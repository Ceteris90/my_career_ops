#!/usr/bin/env node

/**
 * Playwright scanner for The Protocol filtered job-board URLs.
 * The public page is browser-accessible, while plain HTTP is protected by a
 * Cloudflare challenge and the search API requires a browser XSRF session.
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { appendToPipeline, appendToScanHistory, buildLocationFilter, emitJsonReceipt, loadSeenUrls, PORTALS_PATH } from './scan.mjs';
import { buildTitleFilter } from './title-keywords.mjs';
import { localToday } from './lib/local-today.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const HOST = 'theprotocol.it';
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;

/** Normalize one offersResponse from the page's structured Next.js payload. */
export function normalizeTheProtocolResponse(response) {
  if (!response || !Array.isArray(response.offers)) throw new Error('expected offersResponse.offers[]');
  const jobs = [];
  for (const row of response.offers) {
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    const slug = typeof row?.offerUrlName === 'string' ? row.offerUrlName.trim() : '';
    if (!title || !slug || !/^[\p{L}\p{N},._-]+$/u.test(slug)) continue;
    const location = [
      ...(Array.isArray(row.workplace) ? row.workplace.map((place) => place?.location || place?.city) : []),
      ...(Array.isArray(row.workModes) ? row.workModes : []),
    ].filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index).join(', ');
    const postedAt = Date.parse(row.publicationDateUtc || '');
    jobs.push({
      title,
      url: `https://${HOST}/szczegoly/praca/${slug}`,
      company: typeof row.employer === 'string' && row.employer.trim() ? row.employer.trim() : 'The Protocol',
      location,
      source: 'theprotocol-browser',
      postedAt: Number.isNaN(postedAt) ? undefined : postedAt,
    });
  }
  return {
    jobs,
    page: Number(response?.page?.number) || 1,
    pages: Number(response?.page?.count) || 1,
  };
}

export function resolveSearches(config) {
  const searches = Array.isArray(config?.theprotocol_searches) ? config.theprotocol_searches : [];
  return searches.filter((entry) => entry?.enabled !== false && typeof entry?.url === 'string' && entry.url.trim());
}

async function readPageResponse(page) {
  await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 30_000 });
  return page.$eval('#__NEXT_DATA__', (node) => {
    const data = JSON.parse(node.textContent || '{}');
    return data?.props?.pageProps?.offersResponse;
  });
}

async function scanSearch(page, entry) {
  const base = new URL(entry.url);
  if (base.protocol !== 'https:' || base.hostname !== HOST || !base.pathname.startsWith('/filtry/')) {
    throw new Error('URL must use https://theprotocol.it/filtry/...');
  }
  const configured = Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES;
  const maxPages = Math.min(configured, MAX_PAGES_CAP);
  const byUrl = new Map();
  let reportedPages = 1;
  for (let pageNumber = 1; pageNumber <= maxPages && pageNumber <= reportedPages; pageNumber++) {
    if (pageNumber === 1) base.searchParams.delete('pageNumber');
    else base.searchParams.set('pageNumber', String(pageNumber));
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const parsed = normalizeTheProtocolResponse(await readPageResponse(page));
    reportedPages = Math.min(parsed.pages, MAX_PAGES_CAP);
    for (const job of parsed.jobs) byUrl.set(job.url, job);
  }
  if (reportedPages > maxPages) console.error(`  ⚠ ${entry.name || 'The Protocol'} truncated at max_pages=${maxPages} of ${reportedPages}`);
  return [...byUrl.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--dry-run', '--headless', '--json', '--help', '-h']);
  const unknown = args.filter((arg) => arg.startsWith('-') && !known.has(arg));
  if (unknown.length) throw new Error(`unrecognized flag(s): ${unknown.join(', ')}`);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scan-theprotocol.mjs [--dry-run] [--headless] [--json]');
    return;
  }
  const dryRun = args.includes('--dry-run');
  const jsonMode = args.includes('--json');
  const config = existsSync(PORTALS_PATH) ? yaml.load(readFileSync(PORTALS_PATH, 'utf8')) || {} : {};
  const searches = resolveSearches(config);
  if (searches.length === 0) throw new Error('no enabled theprotocol_searches entries in portals.yml');
  const titleMatches = buildTitleFilter(config.title_filter || {});
  const locationMatches = buildLocationFilter(config.location_filter || {});
  const { seen } = loadSeenUrls();
  const accepted = [], titleSkipped = [], locationSkipped = [], duplicateSkipped = [], errors = [];
  let total = 0;

  // The site's Cloudflare policy challenges headless Chromium. A normal visible
  // browser is the supported path; no stealth flags or cookie replay are used.
  const browser = await chromium.launch({ headless: args.includes('--headless') });
  const context = await browser.newContext({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
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
        errors.push({ name: entry.name || 'The Protocol', error: error.message });
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
      source: 'theprotocol',
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
    printScanSummaryHeader('The Protocol Scan', localToday());
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
