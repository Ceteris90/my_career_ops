// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Devexperts careers provider — the public API returns the complete vacancy
// inventory in one array. "Load More" only reveals rows already in that array.

import { fetchJsonWithRetry } from './_http.mjs';

const CAREERS_HOST = 'careers.devexperts.com';
const API_HOST = 'api-careers.in.devexperts.com';
const API_URL = `https://${API_HOST}/v1/vacancies`;

/** Normalize Devexperts' complete vacancies array. */
export function parseDevexpertsResponse(json, entry = {}) {
  if (json == null || (Array.isArray(json) && json.length === 0)) return [];
  if (!Array.isArray(json)) throw new Error('devexperts: expected a vacancies array');
  const jobs = [];
  for (const row of json) {
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!title || !/^[a-z0-9-]+$/i.test(id)) continue;
    const location = [row?.location?.country, row?.location?.city]
      .filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index)
      .join(', ');
    jobs.push({
      title,
      url: `https://${CAREERS_HOST}/position/${id}/`,
      company: entry.name || 'Devexperts',
      location,
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'devexperts',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      const careers = url.protocol === 'https:' && url.hostname === CAREERS_HOST && url.pathname.replace(/\/$/, '') === '/vacancies';
      const api = url.protocol === 'https:' && url.hostname === API_HOST && url.pathname === '/v1/vacancies';
      return careers || api ? { url: API_URL } : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const json = await fetchJsonWithRetry(ctx, API_URL, {
      headers: { accept: 'application/json' },
      redirect: 'error',
    });
    return parseDevexpertsResponse(json, entry);
  },
};
