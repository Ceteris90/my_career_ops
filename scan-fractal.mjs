#!/usr/bin/env node

/**
 * scan-fractal.mjs — career.fractal.partners scanner via Playwright
 *
 * FRACTAL (Netpeak Group) hosts a Vue SSR vacancy board. There is no JSON API:
 * the posting list is server-rendered straight into the DOM, and the whole site
 * sits behind a Cloudflare managed challenge, so a plain HTTP client gets a 403
 * "Just a moment..." interstitial regardless of headers. Playwright drives a real
 * browser (the same choice as scan-interamt.mjs and scan-theprotocol.mjs) so the
 * challenge is passed transparently.
 *
 * Filters and pagination are baked into the URL, not POSTed or clicked. The
 * board does not paginate — the full filtered result set renders on one page and
 * a `page=` query param is ignored. Each configured search is therefore a single
 * page load with its own query string, e.g.
 *
 *   ?directions=development&levels=middle,senior,middle-plus
 *
 * Reads `fractal_searches` from portals.yml (same shape as theprotocol_searches),
 * each entry a `{ name, url, enabled }` filtered search. Falls back to the
 * default development/middle+senior filter if the section is absent.
 *
 * Usage:
 *   node scan-fractal.mjs
 *   node scan-fractal.mjs --dry-run
 *   node scan-fractal.mjs --headless
 *   node scan-fractal.mjs --json          # emit machine-readable receipt
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { appendToPipeline, appendToScanHistory, buildLocationFilter, emitJsonReceipt, loadSeenUrls, PORTALS_PATH } from './scan.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { localToday } from './lib/local-today.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const HOST = 'career.fractal.partners';

const DEFAULT_SEARCH_URL =
  'https://career.fractal.partners/ua/vacancy/?directions=development&levels=middle,senior,middle-plus';

/** Normalize one FRACTAL job-card anchor's DOM into a scanner Job. */
export function normalizeFractalCard(card) {
  const href = typeof card?.href === 'string' ? card.href.trim() : '';
  const m = /\/ua\/vacancy\/([0-9a-f]{6})\/$/.exec(href);
  if (!m) return null;
  const title = (card?.titleText || '').trim().replace(/^🔥\s*/, '').trim();
  if (!title) return null;
  const filters = (card?.filters || []).map((f) => (typeof f === 'string' ? f.trim() : '')).filter(Boolean);
  const language = filters[1] || '';
  const location = (card?.locations || []).map((l) => (typeof l === 'string' ? l.trim() : '')).filter(Boolean).join(', ');
  return {
    title,
    url: `https://${HOST}/ua/vacancy/${m[1]}/`,
    company: 'FRACTAL',
    location,
    source: 'fractal-browser',
  };
}

/**
 * Parse a rendered listing page into raw card data. The board is a Vue app;
 * scoping every `.filter-text` to its own card keeps a card's language/location
 * from leaking into its neighbour. Returns the normalized cards for
 * normalizeFractalCard to finish.
 */
export function parseFractalPage(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('a.job-card[href*="/ua/vacancy/"]')].map((anchor) => {
      const titleText = anchor.querySelector('.job-title-text')?.textContent || '';
      const filters = [...anchor.querySelectorAll('.filters-block .fillters .job-filter .filter-text')]
        .map((el) => el.textContent || '').filter(Boolean);
      const locations = [...anchor.querySelectorAll('.filters-locations .job-filter .filter-text')]
        .map((el) => el.textContent || '').filter(Boolean);
      return { href: anchor.href, titleText, filters, locations };
    });
    return cards;
  });
}

export function resolveSearches(config) {
  const searches = Array.isArray(config?.fractal_searches) ? config.fractal_searches : [];
  const configured = searches.filter((entry) => entry?.enabled !== false && typeof entry?.url === 'string' && entry.url.trim());
  return configured.length ? configured : [{ name: 'FRACTAL default', url: DEFAULT_SEARCH_URL }];
}

async function scanSearch(page, entry) {
  const base = new URL(entry.url);
  if (base.protocol !== 'https:' || base.hostname !== HOST || !base.pathname.startsWith('/ua/vacancy')) {
    throw new Error('URL must use https://career.fractal.partners/ua/vacancy...');
  }
  await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('a.job-card[href*="/ua/vacancy/"]', { state: 'attached', timeout: 30_000 }).catch(() => null);
  // A page that clearly IS the vacancy board but yielded no cards means the
  // Cloudflare challenge did not clear (headless is often stuck on it) or the
  // markup changed — a named error, not a silent "board with no jobs".
  const cards = await parseFractalPage(page);
  if (cards.length === 0) {
    const title = await page.title().catch(() => '');
    if (/just a moment|enable javascript|challenge/i.test(title)) {
      throw new Error(`Cloudflare challenge did not clear (page: "${title}") — try a headed run (no --headless)`);
    }
    throw new Error('no job-card elements found — the FRACTAL board markup may have changed');
  }
  const jobs = [];
  for (const card of cards) {
    const job = normalizeFractalCard(card);
    if (job) jobs.push(job);
  }
  return jobs;
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--dry-run', '--headless', '--json', '--help', '-h']);
  const unknown = args.filter((arg) => arg.startsWith('-') && !known.has(arg));
  if (unknown.length) throw new Error(`unrecognized flag(s): ${unknown.join(', ')}`);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scan-fractal.mjs [--dry-run] [--headless] [--json]');
    return;
  }
  const dryRun = args.includes('--dry-run');
  const jsonMode = args.includes('--json');
  const config = existsSync(PORTALS_PATH) ? yaml.load(readFileSync(PORTALS_PATH, 'utf8')) || {} : {};
  const searches = resolveSearches(config);
  const titleMatches = buildTitleFilter(config.title_filter || {});
  const locationMatches = buildLocationFilter(config.location_filter || {});
  const { seen } = loadSeenUrls();
  const accepted = [], titleSkipped = [], locationSkipped = [], duplicateSkipped = [], errors = [];
  let total = 0;

  // The site's Cloudflare managed challenge rejects headless Chromium unless a
  // real browser solves it. A visible browser is the supported path; no stealth
  // flags or cookie replay are used.
  const browser = await chromium.launch({ headless: args.includes('--headless') });
  const context = await browser.newContext({ locale: 'uk-UA', timezoneId: 'Europe/Kiev' });
  const page = await context.newPage();
  try {
    for (const entry of searches) {
      try {
        const jobs = await scanSearch(page, entry);
        total += jobs.length;
        for (const job of jobs) {
          if (!titleMatches(job.title)) { titleSkipped.push(job); continue; }
          if (!locationMatches(job.location, job.url, job.title)) { locationSkipped.push(job); continue; }
          if (seen.has(job.url)) { duplicateSkipped.push(job); continue; }
          seen.add(job.url);
          accepted.push(job);
        }
      } catch (error) {
        errors.push({ name: entry.name || 'FRACTAL', error: error.message });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!dryRun) {
    const date = localToday();
    if (accepted.length) await appendToPipeline(accepted);
    if (accepted.length) await appendToScanHistory(accepted, date, 'added');
    if (titleSkipped.length) await appendToScanHistory(titleSkipped, date, 'skipped_title');
    if (locationSkipped.length) await appendToScanHistory(locationSkipped, date, 'skipped_location');
    if (duplicateSkipped.length) await appendToScanHistory(duplicateSkipped, date, 'skipped_dup');
  }

  if (jsonMode) {
    emitJsonReceipt({
      version: 'careerops.browser-scan.receipt@1',
      source: 'fractal',
      scanned: searches.length,
      found: total,
      filtered_title: titleSkipped.length,
      filtered_location: locationSkipped.length,
      duplicates: duplicateSkipped.length,
      added: accepted.length,
      added_urls: accepted.map((offer) => offer.url),
      errors,
      dry_run: dryRun,
    }, errors.length ? 2 : 0);
  } else {
    printScanSummaryHeader('FRACTAL Scan', localToday());
    console.log(`Searches:            ${searches.length}`);
    console.log(`Total found:         ${total}`);
    console.log(`Filtered by title:   ${titleSkipped.length}`);
    console.log(`Filtered location:   ${locationSkipped.length}`);
    console.log(`Duplicates:          ${duplicateSkipped.length}`);
    console.log(`New offers:          ${accepted.length}`);
    if (errors.length) for (const error of errors) console.log(`  ✗ ${error.name}: ${error.error}`);
    if (dryRun) console.log('\n(dry run — no files written)');
    if (errors.length) process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal:', error.message);
    process.exit(1);
  });
}