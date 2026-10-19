// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Intellias careers provider — single-company provider for tracked_companies.
// Auto-detects from careers_url on `career.intellias.com` (Intellias's own
// WordPress careers site; the vacancies are served by its `intellias-vacancies`
// plugin). The board is server-rendered, but filtering and pagination go through
// a WordPress admin-ajax endpoint (`action=fly_vacancies`) that returns one
// page of 12 vacancy cards as an HTML array inside JSON — the same endpoint the
// site's own frontend uses.
//
//   - Filters live in the URL path (`job-family_...-and-job-profile_...`); the
//     provider ignores them and POSTs `action=fly_vacancies` with no filter
//     params, walking the FULL inventory (recall-first — scan.mjs applies
//     title_filter / location_filter afterwards).
//   - Pagination: `page=1..N`. Each response carries an `end` flag (true on the
//     last page) and an empty `posts[]` past the end; either stops the walk.
//
// Known limitation: the card's `.location` text is TRUNCATED server-side
// ("Bulgaria, Croatia, Egypt, Germ...") to fit the card. Boards that need full
// locations (and descriptions) for location_filter / content_filter opt in via
// the same vdab/smartrecruiters fetchDetails pattern:
//
//   intellias:
//     fetchDetails: true   # fetch each vacancy page for the full location + description
//     detailLimit: 25      # max detail calls per sweep when fetchDetails=true
//
// The detail page carries the full location in the `.vi_row--static` row whose
// icon is `mappin-icon.svg` (`.vi_row_text`), and the description in the
// `.text_overview` blocks. Detail enrichment is skipped while verify-portals is
// probing, exactly like vdab/smartrecruiters.

import { fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { intInRange } from './_config-utils.mjs';

const ALLOWED_HOST = 'career.intellias.com';
const AJAX_PATH = '/wp-admin/admin-ajax.php';
const ACTION = 'fly_vacancies';
// ~12 cards/page → 100 pages covers 1200 postings, far beyond any live volume.
const DEFAULT_MAX_PAGES = 100;
const MAX_PAGES_CAP = 1500;
const INTER_PAGE_DELAY_MS = 250;
const DETAIL_BATCH = 5;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

/** @param {{ intellias?: any }} entry */
function parseConfig(entry) {
  const cfg = (entry && entry.intellias) || {};
  return {
    fetchDetails: cfg.fetchDetails === true,
    detailLimit: intInRange(cfg.detailLimit, 25, 1, 100),
  };
}

/**
 * Resolve the site origin from the entry's careers_url / api, validating it is
 * https on career.intellias.com (the allowlist guard runs before any network
 * call). Returns null when the entry points elsewhere.
 * @param {any} entry
 * @returns {string|null}
 */
export function resolveOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch { continue; }
    if (parsed.protocol !== 'https:') continue;
    if (parsed.hostname !== ALLOWED_HOST) continue;
    return parsed.origin;
  }
  return null;
}

function assertIntelliasOrigin(origin) {
  let parsed;
  try { parsed = new URL(origin); } catch {
    throw new Error(`intellias: invalid origin: ${origin}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`intellias: origin must use HTTPS: ${origin}`);
  if (parsed.hostname !== ALLOWED_HOST) {
    throw new Error(`intellias: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
}

/**
 * Parse one `fly_vacancies` response body into its posts + end flag. Returns
 * `{ posts: [], end: true }` for an empty/contentless body ("endpoint alive,
 * nothing matched"); throws a descriptive error when the shape isn't what the
 * endpoint documents. Exported for unit tests.
 * @param {string} text
 * @returns {{ posts: string[], end: boolean }}
 */
export function parseIntelliasAjax(text) {
  if (typeof text !== 'string' || !text.trim()) return { posts: [], end: true };
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error('intellias: admin-ajax response was not JSON');
  }
  if (json == null) return { posts: [], end: true };
  // A contentless body — `{}` (empty object) or `[]` — means "endpoint alive,
  // nothing matched", same as null. A body with keys that isn't the documented
  // posts[] shape is a real API change and throws instead.
  if (Array.isArray(json)) return { posts: [], end: true };
  if (typeof json === 'object' && Object.keys(json).length === 0) return { posts: [], end: true };
  if (!Array.isArray(json.posts)) {
    const keys = typeof json === 'object' ? Object.keys(json) : [];
    throw new Error(`intellias: unexpected API response — expected posts[], got keys: [${keys.join(', ')}]`);
  }
  return { posts: json.posts, end: json.end === true };
}

/**
 * Parse one vacancy card HTML fragment into a Job. Cards are `<a>` elements
 * with the posting URL in the href, the title in `.card_title`, and the
 * (server-truncated) location in `.location .fw500`. Rows missing a required
 * field, or whose href doesn't resolve to the allowed host / /vacancy/ path,
 * are dropped. Exported for unit tests.
 * @param {string} html
 * @param {string} companyName
 * @returns {{title: string, url: string, company: string, location: string} | null}
 */
export function parseIntelliasCard(html, companyName) {
  const href = String(html).match(/href="([^"]+)"/);
  if (!href) return null;
  let parsed;
  try { parsed = new URL(decodeEntities(href[1])); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== ALLOWED_HOST || !parsed.pathname.startsWith('/vacancy/')) return null;
  const title = String(html).match(/<div class="card_title">([\s\S]*?)<\/div>/);
  const cleanTitle = title ? decodeEntities(title[1].replace(/\s+/g, ' ').trim()) : '';
  if (!cleanTitle) return null;
  const loc = String(html).match(/<div class="location[^"]*"[^>]*>[\s\S]*?<span class="fw500">([\s\S]*?)<\/span>/);
  return {
    title: cleanTitle,
    url: `${parsed.origin}${parsed.pathname}`,
    company: companyName,
    location: loc ? decodeEntities(loc[1].replace(/\s+/g, ' ').trim()) : '',
  };
}

/**
 * Parse a vacancy detail page for the full location and description. The full
 * location lives in the `.vi_row--static` row whose icon is `mappin-icon.svg`
 * (the card list only carries a truncated form); the description in the
 * `.text_overview` blocks. Best-effort — an empty result means no enrichment.
 * Exported for unit tests.
 * @param {string} html
 * @returns {{ location?: string, description?: string }}
 */
export function parseIntelliasDetail(html) {
  const out = {};
  const rows = String(html).split('vi_row--static').slice(1);
  for (const row of rows) {
    const icon = row.match(/icons\/([\w-]+)\.svg/);
    if (!icon || icon[1] !== 'mappin-icon') continue;
    const text = row.match(/<span class="vi_row_text">([\s\S]*?)<\/span>/);
    const loc = text ? decodeEntities(text[1].replace(/\s+/g, ' ').trim()) : '';
    if (loc) out.location = loc;
    break;
  }
  const blocks = [];
  for (const [, raw] of String(html).matchAll(/<div class="text_overview[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
    const t = htmlToText(raw);
    if (t) blocks.push(t);
  }
  if (blocks.length) out.description = blocks.join('\n\n');
  return out;
}

/** @type {Provider} */
export default {
  id: 'intellias',

  detect(entry) {
    const origin = resolveOrigin(entry);
    return origin ? { url: `${origin}${AJAX_PATH}` } : null;
  },

  async fetch(entry, ctx) {
    const origin = resolveOrigin(entry);
    if (!origin) throw new Error(`intellias: cannot derive origin for ${entry?.name || '(unnamed)'}`);
    assertIntelliasOrigin(origin);
    const ajaxUrl = `${origin}${AJAX_PATH}`;

    const ctxMax = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0 ? ctx.maxPages : Infinity;
    const pageLimit = Math.min(resolveMaxPages(entry), ctxMax);

    const byUrl = new Map();
    let reachedEnd = false;
    for (let page = 1; page <= pageLimit; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const body = new URLSearchParams({ action: ACTION, page: String(page) });
      const text = await fetchTextWithRetry(ctx, ajaxUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'error',
      });
      const parsed = parseIntelliasAjax(text);
      const pageJobs = parsed.posts
        .map((h) => parseIntelliasCard(h, entry?.name || 'Intellias'))
        .filter(Boolean);
      for (const job of pageJobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      // Terminate on the RAW source shape, not the parser's output: the source
      // signals its own end via `end` and an empty posts[] (verified live — the
      // page past the last one returns {posts:[], end:true}). A card-parse
      // break that yields 0 jobs from a non-empty page must NOT read as a clean
      // end (which would silently truncate a still-live board).
      if (parsed.end === true || parsed.posts.length === 0) { reachedEnd = true; break; }
      // First page that shipped cards but parsed to none is a markup break, not
      // an empty board — surface it instead of quietly returning 0 forever.
      if (page === 1 && pageJobs.length === 0) {
        throw new Error('intellias: page 1 returned cards but none parsed — card markup likely changed');
      }
    }

    // Detail enrichment answers "what does this job say", not "is this
    // endpoint alive" — skip it entirely while probing (same rule as vdab).
    const { fetchDetails, detailLimit } = parseConfig(entry);
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    if (fetchDetails && !probing) {
      const jobs = [...byUrl.values()].slice(0, detailLimit);
      for (let i = 0; i < jobs.length; i += DETAIL_BATCH) {
        const batch = jobs.slice(i, i + DETAIL_BATCH);
        await Promise.all(batch.map(async (job) => {
          try {
            const html = await ctx.fetchText(job.url, { redirect: 'error' });
            const detail = parseIntelliasDetail(html);
            if (detail.location) job.location = detail.location;
            if (detail.description) job.description = detail.description;
          } catch {
            // Detail fetch is an enrichment only. Keep the listing result.
          }
        }));
      }
    }

    // The "raise max_pages" warning is tied to the entry/DEFAULT stop — never a
    // ctx.maxPages cap or a probe cut-off. When pageLimit resolved to the config
    // cap (not ctx) and we ran out of pages without the source reporting end,
    // the cap truncated a larger board.
    if (!reachedEnd && pageLimit === resolveMaxPages(entry)) {
      console.error(`  ⚠ intellias: reached max_pages=${resolveMaxPages(entry)}; raise max_pages on this entry to cover the full board`);
    }
    return [...byUrl.values()];
  },
};