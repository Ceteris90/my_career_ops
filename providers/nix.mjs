// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// N-iX careers provider — single-company WordPress careers portal
// (careers.n-ix.com) for tracked_companies. The site is a single-company ATS
// adapter: postings are N-iX's own, so it clears the Source Indexing Policy by
// construction (see providers/ADDING_A_PROVIDER.md, "Before the code").
//
// The jobs listing is server-rendered HTML. Each posting is a
// `<div class="job-card-sm">` card with the title/URL in an `<a class="title">`
// and the location in a second `.info-list` block whose row carries a
// location.svg image. Company is fixed to N-iX — the portal only ever lists the
// employer's own roles.
//
// Filters (subcat[]/categories[]/work_type[]/level[]/country[]/keyword) are
// passed through as query params on careers_url; the site's own pagination
// re-encodes them as indexed arrays (subcat[0]=...) on the `/jobs/page/N/`
// path. Rather than reconstruct that encoding, the provider walks the board by
// following the WordPress `next` pagination link, which the server emits with
// the filters already preserved — the same shape the site's own "next" button
// follows. It stops when a page has no `next` link (last page) or the page cap
// is reached.
//
//   - name: N-iX
//     careers_url: https://careers.n-ix.com/jobs/?subcat%5B%5D=Android&subcat%5B%5D=iOS&subcat%5B%5D=JavaScript&work_type%5B%5D=Remote&work_type%5B%5D=Office+based&keyword=
//     enabled: true
//
// Pagination is bounded by the provider's own constant (never by what the
// source reports — see "Absolute page ceiling" in ADDING_A_PROVIDER.md).
// Observed live 2026-09: the unfiltered board runs 11 pages (~9 jobs/page), so
// the defaults below have wide headroom; a filters URL usually fits on a single
// page.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'careers.n-ix.com';
const DEFAULT_MAX_PAGES = 20; // ~9 jobs/page → ~180 jobs; the full board is ~100
const MAX_PAGES_CAP = 100;    // hard ceiling even for a user override
const INTER_PAGE_DELAY_MS = 200;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

function sleepHook(ms, ctx) {
  return sleep(ms, ctx);
}

/**
 * Parse one N-iX jobs listing page into normalized Job rows. Exported for unit
 * tests. A malformed card is skipped (continue), never fatal.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseNixPage(html) {
  const jobs = [];
  const cards = String(html ?? '').split('<div class="job-card-sm">').slice(1);
  for (const card of cards) {
    const link = card.match(/<a href="(https:\/\/careers\.n-ix\.com\/jobs\/[^"]+)" class="title">([\s\S]*?)<\/a>/);
    if (!link || !link[2].trim()) continue;
    // Location is the row after the location.svg image in the card's second
    // .info-list block. Cards whose second .info-list is missing location end
    // up empty — location_filter then lets them through (an empty location
    // can't match a block term), matching how other list-page providers behave.
    const location = card.match(/<img[^>]*location\.svg[^>]*\/>([\s\S]*?)<\/span>/);
    jobs.push({
      title: decodeEntities(link[2].replace(/\s+/g, ' ').trim()),
      url: link[1],
      company: 'N-iX',
      location: location ? decodeEntities(location[1].replace(/\s+/g, ' ').trim()) : '',
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
  id: 'nix',

  detect(entry) {
    const raw = entry?.careers_url || entry?.api;
    if (typeof raw !== 'string') return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname === HOST ? { url: url.href } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const base = new URL(entry.careers_url);
    if (base.protocol !== 'https:' || base.hostname !== HOST) {
      throw new Error(`nix: untrusted careers_url ${entry.careers_url}`);
    }
    const probeMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const maxPages = Math.min(resolveMaxPages(entry), probeMax);

    const jobs = [];
    let currentUrl = base.href;
    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleepHook(INTER_PAGE_DELAY_MS, ctx);
      const html = await fetchTextWithRetry(ctx, currentUrl, { redirect: 'error' });
      jobs.push(...parseNixPage(html));
      const next = extractNextLink(html, currentUrl);
      if (!next) break;
      currentUrl = next;
    }
    return jobs;
  },
};