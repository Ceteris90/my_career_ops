// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// DataArt careers provider — single-company API provider for tracked_companies.
// The advance-career Swiper is a curated subset; this provider walks the full
// public vacancies API instead and drops non-vacancy promotional rows.

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST = 'www.dataart.team';
const API_BASE = `https://${HOST}/dataart-team/api/vacancies`;
const DEFAULT_MAX_PAGES = 50;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/** Normalize one DataArt vacancies API page. */
export function parseDataartResponse(json, entry = {}) {
  if (json == null || (typeof json === 'object' && Object.keys(json).length === 0)) return [];
  const page = json?.vacancies && Array.isArray(json.vacancies.items) ? json.vacancies : json;
  if (!Array.isArray(page?.items)) {
    const keys = json && typeof json === 'object' ? Object.keys(json) : [];
    throw new Error(`dataart: unexpected API response — expected vacancies.items[], got keys: [${keys.join(', ')}]`);
  }
  const jobs = [];
  for (const row of page.items) {
    if (row?.contentType !== 0) continue;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title) continue;
    let url;
    try { url = new URL(row.fullUrl || `/vacancies/${row.slug || ''}`, `https://${HOST}`); } catch { continue; }
    if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/vacancies/')) continue;
    const locations = [
      ...(Array.isArray(row.locationTags) ? row.locationTags.map((tag) => tag?.title) : []),
      ...(Array.isArray(row.countriesTags) ? row.countriesTags.map((tag) => tag?.title) : []),
    ].filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index);
    const job = { title, url: url.toString(), company: entry.name || 'DataArt', location: locations.join(', ') };
    const description = typeof row.text === 'string' ? htmlToText(row.text).trim() : '';
    if (description) job.description = description;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'dataart',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && ['/advance-career', '/vacancies'].includes(url.pathname.replace(/\/$/, ''))
        ? { url: `${API_BASE}/filter-fields-page` }
        : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const maxConfigured = resolveMaxPages(entry);
    const probeMax = Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity;
    const maxPages = Math.min(maxConfigured, probeMax);
    const jobs = [];
    const seenUrls = new Set();
    let pagesTotal = Infinity;

    for (let page = 1; page <= maxPages && page <= pagesTotal; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const endpoint = page === 1 ? 'filter-fields-page' : 'filter-content-page';
      const url = `${API_BASE}/${endpoint}?page=${page}&pageSize=0`;
      const json = await fetchJsonWithRetry(ctx, url, {
        headers: { accept: 'application/json', 'x-language': 'en-US' },
        redirect: 'error',
      });
      const pageJobs = parseDataartResponse(json, entry);
      for (const job of pageJobs) {
        if (seenUrls.has(job.url)) continue;
        seenUrls.add(job.url);
        jobs.push(job);
      }
      const reported = Number(json?.vacancies?.pagesTotal ?? json?.pagesTotal);
      if (Number.isInteger(reported) && reported >= 0) pagesTotal = Math.min(reported, MAX_PAGES_CAP);
      if (page >= pagesTotal) return jobs;
    }
    if (Number.isFinite(pagesTotal) && pagesTotal > maxPages && (!Number.isFinite(probeMax) || maxConfigured <= probeMax)) {
      console.error(`  ⚠ dataart: reached max_pages=${maxConfigured}; raise max_pages to cover ${pagesTotal} reported pages`);
    }
    return jobs;
  },
};
