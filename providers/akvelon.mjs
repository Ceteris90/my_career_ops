// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Akvelon careers provider — single-company provider for tracked_companies.
// Auto-detects from careers_url on `akvelon.com` (Akvelon's own WordPress
// careers site). The careers page is server-rendered by JetEngine; the two
// skill/category selects on the page are JetSmartFilters that hide/show the
// same rendered cards client-side. Underneath both is the standard WordPress
// REST API on the `vacancy` post type, which is the canonical full-inventory
// source and the one the provider reads:
//
//   https://akvelon.com/wp-json/wp/v2/vacancy?per_page=100&page=N
//
//   - Filters: the page's JetSmartFilters never hit the server (they filter
//     the already-rendered set), so there is nothing to forward — the REST
//     collection returns the FULL inventory and scan.mjs applies
//     title_filter / location_filter downstream (recall-first).
//   - Pagination: `per_page` (max 100) + `page`. The response's
//     `X-WP-TotalPages` header gives the page count; the provider walks up to
//     min(own cap, header) pages. A page past the end answers 400, so the walk
//     is bounded by the header (capped) rather than by probing into that error.
//   - Each item carries `title.rendered`, `link` (absolute posting URL) and
//     `date` (postedAt). The list payload has no location — cards only show the
//     generic "Offshore"/"Remote" tag, which is not country-specific, so no
//     per-posting enrichment is worth the extra requests (the provider stays
//     zero-token).

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

// The careers site is served from both the bare and www hosts.
const ALLOWED_HOSTS = new Set(['akvelon.com', 'www.akvelon.com']);
const REST_PATH = '/wp-json/wp/v2/vacancy';
const PER_PAGE = 100;
// ~100 postings/page → 20 pages covers 2000 postings, far beyond any live
// volume on a single-company board.
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 250;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

const restUrl = (origin, page) => `${origin}${REST_PATH}?per_page=${PER_PAGE}&page=${page}`;

/**
 * Resolve the site origin from the entry's careers_url / api, validating it is
 * https on an allowed akvelon.com host. Returns null when the entry points
 * elsewhere.
 * @param {any} entry
 * @returns {string|null}
 */
export function resolveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch { continue; }
    if (parsed.protocol !== 'https:') continue;
    if (!ALLOWED_HOSTS.has(parsed.hostname)) continue;
    return parsed.origin;
  }
  return null;
}

function assertAkvelonOrigin(origin) {
  let parsed;
  try { parsed = new URL(origin); } catch {
    throw new Error(`akvelon: invalid origin: ${origin}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`akvelon: origin must use HTTPS: ${origin}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`akvelon: untrusted hostname "${parsed.hostname}"`);
  }
}

/** NaN-safe date parse — a date *string* can return NaN; the guard is for the
 * absent/empty field before parsing. */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse one WP REST `vacancy` collection page (a JSON array) into Jobs. An
 * empty array (or a contentless body) is a valid empty page → `[]`. A body
 * that isn't the documented array shape throws a descriptive error (a silent
 * API change). Rows missing title/link, or whose link doesn't resolve to an
 * allowed host under `/vacancy/`, are dropped — never fatal. Exported for unit
 * tests.
 * @param {unknown} items
 * @param {any} entry
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseAkvelonResponse(items, entry) {
  if (!Array.isArray(items)) {
    const kind = items === null ? 'null' : typeof items;
    throw new Error(`akvelon: unexpected API response — expected a vacancy[], got ${kind}`);
  }
  const jobs = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rawTitle = item.title && typeof item.title === 'object' ? item.title.rendered : null;
    const title = typeof rawTitle === 'string' ? decodeEntities(rawTitle.replace(/\s+/g, ' ').trim()) : '';
    if (!title) continue;
    const link = typeof item.link === 'string' ? item.link : '';
    if (!link) continue;
    let parsed;
    try { parsed = new URL(link); } catch { continue; }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || !parsed.pathname.startsWith('/vacancy/')) continue;
    const job = {
      title,
      url: `${parsed.origin}${parsed.pathname}`,
      company: entry?.name || 'Akvelon',
      location: '',
    };
    const ts = toEpochMs(item.date);
    if (ts !== undefined) job.postedAt = ts;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'akvelon',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: restUrl(origin, 1) } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`akvelon: cannot derive origin for ${entry?.name || '(unnamed)'}`);
    assertAkvelonOrigin(origin);

    const ctxMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(resolveMaxPages(entry), ctxMax);

    const byUrl = new Map();
    let totalPages = null;
    let reachedEnd = false;

    for (let page = 1; page <= pageLimit; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = restUrl(origin, page);
      let items;
      if (page === 1) {
        // fetchResponse so we can read X-WP-TotalPages — a page past the end
        // answers 400, so the walk is bounded by the header (capped), not by
        // probing into that error. This also keeps the single page a probe
        // (ctx.maxPages: 1) makes under one un-retried request.
        const res = await ctx.fetchResponse(url, { redirect: 'error' });
        const header = res.headers?.get?.('x-wp-totalpages');
        const parsed = Number(header);
        if (Number.isInteger(parsed) && parsed > 0) totalPages = parsed;
        items = await res.json();
      } else {
        items = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      }
      const pageJobs = parseAkvelonResponse(items, entry);
      for (const job of pageJobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      if (pageJobs.length === 0) { reachedEnd = true; break; }
      // Stop at the source's page count when the header is present. Only
      // reaching the source's OWN last page counts as a natural end — stopping
      // at the config ceiling while the header reports more pages is a cap
      // truncation (reachedEnd stays false → the "raise max_pages" warning).
      if (totalPages !== null && page >= totalPages) { reachedEnd = true; break; }
    }

    // The "raise max_pages" warning is tied to the entry/DEFAULT stop — never a
    // ctx.maxPages cap or a probe cut-off. When pageLimit resolved to the config
    // cap (not ctx) and we ran out of pages without the source reporting end,
    // the cap truncated a larger board.
    if (!reachedEnd && pageLimit === resolveMaxPages(entry)) {
      console.error(`  ⚠ akvelon: reached max_pages=${resolveMaxPages(entry)}; raise max_pages on this entry to cover the full board`);
    }
    return [...byUrl.values()];
  },
};