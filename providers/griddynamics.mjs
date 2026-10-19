// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Grid Dynamics careers provider — single-company SSR parser. The page embeds
// the complete vacancy inventory in data-vacancies; all UI filtering is local.

import { fetchTextWithRetry } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOST = 'www.griddynamics.com';
const PATH = '/careers/discover-openings';
const DEFAULT_URL = `https://${HOST}${PATH}`;

function dataAttribute(html, name) {
  const match = html.match(new RegExp(`\\b${name}=(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : null;
}

/** Parse and filter the complete embedded Grid Dynamics inventory. */
export function parseGridDynamicsHtml(html, entry = {}) {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const source = dataAttribute(html, 'data-vacancies');
  if (!source) throw new Error('griddynamics: data-vacancies payload was not found');
  let rows;
  try { rows = JSON.parse(source); } catch { throw new Error('griddynamics: data-vacancies JSON could not be parsed'); }
  if (!Array.isArray(rows)) throw new Error('griddynamics: expected data-vacancies to be an array');

  let selectedCities = [];
  try { selectedCities = new URL(entry.careers_url || DEFAULT_URL).searchParams.getAll('city'); } catch {}
  const selectedCategories = Array.isArray(entry?.grid_dynamics?.categories)
    ? entry.grid_dynamics.categories.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const includeRemote = entry?.grid_dynamics?.include_remote === true;
  const citySet = new Set(selectedCities.map((value) => value.toLowerCase()));
  const categorySet = new Set(selectedCategories.map((value) => value.toLowerCase()));
  const jobs = [];

  for (const row of rows) {
    const id = Number(row?.id);
    const title = typeof row?.title === 'string' ? row.title.trim() : '';
    const category = typeof row?.category === 'string' ? row.category.trim() : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !title) continue;
    if (categorySet.size > 0 && !categorySet.has(category.toLowerCase())) continue;
    const structured = Array.isArray(row.countryLocations) ? row.countryLocations : [];
    const isSelectedCity = structured.some((location) => citySet.has(`${location?.city}, ${location?.country}`.toLowerCase()));
    const isRemote = (Array.isArray(row.relatedLocations) ? row.relatedLocations : []).some((location) => typeof location === 'string' && /\bremote\b/i.test(location));
    if (citySet.size > 0 && !isSelectedCity && !(includeRemote && isRemote)) continue;
    const locations = Array.isArray(row.relatedLocations)
      ? row.relatedLocations.filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index)
      : [];
    jobs.push({
      title,
      url: `https://${HOST}/careers/vacancy/${id}`,
      company: entry.name || 'Grid Dynamics',
      location: locations.join(', '),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'griddynamics',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === HOST && url.pathname.replace(/\/$/, '') === PATH
        ? { url: url.toString() }
        : null;
    } catch { return null; }
  },

  async fetch(entry, ctx) {
    const detected = this.detect({ careers_url: entry?.careers_url || DEFAULT_URL });
    if (!detected) throw new Error(`griddynamics: careers_url must be an HTTPS ${HOST}${PATH} URL`);
    const html = await fetchTextWithRetry(ctx, detected.url, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'error',
    });
    return parseGridDynamicsHtml(html, entry);
  },
};
