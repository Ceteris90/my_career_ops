#!/usr/bin/env node
/**
 * site-auth-handoff.mjs — hand control to the user when a job board needs login
 *
 * The Inbox resolver (rank-pipeline.mjs) can unwrap most email tracking links
 * without a session, but LinkedIn `/comm/jobs/view` wrappers, Indeed
 * `rc/clk/dl` / `cts/v3` and Glassdoor `partner/jobListing` links only reveal the
 * real posting to an authenticated session. This tool is the explicit handoff:
 * it scans the pipeline's PENDING rows for auth-walled board links, checks which
 * of those boards currently have a live session, and tells the user exactly which
 * boards to log into — instead of the resolver silently leaving the lead unresolved.
 *
 * It never logs in on its own except with `--login` (which runs `site-login.mjs`),
 * never sends/applies, and never writes the pipeline.
 *
 * Run: node site-auth-handoff.mjs             (handoff report; exit 1 if a login is needed)
 *      node site-auth-handoff.mjs --json      (machine-readable)
 *      node site-auth-handoff.mjs --quiet     (exit code only)
 *      node site-auth-handoff.mjs --login     (open site-login.mjs, then re-check)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isLoginWall, isTrackingLead } from './lib/tracking-resolver.mjs';

// Board name → host matcher, mirroring site-login.mjs's SITES.
const BOARD_MATCHERS = [
  { name: 'LinkedIn', re: /(^|\.)linkedin\.com$/i },
  { name: 'Indeed', re: /(^|\.)indeed\.com$/i },
  { name: 'Glassdoor', re: /(^|\.)glassdoor\.[a-z.]+$/i },
];

function hostOf(u) {
  try { return new URL(String(u).replace(/[\x00-\x1f]/g, '')).hostname.toLowerCase(); } catch { return null; }
}

/** Board name for a URL's host, or null. */
export function boardFor(url) {
  const h = hostOf(url);
  if (!h) return null;
  for (const b of BOARD_MATCHERS) if (b.re.test(h)) return b.name;
  return null;
}

/**
 * Boards implicated by the pipeline's PENDING rows: a pending URL that is a
 * known auth-walled tracking lead or a login wall, on a board we know.
 * @returns {Map<string,string[]>} board → example URLs
 */
export function boardsNeeded(root = getCareerOpsRoot()) {
  const p = join(root, 'data', 'pipeline.md');
  const needed = new Map();
  if (!existsSync(p)) return needed;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (!/^- \[ \]/.test(line)) continue;
    const m = line.match(/https?:\/\/[^ |]+/);
    if (!m) continue;
    const url = m[0];
    if (!(isTrackingLead({ url }) || isLoginWall({ url }))) continue;
    const board = boardFor(url);
    if (!board) continue;
    if (!needed.has(board)) needed.set(board, []);
    if (needed.get(board).length < 3) needed.get(board).push(url);
  }
  return needed;
}

/** Run site-auth-doctor.mjs --json and return its parsed result (or null on failure). */
function authStatus(root = getCareerOpsRoot()) {
  const doctor = join(root, 'site-auth-doctor.mjs');
  if (!existsSync(doctor)) return null;
  const r = spawnSync(process.execPath, [doctor, '--json'], { encoding: 'utf-8', timeout: 180_000 });
  try { return JSON.parse(r.stdout || '{}'); } catch { return null; }
}

function runLogin(root = getCareerOpsRoot()) {
  const login = join(root, 'site-login.mjs');
  if (!existsSync(login)) return 1;
  const r = spawnSync(process.execPath, [login], { stdio: 'inherit' });
  return r.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node site-auth-handoff.mjs [--json] [--quiet] [--login]

  --json    machine-readable JSON output
  --quiet   exit code only (0 = nothing to do / all needed boards authed)
  --login   open site-login.mjs interactively, then re-check
  --help    print this help and exit`);
    return 0;
  }
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');

  const root = getCareerOpsRoot();
  const needed = boardsNeeded(root);
  let status = authStatus(root);
  let authed = status?.authenticated || {};

  const pendingBoards = [...needed.keys()];
  let unauthenticated = pendingBoards.filter(b => !authed[b]);

  if (args.includes('--login') && unauthenticated.length > 0) {
    console.log(`\nOpening site-login.mjs for: ${unauthenticated.join(', ')}`);
    const code = runLogin(root);
    if (code !== 0) console.error('site-login.mjs did not complete cleanly; re-check manually with node site-auth-doctor.mjs --json');
    // Re-check ONCE after login — no recursion, so a still-missing session just
    // reports the handoff instead of re-opening the browser in a loop.
    status = authStatus(root);
    authed = status?.authenticated || {};
    unauthenticated = pendingBoards.filter(b => !authed[b]);
  }

  const profileExists = status?.exists ?? false;

  const handoffNeeded = unauthenticated.length > 0;
  const result = {
    profile: status?.profile || null,
    profile_exists: profileExists,
    pending_boards: pendingBoards,
    authenticated: authed,
    unauthenticated,
    handoff_needed: handoffNeeded,
    examples: Object.fromEntries(pendingBoards.map(b => [b, needed.get(b)])),
    action: handoffNeeded
      ? `Run: node site-login.mjs — log in to ${unauthenticated.join(', ')} in the opened browser, then re-run the resolver.`
      : (pendingBoards.length ? 'All needed board sessions are live.' : 'No auth-walled pending links.'),
  };

  if (json) console.log(JSON.stringify(result, null, 2));
  else if (!quiet) {
    if (pendingBoards.length === 0) {
      console.log('No auth-walled pending links — nothing to hand off.');
    } else {
      console.log(`\n${pendingBoards.length} board(s) have auth-walled pending links: ${pendingBoards.join(', ')}`);
      for (const b of pendingBoards) {
        console.log(`  ${authed[b] ? '✅' : '⛔'} ${b}${authed[b] ? ' (session live)' : ' (needs login)'}`);
        for (const u of needed.get(b)) console.log(`       ${u.slice(0, 100)}`);
      }
      if (handoffNeeded) {
        console.log(`\n⛔ HANDOFF: log in to ${unauthenticated.join(', ')}.`);
        console.log('   Run: node site-login.mjs   (log in, close the window), then re-run `node rank-pipeline.mjs --limit 200`.');
        console.log('   If Google SSO says "browser not secure", use the site\'s own email+password form.');
      } else {
        console.log('\n✅ All needed sessions are live.');
      }
    }
  }

  return handoffNeeded ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
