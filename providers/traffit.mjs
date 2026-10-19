// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Traffit provider — a Polish ATS vendor. Every tenant serves its published
// postings at `https://<tenant>.traffit.com/public/job_posts/published` as a
// bare JSON array (no auth, no token), which the tenant's branded careers page
// loads client-side. The ATS host is recognizable (`*.traffit.com`), but most
// tenants front it with a branded careers URL (e.g. Pretius posts its roles at
// pretius.com/pl/kariera and pulls the feed from pretiushr.traffit.com), so an
// entry on a branded domain must pin `provider: traffit` + `api:` explicitly —
// detect() only auto-claims a careers_url whose host is actually *.traffit.com.
//
// This module is the generic adapter; it is documented and tested against the
// tracked_companies: list (one employer per entry — the posting set returned is
// that tenant's own).

import { htmlToText } from './_html-to-text.mjs';

const ALLOWED_TRAFFIT_HOSTS = new Set(['traffit.com']);

/** @param {string} url */
function assertTraffitUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`traffit: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`traffit: URL must use HTTPS: ${url}`);
  const host = parsed.hostname.toLowerCase();
  const allowed = [...ALLOWED_TRAFFIT_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed)
    throw new Error(`traffit: untrusted hostname "${host}" — must be a *.traffit.com host`);
  return url;
}

// A tenant feed URL. Explicit `api:` wins (it may carry a non-standard path or
// query); otherwise a *.traffit.com careers_url is rewritten to the canonical
// published-postings endpoint. Anything else is unclaimable.
/** @param {import('./_types.js').PortalEntry} entry */
function resolveApiUrl(entry) {
  if (typeof entry.api === 'string' && entry.api) {
    assertTraffitUrl(entry.api);
    return entry.api;
  }
  const url = entry.careers_url || '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (![...ALLOWED_TRAFFIT_HOSTS].some((h) => host === h || host.endsWith(`.${h}`))) return null;
  return `https://${host}/public/job_posts/published`;
}

// NaN-safe Date.parse — `|| undefined` would also coerce a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

// Pull the posting body out of advert.values[] (array of { field_id, value })
// and strip its HTML into plain text. Traffit emits only one field, "description".
/** @param {any} advert */
function descriptionOf(advert) {
  const values = Array.isArray(advert?.values) ? advert.values : [];
  const desc = values.find((v) => v && typeof v === 'object' && v.field_id === 'description');
  return htmlToText(desc?.value);
}

/** @type {Provider} */
export default {
  id: 'traffit',

  detect(entry) {
    try {
      const apiUrl = resolveApiUrl(entry);
      return apiUrl ? { url: apiUrl } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`traffit: cannot derive API URL for ${entry.name}`);
    assertTraffitUrl(apiUrl);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertTraffitUrl above it guarantees the final hostname stays *.traffit.com.
    const json = /** @type {any} */ (await ctx.fetchJson(apiUrl, { redirect: 'error' }));
    // The published endpoint answers a bare array. A list is the documented
    // shape; an object (or anything else) means the API changed shape, and a
    // descriptive throw beats a board that silently returns [] forever.
    if (!Array.isArray(json)) {
      const keys = json && typeof json === 'object' ? Object.keys(json).join(',') : typeof json;
      throw new Error(`traffit: expected a JSON array from ${apiUrl}, got ${keys || 'non-object'}`);
    }

    return json
      .map((job) => {
        if (!job || typeof job !== 'object') return null;
        const title = String(job.advert?.name || '').trim();
        const url = typeof job.url === 'string' ? job.url : '';
        if (!title || !url) return null;
        const description = descriptionOf(job.advert);
        return {
          title,
          url,
          company: entry.name,
          location: String(job.options?._location || '').trim(),
          ...(description ? { description } : {}),
          postedAt: toEpochMs(job.valid_start),
        };
      })
      .filter(Boolean);
  },
};