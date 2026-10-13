#!/usr/bin/env node
/**
 * freemotion-night/browser-check.mjs — does the drivers' browser start at all? (W42 review, L63)
 *
 *   node freemotion-night/browser-check.mjs              exit 0: it started and closed; 1: it did not (why on stdout)
 *   node freemotion-night/browser-check.mjs --log <file> count the browser launch failures in a driver's output
 *
 * run.sh runs the first form once before a run: when Camoufox cannot start, no job can work, so the run
 * stops with the reason instead of every agent failing in turn (2026-10-09: a Copilot job spent 25
 * minutes on 21 "Exiting due to channel error" answers and was recorded as a network failure).
 * The second form is what run.sh reads after each job: 3 or more launch failures mean that driver's
 * browser is broken, not the posting.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { camoufoxLaunchOptions } from '../lib/camoufox-page.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Words a browser tool answers with when the browser itself did not start or died. None of them is in a
// job sheet, so the agent's log can be searched as a whole.
export const LAUNCH_FAILURE_RE = /Exiting due to channel error|browserType\.launch[A-Za-z]*: |Failed to launch (the )?browser|Browser (has been|was) closed|Target page, context or browser has been closed|Executable doesn't exist at/g;

/** How many launch failures a driver's output holds. */
export function launchFailures(text) {
  return (String(text || '').match(LAUNCH_FAILURE_RE) || []).length;
}

async function startOnce() {
  const opts = camoufoxLaunchOptions({ root: ROOT });
  if (!opts) return 'no usable config/playwright-mcp-camoufox.json (or its Camoufox program is missing)';
  try {
    const { firefox } = createRequire(join(ROOT, 'package.json'))('playwright');
    const browser = await firefox.launch({ ...opts, headless: true, timeout: 60_000 });
    const page = await browser.newPage();
    await page.goto('about:blank');
    await browser.close();
    return '';
  } catch (e) {
    return String(e.message || e).split('\n')[0].slice(0, 300);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node freemotion-night/browser-check.mjs [--log <driver output file>...]');
    return;
  }
  const i = args.indexOf('--log');
  if (i >= 0) {
    let n = 0;
    for (const f of args.slice(i + 1)) if (existsSync(f)) n += launchFailures(readFileSync(f, 'utf8'));
    console.log(n);
    return;
  }
  const why = await startOnce();
  if (why) { console.log(why); process.exit(1); }
}

if (isMainModule(import.meta.url)) main();
