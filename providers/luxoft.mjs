// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Luxoft careers provider — single-company SSR parser for tracked_companies.
// Each result card carries a structured, HTML-escaped data-job JSON object.

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'career.luxoft.com';
const DEFAULT_URL = `https://${HOST}/jobs`;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/** Parse Luxoft's HTML-escaped data-job objects. */
export function parseLuxoftHtml(html, entry = {}) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const matches = [...html.matchAll(/\bdata-job=(["'])([\s\S]*?)\1/gi)];
  if (matches.length === 0 && /jobs__list__job/i.test(html)) {
    throw new Error('luxoft: job-card markup was present but no data-job payloads parsed');
  }

  const jobs = [];
  const seenUrls = new Set();
  for (const match of matches) {
    let row;
    try { row = JSON.parse(decodeEntities(match[2])); } catch { continue; }
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    if (!title) continue;
    let url;
    try { url = new URL(row.url || '', DEFAULT_URL); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/jobs/')) continue;
    if (seenUrls.has(url.toString())) continue;
    seenUrls.add(url.toString());
    const location = [row.city, row.location]
      .filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index)
      .join(', ');
    jobs.push({ title, url: url.toString(), company: entry.name || 'Luxoft', location });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'luxoft',

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
    if (!detected) throw new Error('luxoft: careers_url must be an HTTPS career.luxoft.com/jobs URL');
    const base = new URL(detected.url);
    const perPage = Math.min(Math.max(Number(base.searchParams.get('perPage')) || 60, 1), 60);
    base.searchParams.set('perPage', String(perPage));
    const configuredMax = resolveMaxPages(entry);
    const probeMax = Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity;
    const maxPages = Math.min(configuredMax, probeMax);
    const jobs = [];

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      if (page > 1) base.searchParams.set('page', String(page));
      else base.searchParams.delete('page');
      const html = await fetchTextWithRetry(ctx, base.toString(), {
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': BROWSER_LIKE_USER_AGENT },
        redirect: 'error',
      });
      const pageJobs = parseLuxoftHtml(html, entry);
      jobs.push(...pageJobs);
      if (pageJobs.length < perPage) return jobs;
    }
    if (!Number.isFinite(probeMax) || configuredMax <= probeMax) {
      console.error(`  ⚠ luxoft: reached max_pages=${configuredMax}; raise max_pages if results were truncated`);
    }
    return jobs;
  },
};
