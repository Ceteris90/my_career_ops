// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// EPAM careers provider — single-company provider for tracked_companies.
// Reads EPAM's public, no-auth search API and walks its offset pagination.

import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST = 'careers.epam.com';
const API_URL = `https://${HOST}/api/jobs/v2/search/careers-i18n`;
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 200;

function resolveMaxPages(entry) {
  const value = entry?.max_pages;
  return Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

function buildApiUrl(entry, from) {
  const config = entry?.epam && typeof entry.epam === 'object' ? entry.epam : {};
  const url = new URL(API_URL);
  url.searchParams.set('from', String(from));
  url.searchParams.set('lang', typeof config.lang === 'string' && config.lang ? config.lang : 'en');
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('sortBy', typeof config.sort_by === 'string' && config.sort_by ? config.sort_by : 'relevance;relocation=asc');
  url.searchParams.set('websiteLocale', typeof config.website_locale === 'string' && config.website_locale ? config.website_locale : 'en-us');
  if (typeof config.query === 'string' && config.query.trim()) url.searchParams.set('q', config.query.trim());
  if (typeof config.facets === 'string' && config.facets.trim()) url.searchParams.set('facets', config.facets.trim());
  return url.toString();
}

function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Normalize one EPAM API page. */
export function parseEpamResponse(json, entry = {}) {
  if (json == null || (Array.isArray(json) && json.length === 0)) return [];
  if (typeof json === 'object' && Object.keys(json).length === 0) return [];
  if (json?.data?.jobs == null && json?.data && Object.keys(json.data).length <= 1) return [];
  if (!json || !json.data || !Array.isArray(json.data.jobs)) {
    const keys = json && typeof json === 'object' ? Object.keys(json) : [];
    throw new Error(`epam: unexpected API response — expected data.jobs[], got keys: [${keys.join(', ')}]`);
  }

  const jobs = [];
  for (const row of json.data.jobs) {
    const title = typeof row?.name === 'string' ? row.name.trim() : '';
    const path = typeof row?.seo?.url === 'string' ? row.seo.url.trim() : '';
    if (!title || !path) continue;

    let url;
    try {
      url = new URL(path, `https://${HOST}`).toString();
    } catch {
      continue;
    }
    if (new URL(url).hostname !== HOST) continue;

    const location = [row.city, row.state, row.country, row.vacancy_type]
      .filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index)
      .join(', ');
    const description = typeof row.description === 'string' ? htmlToText(row.description).trim() : '';
    const postedAt = toEpochMs(row.created_at);

    const job = { title, url, company: entry.name || 'EPAM', location };
    if (description) job.description = description;
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'epam',

  detect(entry) {
    const candidate = entry?.api || entry?.careers_url;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST ? { url: API_URL } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const configuredMaxPages = resolveMaxPages(entry);
    const probeMaxPages = Number(ctx?.maxPages) > 0 ? Number(ctx.maxPages) : Infinity;
    const maxPages = Math.min(configuredMaxPages, probeMaxPages);
    const jobs = [];

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const json = await fetchJsonWithRetry(ctx, buildApiUrl(entry, page * PAGE_SIZE), {
        headers: { accept: 'application/json', 'x-anywhere-tenant': 'anywhere' },
        redirect: 'error',
      });
      const pageJobs = parseEpamResponse(json, entry);
      jobs.push(...pageJobs);

      const rawCount = json.data.jobs.length;
      const total = Number(json.data.total);
      if (rawCount < PAGE_SIZE || (Number.isFinite(total) && (page * PAGE_SIZE) + rawCount >= total)) return jobs;
    }

    if (!Number.isFinite(probeMaxPages) || configuredMaxPages <= probeMaxPages) {
      console.error(`  ⚠ epam: reached max_pages=${configuredMaxPages}; raise max_pages on this entry if results were truncated`);
    }
    return jobs;
  },
};
