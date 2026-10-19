// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Innovecs careers provider — single-company careers portal
// (jobs.innovecs.com) for tracked_companies. The site is a single-company ATS
// adapter: postings are Innovecs' own, so it clears the Source Indexing Policy
// by construction (see providers/ADDING_A_PROVIDER.md, "Before the code").
//
// The listing is server-rendered HTML. Page 1 — the careers_url, e.g.
// `/vacancies/` or a category path like `/vacancies/java/` — is a full page
// whose job cards are `<a class="box box--archive-vacancies-v2--vacancies--item">`
// anchors: title in a `.title-item` div, locations (separated by
// `<span class="line"></span>`) in a `.info.h20` div. A "Load More" button on
// page 1 drives the rest of the pagination.
//
// Each later page lives at `{careers_url}page/{N}/` and is served as a bare
// fragment of job-card markup (no page chrome). Measured live 2026-09: the
// board ran 14 postings — page 1 (10 cards) plus page 2 (fragment, 4 cards);
// pages 3+ answered with a full HTML document again (the site re-renders the
// whole template past the last real page instead of returning an empty
// fragment). The provider therefore stops pagination on a page N≥2 when the
// response is a full HTML document or parses to zero cards, whichever comes
// first.
//
// Category filters are plain path segments on careers_url (no query string),
// so building page URLs off the careers_url preserves them automatically.
//
//   - name: Innovecs
//     careers_url: https://jobs.innovecs.com/vacancies/
//     enabled: true
//
// Pagination is bounded by the provider's own constant (never by what the
// source reports — see "Absolute page ceiling" in ADDING_A_PROVIDER.md).

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const CAREERS_HOST = 'jobs.innovecs.com';

// Default page cap. The site's load-more walk is short (the whole board is a
// handful of pages), so this is generous; a growing board just walks deeper.
const DEFAULT_MAX_PAGES = 20;
// Hard ceiling even for an explicit override.
const MAX_PAGES_CAP = 100;

// The site is Cloudflare-fronted; a short delay between page requests keeps a
// deep pagination walk from tripping rate-limit bursts.
const INTER_PAGE_DELAY_MS = 250;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Assert a careers_url lives on the Innovecs careers host over HTTPS. */
function assertInnovecsUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('innovecs: missing careers_url');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`innovecs: malformed careers_url ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:') throw new Error('innovecs: careers_url must be https:');
  if (url.hostname !== CAREERS_HOST) throw new Error(`innovecs: unexpected host ${url.hostname}`);
  if (!url.pathname.startsWith('/vacancies')) throw new Error('innovecs: careers_url must point at /vacancies');
  return url;
}

/** Build the listing URL for a page number of a careers_url. */
export function pageUrl(careersUrl, page) {
  const base = careersUrl.endsWith('/') ? careersUrl : `${careersUrl}/`;
  return page <= 1 ? base : `${base}page/${page}/`;
}

/** Whether a fetched page is a full HTML document rather than a card fragment. */
export function isFullDocument(html) {
  return /<(?:!doctype html|html\b)/i.test(String(html ?? ''));
}

/**
 * Parse one Innovecs listing page (full page or fragment) into normalized Job
 * rows. Exported for unit tests. A malformed card is skipped (continue), never
 * fatal.
 *
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseInnovecsPage(html, companyName) {
  const jobs = [];
  const body = String(html ?? '');
  // One card is a whole `<a ... href=...>…</a>` element; title and locations
  // live inside it. Matching the element (rather than splitting on the card
  // class, which sits *after* the href in the tag) keeps each href aligned
  // with its own title and location.
  const cardRe = /<a\b[^>]*\bhref=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = cardRe.exec(body)) !== null) {
    const title = match[2].match(/<div class="title-item">([\s\S]*?)<\/div>/);
    if (!title || !title[1].trim()) continue;
    const location = match[2].match(/<div class="info h20">([\s\S]*?)<\/div>/);
    jobs.push({
      title: decodeEntities(title[1].replace(/\s+/g, ' ').trim()),
      url: match[1],
      company: companyName,
      location: location
        ? decodeEntities(location[1].replace(/<span[^>]*class="line"[^>]*><\/span>/g, ', ').replace(/\s+/g, ' ').trim())
        : '',
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'innovecs',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      const matches = url.protocol === 'https:'
        && url.hostname === CAREERS_HOST
        && url.pathname.startsWith('/vacancies');
      return matches ? { url: pageUrl(candidate, 1) } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const careersUrl = entry?.careers_url;
    if (!careersUrl) throw new Error(`innovecs: ${entry.name} has no careers_url`);
    const careers = assertInnovecsUrl(careersUrl);
    const base = careers.origin + careers.pathname;

    const opts = {
      headers: { accept: 'text/html' },
      redirect: 'error',
    };

    const maxPages = resolveMaxPages(entry);
    const isProbe = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const ctxCap = isProbe ? ctx.maxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    const jobs = [];
    let reachedEnd = false;
    let stopReason = 'complete';

    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      let html;
      try {
        html = await fetchTextWithRetry(ctx, pageUrl(base, page), opts);
      } catch (err) {
        // During a probe (ctx.maxPages set) the rejection must propagate
        // unwrapped so the ProbePageBudgetReached sentinel identity survives
        // for verify-portals; only a real scan keeps the pages so far.
        if (isProbe) throw err;
        console.error(`⚠️  innovecs: ${entry.name} truncated at page ${page} after ${err.attempts ?? 1} attempts (${jobs.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      // Pages 2+ are served as bare fragments; a full HTML document is the site
      // re-rendering the whole template past the last real page → stop.
      if (page > 1 && isFullDocument(html)) { reachedEnd = true; break; }
      const parsed = parseInnovecsPage(html, entry.name);
      jobs.push(...parsed);
      if (parsed.length === 0) { reachedEnd = true; break; }
    }

    if (stopReason === 'complete' && !reachedEnd && pagesToFetch === maxPages) {
      console.error(`⚠️  innovecs: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};