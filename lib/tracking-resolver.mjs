#!/usr/bin/env node
// @ts-check
//
// Pure helpers for resolving email job-alert TRACKING links into real job postings.
//
// Gmail ingest pulls job leads from emails. Some alerts (Glassdoor "partner/jobListing"
// links, Indeed "rc/clk/dl" redirect links) are tracking URLs that only reveal the
// real job after client-side JS runs — curl sees no HTTP redirect, so they arrive in
// pipeline.md as content-less rows ("Job lead (email)") that rank at ~0.0. The browser
// half of the fix lives in rank-pipeline.mjs (it owns the Playwright launch + the
// pipeline lock); this module keeps the pure, testable logic separate.

/**
 * Does this pipeline entry look like a content-less tracking link that must be
 * resolved in a real browser before it can be ranked? Targeted at the two known
 * job-alert trackers (Glassdoor jobListing, Indeed rc/clk/dl). Scoped narrowly on
 * purpose: real job URLs (e.g. JustJoin slugs) with a placeholder title are NOT
 * tracked here — they are already rankable from their URL.
 *
 * @param {{url?: string, title?: string}} entry
 */
export function isTrackingLead(entry) {
  const u = String(entry?.url || '');
  // A RESOLVED Glassdoor job page keeps the `jobListingId=` query param but also
  // carries a real job slug (/job-listing/{slug}-JV_...). That is the destination,
  // not a tracker — do not let the jobListingId rule below re-classify it.
  if (/glassdoor\.[a-z]+\/job-listing\//i.test(u)) return false;
  if (/glassdoor\.[a-z]+\/partner\/jobListing/i.test(u)) return true;
  if (/jobListingId=\d+/i.test(u)) return true; // covers glassdoor regional variants
  if (/(^|\/)([a-z]{2}\.)?indeed\.com\/rc\/clk\/dl/i.test(u)) return true;
  // LinkedIn job-alert emails wrap real postings as /comm/jobs/view/{id}; the browser
  // unwraps it to the canonical /jobs/view/{id} page.
  if (/linkedin\.com\/comm\/jobs\/view\//i.test(u)) return true;
  return false;
}

/**
 * Does this pending entry still need a browser pass to become informative? True for
 * a known redirect-style tracker, and for a bare row that carries a real http URL but
 * neither a company nor a title (e.g. a JustJoin offer slug harvested from a Gmail
 * alert). An entry whose company AND title are already filled does not need resolving
 * even when its URL is opaque — the ranker has enough to score it.
 *
 * @param {{url?: string, company?: string, title?: string}} entry
 */
export function needsResolution(entry) {
  const url = String(entry?.url || '');
  const company = String(entry?.company || '').trim();
  const title = String(entry?.title || '').trim();
  // The Gmail ingest writes a content-less row as `|  | Job lead (email)`, so the
  // placeholder title is treated as empty — otherwise a bare real-URL row (e.g. a
  // JustJoin offer slug) never qualifies for resolution.
  const titleEmpty = !title || /^job lead \(email\)$/i.test(title);
  // A row that already carries the employer AND role needs no browser pass, even
  // when its URL is an opaque tracker — the ranker has enough to score it. This
  // matches the rule for bare real-URL rows, and it stops the two known trackers
  // from opening a browser per row when the card parse already filled the row:
  // Indeed rc/clk/dl is Cloudflare-gated and never exposes a destination to
  // automation, and a Glassdoor jobListing that will not unwrap just loops.
  if (company && !titleEmpty) return false;
  if (isTrackingLead(entry)) return true;
  return /^https?:\/\//i.test(url) && !company && titleEmpty;
}

/**
 * Is this URL a LOGIN / auth-wall page? The Inbox resolver reaches these when a
 * tracking link (LinkedIn /comm/jobs/view, Indeed viewjob, Glassdoor jobListing)
 * can only be unwrapped by an authenticated session. Detecting it lets the resolver
 * tell the user to run `node site-login.mjs` instead of silently failing.
 *
 * @param {{url?: string}|string} entry
 */
export function isLoginWall(entry) {
  const raw = typeof entry === 'string' ? entry : String(entry?.url || '');
  let host, path;
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  if (/(^|\.)linkedin\.com$/.test(host) && /^\/(ssr-login|login|checkpoint|uas|authwall)/.test(path)) return true;
  if (/(^|\.)indeed\.com$/.test(host) && /^\/(account|auth|login|secure|promo)(\/|$)/.test(path)) return true;
  if (/(^|\.)glassdoor\.[a-z.]+$/.test(host) && /^\/(member\/login|profile\/login|login)/.test(path)) return true;
  if (/^\/(login|signin|sign-in|auth)(\/|$)/.test(path)) return true;
  return false;
}

/**
 * Email-alert CHROME: navigation, account, promo and search-listing links that job
 * alerts carry alongside real postings. These are never vacancies — resolving or
 * ranking them only pollutes the Inbox — so the pipeline marks them `[x]` with a
 * stored justification. Real postings (`/jobs/view/{id}`, `/job-listing/{slug}`,
 * `/viewjob?jk=`) are deliberately excluded.
 *
 * @param {{url?: string}|string} entry
 */
export function isEmailChrome(entry) {
  const raw = typeof entry === 'string' ? entry : String(entry?.url || '');
  let host, path;
  try {
    const u = new URL(raw);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  // LinkedIn chrome: feed/messaging/network/notifications, premium upsell, widgets,
  // saved-items, alert management and search-result pages. A real posting
  // (/comm/jobs/view/{id} or /jobs/view/{id}) is NOT chrome.
  if (/(^|\.)linkedin\.com$/.test(host)) {
    // The /comm/jobs/view wrapper is login-walled; only the canonical public
    // /jobs/view/{id} page is a real posting.
    if (/^\/comm\/jobs\/view\//.test(path)) return true;
    if (/^\/jobs\/view\//.test(path)) return false;
    if (/^\/(ssr-login|login|checkpoint|uas)(\/|$)/.test(path)) return true;
    if (/^\/comm\/(in|feed|messaging|mynetwork|notifications|premium|widgets|my-items)(\/|$)/.test(path)) return true;
    if (/^\/comm\/jobs\/(alerts|search-results)/.test(path)) return true;
    if (/^\/(company|jobs\/search|feed|messaging|mynetwork|notifications)(\/|$)/.test(path)) return true;
  }
  // Indeed chrome: alert settings, legal/support, home, search listings, tracking pixels.
  if (/(^|\.)indeed\.com$/.test(host)) {
    if (host === 'clk.indeed.com') return true;
    // cts.indeed.com/v3/{blob} is Indeed's opaque click-tracker. In a logged-out
    // browser it resolves to account/legal/help pages, not postings, so it is
    // treated as chrome rather than rewritten into a junk-titled row.
    if (host === 'cts.indeed.com') return true;
    if (/^(support|subscriptions)\./.test(host)) return true;
    if (/^\/(subscriptions|legal|support|alerts|update)(\/|$)/.test(path)) return true;
    if (/^\/(imgping|q\/)/.test(path)) return true;
    if (path === '/' || path === '') return true;
    if (/^\/jobs\/?$/.test(path)) return true;
  }
  // Glassdoor chrome: community bowls, search listings, privacy/account settings,
  // mail-open pixels and the internal redirect stub.
  if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) {
    if (/^\/(community|about|member|brand-views)/.test(path)) return true;
    if (/^\/job\/.*srch_/i.test(path)) return true;
    if (/^\/job-listing\/api\//.test(path)) return true;
    if (path === '/' || path === '') return true;
    if (host.startsWith('mail') || host.startsWith('mail8.')) return true;
  }
  // JustJoin chrome: the board home, all-locations listing, and the `hello.` mail host.
  if (/(^|\.)justjoin\.it$/.test(host)) {
    if (path === '/' || path === '') return true;
    if (/^\/job-offers\/all-locations/.test(path)) return true;
    if (host.startsWith('hello.')) return true;
  }
  // Misc promo / social / home pages seen in job-alert footers.
  if (['rocket.pl', 'www.rocket.pl', 'www.facebook.com', 'www.instagram.com', 'x.com', 'twitter.com', 'go.onelink.me'].includes(host)) return true;
  if (host === 'solid.jobs' && (path === '/' || path === '')) return true;
  return false;
}

// Known site suffixes that a browser tab title appends after the real job title
// (e.g. "React Native Developer - Warszawa, mazowieckie - Indeed.com"). Order
// matters: match the longest/known host first.
const TITLE_SUFFIX_RE = /\s*[-–—|]\s*(?:Indeed(?:\.com|\.ca|\.co\.uk|\.pl)?|Glassdoor|JustJoin\.it|LinkedIn)\s*$/i;

// A title that is only site chrome (no job in it) — e.g. Glassdoor's block page
// renders "Security". Returning it would mislabel the row; fall back to the URL slug.
const GENERIC_TITLE_RE = /^(security|home|jobs|job search|search|error|page not found|not found|access denied|glassdoor)$/i;

// Anti-bot interstitial pages ("Help Us Protect Glassdoor", Cloudflare "checking
// your browser", etc.) render their own title, not the job's. Returning it as the
// title would mislabel the row; drop it so the caller falls back to titleFromUrl.
const BLOCK_PAGE_RE = /(help us protect|unusual traffic|access (?:is )?(?:denied|limited)|checking your browser|verify (?:you are|your) (?:a )?human|just a moment)/i;

// Site-chrome pages that a broken/expired tracker resolves to (Indeed's account,
// login, help, legal and unsubscribe pages render their own titles, not a job's).
// Treating them as a title would rewrite a row into junk like "Sign In | Indeed
// Accounts" — so they are rejected and the row is left for the chrome sweep.
const CHROME_PAGE_TITLE_RE = /(sign in|log ?in|войти|create an account|forgot password|help center|terms of service|privacy (policy|notice)|unsubscribed|indeed accounts|hr tech privacy|praca, oferty pracy)/i;

/**
 * Strip the site chrome from a browser tab title to recover the job title.
 * Falls back to the raw title if nothing recognizable is stripped. Returns ''
 * for a known anti-bot interstitial title so the caller uses the URL slug instead.
 *
 * @param {string} rawTitle
 */
export function cleanTitle(rawTitle) {
  const t = String(rawTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!t || BLOCK_PAGE_RE.test(t) || CHROME_PAGE_TITLE_RE.test(t)) return '';
  const stripped = t.replace(TITLE_SUFFIX_RE, '').trim();
  if (!stripped || GENERIC_TITLE_RE.test(stripped)) return '';
  return stripped;
}

/**
 * Rewrite a pipeline row's URL cell (0) and title cell (2) to the resolved values,
 * preserving every other cell byte-for-byte. Returns the new row, or the original
 * line unchanged when there is nothing safe to change.
 *
 * @param {string} rawLine
 * @param {{url: string, title: string}} resolved
 */
export function rewriteResolvedRow(rawLine, resolved) {
  const title = sanitizeTitle(resolved.title);
  const company = sanitizeTitle(resolved.company);
  // Proceed when we learned at least a title or a company; a row where both are
  // still empty has nothing to gain from a rewrite.
  if ((!title && !company) || !/^https?:\/\//i.test(resolved.url)) return rawLine;
  const rest = rawLine.slice(6);
  const cells = rest.split('|');
  if (cells.length < 3) return rawLine;
  cells[0] = `${resolved.url} `;
  if (title) cells[2] = ` ${title} `;
  if (company && !String(cells[1] || '').trim()) cells[1] = ` ${company} `;
  return `${rawLine.slice(0, 6)}${cells.join('|')}`;
}

/**
 * Remove a trailing `rank:` annotation segment from a pipeline row. Resolution
 * strips the stale placeholder rank on a resolved row so it becomes pending again
 * and is re-ranked against the real posting. Only the trailing rank segment (which
 * this tool appends last) is removed; everything else is preserved byte-for-byte.
 *
 * @param {string} rawLine
 */
export function stripRankAnnotation(rawLine) {
  return String(rawLine ?? '').replace(/ \| rank: [^\n]*$/, '');
}

/**
 * Best-effort job title from a resolved job URL when the page itself is CAPTCHA-
 * or SPA-blocked. Glassdoor job-listing URLs embed the title in the slug (e.g.
 * "glassdoor.ca/job-listing/développeur-senior-f..." → "Développeur Senior F...").
 * Noisy generic path segments (job, candidate, rc, clk, ...) are skipped.
 *
 * @param {string} url
 */
export function titleFromUrl(url) {
  let path;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return '';
  }
  const STOP = /^(job|jobs|job-listing|joblisting|career|careers|candidate|viewjob|rc|clk|dl|partner|index|offer|vacancy)$/i;
  const segs = path
    .split('/')
    .filter(Boolean)
    .map(s => s
      .replace(/\.html?$/i, '')          // trailing .htm / .html
      .replace(/[-_]?jv_[^/]*$/i, '')    // Glassdoor "-JV_KO0,20_KE21,29" job-id suffix
      .replace(/[-_+]+/g, ' ')
      .trim())
    .filter(s => s.length > 2 && !STOP.test(s));
  const t = (segs.pop() || '').trim();
  return t.length > 3 ? t : '';
}

function sanitizeTitle(title) {
  return String(title ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[|\n\r\t]/g, '/')
    .trim()
    .slice(0, 120);
}

/**
 * Apply row rewrites to pipeline.md text, consuming each target once by its exact
 * original line. Rows that already resolved (or moved) are left untouched.
 *
 * @param {string} text
 * @param {{raw: string, url: string, title: string}[]} rewrites
 * @returns {{text: string, written: number}}
 */
export function applyRowRewrites(text, rewrites) {
  const queue = rewrites.map(r => ({ ...r, used: false }));
  let written = 0;
  const out = String(text ?? '')
    .split('\n')
    .map(line => {
      const hit = queue.find(r => !r.used && r.raw === line);
      if (!hit) return line;
      hit.used = true;
      const next = rewriteResolvedRow(line, hit);
      if (next !== line) written += 1;
      return next;
    })
    .join('\n');
  return { text: out, written };
}