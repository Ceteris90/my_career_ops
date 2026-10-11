// @ts-check
/**
 * lib/board-employer.mjs — the real employer of a posting that a job board
 * relays under its own name.
 *
 * APEC's feed lists some HelloWork postings with "Hellowork" as the company
 * (utm_source=apec). The blacklist, the tracker check and the per-company cap
 * all ran on that name, so a Capgemini posting reached a night run on
 * 2026-10-07 although Capgemini is on data/blacklist.md. The posting page's
 * schema.org JobPosting block (JSON-LD) names the employer in
 * `hiringOrganization.name`; make-pool.mjs reads it for every job whose
 * company is a board's name and runs the company checks again on it.
 *
 * Answers are kept in data/employer-names.json (url -> name, or null when the
 * page names no employer), so a page is asked for once.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { BROWSER_LIKE_USER_AGENT } from '../user-agent.mjs';

const TIMEOUT_MS = 15_000;
const THROTTLE_MS = 1_500;

/** Names that are a job board or a public job service, not an employer. */
const BOARD_NAME = /^(hello ?work|apec|france ?travail|p[oô]le ?emploi|free-?work|meteojob|indeed|linkedin|welcome to the jungle|wttj|jobteaser|talent\.com|jooble|monster|cadremploi|regionsjob|jobposting\.pro)$/i;

/** @param {string} name */
export const isBoardName = (name) => BOARD_NAME.test(String(name || '').trim());

/**
 * The employer named in a page's JSON-LD JobPosting, or null.
 * @param {string} html
 * @returns {string|null}
 */
export function employerFromHtml(html) {
  // HelloWork writes the "+" as an entity (ld&#x2B;json), as lib/posting-fetch.mjs knows.
  const blocks = String(html || '').matchAll(/<script[^>]*type=["']application\/ld(?:\+|&#x2B;|&#43;|&plus;)json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let data;
    try { data = JSON.parse(body.trim()); } catch { continue; }
    const items = [data, ...(Array.isArray(data) ? data : []), ...(Array.isArray(data?.['@graph']) ? data['@graph'] : [])];
    for (const it of items) {
      const org = it?.hiringOrganization;
      const name = (typeof org === 'string' ? org : org?.name || '').trim();
      if (name && !isBoardName(name)) return name;
    }
  }
  // HelloWork pages without a JobPosting block (#43) still name the employer in the title:
  // "Offre Emploi CDI … - Recrutement par Assystem | Hellowork".
  const title = String(html || '').match(/<title>[^<]*? - Recrutement par ([^<|]+?)\s*\|\s*Hellowork\s*<\/title>/i);
  const name = title ? decodeEntities(title[1]).trim() : '';
  return name && !isBoardName(name) ? name : null;
}

/** @param {string} s */
const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");

/**
 * Real employer for each row whose `co` is a board's name. Rows are changed
 * in place (`co` replaced, `boardCo` keeps the board's name). Returns how many
 * were resolved and how many stayed unknown.
 * @param {Array<{ co?: string, url: string, boardCo?: string }>} rows
 * @param {{ cachePath: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} opts
 */
export async function resolveBoardEmployers(rows, { cachePath, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  let resolved = 0, unknown = 0, asked = 0;
  for (const x of rows) {
    if (!isBoardName(x.co || '')) continue;
    if (!(x.url in cache)) {
      if (asked++) await sleep(THROTTLE_MS);
      try {
        const res = await fetchImpl(x.url, { headers: { 'user-agent': BROWSER_LIKE_USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) cache[x.url] = employerFromHtml(await res.text());
      } catch { /* network: asked again next run */ }
    }
    const name = cache[x.url];
    if (name) { x.boardCo = x.co; x.co = name; resolved++; } else unknown++;
  }
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  return { resolved, unknown };
}
