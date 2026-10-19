// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

import { htmlToText } from './_html-to-text.mjs';

const URL = 'https://jobs.devby.io/';

export function parseDevByPage(html) {
  const jobs = [];
  const blocks = String(html ?? '').split(/(?=<div\b[^>]*class="[^"]*vacancies-list-item\b)/i).slice(1);
  for (const block of blocks) {
    const link = block.match(/<a\b[^>]*class="[^"]*vacancies-list-item__link_block[^>]*href="(\/vacancies\/\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const company = htmlToText(block.match(/<div\b[^>]*class="[^"]*vacancies-list-item__company[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') || 'dev.by';
    jobs.push({ title: htmlToText(link[2]), company, location: '', url: `https://jobs.devby.io${link[1]}` });
  }
  return jobs.filter(job => job.title);
}

/** @type {Provider} */
export default {
  id: 'devby',
  detect(entry) {
    return entry?.provider === 'devby' ? { url: URL } : null;
  },
  async fetch(_entry, ctx) {
    return parseDevByPage(await ctx.fetchText(URL, { redirect: 'error' }));
  },
};
