// Which discovered offers count as "already evaluated" for the Explore /
// "new matches" supply loop (api/whats-new).
//
// Pure JS (no TS types) so it can be imported by the route AND by a
// `node --test` unit test, matching funnel-tiles.mjs / status-alias.mjs /
// clean-chips.mjs — web's test script is `node --test tests/**/*.test.mjs`
// and there is no TS runner.
//
// THE KEY IS COMPANY **AND** ROLE (#3131). Suppressing by employer alone meant
// one evaluated role removed that employer's entire board from Explore,
// permanently, including postings first seen afterwards. An employer with 20+
// live roles went completely invisible after evaluating one of them, and the
// scanner was working throughout — the rows were in scan-history.tsv, only the
// view hid them. "No new matches" then reads identically to "matches exist but
// are suppressed", which is what makes it hard to notice.
//
// The trade is deliberate and in the safer direction. If the tracker's role
// text and the scan-history title drift apart ("Staff SWE" vs "Staff Software
// Engineer"), an already-evaluated role can reappear in Explore once: a
// VISIBLE false positive the user can dismiss. What it replaces is a silent
// false negative — a board the user cannot see and gets no signal about.
//
// THE POSTING URL REFINES THAT KEY (#5684). Company + role still hid every
// LATER requisition with the same title (one opening per city, a second req a
// recruiter posted under the same title) for good: #3131's silent false
// negative in a narrower shape. So when the evaluated row's posting URL (its
// URL cell, else its report's `**URL:**`) and the scan row's URL are both
// known, they decide: the same key is the evaluated posting, a different key
// is another opening. It is the rule verify-pipeline.mjs applies to duplicate
// reports: two present-and-different URLs prove two openings, a missing one
// proves nothing. So an unknown URL on either side falls back to company +
// role, and #3131's trade stands unchanged for every row without one.
//
// Two URLs on DIFFERENT hosts are not evidence either. An aggregator listing
// is evaluated under the employer's URL (AGENTS.md, "Aggregator Listings"), so
// the scan row and the report name one posting on two hosts; reading that as
// two openings would resurface every such evaluated role. The URL can only
// bring a row back that company + role would hide, never hide a new one, so
// what it can get wrong stays on #3131's visible side.
//
// Reports are read lazily through an injected reader, and only for evaluated
// rows whose company + role match a scan row, once each. Nothing is read to
// build the keys.
//
// The normalizer is injected rather than imported, because the route resolves
// the CORE's normalizeTextKey from the user's own checkout (lib/core/text-key)
// so web dedup always matches CLI dedup. A second key helper here is exactly
// the local reimplementation #2666 removed. The URL key is imported: it is
// core/url-key.mjs, the parity-tested mirror the web already keys posting URLs
// with on the server (Explore dedup, inbox reconcile).

import { normalizeUrl } from "./core/url-key.mjs";

// The core's report-URL rule (merge-tracker.mjs resolveReportUrl,
// verify-pipeline.mjs extractReportUrlKey): `**URL:**` anywhere on the line,
// since the documented header can be inline, and `[ \t]*` so an empty header
// cannot capture the next line. A token normalizeUrl cannot key (`N/A`) reads
// as unknown.
const REPORT_URL = /\*\*URL:\*\*[ \t]*(\S+)/;

/**
 * Suppression key for one company/role pair.
 *
 * A tracker row with no role yields "company|", which matches only a scan row
 * that also has no title — so a backfilled, role-less row (#1799) suppresses
 * that one shape rather than the whole employer.
 *
 * @param {(value: unknown, separator?: string) => string} norm - Core key fn.
 * @param {string} company
 * @param {string} role
 * @returns {string}
 */
export function suppressionKey(norm, company, role) {
  return `${norm(company, " ")}|${norm(role, " ")}`;
}

/**
 * @typedef {{key: string, host: string}} PostingId
 * @typedef {{company?: string, role?: string, url?: string, report?: string}} EvaluatedApp
 */

/**
 * Posting identity of a URL, or null when it has no key.
 *
 * @param {unknown} raw
 * @returns {PostingId | null}
 */
function postingId(raw) {
  const key = normalizeUrl(raw);
  return key ? { key, host: new URL(key).host } : null;
}

/**
 * The evaluated row's posting: its URL cell, else its report's `**URL:**`.
 *
 * @param {EvaluatedApp} app
 * @param {((app: EvaluatedApp) => string | null) | undefined} readReport
 * @returns {PostingId | null}
 */
function evaluatedPosting(app, readReport) {
  const fromCell = postingId(app?.url);
  if (fromCell) return fromCell;
  const report = readReport?.(app);
  const match = typeof report === "string" ? REPORT_URL.exec(report) : null;
  return match ? postingId(match[1]) : null;
}

/**
 * Keys for every evaluated application, each with its posting resolved on
 * first use.
 *
 * Rows whose company normalizes to nothing are dropped: they cannot identify
 * an employer, and keeping them would let one blank row suppress every scan
 * row whose company is also unkeyable.
 *
 * @param {EvaluatedApp[]} applications
 * @param {(value: unknown, separator?: string) => string} norm
 * @param {(app: EvaluatedApp) => string | null} [readReport] - Text of the
 *   report a tracker row links to, or null. Called lazily (see the header).
 * @returns {Map<string, (() => PostingId | null)[]>}
 */
export function evaluatedKeys(applications, norm, readReport) {
  const keys = new Map();
  for (const app of applications ?? []) {
    if (!norm(app?.company, " ")) continue;
    const key = suppressionKey(norm, app?.company ?? "", app?.role ?? "");
    /** @type {PostingId | null | undefined} */
    let posting;
    const resolve = () => (posting === undefined ? (posting = evaluatedPosting(app, readReport)) : posting);
    const postings = keys.get(key);
    if (postings) postings.push(resolve);
    else keys.set(key, [resolve]);
  }
  return keys;
}

/**
 * Has this discovered offer already been evaluated?
 *
 * @param {Map<string, (() => PostingId | null)[]>} keys - From evaluatedKeys().
 * @param {(value: unknown, separator?: string) => string} norm
 * @param {string} company - Scan-history company cell.
 * @param {string} title - Scan-history title cell.
 * @param {string} [url] - Scan-history url cell.
 * @returns {boolean}
 */
export function isEvaluated(keys, norm, company, title, url) {
  if (!company || !norm(company, " ")) return false;
  const postings = keys.get(suppressionKey(norm, company, title));
  if (!postings) return false;
  const scanned = postingId(url);
  if (!scanned) return true;
  return postings.some((resolve) => {
    const evaluated = resolve();
    // Only two known URLs on one host can prove two openings.
    return !evaluated || evaluated.host !== scanned.host || evaluated.key === scanned.key;
  });
}
