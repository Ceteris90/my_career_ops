// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// GlobalLogic careers provider — single-company provider for tracked_companies.
// Reads GlobalLogic's server-rendered WordPress careers portal
// (globallogic.com/<locale>/career-search-page/), a Hitachi Group subsidiary's
// own listing of its own postings, so it clears the Source Indexing Policy by
// construction (see providers/ADDING_A_PROVIDER.md, "Before the code").
//
// The listing is server-rendered HTML: each posting is an `<a class="job_box">`
// card carrying the posting URL in the href, the title in `<h4>`, the office
// locations in `.top_area .job_location` spans and the work model (Remote /
// Hybrid / On-site) in a `.job_tag` span.
//
// Filters (keywords, job_functions[], experience[], location[], work_models[])
// are read from the careers_url query string — e.g. the user's
// `?work_models=freelance%2Cremote%2Chybrid`. Rather than re-encode them, the
// provider walks the board by following the WordPress `next` pagination link,
// which the server emits with the filters already preserved — the same shape the
// site's own "next" button follows, and the only reliable way to page (the site
// rewrites a `work_models[]=...` array query into a single `work_models=...` on
// load, so never hand-build the paged URL). It stops when a page has no `next`
// link (last page) or the page cap is reached.
//
//   - name: GlobalLogic
//     careers_url: https://www.globallogic.com/ua/career-search-page/?work_models=freelance%2Cremote%2Chybrid
//     enabled: true
//
// Pagination is bounded by the provider's own constant (never by what the
// source reports — see "Absolute page ceiling" in ADDING_A_PROVIDER.md).
// Observed live 2026-09: the unfiltered ua board runs ~50 pages at 10 jobs/page;
// the defaults below have headroom for that and any common filter.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const ALLOWED_HOST = 'www.globallogic.com';
const LISTING_PATH = '/career-search-page/';
const DEFAULT_MAX_PAGES = 100; // 10 jobs/page → 1000 postings; observed board ~500
const MAX_PAGES_CAP = 500;    // hard ceiling even for a user override
const INTER_PAGE_DELAY_MS = 250;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/**
 * Validate a listing URL lives on the allowed host over HTTPS and points at the
 * career-search-page listing. Exported for unit tests.
 * @param {string} value
 * @returns {URL}
 */
export function assertListingUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('globallogic: missing careers_url');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`globallogic: malformed careers_url ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:') throw new Error('globallogic: careers_url must be https:');
  if (url.hostname !== ALLOWED_HOST) throw new Error(`globallogic: untrusted hostname "${url.hostname}" — must be ${ALLOWED_HOST}`);
  if (!url.pathname.endsWith(LISTING_PATH) && !url.pathname.includes(LISTING_PATH)) {
    throw new Error('globallogic: careers_url must point at a /career-search-page/ listing');
  }
  return url;
}

/**
 * Parse one GlobalLogic jobs listing page into normalized Job rows. Exported for
 * unit tests. A malformed card is skipped (continue), never fatal.
 *
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseGlobalLogicPage(html, companyName) {
  const jobs = [];
  const cards = [...String(html ?? '').matchAll(/<a\b([^>]*class="job_box"[^>]*)>([\s\S]*?)<\/a>/g)];
  for (const [, attrs, inner] of cards) {
    const href = attrs.match(/href="([^"]+)"/);
    const title = inner.match(/<h4>([\s\S]*?)<\/h4>/);
    if (!href || !title || !title[1].trim()) continue;
    let parsed;
    try {
      parsed = new URL(href[1]);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST || !parsed.pathname.includes('/careers/')) continue;
    // Office locations + work model tag (Remote/Hybrid/On-site) — join them so
    // location_filter can match either. Cards with neither end up empty, which
    // lets location_filter pass them through (an empty location can't match).
    const parts = [];
    for (const m of inner.matchAll(/<span class="job_location">([\s\S]*?)<\/span>/g)) {
      const t = decodeEntities(m[1].replace(/\s+/g, ' ').trim());
      if (t) parts.push(t);
    }
    const tag = inner.match(/<span class="job_tag">([\s\S]*?)<\/span>/);
    if (tag) {
      const t = decodeEntities(tag[1].replace(/\s+/g, ' ').trim());
      if (t) parts.push(t);
    }
    jobs.push({
      title: decodeEntities(title[1].replace(/\s+/g, ' ').trim()),
      url: parsed.href,
      company: companyName,
      location: parts.join(', '),
    });
  }
  return jobs;
}

/**
 * Extract the WordPress `next` pagination link, resolved to an absolute URL.
 * Returns null on the last page or when the markup has no next link.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string | null}
 */
export function extractNextLink(html, baseUrl) {
  const m = String(html ?? '').match(/<a class="next page-numbers" href="([^"]+)"/);
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).href;
  } catch {
    return null;
  }
}

/** @type {Provider} */
export default {
  id: 'globallogic',

  detect(entry) {
    const raw = entry?.careers_url || entry?.api;
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw);
      const matches = url.protocol === 'https:'
        && url.hostname === ALLOWED_HOST
        && url.pathname.includes(LISTING_PATH);
      return matches ? { url: url.href } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const careersUrl = entry?.careers_url;
    if (!careersUrl) throw new Error(`globallogic: ${entry?.name || '(unnamed)'} has no careers_url`);
    const base = assertListingUrl(careersUrl);
    const probeMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const maxPages = Math.min(resolveMaxPages(entry), probeMax);

    const jobs = [];
    let currentUrl = base.href;
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const html = await fetchTextWithRetry(ctx, currentUrl, { redirect: 'error' });
      jobs.push(...parseGlobalLogicPage(html, entry?.name || 'GlobalLogic'));
      const next = extractNextLink(html, currentUrl);
      if (!next) break;
      currentUrl = next;
    }
    return jobs;
  },
};