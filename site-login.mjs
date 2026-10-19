#!/usr/bin/env node
// @ts-check
//
// site-login.mjs — one-time interactive login for the job boards whose tracking
// links the Inbox resolver cannot unwrap without an authenticated session:
// LinkedIn (/comm/jobs/view wrappers), Indeed (viewjob / cts/v3), Glassdoor
// (partner/jobListing). It saves cookies into a persistent Playwright profile under
// `data/.browser-profile` (gitignored), which `rank-pipeline.mjs` reuses
// automatically on the next run — the same "authenticate once, then the tool can
// use it" shape as `gmail-reauth.mjs`.
//
// Usage:
//   node site-login.mjs                 # open a browser, log in, close the window
//   node site-login.mjs --status        # print the profile path and whether it exists
//   node site-login.mjs --cdp <url>     # copy cookies from a Chrome running with
//                                       #   --remote-debugging-port=9222 (escape hatch
//                                       #   when Google SSO refuses inside automation)
//
// If "Sign in with Google" reports the browser is not secure, log in with the
// site's own email + password form instead — that avoids Google's automation block
// entirely. Nothing here sends, applies, or clicks an application — it only
// establishes a session the read-only resolver can reuse.

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
export const PROFILE_DIR = join(DATA_ROOT, 'data', '.browser-profile');

// Launch a persistent context for the job boards. Google blocks "Sign in with
// Google" inside automation-controlled browsers ("this browser or app may not be
// secure"), so we (a) prefer the user's REAL Chrome over Playwright's bundled
// Chromium, and (b) strip Playwright's automation markers. Falls back to bundled
// Chromium when Chrome is not installed.
export async function launchProfileContext({ headless }) {
  const common = {
    headless,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...common, channel: 'chrome' });
  } catch {
    return await chromium.launchPersistentContext(PROFILE_DIR, common);
  }
}

// Import cookies from a user-launched, already-logged-in Chrome exposed over the
// DevTools protocol (chrome --remote-debugging-port=9222) into our persistent
// profile. This is the escape hatch when Google SSO refuses to work even in real
// Chrome: log in with your normal browser, then copy the session here.
async function importFromCdp(cdpUrl) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  if (!contexts.length) {
    console.error('site-login --cdp: no browser context found at', cdpUrl);
    await browser.close();
    return 1;
  }
  const cookies = await contexts[0].cookies();
  const profile = await launchProfileContext({ headless: true });
  await profile.addCookies(cookies);
  await profile.close();
  await browser.close();
  console.log(`Imported ${cookies.length} cookie(s) from ${cdpUrl} into the profile.`);
  console.log('Now verify with: node site-auth-doctor.mjs --json');
  return 0;
}

// The boards that gate their postings behind a session. `selector` is the
// logged-in marker we check on the site's home page after consent.
export const SITES = [
  { name: 'LinkedIn', loginUrl: 'https://www.linkedin.com/login', homeUrl: 'https://www.linkedin.com/feed/', selector: '.global-nav__me, img.global-nav__me-photo' },
  { name: 'Indeed', loginUrl: 'https://pl.indeed.com/account/login', homeUrl: 'https://pl.indeed.com/', selector: '#gnav-AccountMenu, [data-testid="gnav-AccountMenu"]' },
  { name: 'Glassdoor', loginUrl: 'https://www.glassdoor.ca/profile/login_input.htm', homeUrl: 'https://www.glassdoor.ca/', selector: '[data-test="user-avatar"], .siteHeader__profilePhoto, [data-test="site-header-profile"]' },
];

async function status() {
  const exists = existsSync(PROFILE_DIR);
  console.log(JSON.stringify({ profile: PROFILE_DIR, exists }, null, 2));
  return 0;
}

// Wait without needing a keypress in the caller's shell: finish when the user
// closes the browser window, or once every site is detected as logged in, or on a
// 15-minute safety timeout.
async function waitUntilDone(context, pages) {
  const deadline = Date.now() + 15 * 60 * 1000;
  let closed = false;
  context.on('close', () => { closed = true; });
  const seen = new Set();
  while (!closed && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    if (closed) break;
    let all = true;
    for (const { site, page } of pages) {
      if (page.isClosed()) continue;
      try {
        const ok = await page.evaluate(sel => !!document.querySelector(sel), site.selector);
        if (ok && !seen.has(site.name)) { seen.add(site.name); console.log(`  ✅ ${site.name} logged in`); }
        if (!ok) all = false;
      } catch { all = false; }
    }
    if (all && seen.size >= pages.length) break;
  }
  return closed;
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node site-login.mjs [--status] [--cdp <url>]

  --status      print the saved profile path and whether it exists
  --cdp <url>   copy cookies from an already-logged-in Chrome started with
                --remote-debugging-port (default http://127.0.0.1:9222)
  --help, -h    print this help and exit

With no flags, opens a browser and saves the login session to the profile at
data/.browser-profile for the Inbox tracking-link resolver to reuse.`);
    return 0;
  }

  if (args.includes('--status')) return status();

  const cdpIdx = args.indexOf('--cdp');
  if (cdpIdx !== -1) return importFromCdp(args[cdpIdx + 1] || 'http://127.0.0.1:9222');

  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log('\nOpening a browser with a persistent profile at:');
  console.log(`  ${PROFILE_DIR}\n`);
  console.log('Log in to each of these in the opened browser:');
  for (const s of SITES) console.log(`  • ${s.name} — ${s.loginUrl}`);
  console.log('\nTip: complete any 2FA / captcha. If "Sign in with Google" says the');
  console.log('browser is not secure, use the site\'s own EMAIL + PASSWORD form instead');
  console.log('(LinkedIn/Indeed/Glassdoor all have one), or see --cdp in the usage.\n');

  let context;
  try {
    context = await launchProfileContext({ headless: false });
  } catch (err) {
    console.error(`site-login: cannot launch browser (${err.message})`);
    return 1;
  }

  try {
    const pages = [];
    // One tab per site so the user can log into all of them in one pass.
    for (const s of SITES) {
      const page = await context.newPage();
      try {
        await page.goto(s.loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      } catch {
        // Some login URLs redirect; not fatal — the user can navigate manually.
      }
      pages.push({ site: s, page });
    }

    if (process.stdin.isTTY) {
      const rl = createInterface({ input, output });
      await rl.question('\nPress Enter once you have logged in to the sites you want...');
      rl.close();
    } else {
      console.log('Log in, then CLOSE the browser window when done.');
      console.log('(It also auto-finishes as soon as every site is detected as logged in.)\n');
      const closed = await waitUntilDone(context, pages);
      if (closed) {
        console.log('\nBrowser closed. The profile is saved; the Inbox resolver will reuse it.');
        return 0;
      }
    }

    console.log('\nVerifying sessions:');
    let ok = 0;
    for (const { site, page } of pages) {
      let loggedIn = false;
      try {
        await page.goto(site.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1500);
        loggedIn = await page.evaluate(sel => !!document.querySelector(sel), site.selector);
      } catch { /* best-effort check */ }
      console.log(`  ${loggedIn ? '✅' : '⚠️ '} ${site.name}${loggedIn ? '' : ' — not detected (may still be logged in; check manually)'}`);
      if (loggedIn) ok += 1;
    }
    console.log(`\nDone. ${ok}/${SITES.length} session(s) detected. The profile is saved; the Inbox resolver will reuse it.`);
    return 0;
  } finally {
    await context.close().catch(() => {});
  }
}

import { isMainModule } from './lib/is-main-module.mjs';
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
    console.error(`site-login: ${err?.message || err}`);
    process.exit(1);
  });
}
