#!/usr/bin/env node
// @ts-check
//
// site-auth-doctor.mjs — non-interactive check of the persistent browser profile
// that `site-login.mjs` creates and `rank-pipeline.mjs` reuses. Answers "is the
// session still valid?" so a daily run can nudge the user to re-authenticate
// BEFORE the Inbox resolver silently fails on login-walled tracking links.
//
// Usage:
//   node site-auth-doctor.mjs --json     # machine-readable
//   node site-auth-doctor.mjs --quiet    # exit code only (0 = at least one session)
//
// Exit 0 when the profile exists and at least one site is authenticated; exit 1
// otherwise (no profile, or all sessions expired). The JSON always prints.

import { existsSync } from 'node:fs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { SITES, PROFILE_DIR, launchProfileContext } from './site-login.mjs';

// Session cookie names that prove a logged-in session on each board. Checked
// first (robust against DOM/class churn), then the DOM selector as a fallback.
const SESSION_COOKIES = {
  LinkedIn: ['li_at'],
  Indeed: ['PPID', 'CTK', 'SOCK'],
  Glassdoor: ['GSESSIONID', 'gdId'],
};

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node site-auth-doctor.mjs [--json] [--quiet]

  --json       machine-readable JSON output
  --quiet      exit code only (0 = at least one authenticated session)
  --help, -h   print this help and exit`);
    return 0;
  }

  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const result = { profile: PROFILE_DIR, exists: existsSync(PROFILE_DIR), authenticated: {}, anyAuthenticated: false };

  if (!result.exists) {
    if (json || !quiet) console.log(JSON.stringify(result, null, 2));
    return 1;
  }

  let context;
  try {
    // Must use the same channel (real Chrome) that wrote the profile — macOS
    // encrypts cookies per browser, so bundled Chromium cannot read Chrome's.
    context = await launchProfileContext({ headless: true });
  } catch (err) {
    result.error = `cannot launch browser: ${err.message}`;
    if (json || !quiet) console.log(JSON.stringify(result, null, 2));
    return 1;
  }

  try {
    const allCookies = await context.cookies().catch(() => []);
    for (const s of SITES) {
      const want = SESSION_COOKIES[s.name] || [];
      const cookieHit = allCookies.some(c => want.includes(c.name) && (s.homeUrl.includes(c.domain.replace(/^\./, '')) || c.domain.includes(new URL(s.homeUrl).hostname.replace(/^www\./, ''))));
      let domHit = false;
      const page = await context.newPage();
      try {
        await page.goto(s.homeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(1200);
        domHit = await page.evaluate(sel => !!document.querySelector(sel), s.selector);
      } catch { /* best-effort */ }
      finally { await page.close(); }
      const loggedIn = cookieHit || domHit;
      result.authenticated[s.name] = loggedIn;
      if (loggedIn) result.anyAuthenticated = true;
    }
  } finally {
    await context.close();
  }

  if (json || !quiet) console.log(JSON.stringify(result, null, 2));
  return result.anyAuthenticated ? 0 : 1;
}

import { isMainModule } from './lib/is-main-module.mjs';
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
    console.error(`site-auth-doctor: ${err?.message || err}`);
    process.exit(1);
  });
}
