// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Creatio provider — single-company Drupal (Views) HTML provider for
// tracked_companies. The careers site (www.creatio.com/company/careers/
// job-openings) server-renders the FULL inventory into one page — measured
// live 2026-09-26: all 90 postings across 9 department groups in the HTML.
// The Location / Market ("department" / "location") filters are pure
// client-side JS (careers.js hides `.views-group` / `.views-row` nodes) and
// there is no server-side pagination (a `views-row` appears once, a short
// page terminates the walk), so a single fetch returns the whole board.
//
// The listing is a Drupal Views render: each `<div class="views-group">`
// block carries a department in `.views-group__title`, and each posting is a
// `.views-row` with the canonical URL in the `.views-field-title` anchor, the
// title text there too, the office location in
// `.views-field-field-vacancy-location` and the market/region in
// `.views-field-field-vacancy-region`. The `field-hot` block is just a "HOT"
// badge, not a date.
//
// List cards carry no posted date and the detail pages expose no schema.org
// JobPosting JSON-LD, so jobs stay undated.

//   - name: Creatio
//     careers_url: https://www.creatio.com/company/careers/job-openings
//     enabled: true

import { decodeEntities } from './_html-entities.mjs';

const HOST = 'www.creatio.com';
const LIST_PATH = '/company/careers/job-openings';

/**
 * Parse the Creatio job-openings list page. Exported for unit tests.
 *
 * Postings are `<div class="views-row">` cards inside `<div class="views-group">`
 * blocks: the canonical URL and title in the `.views-field-title` anchor,
 * the office location in `.views-field-field-vacancy-location` and the market/
 * region in `.views-field-field-vacancy-region`. Cards whose URL resolves off
 * the careers host are dropped (defense in depth).
 *
 * @param {string} html
 * @param {string} companyName
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseCreatioList(html, companyName) {
  const jobs = [];
  const groups = String(html).split('<div class="views-group"').slice(1);
  for (const group of groups) {
    const rows = group.split('<div class="views-row">').slice(1);
    for (const row of rows) {
      const titleAnchor = row.match(/views-field-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!titleAnchor) continue;
      const title = decodeEntities(titleAnchor[2].replace(/\s+/g, ' ').trim());
      if (!title) continue;
      let parsed;
      try { parsed = new URL(decodeEntities(titleAnchor[1]), `https://${HOST}`); } catch { continue; }
      if (parsed.protocol !== 'https:' || parsed.hostname !== HOST) continue;
      const locMatch = row.match(/views-field-field-vacancy-location"><a href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const regionMatch = row.match(/views-field-field-vacancy-region"><a href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const location = locMatch ? decodeEntities(locMatch[1].replace(/\s+/g, ' ').trim()) : '';
      const region = regionMatch ? decodeEntities(regionMatch[1].replace(/\s+/g, ' ').trim()) : '';
      const locParts = [location, region].filter(Boolean);
      jobs.push({
        title,
        url: `${parsed.origin}${parsed.pathname}`,
        company: companyName,
        location: locParts.join(', '),
        // no postedAt — the list page carries no date.
      });
    }
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'creatio',

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
    return parseCreatioList(html, entry.name || 'Creatio');
  },
};