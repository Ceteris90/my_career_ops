// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// AgileEngine provider — single-company HTML provider for tracked_companies.
// The careers site (join.agileengine.com/open-positions/) server-renders the
// FULL inventory into one page — measured live 2026-09-26: all 63 postings in
// the HTML, each a `.open-position` card. Pagination and the category /
// specialization / location / experience filters are purely client-side JS, so
// there is no server-side walk: a single fetch returns the whole board.
//
// List cards carry title / canonical URL / locations but NO posted date (only
// a "New!" badge). Dates live only on the detail page's JSON-LD
// (schema.org JobPosting `datePosted`), so the provider returns undated jobs
// plus an `enrichDate(job, ctx)` hook for callers that want per-posting dates.

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'join.agileengine.com';
const LIST_PATH = '/open-positions/';

/**
 * Parse the AgileEngine open-positions list page. Exported for unit tests.
 *
 * Postings are `<div class="open-position">` cards: the canonical URL and
 * title in the `h3.job-title` anchor, locations in the `ul.shown-locations`
 * list items. Cards whose URL resolves off the careers host are dropped
 * (defense in depth — the site should never link a posting on another host).
 *
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseAgileEngineList(html, companyName) {
  const jobs = [];
  const cards = String(html).split('<div class="open-position">').slice(1);
  for (const card of cards) {
    const anchor = card.match(/<h3 class="job-title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!anchor) continue;
    const title = decodeEntities(anchor[2].replace(/\s+/g, ' ').trim());
    if (!title) continue;
    let parsed;
    try { parsed = new URL(decodeEntities(anchor[1])); } catch { continue; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) continue;
    const locations = [];
    const locBlock = card.match(/<ul class="shown-locations">([\s\S]*?)<\/ul>/);
    if (locBlock) {
      for (const [, li] of locBlock[1].matchAll(/<li[^>]*>\s*([\s\S]*?)\s*<\/li>/g)) {
        const loc = decodeEntities(li.replace(/\s+/g, ' ').trim()).replace(/,$/, '');
        if (loc) locations.push(loc);
      }
    }
    jobs.push({
      title,
      url: `${parsed.origin}${parsed.pathname}`,
      company: companyName,
      location: locations.join(', '),
      // no postedAt — the list page carries no date; see enrichDate.
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'agileengine',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname.replace(/\/$/, '').startsWith(LIST_PATH.replace(/\/$/, ''))
        ? { url: `https://${HOST}${LIST_PATH}` }
        : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const html = await ctx.fetchText(`https://${HOST}${LIST_PATH}`, { redirect: 'error' });
    return parseAgileEngineList(html, entry.name || 'AgileEngine');
  },

  /**
   * Fill in job.postedAt (and description) from the posting's detail page
   * JSON-LD (schema.org JobPosting). Any failure leaves the job undated; the
   * caller's undated policy then applies as usual.
   */
  async enrichDate(job, ctx) {
    const html = await ctx.fetchText(job.url, { redirect: 'error' });
    for (const [, raw] of String(html).matchAll(/<script\b[^>]*(?<![\w-])type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      let data;
      try { data = JSON.parse(raw); } catch { continue; }
      const nodes = [];
      if (Array.isArray(data)) nodes.push(...data);
      else if (Array.isArray(data?.['@graph'])) nodes.push(...data['@graph']);
      else nodes.push(data);
      const node = nodes.find((n) => n && typeof n === 'object' && (n['@type'] === 'JobPosting' || (Array.isArray(n['@type']) && n['@type'].includes('JobPosting'))));
      if (node) {
        const ts = Date.parse(node.datePosted || '');
        if (!Number.isNaN(ts)) job.postedAt = ts;
        if (typeof node.description === 'string' && node.description.trim()) job.description = node.description.trim();
        return;
      }
    }
  },
};