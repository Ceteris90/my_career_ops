// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Tieto (Tietoevry) careers provider — single-company Attrax SSR parser for
// tracked_companies. The careers site is server-rendered HTML (no JSON API):
// job tiles carry a title link, a location block, and a data-jobid, and both
// the search filter and pagination are baked into the URL query string:
//
//   https://careers.tieto.com/jobs?options=193%2C403%2C414%2C413&page=1
//
// `options` is a comma-separated list of Attrax facet option ids (location /
// job area / job family / work-location-type …) and is preserved verbatim
// from careers_url; `page` advances the walk. The results-per-page selector
// is ignored server-side (a `pageSize` param does not change the count), so
// the page size is fixed at 10 tiles and a short page terminates the walk.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'careers.tieto.com';
const DEFAULT_URL = `https://${HOST}/jobs`;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;
const PAGE_SIZE = 10;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Parse Tieto's Attrax job-results HTML. Exported for unit tests. */
export function parseTietoHtml(html, entry = {}) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const matches = [...html.matchAll(/<div class="attrax-vacancy-tile [^"]*" data-jobid="(\d+)"/g)];
  if (matches.length === 0 && /attrax-vacancy-tile__title/i.test(html)) {
    throw new Error('tieto: job-card markup was present but no job tiles parsed');
  }

  const jobs = [];
  const seenUrls = new Set();
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1];
    const blockStart = matches[i].index;
    const blockEnd = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const block = html.slice(blockStart, blockEnd);

    const titleMatch = block.match(/attrax-vacancy-tile__title[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const title = stripTags(titleMatch[2]);
    if (!title) continue;

    let url;
    try { url = new URL(titleMatch[1], DEFAULT_URL); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/job/')) continue;
    if (seenUrls.has(url.toString())) continue;
    seenUrls.add(url.toString());

    const locMatch = block.match(/attrax-vacancy-tile__location-freetext[\s\S]*?attrax-vacancy-tile__item-value">([\s\S]*?)<\/p>/);
    const location = locMatch ? stripTags(locMatch[1]) : '';
    const _jobId = id;

    jobs.push({ title, url: url.toString(), company: entry.name || 'Tieto', location });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'tieto',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname === '/jobs'
        ? { url: url.toString() }
        : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const detected = this.detect({ careers_url: entry?.careers_url || DEFAULT_URL });
    if (!detected) throw new Error('tieto: careers_url must be an HTTPS careers.tieto.com/jobs URL');
    const base = new URL(detected.url);
    base.searchParams.delete('page');
    const configuredMax = resolveMaxPages(entry);
    const probeMax = Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity;
    const maxPages = Math.min(configuredMax, probeMax);
    const jobs = [];

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      base.searchParams.set('page', String(page));
      const html = await fetchTextWithRetry(ctx, base.toString(), {
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': BROWSER_LIKE_USER_AGENT },
        redirect: 'error',
      });
      const pageJobs = parseTietoHtml(html, entry);
      jobs.push(...pageJobs);
      if (pageJobs.length < PAGE_SIZE) return jobs;
    }
    if (!Number.isFinite(probeMax) || configuredMax <= probeMax) {
      console.error(`  ⚠ tieto: reached max_pages=${configuredMax}; raise max_pages if results were truncated`);
    }
    return jobs;
  },
};