// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// SoftServe careers provider — a single-company adapter for the SoftServe career
// site (career.softserveinc.com), a Nuxt SSG application. The live JSON API
// (GET /api/frontend/vacancies?…&page=N) sits behind an Imperva/Incapsula WAF
// that serves an HTML challenge to bare fetches after the first request, so
// keyword-search through that endpoint is not reliably scannable (measured live:
// page 1 answered, page 2 and keyword queries returned a challenge page). The
// statically pre-rendered Nuxt payload (`…/en-us/vacancies/{filters}/_payload.json`)
// is served through the CDN and answers a plain fetch for every page without the
// WAF blocking, which is the path this provider reads.
//
// The careers_url on the portals.yml entry is the full filtered listing URL the
// user wants to scan (direction/subdirection/position path segments). Page 1's
// payload is `{careers_url}/_payload.json`; page N's is
// `{careers_url}/page-N/_payload.json`. Pagination metadata (`total`,
// `last_page`) lives inside the payload's `meta`.
//
// The payload is Nuxt's devalue JSON serialization: a flat array whose elements
// reference each other by index, with special marker arrays like
// ["ShallowReactive", <index>] for reactive wrappers. decodeNuxtPayload resolves
// those references so the vacancy rows and pagination meta become plain objects.

import { fetchJsonWithRetry } from './_http.mjs';

const CAREERS_HOST = 'career.softserveinc.com';
const PAGE_SIZE = 12;

// Safety cap on pagination — the page count must never be decided by the
// source's reported `last_page` alone (untrusted third-party data), so this is
// the provider's own bound. Override with `max_pages` on the portal entry for a
// filter that genuinely exceeds it.
const DEFAULT_MAX_PAGES = 20;
// Hard ceiling even for an explicit override. SoftServe's engineering filters
// are small (the widest scanned direction topped out at 18 pages / 213 roles);
// this leaves ample headroom while still bounding a misbehaving server.
const MAX_PAGES_CAP = 100;

// Imperva WAF fronts the site; a short delay between page requests keeps the
// provider from tripping rate-limit bursts on a deep pagination walk.
const INTER_PAGE_DELAY_MS = 250;

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
export function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Assert a careers_url lives on the SoftServe careers host over HTTPS. */
function assertSoftServeUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('softserve: missing careers_url');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`softserve: malformed careers_url ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:') throw new Error('softserve: careers_url must be https:');
  if (url.hostname !== CAREERS_HOST) throw new Error(`softserve: unexpected host ${url.hostname}`);
  if (!url.pathname.startsWith('/en-us/vacancies')) throw new Error('softserve: careers_url must point at /en-us/vacancies');
  return url;
}

/**
 * Resolve a Nuxt devalue payload array into a plain object/array tree.
 *
 * Nuxt's `_payload.json` is a JSON array where any element may be:
 *   - a primitive value (number, string, boolean, null);
 *   - a plain object whose *object* values are indices into the array;
 *   - a plain array of indices into the array;
 *   - a marker array whose first element is a string, e.g. ["ShallowReactive", N],
 *     which wraps the element at index N (the reactive types resolve to the
 *     wrapped value).
 * Index references are only ever non-negative integers; actual JSON numbers
 * always live behind an index of their own, so an object field holding a number
 * is always a reference. Strings, booleans and null are never references.
 *
 * Exported for the test suite.
 */
export function decodeNuxtPayload(arr) {
  const resolve = (idx, depth = 0) => {
    if (depth > 32) throw new Error('softserve: payload reference depth exceeded');
    const node = arr[idx];
    if (Array.isArray(node)) {
      if (typeof node[0] === 'string') {
        if (/^Shallow(?:Reactive|Ref)$|^Reactive$|^Ref$/.test(node[0])) return resolve(node[1], depth + 1);
        return node;
      }
      return node.map((item) => resolve(item, depth + 1));
    }
    if (node !== null && typeof node === 'object') {
      const out = {};
      for (const key of Object.keys(node)) {
        const value = node[key];
        out[key] = typeof value === 'number' ? resolve(value, depth + 1) : value;
      }
      return out;
    }
    return node;
  };
  return resolve(0);
}

/**
 * Pull the filtered-listing payload out of a decoded Nuxt page tree.
 *
 * `root.data` is keyed by the query string of the request that produced the
 * payload (e.g. `vacancies-?direction%5B%5D=…&filters=1`); its value is the page
 * payload `{ data: { vacancies: […], filters }, links, meta }`. The `meta`
 * object carries `current_page`, `last_page`, `per_page`, `total`.
 */
export function pagePayloadFromDecoded(root) {
  const data = root?.data;
  if (data == null || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  const payload = keys.length > 0 ? data[keys[0]] : null;
  if (payload == null || typeof payload !== 'object' || !Array.isArray(payload?.data?.vacancies)) return null;
  return payload;
}

/** Normalize one SoftServe vacancy row. */
export function normalizeVacancy(row, entry) {
  const urlSegment = typeof row?.urlSegment === 'string' ? row.urlSegment.trim() : '';
  const title = typeof row?.name === 'string' ? row.name.trim() : '';
  if (!urlSegment || !title) return null;
  const location = typeof row?.city === 'string' ? row.city.trim() : '';
  return {
    title,
    url: `https://${CAREERS_HOST}/en-us/vacancies/${urlSegment}`,
    company: entry.name,
    location,
  };
}

/**
 * Parse one page's decoded payload into jobs + pagination info.
 *
 * Exported for the test suite. Returns `{ jobs, lastPage, total }`; `jobs` is
 * `[]` when the payload has no vacancies (endpoint alive, nothing matched).
 */
export function parseSoftServePage(decoded, entry) {
  const payload = pagePayloadFromDecoded(decoded);
  if (!payload) throw new Error('softserve: payload did not contain a vacancies listing');
  const rows = Array.isArray(payload.data.vacancies) ? payload.data.vacancies : [];
  const jobs = [];
  for (const row of rows) {
    const job = normalizeVacancy(row, entry);
    if (job) jobs.push(job);
  }
  const meta = payload.meta;
  const lastPage = Number.isInteger(meta?.last_page) && meta.last_page > 0 ? meta.last_page : 1;
  const total = Number.isInteger(meta?.total) && meta.total >= 0 ? meta.total : jobs.length;
  return { jobs, lastPage, total };
}

/** Build the `_payload.json` URL for a page number of a careers_url. */
function payloadUrl(careersUrl, page) {
  const base = careersUrl.endsWith('/') ? careersUrl.slice(0, -1) : careersUrl;
  return page <= 1 ? `${base}/_payload.json` : `${base}/page-${page}/_payload.json`;
}

/** @type {Provider} */
export default {
  id: 'softserve',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      const matches = url.protocol === 'https:'
        && url.hostname === CAREERS_HOST
        && url.pathname.startsWith('/en-us/vacancies');
      return matches ? { url: payloadUrl(candidate, 1) } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const careersUrl = entry?.careers_url;
    if (!careersUrl) throw new Error(`softserve: ${entry.name} has no careers_url`);
    const careers = assertSoftServeUrl(careersUrl);
    const base = careers.origin + careers.pathname;

    const opts = {
      headers: { accept: 'application/json' },
      redirect: 'error',
    };

    const maxPages = resolveMaxPages(entry);
    const ctxCap = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pagesToFetch = Math.min(maxPages, ctxCap);

    let jobs = [];
    let lastPage = 1;
    let stopReason = 'complete';

    for (let page = 1; page <= pagesToFetch; page++) {
      if (page > 1) await ctx.sleep?.(INTER_PAGE_DELAY_MS);
      let decoded;
      try {
        decoded = decodeNuxtPayload(await fetchJsonWithRetry(ctx, payloadUrl(base, page), opts));
      } catch (err) {
        console.error(`⚠️  softserve: ${entry.name} truncated at page ${page} after ${err.attempts ?? 1} attempts (${jobs.length} jobs): ${err.message}`);
        stopReason = 'fetch-error';
        break;
      }
      const parsed = parseSoftServePage(decoded, entry);
      jobs.push(...parsed.jobs);
      lastPage = parsed.lastPage;
      if (parsed.jobs.length < PAGE_SIZE) break; // short page → last page reached
      if (page >= lastPage) break;
    }

    if (stopReason === 'complete' && lastPage > pagesToFetch && pagesToFetch === maxPages) {
      console.error(`⚠️  softserve: ${entry.name} truncated at max_pages=${maxPages} (${jobs.length} jobs) — raise max_pages on this entry for more`);
    }

    return jobs;
  },
};