// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { htmlToText } from './_html-to-text.mjs';

const HOST = 'jobs.dev.ua';
const MAX_PAGES_CAP = 100;

export function parseDevUaPage(html) {
  const jobs = [];
  for (const block of String(html ?? '').match(/<article\b[^>]*class="[^"]*job-row\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi) || []) {
    const link = block.match(/<a\b[^>]*href="(\/jobs\/\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const company = htmlToText(block.match(/<a\b[^>]*class="[^"]*job-row__company[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '') || 'DEV Ukraine';
    const facts = [...block.matchAll(/<span\b[^>]*class="[^"]*job-row__fact[^>]*>([\s\S]*?)<\/span>/gi)].map(m => htmlToText(m[1]));
    jobs.push({ title: htmlToText(link[2]), company, location: facts[0] || '', url: `https://${HOST}${link[1]}` });
  }
  return jobs.filter(job => job.title);
}

/** @type {Provider} */
export default {
  id: 'devua',
  detect(entry) {
    try {
      const url = new URL(entry?.careers_url);
      return url.protocol === 'https:' && url.hostname === HOST ? { url: url.href } : null;
    } catch { return null; }
  },
  async fetch(entry, ctx) {
    const base = new URL(entry.careers_url);
    if (base.protocol !== 'https:' || base.hostname !== HOST) throw new Error('devua: untrusted careers_url');
    const configured = Number.isInteger(entry?.max_pages) && entry.max_pages > 0 ? entry.max_pages : 10;
    const limit = Math.min(configured, MAX_PAGES_CAP, ctx.maxPages || MAX_PAGES_CAP);
    const jobs = [];
    for (let page = 1; page <= limit; page++) {
      const url = new URL(base);
      if (page > 1) url.searchParams.set('page', String(page));
      const parsed = parseDevUaPage(await ctx.fetchText(url.href, { redirect: 'error' }));
      jobs.push(...parsed);
      if (parsed.length < 15) break;
    }
    return jobs;
  },
};
