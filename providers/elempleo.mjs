// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// ElEmpleo provider: elempleo.com, a general job board for Colombia.
// Target list: `job_boards:`. Wire it in with the search URL you would open in
// a browser:
//   - name: ElEmpleo
//     careers_url: https://www.elempleo.com/co/ofertas-empleo/
//
// There is no public API; the search pages are server-rendered HTML. Measured
// on https://www.elempleo.com/co/ofertas-empleo/ (2026-10-23: HTTP 200 with
// career-ops' default User-Agent), each result card carries its own data as
// entity-encoded JSON:
//   <div class="... js-area-bind ..." data-url="/co/ofertas-trabajo/{slug}-{ID}"
//        data-ga4-offerdata="{&quot;id&quot;:{ID},&quot;title&quot;:&quot;...&quot;,
//                             &quot;company&quot;:&quot;...&quot;,&quot;location&quot;:&quot;Bogot&#225;&quot;,...}">
// so a title such as `Mec&#225;nico` decodes once, through the shared
// decodeEntities, before the JSON is read. The page also links each posting
// from share buttons (WhatsApp, ...); only same-host /ofertas-trabajo/ URLs
// are kept.
//
// Pagination: the page renders its pager client-side, so the `?pagina=N`
// parameter used here is unverified. The walk stops as soon as a page brings
// no new ids, so a parameter the board ignores (re-serving page 1) ends the
// walk instead of repeating it.

import { decodeEntities } from './_html-entities.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CAP = 20;
const DEFAULT_MAX_JOBS = 50;
const MAX_JOBS_CAP = 500;
const OBSERVED_PAGE_SIZE = 20; // results per page, measured 2026-10-23

const ALLOWED_HOSTS = new Set(['www.elempleo.com', 'elempleo.com']);

/** A posting detail link anywhere in the page: the "this is a listing" signal. */
const POSTING_HREF_RE = /\/[a-z]{2}\/ofertas-trabajo\/[a-z0-9-]+-\d+/i;

/** @param {unknown} s */
function clean(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Keep user overrides bounded so a typo cannot turn one board into an unbounded crawl. */
function boundedPositiveInt(value, fallback, cap) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, cap) : fallback;
}

/**
 * Validate a configured search URL and rebuild it from its parts: https only,
 * an elempleo.com host only, port and credentials dropped.
 * @param {unknown} raw
 * @returns {URL}
 */
export function resolveListUrl(raw) {
  const u = new URL(String(raw)); // throws on a malformed URL
  if (u.protocol !== 'https:') throw new Error(`elempleo: careers_url must be https, got ${u.protocol}`);
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`elempleo: ${u.hostname} is not an elempleo.com host`);
  return new URL(`https://${u.hostname}${u.pathname}${u.search}`);
}

/**
 * Parse the result cards out of one search page.
 * @param {string} html
 * @param {string} origin - e.g. https://www.elempleo.com
 * @returns {Array<{id:string,title:string,url:string,company:string,location:string}>}
 */
export function parseCards(html, origin) {
  const out = [];
  for (const tagM of String(html).matchAll(/<div\b[^>]*\bdata-ga4-offerdata="([^"]+)"[^>]*>/gi)) {
    const tag = tagM[0];
    const urlM = tag.match(/\bdata-url="([^"]+)"/i);
    if (!urlM) continue;

    let url;
    try {
      url = new URL(decodeEntities(urlM[1]), origin);
    } catch {
      continue;
    }
    if (!ALLOWED_HOSTS.has(url.hostname) || !POSTING_HREF_RE.test(url.pathname)) continue;

    let data;
    try {
      data = JSON.parse(decodeEntities(tagM[1]));
    } catch {
      continue; // one malformed card, not a broken board
    }
    if (!data || typeof data !== 'object') continue;

    const title = clean(data.title);
    if (!title || title.length < 3) continue;
    const company = clean(data.company);

    out.push({
      id: data.id != null ? String(data.id) : url.pathname,
      title,
      url: `${url.origin}${url.pathname}`,
      // "Empresa confidencial" is the board's placeholder, not an employer;
      // like a missing one it becomes the tracker's '?' marker (#1596), never
      // the board's or the entry's name (Source Indexing Policy rule 1).
      company: !company || /^empresa confidencial$/i.test(company) ? '?' : company,
      location: clean(data.location),
    });
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'elempleo',

  detect(entry) {
    const raw = entry?.api || entry?.careers_url;
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return { url: resolveListUrl(raw).href };
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const raw = entry.api || entry.careers_url;
    if (!raw) throw new Error(`elempleo: no URL provided for ${entry.name}`);
    // Host allowlist before any request (SSRF guard).
    const listUrl = resolveListUrl(raw);

    // verify-portals' health probe sets ctx.maxPages: one page, no retries,
    // and a fetch rejection propagates unwrapped.
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const entryMaxPages = boundedPositiveInt(entry.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_CAP);
    const maxPages = probing ? Math.min(entryMaxPages, ctx.maxPages) : entryMaxPages;
    const maxJobs = boundedPositiveInt(entry.max_jobs, DEFAULT_MAX_JOBS, MAX_JOBS_CAP);

    const jobs = [];
    const seen = new Set();
    /** @type {'complete'|'cap'|'fetch-error'} */
    let stopReason = 'complete';

    for (let page = 1; page <= maxPages; page++) {
      // Random 1-2.5 s pause between pages, never before the first one.
      if (page > 1) await sleep(1000 + Math.random() * 1500, ctx);

      const pageUrl = new URL(listUrl);
      pageUrl.searchParams.set('pagina', String(page));

      let html;
      try {
        html = await fetchTextWithRetry(ctx, pageUrl.href, {
          redirect: 'error',
          headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        }, probing ? { retries: 0 } : {});
      } catch (err) {
        if (probing || page === 1) throw err;
        console.warn(`[elempleo] ${entry.name}: page ${page} failed (${(err && err.message) || err}); keeping the ${jobs.length} posting(s) from earlier pages.`);
        stopReason = 'fetch-error';
        break;
      }

      const cards = parseCards(html, listUrl.origin);
      if (cards.length === 0) {
        if (page === 1 && POSTING_HREF_RE.test(html)) {
          throw new Error(`elempleo: ${pageUrl.href} links postings but no result card parsed (markup change?)`);
        }
        break; // page 1: a search with no results; later: past the last page
      }

      let fresh = 0;
      for (const card of cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        fresh++;
        if (jobs.length >= maxJobs) {
          stopReason = 'cap';
          break;
        }
        jobs.push({ title: card.title, url: card.url, company: card.company, location: card.location });
      }
      if (stopReason === 'cap' || fresh === 0 || jobs.length >= maxJobs) break;
      if (page === maxPages && !probing && cards.length >= OBSERVED_PAGE_SIZE) stopReason = 'cap';
    }

    if (stopReason === 'cap') {
      console.warn(`[elempleo] ${entry.name}: stopped at max_pages ${maxPages} / max_jobs ${maxJobs}; the search has more results. Raise max_pages or max_jobs on this entry to read them.`);
    }
    return jobs;
  },
};
