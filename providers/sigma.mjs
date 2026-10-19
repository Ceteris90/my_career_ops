// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Sigma Software careers provider — single-company WordPress careers portal
// (career.sigma.software) for tracked_companies. The site is a single-company
// ATS adapter: postings are Sigma Software's own, so it clears the Source
// Indexing Policy by construction (see providers/ADDING_A_PROVIDER.md, "Before
// the code").
//
// The board is server-rendered React but the listings themselves are not in
// the initial HTML: the site issues an AJAX POST to wp-admin/admin-ajax.php,
// action `filter_vacancies_v2_loadmore`, paged with `page` (0-indexed). Each
// response is a JSON envelope `{ success: true, data: { html, has_more } }`
// whose `html` is a fragment of `<a class="vacancy-card-new">` cards — title in
// the `<h3 class="vacancy-card-new__title">` (with the parenthetical in a
// `<span class="subtitle">`), location in the
// `.vacancy-card-new__locations span`. Company is fixed to Sigma Software — the
// portal only ever lists the employer's own roles.
//
// Filters are passed through from careers_url's query string: `direction`,
// `locations`, `seniority` and `workplace_type` (comma-separated values that
// the API wants as JSON arrays) plus `keyword`. When a `direction` filter is
// present the site also sends `direction_type=children`, so the provider does
// too. The walk starts at page 0 and stops when the source reports
// `has_more: false` or a page parses to no cards.
//
//   - name: Sigma Software
//     careers_url: https://career.sigma.software/what-we-offer/vacancies/?direction=android%2Cios%2Cjavascript%2Creact%2Creact-native
//     enabled: true
//
// Pagination is bounded by the provider's own constant (never by what the
// source reports — see "Absolute page ceiling" in ADDING_A_PROVIDER.md).
// Observed live 2026-09: the filtered board runs two pages (~64 + 16 jobs) at
// the default page size, so the defaults below have wide headroom.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'career.sigma.software';
const AJAX_PATH = '/wp-admin/admin-ajax.php';
const ACTION = 'filter_vacancies_v2_loadmore';
const COMPANY = 'Sigma Software';
const DEFAULT_MAX_PAGES = 20; // ~64 jobs/page → ~1280 jobs; the board is far smaller
const MAX_PAGES_CAP = 100;    // hard ceiling even for a user override
const INTER_PAGE_DELAY_MS = 200;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/**
 * Turn the filter query params a user put on careers_url into the form fields
 * the admin-ajax action expects. List-valued params (`direction`, `locations`,
 * `seniority`, `workplace_type`) are comma-separated in the URL and JSON arrays
 * in the body; `keyword` passes through verbatim.
 *
 * @param {string} careersUrl
 * @returns {URLSearchParams}
 */
export function buildSigmaFilters(careersUrl) {
  const u = new URL(careersUrl);
  const params = new URLSearchParams();
  const listParams = ['direction', 'locations', 'seniority', 'workplace_type'];
  let hasDirection = false;
  for (const key of listParams) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (values.length) {
      params.set(key, JSON.stringify(values));
      if (key === 'direction') hasDirection = true;
    }
  }
  if (hasDirection) params.set('direction_type', 'children');
  const keyword = u.searchParams.get('keyword');
  if (keyword) params.set('keyword', keyword);
  return params;
}

/**
 * Parse one admin-ajax JSON envelope. Exported for unit tests. A contentless
 * body (`''`, `null`, `{}`, `[]`) reads as "endpoint alive, nothing matched"
 * and yields an empty page; a non-JSON body or an envelope without the
 * documented `data.html` / `data.has_more` shape throws — a silent API change
 * is better surfaced than a board that quietly returns 0 forever.
 *
 * @param {unknown} text
 * @returns {{ html: string, hasMore: boolean }}
 */
export function parseSigmaAjax(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { html: '', hasMore: false };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('sigma: admin-ajax returned non-JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { html: '', hasMore: false };
  }
  if (Object.keys(parsed).length === 0) return { html: '', hasMore: false };
  if (parsed.success !== true || parsed.data === undefined || parsed.data === null || typeof parsed.data !== 'object') {
    throw new Error(`sigma: unexpected admin-ajax envelope (got keys: ${Object.keys(parsed).join(',')})`);
  }
  return {
    html: typeof parsed.data.html === 'string' ? parsed.data.html : '',
    hasMore: parsed.data.has_more === true,
  };
}

/**
 * Parse one admin-ajax HTML fragment into normalized Job rows. Exported for
 * unit tests. A malformed card is skipped (continue), never fatal.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseSigmaCards(html) {
  const jobs = [];
  for (const match of String(html ?? '').matchAll(/<a class="vacancy-card-new" href="([^"]+)"[\s\S]*?<\/a>/g)) {
    let url;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname !== HOST) continue;
    const card = match[0];
    const titleMatch = card.match(/class="vacancy-card-new__title"[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleMatch
      ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
      : '';
    if (!title) continue;
    const locMatch = card.match(/class="vacancy-card-new__locations"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/);
    const location = locMatch ? decodeEntities(locMatch[1].replace(/\s+/g, ' ').trim()) : '';
    jobs.push({ title, url: url.href, company: COMPANY, location });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'sigma',

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
    const base = entry?.careers_url || entry?.api;
    if (typeof base !== 'string') {
      throw new Error(`sigma: ${entry?.name || '(unnamed)'} has no careers_url`);
    }
    let url;
    try {
      url = new URL(base);
    } catch {
      throw new Error(`sigma: untrusted careers_url ${base}`);
    }
    if (url.protocol !== 'https:' || url.hostname !== HOST) {
      throw new Error(`sigma: untrusted careers_url ${base}`);
    }
    const ajaxUrl = `https://${HOST}${AJAX_PATH}`;
    const filters = buildSigmaFilters(base);

    const ctxMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const maxPages = Math.min(resolveMaxPages(entry), ctxMax);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;

    const jobs = [];
    let page = 0;
    let ended = false;
    for (; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = new URLSearchParams({ action: ACTION, page: String(page) });
      for (const [key, value] of filters) body.set(key, value);
      const text = await fetchTextWithRetry(ctx, ajaxUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'error',
      });
      const { html, hasMore } = parseSigmaAjax(text);
      const pageJobs = parseSigmaCards(html);
      // A first page that shipped cards but parsed to none is a markup break,
      // not an empty board — surface it instead of quietly returning 0 forever.
      if (page === 0 && pageJobs.length === 0 && html.trim()) {
        throw new Error('sigma: page 0 returned cards but none parsed — card markup likely changed');
      }
      jobs.push(...pageJobs);
      if (!hasMore || pageJobs.length === 0) { ended = true; break; }
    }

    // Cap warning: the board was truncated by the config cap, not by the source
    // signalling its end. Silent under ctx.maxPages (verify-portals asking for
    // one page on purpose).
    if (!ended && page >= maxPages && maxPages === resolveMaxPages(entry) && !probing) {
      console.error(`⚠️  sigma: ${entry?.name || COMPANY} truncated at max_pages=${maxPages} — raise max_pages on this entry for the full board`);
    }
    return jobs;
  },
};