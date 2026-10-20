#!/usr/bin/env node
/**
 * link-denylist.mjs — user-maintained NON-JOB service-link filter for career-ops
 *
 * The Inbox pulls job leads from emails and boards, alongside obvious service
 * links: unsubscribe pages, YouTube, social profiles, newsletter polls/surveys,
 * account/settings/privacy pages. Resolving or ranking those in a browser is
 * wasted work and pollutes the pipeline. This module classifies a URL against a
 * USER-LAYER list (`data/link-denylist.txt`, agent-maintained) so the daily cycle
 * can mark a match `[x] ... — SKIP: non-job service link (<category>)` WITHOUT a
 * browser pass.
 *
 * The list lives in the data root (user layer) and survives `update-system.mjs`;
 * extend it whenever a new obviously-non-job link shows up. This is a complement
 * to `lib/tracking-resolver.mjs`'s `isEmailChrome` (the system-layer board-chrome
 * rules) — it does NOT replace it.
 *
 * Self-maintaining: after a scan the agent runs `--harvest` to read the pipeline's
 * already-classified non-job rows and propose/append the hosts the list still misses,
 * and `--summary` to print a short "what was filtered out" roll-up.
 *
 * Run: node link-denylist.mjs <url> [url...]        (text verdicts to stdout)
 *      node link-denylist.mjs --file urls.txt       (one URL per line; # = comment)
 *      node link-denylist.mjs <url...> --json       (structured JSON)
 *      node link-denylist.mjs --list                (print the loaded rules)
 *      node link-denylist.mjs --summary             (brief roll-up of filtered links)
 *      node link-denylist.mjs --harvest [--apply]   (propose / append new hosts)
 *      node link-denylist.mjs --self-test           (built-in assertions)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DENYLIST_REL = 'data/link-denylist.txt';

/** Resolve the denylist path under the data root. */
export function denylistPath(root = getCareerOpsRoot()) {
  return join(root, DENYLIST_REL);
}

/**
 * Parse the denylist file into rules.
 * `#` comments and blank lines ignored; `re:<regex>` = case-insensitive regex;
 * anything else = case-insensitive substring. Returns [] when the file is absent.
 * @param {string} text
 * @returns {{raw:string,kind:'substring'|'regex',test:RegExp}[]}
 */
export function parseDenylist(text) {
  const rules = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (t.startsWith('re:')) {
      const src = t.slice(3).trim();
      if (!src) continue;
      try {
        rules.push({ raw: t, kind: 'regex', test: new RegExp(src, 'i') });
      } catch {
        // A malformed regex must not break the whole filter — skip it loudly.
        console.error(`⚠️  link-denylist: ignoring invalid regex: ${t}`);
      }
    } else {
      rules.push({ raw: t, kind: 'substring', test: new RegExp(escapeRegExp(t), 'i') });
    }
  }
  return rules;
}

/** Load and parse the denylist from the data root. */
export function loadDenylist(root = getCareerOpsRoot()) {
  const p = denylistPath(root);
  if (!existsSync(p)) return { path: p, rules: [] };
  return { path: p, rules: parseDenylist(readFileSync(p, 'utf-8')) };
}

/**
 * Classify one URL. Returns `{ denied, matched, url }` — `matched` is the first
 * rule that hit, or null.
 * @param {string} url
 * @param {{raw:string,kind:string,test:RegExp}[]} rules
 */
export function classify(url, rules) {
  const u = String(url ?? '');
  for (const r of rules) {
    if (r.test.test(u)) return { url: u, denied: true, matched: r.raw };
  }
  return { url: u, denied: false, matched: null };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A pipeline row already classified as non-job (by this filter's marker or by the
// system-layer email-chrome sweep). Used to keep the list self-maintaining.
const NONJOB_MARKERS = [
  /— SKIP: non-job service link/,
  /— SKIP: non-job email chrome/,
  /skipped \(email chrome/,
];

function hostOf(u) {
  try {
    return new URL(String(u).replace(/[\x00-\x1f]/g, '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Scan the pipeline for `[x]`/`[ ]` rows, tagging each URL as non-job (by marker) or
 * job. Returns `[{url, nonjob}]`.
 */
export function scanPipeline(root = getCareerOpsRoot()) {
  const p = join(root, 'data/pipeline.md');
  if (!existsSync(p)) return [];
  const rows = [];
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (!/^- \[[ x]\]/.test(line)) continue;
    const m = line.match(/https?:\/\/[^ |]+/);
    if (!m) continue;
    rows.push({ url: m[0], nonjob: NONJOB_MARKERS.some(re => re.test(line)) });
  }
  return rows;
}

/**
 * Brief roll-up of the links the pipeline has filtered as non-job, grouped by host.
 * @returns {{total:number, byHost:[string,number][]}}
 */
export function summarize(root = getCareerOpsRoot()) {
  const rows = scanPipeline(root);
  const byHost = new Map();
  for (const r of rows) {
    if (!r.nonjob) continue;
    const h = hostOf(r.url) || '(unparseable)';
    byHost.set(h, (byHost.get(h) || 0) + 1);
  }
  const total = [...byHost.values()].reduce((a, b) => a + b, 0);
  return { total, byHost: [...byHost.entries()].sort((a, b) => b[1] - a[1]) };
}

/**
 * Propose new denylist entries from the pipeline's non-job rows: a host that appears
 * in non-job rows, is NOT already covered by a rule, and NEVER appears on a real
 * posting row (so we never blanket-deny a board that also carries jobs). Returns
 * `[[host, count], ...]` worst-first.
 */
export function harvest(root = getCareerOpsRoot()) {
  const { rules } = loadDenylist(root);
  const rows = scanPipeline(root);
  const jobHosts = new Set(rows.filter(r => !r.nonjob).map(r => hostOf(r.url)).filter(Boolean));
  const proposals = new Map();
  for (const r of rows) {
    if (!r.nonjob) continue;
    const h = hostOf(r.url);
    if (!h || jobHosts.has(h)) continue;         // also carries real postings → not a blanket-deny candidate
    if (classify(r.url, rules).denied) continue; // already covered
    proposals.set(h, (proposals.get(h) || 0) + 1);
  }
  return [...proposals.entries()].sort((a, b) => b[1] - a[1]);
}

/** Append harvested host rules to the denylist (deduped), under a dated header. */
export function applyHarvest(proposals, root = getCareerOpsRoot()) {
  const p = denylistPath(root);
  const existing = existsSync(p) ? readFileSync(p, 'utf-8') : '';
  const covered = new Set(parseDenylist(existing).map(r => r.raw));
  const add = proposals.map(([h]) => h).filter(h => !covered.has(h));
  if (add.length === 0) return 0;
  const stamp = new Date().toISOString().slice(0, 10);
  const block = `\n## Auto-harvested ${stamp} (from pipeline non-job rows)\n` + add.join('\n') + '\n';
  const next = existing.replace(/\s*$/, '\n') + block;
  writeFileSync(p, next);
  return add.length;
}

function selfTest() {
  const rules = parseDenylist(readFileSync(denylistPath(), 'utf-8'));
  const cases = [
    ['https://www.youtube.com/user/pracuj', true],
    ['https://www.pracuj.pl/konto/rezygnacja-z-subskrybcji?userId=1', true],
    ['https://www.webankieta.pl/survey/588164/podziel-sie-opinia.html', true],
    ['https://www.instagram.com/pracuj.pl/', true],
    ['https://www.pracuj.pl/praca/react-native-developer,oferta,1005', false],
    ['https://justjoin.it/job-offer/connectis-react-native-developer-warszawa-mobile', false],
    ['https://jobs.ashbyhq.com/kraken.com/482dd459', false],
  ];
  let ok = true;
  for (const [u, want] of cases) {
    const got = classify(u, rules).denied;
    const pass = got === want;
    if (!pass) ok = false;
    console.log(`${pass ? '✅' : '❌'} ${want ? 'deny' : 'allow'}  ${u}`);
  }
  return ok;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);

  const { path: listPath, rules } = loadDenylist();
  const json = args.includes('--json');

  if (args.includes('--list')) {
    console.log(`# ${listPath} — ${rules.length} rule(s)`);
    rules.forEach(r => console.log(r.raw));
    return;
  }

  if (args.includes('--summary')) {
    const { total, byHost } = summarize();
    if (json) {
      console.log(JSON.stringify({ total, byHost }, null, 2));
    } else {
      console.log(`Filtered as non-job: ${total} link(s) across ${byHost.length} host(s)`);
      byHost.forEach(([h, n]) => console.log(`  ${String(n).padStart(4)}  ${h}`));
    }
    return;
  }

  if (args.includes('--harvest')) {
    const proposals = harvest();
    if (args.includes('--apply')) {
      const added = applyHarvest(proposals);
      console.log(added > 0
        ? `Appended ${added} new host rule(s) to ${listPath}`
        : `Nothing to add — all harvested hosts already covered (${proposals.length} candidate(s) considered).`);
    } else {
      console.log(`Harvest proposals (${proposals.length}) — hosts seen only on non-job rows and not yet covered:`);
      proposals.forEach(([h, n]) => console.log(`  ${String(n).padStart(4)}  ${h}`));
      console.log('\nRe-run with --apply to append them, or add patterns manually.');
    }
    return;
  }

  let urls = [];
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const f = args[fileIdx + 1];
    if (!f || !existsSync(f)) {
      console.error(`link-denylist: file not found: ${f}`);
      process.exit(1);
    }
    urls = readFileSync(f, 'utf-8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  } else {
    urls = args.filter(a => /^https?:\/\//i.test(a));
  }

  if (urls.length === 0) {
    console.error('Usage: node link-denylist.mjs <url> [url...] | --file urls.txt | --list | --summary | --harvest [--apply] | --self-test [--json]');
    process.exit(1);
  }

  const results = urls.map(u => classify(u, rules));
  if (json) {
    console.log(JSON.stringify({ path: listPath, rules: rules.length, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.denied ? '🚫 non-job' : '✅ job    '}  ${r.denied ? `(${r.matched}) ` : ''}${r.url}`);
    }
    const denied = results.filter(r => r.denied).length;
    console.log(`\n${denied}/${results.length} classified non-job by ${listPath}`);
  }
}

if (isMainModule(import.meta.url)) main();
