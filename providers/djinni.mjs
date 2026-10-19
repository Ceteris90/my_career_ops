// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';

const HOST = 'djinni.co';
const DEFAULT_MAX_PAGES = 20;
const MAX_PAGES_CAP = 100;

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== HOST || !url.pathname.startsWith('/jobs/')) {
    throw new Error(`djinni: untrusted jobs URL: ${value}`);
  }
  return url;
}

export function parseDjinniPage(html) {
  const jobs = [];
  const blocks = String(html ?? '').split(/(?=<div\b[^>]*class="[^"]*job-item\b)/i).slice(1);
  for (const block of blocks) {
    const href = block.match(/<a\b[^>]*href="(\/jobs\/\d+[^"?#]*)"[^>]*class="[^"]*job_item__header-link/i)?.[1];
    const title = htmlToText(block.match(/<h2\b[^>]*class="[^"]*job-item__position[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
    if (!href || !title) continue;
    const company = htmlToText(block.match(/<span\b[^>]*class="[^"]*small text-gray-800[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || 'Djinni';
    const location = htmlToText(block.match(/<span\b[^>]*class="location-text"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const description = htmlToText(block.match(/<span\b[^>]*class="[^"]*js-original-text[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    jobs.push({ title, company, location, url: `https://${HOST}${decodeEntities(href)}`, ...(description ? { description } : {}) });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'djinni',
  detect(entry) {
    try { return { url: trustedUrl(entry?.careers_url).href }; } catch { return null; }
  },
  async fetch(entry, ctx) {
    const base = trustedUrl(entry?.careers_url);
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES;
    const limit = Math.min(configured, MAX_PAGES_CAP, ctx.maxPages || MAX_PAGES_CAP);
    const jobs = [];
    for (let page = 1; page <= limit; page++) {
      const url = new URL(base);
      if (page > 1) url.searchParams.set('page', String(page));
      const parsed = parseDjinniPage(await ctx.fetchText(url.href, { redirect: 'error' }));
      jobs.push(...parsed);
      if (parsed.length < 15) break;
    }
    return jobs;
  },
};
