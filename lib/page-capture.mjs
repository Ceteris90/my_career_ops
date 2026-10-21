// @ts-check
/**
 * page-capture.mjs — archive a page so a failed/discarded lead can be
 * investigated later without re-opening it (and without the posting having gone
 * away in the meantime).
 *
 * A capture is a self-contained bundle under
 * `{dataRoot}/data/captures/{YYYY-MM-DD}/{slug}/`:
 *
 *   meta.json       requested/final URL, title, company, reason, status, file list
 *   screenshot.png  full-page PNG
 *   page.html       final DOM (page.content())
 *   network.har     every request/response with bodies EMBEDDED (JS/CSS/images/JSON)
 *   trace.zip       Playwright trace — replays DOM snapshots + styles + console +
 *                   network, openable with `npx playwright show-trace trace.zip`
 *
 * Why a re-open instead of capturing the run's live context: `recordHar` and
 * `tracing` are fixed when the BrowserContext is created, so they cannot be
 * retro-fitted onto the resolver's existing context. Capturing only on failures
 * (rare) makes a dedicated, self-contained re-open the simplest correct design —
 * and it reuses the persistent profile, so auth-walled pages still archive.
 *
 * Failure capture is best-effort and never fatal: callers wrap it and continue.
 */

import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { BOT_CHALLENGE_PATTERNS } from '../liveness-core.mjs';
import { PROFILE_DIR } from '../site-login.mjs';

const INDEX_HEADER = 'ts\tslug\turl\tfinal_url\ttitle\tcompany\treason\tstatus\tdir';

/** Filesystem-safe slug: readable prefix from the label, then a short url hash. */
export function slugify(label, url) {
  const base = String(label || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const hash = createHash('sha1').update(String(url || '')).digest('hex').slice(0, 8);
  return base ? `${base}-${hash}` : hash;
}

/** Canonical capture root under the data root. */
export function captureRoot(root = getCareerOpsRoot()) {
  return join(root, 'data', 'captures');
}

/** Today's date as YYYY-MM-DD in local time (captures are human-browsed). */
function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sanitizeField(v) {
  return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/** Append one row to the capture index (best-effort; creates it with a header). */
export function appendCaptureIndex(root, meta) {
  try {
    const path = join(captureRoot(root), 'index.tsv');
    mkdirSync(captureRoot(root), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, INDEX_HEADER + '\n');
    const row = [
      meta.ts, meta.slug, meta.requestedUrl, meta.finalUrl || '',
      meta.title || '', meta.company || '', meta.reason || '', meta.status || '',
      meta.dir,
    ].map(sanitizeField).join('\t');
    appendFileSync(path, row + '\n');
  } catch {
    // index is a convenience; a failed append must not fail the capture
  }
}

/** Read the capture index, newest first. Missing index → []. */
export function readCaptureIndex(root = getCareerOpsRoot()) {
  const path = join(captureRoot(root), 'index.tsv');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [ts, slug, url, final_url, title, company, reason, status, dir] = line.split('\t');
      return { ts, slug, url, finalUrl: final_url, title, company, reason, status, dir };
    })
    .reverse();
}

async function looksLikeChallenge(page) {
  try {
    const { body, title, dom } = await page.evaluate(() => ({
      body: document.body?.innerText || '',
      title: document.title || '',
      dom: !!document.querySelector(
        '#challenge-form, .cf-turnstile, [data-translate], #cf-chl-widget, '
        + '.challenge-platform, script[src*="challenges.cloudflare.com"], iframe[src*="challenges.cloudflare.com"]'),
    }));
    if (dom) return true;
    if (BOT_CHALLENGE_PATTERNS.some((re) => re.test(title) || re.test(body))) return true;
    const text = `${title}\n${body}`.toLowerCase();
    return /требуется дополнительная верификация|ид[её]т проверка|подтвердите, что вы|выполняется проверка|just a moment|verify you are human|attention required/.test(text);
  } catch {
    return false;
  }
}

/**
 * Open `url` in a fresh capture context and write a full bundle.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.reason]    why this page is being archived (free text)
 * @param {string} [opts.company]
 * @param {string} [opts.title]
 * @param {string} [opts.status]    verdict label, e.g. 'unconfirmed', 'discarded'
 * @param {string} [opts.root]      data root (defaults to getCareerOpsRoot())
 * @param {number} [opts.headedWaitMs] wait for a human to clear an anti-bot wall
 * @param {boolean} [opts.headless] default false (anti-bot pages need a real browser)
 * @param {number} [opts.timeoutMs] navigation timeout
 * @param {boolean} [opts.useProfile] reuse data/.browser-profile (default: if it exists)
 * @param {(m: string) => void} [opts.log]
 * @returns {Promise<{dir: string, meta: object, files: string[]}>}
 */
export async function captureUrl(url, opts = {}) {
  const root = opts.root || getCareerOpsRoot();
  const log = opts.log || (() => {});
  const date = today();
  const slug = slugify(opts.company || opts.title || new URL(url).hostname, url);
  const dir = join(captureRoot(root), date, slug);
  mkdirSync(dir, { recursive: true });

  const harPath = join(dir, 'network.har');
  const tracePath = join(dir, 'trace.zip');
  const shotPath = join(dir, 'screenshot.png');
  const htmlPath = join(dir, 'page.html');
  const metaPath = join(dir, 'meta.json');

  const useProfile = opts.useProfile ?? existsSync(PROFILE_DIR);
  const contextOptions = {
    headless: opts.headless ?? false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 900 },
    recordHar: { path: harPath, content: 'embed', mode: 'full' },
  };

  let context = null;
  let browser = null;
  const startedAt = new Date().toISOString();
  try {
    if (useProfile) {
      try {
        context = await chromium.launchPersistentContext(PROFILE_DIR, { ...contextOptions, channel: 'chrome' });
      } catch {
        context = await chromium.launchPersistentContext(PROFILE_DIR, contextOptions);
      }
    } else {
      browser = await chromium.launch({ headless: contextOptions.headless, args: contextOptions.args });
      context = await browser.newContext(contextOptions);
    }

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = context.pages()[0] || await context.newPage();

    let navError = null;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs || 30_000 });
    } catch (err) {
      navError = String(err?.message || err);
    }
    await page.waitForTimeout(2500);

    // Give a human a chance to clear an anti-bot wall before we snapshot it.
    const headedWaitMs = opts.headedWaitMs || 0;
    if (headedWaitMs > 0 && await looksLikeChallenge(page)) {
      log(`  ⚠️  anti-bot wall — solve it in the window; capturing in up to ${Math.round(headedWaitMs / 1000)}s`);
      const deadline = Date.now() + headedWaitMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if (!(await looksLikeChallenge(page))) break;
      }
    }

    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    try {
      await page.screenshot({ path: shotPath, fullPage: true, timeout: 30_000 });
    } catch {
      await page.screenshot({ path: shotPath, timeout: 15_000 }).catch(() => {});
    }
    let html = '';
    try { html = await page.content(); } catch { /* leave empty */ }
    writeFileSync(htmlPath, html);

    await context.tracing.stop({ path: tracePath });
    await context.close();
    context = null;
    if (browser) { await browser.close(); browser = null; }

    const meta = {
      ts: startedAt,
      slug,
      requestedUrl: url,
      finalUrl,
      title,
      company: opts.company || '',
      reason: opts.reason || '',
      status: opts.status || '',
      date,
      dir,
      files: { screenshot: 'screenshot.png', html: 'page.html', har: 'network.har', trace: 'trace.zip' },
      navError,
      usedProfile: useProfile,
    };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    appendCaptureIndex(root, meta);
    log(`  🗄️  captured → ${dir}`);
    return { dir, meta, files: [metaPath, shotPath, htmlPath, harPath, tracePath] };
  } catch (err) {
    // Clean up a half-written bundle so a broken capture never looks complete.
    try { if (context) await context.close(); } catch { /* ignore */ }
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}
