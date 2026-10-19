// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// LeverX careers provider — single-company SSR parser for tracked_companies.
// The page ships every filtered vacancy card in its initial HTML; "Show more"
// only reveals cards client-side, so one public GET covers the full result set.

import { fetchTextWithRetry } from './_http.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST = 'career.leverx.com';
const DEFAULT_URL = `https://${HOST}/vacancies`;

function extractBlogpostJson(html) {
  const marker = 'const blogpost =';
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) return null;
  const start = html.indexOf('{', markerAt + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

function selectedTagGroups(careersUrl) {
  let tags = [];
  try { tags = new URL(careersUrl || DEFAULT_URL).searchParams.getAll('tag'); } catch { return []; }
  const groups = new Map();
  for (const value of tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)) {
    const prefix = value.includes('_') ? value.slice(0, value.indexOf('_')) : value;
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(value);
  }
  return [...groups.values()];
}

/** Normalize LeverX's embedded HubSpot blogpost payload. */
export function parseLeverxHtml(html, entry = {}) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const source = extractBlogpostJson(html);
  if (!source) throw new Error('leverx: expected embedded `const blogpost` JSON was not found');
  let payload;
  try { payload = JSON.parse(source); } catch { throw new Error('leverx: embedded blogpost JSON could not be parsed'); }
  if (!Array.isArray(payload?.objects)) throw new Error('leverx: expected blogpost.objects[]');

  const groups = selectedTagGroups(entry.careers_url);
  const jobs = [];
  for (const row of payload.objects) {
    const title = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!title) continue;
    const slugs = new Set([
      ...(Array.isArray(row.tagList) ? row.tagList.map((tag) => tag?.slug) : []),
      ...(Array.isArray(row.tagNames) ? row.tagNames : []),
    ].filter((tag) => typeof tag === 'string').map((tag) => tag.toLowerCase()));
    if (!groups.every((group) => group.some((tag) => slugs.has(tag)))) continue;

    let url;
    try {
      url = new URL(row.absoluteUrl || row.publishedUrl || row.url || '', DEFAULT_URL);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/vacancies/')) continue;

    const location = [...slugs]
      .filter((tag) => tag.startsWith('location_') || tag.startsWith('work_'))
      .map((tag) => tag.slice(tag.indexOf('_') + 1).replace(/-/g, ' '))
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(', ');
    const job = { title, url: url.toString(), company: entry.name || 'LeverX', location };
    const description = typeof row.postBody === 'string' ? htmlToText(row.postBody).trim() : '';
    if (description) job.description = description;
    if (Number.isFinite(row.publishDate)) job.postedAt = row.publishDate;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'leverx',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname.startsWith('/vacancies')
        ? { url: url.toString() }
        : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const candidate = entry?.careers_url || DEFAULT_URL;
    const detected = this.detect({ careers_url: candidate });
    if (!detected) throw new Error('leverx: careers_url must be an HTTPS career.leverx.com/vacancies URL');
    const html = await fetchTextWithRetry(ctx, detected.url, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'error',
    });
    return parseLeverxHtml(html, entry);
  },
};
