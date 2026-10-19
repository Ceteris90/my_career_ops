// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Dev.Pro careers provider — single-company WordPress careers portal
// (career.dev.pro) for tracked_companies. The site is a single-company ATS
// adapter: postings are Dev.Pro's own, so it clears the Source Indexing Policy
// by construction (see providers/ADDING_A_PROVIDER.md, "Before the code").
//
// The jobs listing is server-rendered HTML. Each posting is an
// `<a href="https://career.dev.pro/vacancy/{hex}/" class="position-row">`
// row with the title in an `<h3>` and the location (e.g. "Latin America,
// Remote") in the `.position-info` `<span>`. Some rows carry a template
// "Career Opportunities at Dev.Pro" suffix on the title; that boilerplate is
// stripped so titles match the actual role. Company is fixed to Dev.Pro — the
// portal only ever lists the employer's own roles.
//
// Filters (location / level / search) are client-side dropdowns that re-issue
// the page with query params on the base path (`?location=latin-america&level=
// senior`); the server-rendered board honors them. Pagination is WordPress
// numbered links on `/open-positions/page/N/`, which the server emits with the
// filters already preserved (`/open-positions/page/2/?location=latin-america`).
// There is no `next` link to follow — the provider increments the page number
// and rebuilds the URL, preserving the query string, and stops on a partial
// page (< PAGE_SIZE rows, which is always the last) or the page cap. A
// past-the-end page answers 200 with zero rows, so the partial-page bound is
// the termination signal, not HTTP status.
//
//   - name: Dev.Pro
//     careers_url: https://career.dev.pro/open-positions/
//     enabled: true
//
// Pagination is bounded by the provider's own constant (never by what the
// source reports — see "Absolute page ceiling" in ADDING_A_PROVIDER.md).
// Observed live 2026-09: the unfiltered board runs 4 pages of 10 jobs/page
// (~40 jobs), so the defaults below have wide headroom.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'career.dev.pro';
const VACANCY_PREFIX = `https://${HOST}/vacancy/`;
const DEFAULT_MAX_PAGES = 20; // ~10 jobs/page → ~200 jobs; the full board is ~40
const MAX_PAGES_CAP = 100;    // hard ceiling even for a user override
const INTER_PAGE_DELAY_MS = 200;
const PAGE_SIZE = 10;         // observed 10 rows/page (unfiltered and filtered)
const TITLE_SUFFIX_RE = /\s*Career Opportunities at Dev\.Pro\s*$/;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/**
 * Normalize a Dev.Pro careers URL to its pagination components. Returns the
 * origin, the page-1 root path (a `/open-positions/`-style path, always with a
 * trailing slash), the starting page (1, or the number when the URL is already
 * a `/page/N/` URL), and the preserved query string (filters).
 *
 * @param {string} baseUrl
 * @returns {{ origin: string, rootPath: string, startPage: number, search: string }}
 */
export function parseDevProBase(baseUrl) {
  const u = new URL(baseUrl);
  const m = u.pathname.match(/^(.*)\/page\/(\d+)\/$/);
  let rootPath;
  let startPage;
  if (m) {
    rootPath = m[1];
    startPage = parseInt(m[2], 10);
  } else {
    rootPath = u.pathname;
    startPage = 1;
  }
  if (!rootPath.endsWith('/')) rootPath += '/';
  return { origin: u.origin, rootPath, startPage, search: u.search };
}

/**
 * Build the URL for a given page, preserving the query string (filters).
 * Page 1 is the bare root path; pages past the first use `/page/{N}/`.
 *
 * @param {string} baseUrl
 * @param {number} page
 * @returns {string}
 */
export function buildDevProPageUrl(baseUrl, page) {
  const { origin, rootPath, startPage, search } = parseDevProBase(baseUrl);
  const p = Number.isInteger(page) && page > 0 ? page : startPage;
  if (p === 1) return `${origin}${rootPath}${search}`;
  return `${origin}${rootPath}page/${p}/${search}`;
}

/**
 * Parse one Dev.Pro listings page into normalized Job rows. Exported for unit
 * tests. A malformed row is skipped (continue), never fatal.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseDevProPage(html) {
  const jobs = [];
  const rows = String(html ?? '').split(`<a href="${VACANCY_PREFIX}`).slice(1);
  for (const row of rows) {
    const id = row.match(/^([0-9a-f]{6,})\/" class="position-row"/);
    if (!id) continue;
    const title = row.match(/<h3>([\s\S]*?)<\/h3>/);
    if (!title || !title[1].trim()) continue;
    // Location is the text of the .position-info <span>; a row with no span
    // leaves it empty so location_filter lets it through (an empty location
    // can't match a block term), matching how other list-page providers behave.
    const loc = row.match(/<div class="position-info">\s*<span>([\s\S]*?)<\/span>/);
    jobs.push({
      title: decodeEntities(title[1].replace(/\s+/g, ' ').replace(TITLE_SUFFIX_RE, '').trim()),
      url: `${VACANCY_PREFIX}${id[1]}/`,
      company: 'Dev.Pro',
      location: loc ? decodeEntities(loc[1].replace(/\s+/g, ' ').trim()) : '',
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'devpro',

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
    const raw = entry.careers_url || entry.api;
    let base;
    try {
      base = new URL(raw);
    } catch {
      throw new Error(`devpro: malformed careers_url ${raw}`);
    }
    if (base.protocol !== 'https:' || base.hostname !== HOST) {
      throw new Error(`devpro: untrusted careers_url ${raw}`);
    }

    const { startPage } = parseDevProBase(base.href);
    const isProbe = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryCap = resolveMaxPages(entry);
    const cap = isProbe ? Math.min(entryCap, ctx.maxPages) : entryCap;

    const jobs = [];
    let reachedCap = false;
    for (let page = startPage; page < startPage + cap; page++) {
      if (page > startPage) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = buildDevProPageUrl(base.href, page);
      const html = await fetchTextWithRetry(ctx, url, { redirect: 'error' });
      const pageJobs = parseDevProPage(html);
      jobs.push(...pageJobs);
      // A partial page (< PAGE_SIZE rows) or an empty past-the-end page is the
      // last page — the source returns 200, so the row count is the signal.
      if (pageJobs.length < PAGE_SIZE) break;
      if (page === startPage + cap - 1) reachedCap = true;
    }
    // Warn only on a real scan (never a probe) stopped by the page ceiling —
    // that message means the cap truncated a healthy board, not that it broke.
    if (reachedCap && !isProbe) {
      console.warn(
        `devpro: page ceiling reached on "${entry.name || 'Dev.Pro'}" — raise max_pages to fetch the full board`,
      );
    }
    return jobs;
  },
};