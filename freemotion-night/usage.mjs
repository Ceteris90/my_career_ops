// node freemotion-night/usage.mjs [run-id] — per-job token use for an overnight run (agy, agy-sonnet, codex, sonnet1, sonnet;
// copilot jobs are listed without tokens: see copilot-usage.mjs; codex-usage.mjs shows Codex's 5-hour/weekly windows).
// node freemotion-night/usage.mjs --drivers — every run: per driver, jobs and sent, and how many jobs each
// driver did between its limit hits (tmp/fm/usage/limit-hits.tsv, written by run.sh).
// node freemotion-night/usage.mjs --cost [--since YYYY-MM-DD] — cost per SENT application (#7): per driver,
// jobs, sent, tokens (Copilot: AI credits; Claude: list-price $) per sent application, and what writing the
// CVs and letters cost (docs-<N>.json docTokens, written by prepare-docs.mjs since 2026-10-12).
// node freemotion-night/usage.mjs --errors [--since YYYY-MM-DD] — per driver (and agy model): tool calls per
// job, how many failed, jobs with 3+ failures, and the sent rate (tool-errors.mjs reads each driver's own log).
// Defaults to the run id in tmp/fm/night/run-id (the last sheets make-jobs.mjs wrote).
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jobToolStats } from './tool-errors.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const DRIVERS = process.argv.includes('--drivers');
const COST = process.argv.includes('--cost');
const ERRORS = process.argv.includes('--errors');
const SINCE = (() => { const i = process.argv.indexOf('--since'); return i >= 0 ? process.argv[i + 1] : ''; })();
const RUN = DRIVERS || COST || ERRORS ? null : process.argv[2] ?? readFileSync(`${ROOT}/tmp/fm/night/run-id`, 'utf8').trim();
const runsPath = `${ROOT}/tmp/fm/usage/night-runs.tsv`;
const runs = existsSync(runsPath) ? readFileSync(runsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const ledger = readFileSync(`${ROOT}/data/freemotion-submissions.tsv`, 'utf8').split('\n').map((l) => l.split('\t')).filter((c) => c[7] === RUN);
const k = (x) => (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? Math.round(x / 1e3) + 'k' : String(x));
const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// Codex's exec log is JSONL; each `turn.completed` event carries that turn's usage (cached is part of input).
const codexUsage = (p) => {
  if (!existsSync(p)) return null;
  const u = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.includes('"turn.completed"')) continue;
    try { const x = JSON.parse(line).usage ?? {}; u.input_tokens += x.input_tokens ?? 0; u.cached_input_tokens += x.cached_input_tokens ?? 0; u.output_tokens += (x.output_tokens ?? 0) + (x.reasoning_output_tokens ?? 0); } catch { /* torn line */ }
  }
  return u;
};
// The run a job belonged to: its sheet's --run-id (#39: the per-run list showed every run's jobs).
const runOf = (n) => { const b = `${ROOT}/tmp/fm/night/job-${n}.md`; return existsSync(b) ? (readFileSync(b, 'utf8').match(/--run-id (fm-[\w-]+)/) ?? [])[1] ?? null : null; };
const urlOf = (n) => { const b = `${ROOT}/tmp/fm/night/job-${n}.md`; return existsSync(b) ? (readFileSync(b, 'utf8').match(/^   (https?:\/\/\S+)/m) ?? [])[1] ?? null : null; };
/** One job's use by its driver: fresh in, cached in, out tokens; Claude's list price; Copilot's AI credits. */
function jobUse(d, n) {
  const file = `${ROOT}/tmp/fm/usage/${d}-${n}.json`;
  const r = { fin: 0, cached: 0, out: 0, usd: 0, credits: 0 };
  if (d.startsWith('copilot')) {
    if (!existsSync(file)) return r;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.includes('"session.usage_checkpoint"')) { try { r.credits = (JSON.parse(line).data.totalNanoAiu || 0) / 1e9 || r.credits; } catch { /* torn */ } }
    }
    return r;
  }
  const j = d.startsWith('codex') ? codexUsage(file) : read(file);
  if (j && d.startsWith('agy')) { r.fin = j.usage?.input_tokens ?? 0; r.cached = j.usage?.cache_read_tokens ?? 0; r.out = j.usage?.output_tokens ?? 0; }
  if (j && d.startsWith('codex')) { r.cached = j.cached_input_tokens; r.fin = j.input_tokens - r.cached; r.out = j.output_tokens; }
  if (j && d.startsWith('sonnet')) { const u = j.usage ?? {}; r.fin = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); r.cached = u.cache_read_input_tokens ?? 0; r.out = u.output_tokens ?? 0; r.usd = j.total_cost_usd ?? 0; }
  return r;
}
const tot = { usd: 0, sent: 0, jobs: 0 };
if (DRIVERS) { driverReport(); process.exit(0); }
if (COST) { costReport(); process.exit(0); }
if (ERRORS) { errorReport(); process.exit(0); }
console.log('job   driver  result             fresh in / cached in / out     tool calls (failed)');
for (const [n, start, , d] of runs) {
  if (runOf(n) !== RUN) continue;   // this run's jobs only (#39)
  const url = urlOf(n);
  const res = ledger.filter((c) => c[1] === url).at(-1)?.[5] ?? '-';
  const { fin, cached, out, usd } = jobUse(d, n);
  const t = jobToolStats(ROOT, d, n, start);
  tot.usd += usd;
  tot[d] = (tot[d] ?? 0) + fin + cached + out; tot.jobs++; if (res === 'submitted') tot.sent++;
  console.log(`${n}  ${d.padEnd(10)}  ${res.padEnd(17)}  ${`${k(fin)} / ${k(cached)} / ${k(out)}`.padEnd(26)}  ${t ? `${t.calls} (${t.failed})` : '-'}`);
}
const byDriver = Object.entries(tot).filter(([x]) => !['usd', 'sent', 'jobs'].includes(x)).map(([x, v]) => `${x} ${k(v)}`).join(' · ');
console.log(`TOTAL ${tot.jobs} runs, ${tot.sent} sent · ${byDriver} (Claude ~$${tot.usd.toFixed(2)} list price)`);

function driverReport() {
  // Latest outcome per posting URL, across every run.
  const all = readFileSync(`${ROOT}/data/freemotion-submissions.tsv`, 'utf8').split('\n').map((l) => l.split('\t'));
  const outcome = new Map();
  for (const c of all) if (c[1] && c[5] && c[5] !== 'in-progress') outcome.set(`${c[1]}|${c[7]}`, c[5]);
  const hitsPath = `${ROOT}/tmp/fm/usage/limit-hits.tsv`;
  const hits = existsSync(hitsPath) ? readFileSync(hitsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
  const stats = {};
  for (const [n, start, , d] of runs) {
    const s = (stats[d] ??= { jobs: 0, sent: 0, starts: [] });
    s.jobs++; s.starts.push(start);
    const brief = `${ROOT}/tmp/fm/night/job-${n}.md`;
    const text = existsSync(brief) ? readFileSync(brief, 'utf8') : '';
    const url = (text.match(/^   (https?:\/\/\S+)/m) ?? [])[1];
    const run = (text.match(/--run-id (fm-[\w-]+)/) ?? [])[1];
    if (outcome.get(`${url}|${run}`) === 'submitted') s.sent++;
  }
  console.log('driver      jobs  sent  jobs between limit hits (hit time UTC)');
  for (const [d, s] of Object.entries(stats)) {
    const mine = hits.filter((h) => h[0] === d).map((h) => h[1]).sort();
    let prev = '';
    const per = mine.map((t) => { const c = s.starts.filter((x) => x > prev && x <= t).length; prev = t; return `${c} (${t.slice(5, 16)})`; });
    const since = s.starts.filter((x) => x > prev).length;
    console.log(`${d.padEnd(10)}  ${String(s.jobs).padStart(4)}  ${String(s.sent).padStart(4)}  ${per.join(', ') || '-'}${mine.length ? ` · ${since} since the last hit` : ''}`);
  }
}

function errorReport() {
  // Latest outcome per posting URL and run, across every run.
  const outcome = new Map();
  for (const c of readFileSync(`${ROOT}/data/freemotion-submissions.tsv`, 'utf8').split('\n').map((l) => l.split('\t'))) {
    if (c[1] && c[5] && c[5] !== 'in-progress') outcome.set(`${c[1]}|${c[7]}`, c[5]);
  }
  const by = {};
  for (const [n, start, , d] of runs) {
    if (SINCE && String(start).slice(0, 10) < SINCE) continue;
    const t = jobToolStats(ROOT, d, n, start);
    if (!t || !t.calls) continue;   // no log on this machine, or the driver never got going
    const key = d.startsWith('agy') && t.model ? `${d} · ${t.model}` : d;
    const s = (by[key] ??= { jobs: 0, sent: 0, calls: 0, failed: 0, bad: 0 });
    s.jobs++; s.calls += t.calls; s.failed += t.failed; if (t.failed >= 3) s.bad++;
    if (outcome.get(`${urlOf(n)}|${runOf(n)}`) === 'submitted') s.sent++;
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  console.log(`Tool calls and failures per job${SINCE ? ` since ${SINCE}` : ' (all runs)'} — jobs whose driver log is on this machine`);
  console.log(`${'driver'.padEnd(44)} jobs  calls/job  failed  3+ failed  sent`);
  for (const [key, s] of Object.entries(by).sort((a, b) => b[1].jobs - a[1].jobs)) {
    console.log(`${key.padEnd(44)} ${String(s.jobs).padStart(4)} ${(s.calls / s.jobs).toFixed(0).padStart(10)} ${pct(s.failed, s.calls).padStart(7)} ${pct(s.bad, s.jobs).padStart(10)} ${pct(s.sent, s.jobs).padStart(5)}`);
  }
  if (!Object.keys(by).length) console.log('(no driver logs found)');
}

function costReport() {
  // Latest outcome per posting URL and run, across every run.
  const outcome = new Map();
  for (const c of readFileSync(`${ROOT}/data/freemotion-submissions.tsv`, 'utf8').split('\n').map((l) => l.split('\t'))) {
    if (c[1] && c[5] && c[5] !== 'in-progress') outcome.set(`${c[1]}|${c[7]}`, c[5]);
  }
  const by = {};
  const sentJobs = new Set();
  for (const [n, start, , d] of runs) {
    if (SINCE && String(start).slice(0, 10) < SINCE) continue;
    const s = (by[d] ??= { jobs: 0, sent: 0, tokens: 0, usd: 0, credits: 0 });
    const u = jobUse(d, n);
    s.jobs++; s.tokens += u.fin + u.cached + u.out; s.usd += u.usd; s.credits += u.credits;
    if (outcome.get(`${urlOf(n)}|${runOf(n)}`) === 'submitted') { s.sent++; sentJobs.add(String(n)); }
  }
  const per = (x, sent) => (sent ? x / sent : 0);
  console.log(`Cost per sent application${SINCE ? ` since ${SINCE}` : ' (all runs)'} — driver attempts are counted, sent = confirmed submissions`);
  console.log('driver       jobs  sent  sent%   tokens   per sent   other per sent');
  let all = { jobs: 0, sent: 0 };
  for (const [d, s] of Object.entries(by).sort((a, b) => b[1].jobs - a[1].jobs)) {
    all.jobs += s.jobs; all.sent += s.sent;
    const other = d.startsWith('copilot') ? `${per(s.credits, s.sent).toFixed(1)} AI credits` : d.startsWith('sonnet') ? `$${per(s.usd, s.sent).toFixed(2)} list price` : '';
    console.log(`${d.padEnd(11)} ${String(s.jobs).padStart(5)} ${String(s.sent).padStart(5)} ${(s.jobs ? (100 * s.sent / s.jobs).toFixed(0) : '0').padStart(5)}%  ${(s.tokens ? k(s.tokens) : '-').padStart(7)}  ${(s.sent && s.tokens ? k(Math.round(s.tokens / s.sent)) : '-').padStart(9)}   ${other}`);
  }
  // CV and letter writing, from each job's docs-<N>.json (prepare-docs.mjs writes docTokens since 2026-10-12).
  const docs = { jobs: 0, tokens: {}, sentTokens: 0 };
  for (const [n, start] of runs) {
    if (SINCE && String(start).slice(0, 10) < SINCE) continue;
    const j = read(`${ROOT}/tmp/fm/night/docs-${n}.json`);
    if (!j?.docTokens) continue;
    docs.jobs++;
    for (const [w, t] of Object.entries(j.docTokens)) {
      docs.tokens[w] = (docs.tokens[w] || 0) + t;
      if (sentJobs.has(String(n))) docs.sentTokens += t;
    }
  }
  console.log(`TOTAL ${all.jobs} driver runs, ${all.sent} sent`);
  if (docs.jobs) console.log(`CV + letter writing: ${docs.jobs} jobs · ${Object.entries(docs.tokens).map(([w, t]) => `${w} ${k(t)}`).join(' · ')} · ${all.sent ? k(Math.round(docs.sentTokens / Math.max(1, sentJobs.size))) : '-'} per sent application (copilot reports no tokens)`);
  else console.log('CV + letter writing: no job with docTokens yet (recorded from 2026-10-12 on)');
}
