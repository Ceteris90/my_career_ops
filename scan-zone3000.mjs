#!/usr/bin/env node

/**
 * scan-zone3000.mjs — ZONE3000 vacancies scanner via Playwright
 *
 * ZONE3000 (zone3000.net, the SerpApi/DataImpulse company) publishes its open
 * roles on a single Vue SPA page. The whole site — HTML page and JSON API alike
 * — sits behind a Cloudflare "Just a moment" managed JS challenge: a bare HTTP
 * fetch (including the project's own _http.mjs with a browser-like UA) gets
 * HTTP 403 on every endpoint, while a real browser passes it. That makes this a
 * standalone browser scanner (like scan-interamt.mjs), never a providers/*.mjs
 * fetch module.
 *
 * The page renders every vacancy server-side as a card
 * (`a[href^="/vacancies/"] > div.vacancy__container`), whose text nodes are
 * ordered `[title, location, optionalTagOrPartner]` — the public JSON endpoint
 * `GET /api/vacancies` returns the same inventory in one array, but it ignores
 * keyword/direction/location/tag/page/per_page query params (no server-side
 * pagination or filtering; the on-page filters are client-side) and, unlike the
 * server-rendered HTML, answering it requires an `x-xsrf-token` header derived
 * from a session cookie. So the scanner reads the rendered DOM cards instead of
 * the API — one browser load yields the full inventory with no token handling.
 * The scanner then applies the standard title_filter/location_filter and dedupes
 * through the same scan.mjs helpers the fetch-based providers use.
 *
 * Reads `title_filter` / `location_filter` from portals.yml. Results are
 * appended to data/pipeline.md and data/scan-history.tsv exactly like scan.mjs.
 *
 * Usage:
 *   node scan-zone3000.mjs
 *   node scan-zone3000.mjs --dry-run
 *   node scan-zone3000.mjs --debug
 *   node scan-zone3000.mjs --headless   # usually fails to clear the Cloudflare challenge
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { appendToPipeline, appendToScanHistory, loadSeenUrls, PORTALS_PATH, SCAN_HISTORY_PATH } from './scan.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { localToday } from './lib/local-today.mjs';
import { printScanSummaryHeader } from './lib/scan-summary-marker.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// ── Config ───────────────────────────────────────────────────────────

const SCAN_HISTORY = SCAN_HISTORY_PATH;
const DATA_ROOT    = getCareerOpsRoot();

// Landing page — navigating here passes the Cloudflare challenge and renders the
// full vacancy inventory server-side as DOM cards.
const VACANCIES_URL = 'https://zone3000.net/vacancies';

// ── Args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DEBUG   = args.includes('--debug');
// Zone3000's Cloudflare "Just a moment" managed challenge only auto-solves for a
// real (headed) browser — Playwright's bundled headless Chromium is detected and
// stuck on the challenge forever (measured live). So the scanner runs headed by
// default; a brief browser window opening during the scan is the unavoidable
// tradeoff for this source. `--headless` is an escape hatch, but the challenge
// will likely not clear and the run will fail with a named error.
const HEADLESS = args.includes('--headless');

if (isMainModule(import.meta.url) && (args.includes('--help') || args.includes('-h'))) {
  console.log(`Usage: node scan-zone3000.mjs [--dry-run] [--debug] [--headless]

  --dry-run    print the offers that would be added without writing
  --debug      save the raw extracted cards to output/ for inspection
  --headless   run a headless browser (usually fails to clear the Cloudflare challenge)
  --help, -h   print this help and exit`);
  process.exit(0);
}

// ── Load portals.yml filters ─────────────────────────────────────────

let config = {};
if (existsSync(PORTALS_PATH)) {
  config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
}

const titleFilter = config.title_filter || {};
const positiveKw = (titleFilter.positive || []).map(k => k.toLowerCase());
const negativeKw = (titleFilter.negative || []).map(k => k.toLowerCase());

function matchesTitle(title) {
  const lower = title.toLowerCase();
  if (negativeKw.some(k => lower.includes(k))) return false;
  if (positiveKw.length === 0) return true;
  return positiveKw.some(k => lower.includes(k));
}

const locFilter = config.location_filter || {};
const locAllow = (locFilter.allow || []).map(k => k.toLowerCase());
const locBlock = (locFilter.block || []).map(k => k.toLowerCase());

function matchesLocation(loc) {
  if (!loc) return true;
  const lower = loc.toLowerCase();
  if (locBlock.some(k => lower.includes(k))) return false;
  if (locAllow.length === 0) return true;
  return locAllow.some(k => lower.includes(k));
}

// ── DOM extraction ───────────────────────────────────────────────────

// Read all vacancy cards off the rendered page. Self-contained (no closure over
// module scope) so it serializes cleanly into page.evaluate. Exported for the
// test suite.
export function extractVacancyCards(root) {
  const doc = root ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return [];
  const OFFER_BASE = 'https://zone3000.net/vacancies/';
  const cardTexts = (container) => {
    const out = [];
    const doc = container.ownerDocument || document;
    const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text) out.push(text);
    }
    return out;
  };
  const links = [...(doc.querySelectorAll?.('a[href^="/vacancies/"]') || [])]
    .filter(a => a.querySelector('div.vacancy__container'));
  const jobs = [];
  for (const a of links) {
    const slug = a.getAttribute('href');
    if (!slug) continue;
    const container = a.querySelector('div.vacancy__container');
    const texts = cardTexts(container);
    const title = texts[0] || '';
    if (!title) continue;
    jobs.push({
      title,
      url: `${OFFER_BASE}${slug.replace(/^\/vacancies\//, '')}`,
      location: texts[1] || '',
    });
  }
  // The hot + open sections are mutually exclusive, but guard against the same
  // slug appearing twice anyway — url is the dedup key downstream.
  const seen = new Set();
  return jobs.filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)));
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(join(DATA_ROOT, 'data'), { recursive: true });

  const { seen } = loadSeenUrls();
  const date = localToday();
  const company = config.zone3000_company || 'ZONE3000';

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ locale: 'en-GB' });
  const page = await context.newPage();

  let offers = [];
  try {
    // Navigate to clear the Cloudflare challenge. The challenge auto-solves for a
    // real browser (the JS challenge is not a CAPTCHA, so no human interaction is
    // needed or relayed) but only in headed mode — bundled headless Chromium is
    // detected and stuck. The vacancy cards are server-rendered, so no wait on
    // the SPA hydrating is required once the document has loaded.
    await page.goto(VACANCIES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('div.vacancy__container'), null, { timeout: 45000 });

    offers = await page.evaluate(extractVacancyCards);

    if (DEBUG) {
      const debugDir = join(DATA_ROOT, 'output');
      mkdirSync(debugDir, { recursive: true });
      const debugPng = join(debugDir, 'debug-zone3000.png');
      await page.screenshot({ path: debugPng, fullPage: true });
      console.log(`  [debug] screenshot → ${debugPng}`);
      console.log(`  [debug] cards: ${offers.length}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (offers.length === 0) {
    console.error('Error: no vacancy cards found — either the Cloudflare challenge did not clear in --headless mode, or the board markup changed.');
    process.exit(1);
  }

  for (const o of offers) o.company = company;

  let newOffers = [];
  const titleSkipped = [];
  const locationSkipped = [];
  const dupeSkipped = [];

  for (const canonical of offers) {
    if (!matchesTitle(canonical.title)) { seen.add(canonical.url); titleSkipped.push(canonical); continue; }
    if (!matchesLocation(canonical.location)) { seen.add(canonical.url); locationSkipped.push(canonical); continue; }
    if (seen.has(canonical.url)) { dupeSkipped.push(canonical); continue; }
    seen.add(canonical.url);
    newOffers.push(canonical);
  }

  if (!DRY_RUN) {
    if (newOffers.length > 0) await appendToPipeline(newOffers);
    if (newOffers.length > 0) await appendToScanHistory(newOffers, date, 'added');
    if (titleSkipped.length > 0) await appendToScanHistory(titleSkipped, date, 'skipped_title');
    if (locationSkipped.length > 0) await appendToScanHistory(locationSkipped, date, 'skipped_location');
    if (dupeSkipped.length > 0) await appendToScanHistory(dupeSkipped, date, 'skipped_dup');
  }

  printScanSummaryHeader('ZONE3000 Scan', date);
  console.log(`Total vacancies:     ${offers.length}`);
  console.log(`Filtered by title:   ${titleSkipped.length}`);
  console.log(`Filtered location:   ${locationSkipped.length}`);
  console.log(`Duplicates:          ${dupeSkipped.length}`);
  console.log(`New offers:          ${newOffers.length}`);

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.title} | ${o.location || 'N/A'}`);
    }
    if (DRY_RUN) {
      console.log('\n(dry run — not saved)');
    } else {
      console.log('\nSaved to data/pipeline.md');
    }
  }

  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
}

// Guarded like every sibling scanner (scan-interamt.mjs:377). Unguarded, merely
// IMPORTING this module would drive a live browser scan and append to the user's
// pipeline — a module should not scan the internet as a side effect of being
// loaded (#3510).
if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}