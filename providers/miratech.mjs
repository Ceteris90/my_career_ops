// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
import { fetchJsonWithRetry, sleep } from './_http.mjs';
import { coerceId } from './_ids.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Miratech provider — single-company adapter for tracked_companies.
//
// Miratech's careers page (https://miratechgroup.com/career/) is a WordPress
// page that does NOT server-render any postings. It embeds the SmartRecruiters
// job widget for company_code "Miratech1":
//
//   widget({ company_code: "Miratech1",
//            departments_field_id: "5b741576b60a5e6daf8f57e2",
//            add_search: "true", ... })
//
// The widget's search box, department select and "show more" button are all
// client-side views over ONE server-side source: SmartRecruiters' public
// postings API. Reading that API directly is the canonical full-inventory path
// (Source Indexing Policy rule 3) — no HTML scraping, no per-posting request,
// no browser:
//
//   https://api.smartrecruiters.com/v1/companies/Miratech1/postings
//     ?limit=100&offset=N&status=PUBLIC
//
//   - Filters: the widget's department filter and search box narrow the same
//     set the API returns (they never hit a different endpoint). A provider
//     must traverse the full inventory, so none of them are forwarded —
//     scan.mjs applies title_filter / location_filter / content_filter
//     downstream (recall-first).
//   - Pagination: `limit` + `offset` over `content[]`; `totalFound` is the
//     source's own count (informational only — the walk is bounded by the
//     provider's own cap, never by `totalFound`). A page shorter than the page
//     size ends the walk naturally.
//   - Each row carries `name` (title), `id` (posting id → public URL),
//     `releasedDate` (postedAt), `refNumber` (employer requisition id),
//     `language.code` and `location`. No detail request is needed for any of
//     these, so the provider stays zero-token.
//
// Job URL: the canonical public posting page is
// https://jobs.smartrecruiters.com/Miratech1/<id>-<title-slug> — the exact URL
// the embedded widget links to. Miratech does not expose a per-posting page on
// its own host.

const API_HOST = 'api.smartrecruiters.com';
const COMPANY_SLUG = 'Miratech1';
// Miratech's branded careers host. Only this host is auto-claimed: the generic
// SmartRecruiters hosts belong to the `smartrecruiters` provider, and claiming
// them here would steal its entries (this module sorts before it).
const CAREERS_HOSTS = new Set(['miratechgroup.com', 'www.miratechgroup.com']);
// `/career` or `/career/` exactly — not a `/careers/...` neighbour.
const CAREER_PATH_RE = /^\/career\/?$/;
const PUBLIC_JOB_BASE = 'https://jobs.smartrecruiters.com/';

const SR_PAGE_SIZE = 100;
// ~221 open postings measured live 2026-10-19 → 3 pages of 100. 10 pages
// (≈1000 postings) is comfortably beyond any live volume on this board.
const DEFAULT_MAX_PAGES = 10;
const MAX_PAGES_CAP = 100;
const INTER_PAGE_DELAY_MS = 250;

function resolveMaxPages(entry) {
  return Number.isInteger(entry?.max_pages) && entry.max_pages > 0
    ? Math.min(entry.max_pages, MAX_PAGES_CAP)
    : DEFAULT_MAX_PAGES;
}

const buildPostingsUrl = (offset) =>
  `https://${API_HOST}/v1/companies/${COMPANY_SLUG}/postings?limit=${SR_PAGE_SIZE}&offset=${offset}&status=PUBLIC`;

/** NaN-safe date parse — a date *string* can return NaN; the guard is for the
 * absent/empty field before parsing. */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {string} title @returns {string} */
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Parse one SmartRecruiters postings page into Jobs. Exported for unit tests.
 *
 * `{ content: [] }` is a valid empty page → `{ rows: [], rawCount: 0 }`. A body
 * that isn't the documented envelope (`content` absent, non-array, or a bare
 * non-object) throws a descriptive error (a silent API change). A row missing
 * a usable `name` / `id`, or whose id can't be encoded, is dropped — never
 * fatal to the page.
 *
 * `rawCount` is the source's own row count for the page (before any row was
 * dropped), which is what the caller's short-page stop keys off.
 *
 * @param {unknown} json
 * @param {string} companyName
 * @returns {{ rows: Array<{title: string, url: string, company: string, location: string, postedAt?: number, requisitionId?: string, language?: string}>, rawCount: number }}
 */
export function parseMiratechPage(json, companyName) {
  const content = json && typeof json === 'object' ? /** @type {any} */ (json).content : null;
  if (!Array.isArray(content)) {
    const got = json && typeof json === 'object' ? Object.keys(json).join(', ') : typeof json;
    throw new Error(`miratech: unexpected response — expected content[], got: [${got}]`);
  }
  const rows = [];
  for (const row of content) {
    if (!row || typeof row !== 'object') continue;
    const title = typeof row.name === 'string' ? row.name.replace(/\s+/g, ' ').trim() : '';
    if (!title) continue;
    const rawId = coerceId(row.id);
    if (!rawId) continue;
    const idSegment = safeEncodeURIComponent(rawId);
    if (idSegment === null) continue;

    const loc = row.location && typeof row.location === 'object' ? row.location : {};
    const fullLocation = loc.fullLocation || [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
    const location = [fullLocation, loc.remote ? 'Remote' : ''].filter(Boolean).join(', ');
    const titleSlug = slugify(title);

    const job = {
      title,
      url: `${PUBLIC_JOB_BASE}${COMPANY_SLUG}/${idSegment}${titleSlug ? `-${titleSlug}` : ''}`,
      company: companyName || 'Miratech',
      location,
    };
    const postedAt = toEpochMs(row.releasedDate);
    if (postedAt !== undefined) job.postedAt = postedAt;
    const requisitionId = coerceId(row.refNumber);
    if (requisitionId) job.requisitionId = requisitionId;
    const language = coerceId(row.language?.code);
    if (language) job.language = language;
    rows.push(job);
  }
  return { rows, rawCount: content.length };
}

/** @type {Provider} */
export default {
  id: 'miratech',

  detect(entry) {
    const candidate = entry?.careers_url || entry?.api;
    if (typeof candidate !== 'string') return null;
    let parsed;
    try { parsed = new URL(candidate); } catch { return null; }
    if (parsed.protocol !== 'https:') return null;
    if (!CAREERS_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    if (!CAREER_PATH_RE.test(parsed.pathname)) return null;
    return { url: buildPostingsUrl(0) };
  },

  async fetch(entry, ctx) {
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const ctxMax = probing ? ctx.maxPages : Infinity;
    const ownMax = resolveMaxPages(entry);
    const pageLimit = Math.min(ownMax, ctxMax);

    const byUrl = new Map();
    let stopReason = 'cap';

    for (let page = 0; page < pageLimit; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);
      const url = buildPostingsUrl(page * SR_PAGE_SIZE);
      let json;
      try {
        json = await fetchJsonWithRetry(ctx, url, { redirect: 'error' });
      } catch (err) {
        // A probe's budget cut-off must survive unwrapped (verify-portals reads
        // it as "endpoint live, count unknown"), and a first-page failure has
        // nothing to fall back on — both rethrow.
        if (page === 0 || probing) throw err;
        stopReason = 'fetch-error';
        console.error(`  ⚠ miratech: page ${page + 1} failed (${err?.message || err}); keeping ${byUrl.size} postings`);
        break;
      }
      const { rows, rawCount } = parseMiratechPage(json, entry?.name);
      for (const job of rows) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
      if (rawCount < SR_PAGE_SIZE) { stopReason = 'complete'; break; }
      if (page === pageLimit - 1) stopReason = 'cap';
    }

    // Only a config-ceiling stop warns — never a ctx.maxPages cap, a probe
    // cut-off, a fetch error, or a natural end.
    if (stopReason === 'cap' && pageLimit === ownMax) {
      console.error(`  ⚠ miratech: reached max_pages=${ownMax}; raise max_pages on this entry to cover the full board`);
    }
    return [...byUrl.values()];
  },
};
