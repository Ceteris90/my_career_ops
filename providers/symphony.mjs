// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Symphony Solutions provider — single-company provider for tracked_companies.
// Reads Symphony Solutions' own WordPress careers portal
// (symphony-solutions.com/vacancies), a Dutch-based software company's listing
// of its own postings, so it clears the Source Indexing Policy by construction
// (see providers/ADDING_A_PROVIDER.md, "Before the code").
//
// The listing is server-rendered HTML: the full inventory is baked into the
// /vacancies page (measured live 2026-09-26: the "2 job openings" count matches
// the number of `article.item-vacancy` cards in the markup). The Location /
// Technology filters and the MixItUp-style pagination (`.multiMixerPager`, the
// `data-limit="100"` wrapper) are purely client-side JS, so there is no
// server-side walk: a single fetch returns the whole board. Each posting is an
// `article.item-vacancy` card with the canonical URL in the `.box-vacancy--link`
// anchor, the title in `.item-vacancy--title` and the office locations in the
// `.cl-muted` span block.
//
// List cards carry no posted date, and the detail pages expose no schema.org
// JobPosting JSON-LD (only WebSite/BreadcrumbList nodes), so jobs stay undated.
//
//   - name: Symphony Solutions
//     careers_url: https://symphony-solutions.com/vacancies
//     enabled: true

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'symphony-solutions.com';
const LIST_PATH = '/vacancies';

/**
 * Parse the Symphony Solutions vacancies list page. Exported for unit tests.
 *
 * Postings are `<article class="item-vacancy">` cards: the canonical URL in the
 * `.box-vacancy--link` anchor, title in `.item-vacancy--title`, office locations
 * in the `.cl-muted` span block (the `|` separators are inside their own spans,
 * so the bare `<span>…</span>` matches collect only location names). Cards whose
 * URL resolves off the careers host are dropped (defense in depth).
 *
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseSymphonyList(html, companyName) {
  const jobs = [];
  const cards = String(html).split('<article').slice(1);
  for (const card of cards) {
    if (!/class="item-vacancy"/.test(card)) continue;
    const anchor = card.match(/<a\b([^>]*class="box-vacancy--link"[^>]*)>/);
    const title = card.match(/<h3 class="item-vacancy--title[^"]*">([\s\S]*?)<\/h3>/);
    if (!anchor || !title || !title[1].trim()) continue;
    const href = anchor[1].match(/href="([^"]+)"/);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(decodeEntities(href[1])); } catch { continue; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) continue;
    const locations = [];
    const locBlock = card.match(/<div class="flex-align-center cl-muted">([\s\S]*?)<\/div>\s*<\/div>/);
    if (locBlock) {
      const block = locBlock[1].replace(/<span class="mx-1">\|<\/span>/g, '');
      for (const [, span] of block.matchAll(/<span>([^<]*)<\/span>/g)) {
        const loc = decodeEntities(span.replace(/\s+/g, ' ').trim());
        if (loc) locations.push(loc);
      }
    }
    jobs.push({
      title: decodeEntities(title[1].replace(/\s+/g, ' ').trim()),
      url: parsed.href,
      company: companyName,
      location: locations.join(', '),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'symphony',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname.replace(/\/$/, '').startsWith(LIST_PATH)
        ? { url: `https://${HOST}${LIST_PATH}` }
        : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const html = await ctx.fetchText(`https://${HOST}${LIST_PATH}`, { redirect: 'error' });
    return parseSymphonyList(html, entry.name || 'Symphony Solutions');
  },
};