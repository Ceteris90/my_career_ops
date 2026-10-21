#!/usr/bin/env node
// @ts-check
//
// investigate.mjs — work with the page captures written by lib/page-capture.mjs.
//
// A capture is a self-contained bundle (screenshot + HTML + HAR + Playwright
// trace + meta) for a page that failed to yield a job, or that was discarded, so
// you can look at it later without re-opening the (often dead) posting.
//
// Usage:
//   node investigate.mjs                                  # list captures (newest first)
//   node investigate.mjs --list [--json] [--limit N]
//   node investigate.mjs --show <slug|#n>                 # print meta.json
//   node investigate.mjs --open <slug|#n>                 # open page.html in the browser
//   node investigate.mjs --image <slug|#n>                # open screenshot.png
//   node investigate.mjs --trace <slug|#n>                # open the Playwright trace
//   node investigate.mjs --dir <slug|#n>                  # print the bundle path
//   node investigate.mjs --capture <url> [url...]         # capture now
//        [--reason "..."] [--company "..."] [--title "..."] [--status ...]
//        [--headed-wait ms] [--headless]
//   node investigate.mjs --prune [--days N]               # delete captures older than N days (default 30)

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { captureUrl, readCaptureIndex, captureRoot } from './lib/page-capture.mjs';
import { hasFlag, flagValue, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const KNOWN_FLAGS = ['--list', '--json', '--limit', '--show', '--open', '--image', '--trace', '--dir', '--capture', '--prune', '--days', '--reason', '--company', '--title', '--status', '--headed-wait', '--headless', '--help', '-h'];
const VALUE_FLAGS = ['--limit', '--show', '--open', '--image', '--trace', '--dir', '--days', '--reason', '--company', '--title', '--status', '--headed-wait'];

const USAGE = `Usage:
  node investigate.mjs                                  # list captures (newest first)
  node investigate.mjs --list [--json] [--limit N]
  node investigate.mjs --show <slug|#n>                 # print meta.json
  node investigate.mjs --open <slug|#n>                 # open page.html
  node investigate.mjs --image <slug|#n>                # open screenshot.png
  node investigate.mjs --trace <slug|#n>                # open the Playwright trace
  node investigate.mjs --dir <slug|#n>                  # print the bundle path
  node investigate.mjs --capture <url> [url...] [--reason ...] [--company ...] [--title ...] [--status ...] [--headed-wait ms] [--headless]
  node investigate.mjs --prune [--days N]               # delete captures older than N days (default 30)
  node investigate.mjs --help`;

const open_ = (target) => { try { execFileSync('open', [target], { stdio: 'ignore' }); } catch { /* non-macOS or no opener */ } };

const INDEX_HEADER = 'ts\tslug\turl\tfinal_url\ttitle\tcompany\treason\tstatus\tdir';
const INDEX_FIELDS = ['ts', 'slug', 'url', 'finalUrl', 'title', 'company', 'reason', 'status', 'dir'];

/** Delete capture date-folders older than `days` and drop their index rows. */
export function pruneCaptures(root, days) {
  const base = captureRoot(root);
  if (!existsSync(base)) { console.log(`No captures under ${base}.`); return 0; }
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  let removed = 0;
  for (const name of readdirSync(base)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    const d = new Date(`${name}T00:00:00`);
    if (Number.isNaN(d.getTime()) || d >= cutoff) continue;
    rmSync(join(base, name), { recursive: true, force: true });
    console.log(`  removed ${name}`);
    removed++;
  }
  // Keep only index rows whose bundle directory still exists (chronological order).
  const kept = readCaptureIndex(root).filter((c) => c.dir && existsSync(c.dir)).reverse();
  const rows = kept.map((c) => INDEX_FIELDS.map((f) => String(c[f] ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t'));
  const indexPath = join(base, 'index.tsv');
  if (kept.length) writeFileSync(indexPath, INDEX_HEADER + '\n' + rows.join('\n') + '\n');
  else if (existsSync(indexPath)) writeFileSync(indexPath, INDEX_HEADER + '\n');
  console.log(`Pruned ${removed} capture day-folder(s) older than ${days} day(s); ${kept.length} capture(s) remain.`);
  return removed;
}

/** Resolve a `<slug|#n|path>` selector to a capture index entry (or a bare dir). */
function resolveCapture(sel, root) {
  if (!sel) return null;
  if (existsSync(sel) && existsSync(join(sel, 'meta.json'))) return { dir: sel, slug: sel.split('/').pop() };
  const list = readCaptureIndex(root);
  if (/^#?\d+$/.test(sel)) {
    const n = Number(sel.replace('#', ''));
    return list[n - 1] || null;
  }
  return list.find((c) => c.slug === sel) || list.find((c) => c.slug.startsWith(sel)) || null;
}

function printList(root, { json, limit }) {
  const list = readCaptureIndex(root);
  const capped = limit ? list.slice(0, limit) : list;
  if (json) { console.log(JSON.stringify(capped, null, 2)); return; }
  if (!capped.length) { console.log(`No captures yet under ${captureRoot(root)}.`); return; }
  console.log(`Captures (newest first) — ${captureRoot(root)}\n`);
  capped.forEach((c, i) => {
    const label = [c.company, c.title].filter(Boolean).join(' — ') || '(no label)';
    const date = (c.dir || '').match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1] || (c.ts || '').slice(0, 10);
    console.log(`#${i + 1}  ${date}  ${label}`);
    console.log(`     ${c.status || ''}${c.reason ? ' · ' + c.reason : ''}`);
    console.log(`     ${c.url}`);
  });
  console.log('\nOpen one with:  node investigate.mjs --show #1  ( or --open / --trace / --dir )');
}

async function main(args) {
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  const root = getCareerOpsRoot();

  if (hasFlag(args, '--prune')) {
    pruneCaptures(root, Number(flagValue(args, '--days')) || 30);
    return;
  }

  const captureIdx = args.indexOf('--capture');
  if (captureIdx !== -1) {
    const urls = args.slice(captureIdx + 1).filter((a) => /^https?:\/\//i.test(a));
    if (!urls.length) { console.error('--capture needs at least one http(s) URL.'); process.exitCode = 1; return; }
    const headedWaitMs = Number(flagValue(args, '--headed-wait')) || 0;
    for (const url of urls) {
      try {
        await captureUrl(url, {
          reason: flagValue(args, '--reason') || 'manual capture (investigate)',
          company: flagValue(args, '--company'), title: flagValue(args, '--title'),
          status: flagValue(args, '--status') || 'manual',
          headedWaitMs, headless: hasFlag(args, '--headless'), root, log: (m) => console.log(m),
        });
      } catch (err) {
        console.error(`  capture failed for ${url}: ${err?.message || err}`);
      }
    }
    return;
  }

  const show = flagValue(args, '--show');
  const openSel = flagValue(args, '--open');
  const imageSel = flagValue(args, '--image');
  const traceSel = flagValue(args, '--trace');
  const dirSel = flagValue(args, '--dir');
  const sel = show || openSel || imageSel || traceSel || dirSel;

  if (sel) {
    const cap = resolveCapture(sel, root);
    if (!cap) { console.error(`No capture matches "${sel}". Run \`node investigate.mjs --list\`.`); process.exitCode = 1; return; }
    const dir = cap.dir || join(captureRoot(root), cap.date || '', cap.slug);
    if (show) {
      const p = join(dir, 'meta.json');
      if (!existsSync(p)) { console.error(`No meta.json in ${dir}`); process.exitCode = 1; return; }
      console.log(readFileSync(p, 'utf-8')); return;
    }
    if (dirSel) { console.log(dir); return; }
    if (openSel) { const p = join(dir, 'page.html'); if (existsSync(p)) open_(p); else console.error(`No page.html in ${dir}`); return; }
    if (imageSel) { const p = join(dir, 'screenshot.png'); if (existsSync(p)) open_(p); else console.error(`No screenshot.png in ${dir}`); return; }
    if (traceSel) {
      const p = join(dir, 'trace.zip');
      if (!existsSync(p)) { console.error(`No trace.zip in ${dir}`); process.exitCode = 1; return; }
      console.log(`Opening Playwright trace viewer for ${p}\n(close the viewer tab / Ctrl-C to stop.)`);
      const child = spawn('npx', ['playwright', 'show-trace', p], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
  }

  printList(root, { json: hasFlag(args, '--json'), limit: Number(flagValue(args, '--limit')) || 0 });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(() => process.exit(process.exitCode || 0)).catch((err) => {
    console.error(`investigate: ${err?.message || err}`);
    process.exit(1);
  });
}
