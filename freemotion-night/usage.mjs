// node freemotion-night/usage.mjs [run-id] — per-job token use for an overnight run (agy, agy-sonnet, codex, sonnet1, sonnet;
// copilot jobs are listed without tokens: see copilot-usage.mjs; codex-usage.mjs shows Codex's 5-hour/weekly windows).
// node freemotion-night/usage.mjs --drivers — every run: per driver, jobs and sent, and how many jobs each
// driver did between its limit hits (tmp/fm/usage/limit-hits.tsv, written by run.sh).
// node freemotion-night/usage.mjs --cost [--since YYYY-MM-DD] — cost per SENT application (#7): per driver,
// jobs, sent, tokens (Copilot: AI credits; Claude: list-price $) per sent application, and what writing the
// CVs and letters cost (docs-<N>.json docTokens, written by prepare-docs.mjs since 2026-10-12).
// node freemotion-night/usage.mjs --context-test [--since YYYY-MM-DD] — the context test (#61): Codex jobs run
// with their whole conversation vs compacted at CTX_COMPACT_AT tokens (run.sh, data/context-test.tsv):
// model calls, compactions, tokens and Codex's weekly % per job and per SENT application.
// Defaults to the run id in tmp/fm/night/run-id (the last sheets make-jobs.mjs wrote).
import { readFileSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const DRIVERS = process.argv.includes('--drivers');
const COST = process.argv.includes('--cost');
const CTX = process.argv.includes('--context-test');
const SINCE = (() => { const i = process.argv.indexOf('--since'); return i >= 0 ? process.argv[i + 1] : ''; })();
const RUN = DRIVERS || COST || CTX ? null : process.argv[2] ?? readFileSync(`${ROOT}/tmp/fm/night/run-id`, 'utf8').trim();
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
let sessionIndex = null;   // Codex session logs by thread id (codexSession, --context-test)
if (DRIVERS) { driverReport(); process.exit(0); }
if (COST) { costReport(); process.exit(0); }
if (CTX) { contextReport(); process.exit(0); }
console.log('job   driver  result             fresh in / cached in / out');
for (const [n, , , d] of runs) {
  if (runOf(n) !== RUN) continue;   // this run's jobs only (#39)
  const url = urlOf(n);
  const res = ledger.filter((c) => c[1] === url).at(-1)?.[5] ?? '-';
  const { fin, cached, out, usd } = jobUse(d, n);
  tot.usd += usd;
  tot[d] = (tot[d] ?? 0) + fin + cached + out; tot.jobs++; if (res === 'submitted') tot.sent++;
  console.log(`${n}  ${d.padEnd(10)}  ${res.padEnd(17)}  ${k(fin)} / ${k(cached)} / ${k(out)}`);
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

/** A Codex job's session log (~/.codex/sessions/Y/M/D/rollout-*-<thread>.jsonl): model calls, compactions, weekly %. */
function codexSession(n) {
  const log = `${ROOT}/tmp/fm/usage/codex-${n}.json`;
  if (!existsSync(log)) return null;
  const tid = (readFileSync(log, 'utf8').match(/"thread_id":"([\w-]+)"/) ?? [])[1];
  if (!tid) return null;
  if (!sessionIndex) {
    sessionIndex = new Map();
    const base = `${homedir()}/.codex/sessions`;
    const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
    for (const y of ls(base)) for (const m of ls(`${base}/${y}`)) for (const d of ls(`${base}/${y}/${m}`)) {
      for (const f of ls(`${base}/${y}/${m}/${d}`)) { const id = (f.match(/-([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/) ?? [])[1]; if (id) sessionIndex.set(id, `${base}/${y}/${m}/${d}/${f}`); }
    }
  }
  const path = sessionIndex.get(tid);
  if (!path) return null;
  const r = { calls: 0, compactions: 0, weekFirst: null, weekLast: null };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.includes('"type":"compacted"')) { r.compactions++; continue; }
    if (!line.includes('"token_count"')) continue;
    try {
      const p = JSON.parse(line).payload ?? {};
      if ((p.info?.last_token_usage?.input_tokens ?? 0) > 0) r.calls++;
      const w = p.rate_limits?.secondary?.used_percent;
      if (Number.isFinite(w)) { r.weekFirst ??= w; r.weekLast = w; }
    } catch { /* torn line */ }
  }
  return r;
}

function contextReport() {
  const path = `${ROOT}/data/context-test.tsv`;
  if (!existsSync(path)) { console.log('No context test yet: run.sh draws an arm for each Codex job (data/context-test.tsv).'); return; }
  const arms = new Map();   // job|run -> {arm, at}
  for (const c of readFileSync(path, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'))) arms.set(`${c[0]}|${c[5]}`, { arm: c[3], at: c[4] });
  const outcome = new Map();
  for (const c of readFileSync(`${ROOT}/data/freemotion-submissions.tsv`, 'utf8').split('\n').map((l) => l.split('\t'))) {
    if (c[1] && c[5] && c[5] !== 'in-progress') outcome.set(`${c[1]}|${c[7]}`, c[5]);
  }
  const by = {};
  for (const [n, start, , d] of runs) {
    if (d !== 'codex' || (SINCE && String(start).slice(0, 10) < SINCE)) continue;
    const run = runOf(n);
    const a = arms.get(`${n}|${run}`);
    if (!a) continue;   // ran before the test
    const name = a.arm === 'compact' ? `compact ${Math.round(a.at / 1000)}k` : a.arm;
    const s = (by[name] ??= { jobs: 0, sent: 0, tokens: 0, calls: 0, compactions: 0, week: 0, weekJobs: 0, logs: 0 });
    const u = jobUse('codex', n);
    s.jobs++; s.tokens += u.fin + u.cached + u.out;
    if (outcome.get(`${urlOf(n)}|${run}`) === 'submitted') s.sent++;
    const x = codexSession(n);
    if (x) {
      s.logs++; s.calls += x.calls; s.compactions += x.compactions;
      if (x.weekFirst !== null && x.weekLast >= x.weekFirst) { s.week += x.weekLast - x.weekFirst; s.weekJobs++; }
    }
  }
  console.log(`Context test (#61): Codex jobs with the whole conversation vs compacted${SINCE ? `, since ${SINCE}` : ''}`);
  console.log('arm            jobs  sent  sent%  calls/job  compactions/job  tokens/job  tokens/sent  week %/sent');
  for (const [name, s] of Object.entries(by).sort()) {
    const per = (x, m) => (m ? x / m : 0);
    console.log(`${name.padEnd(13)} ${String(s.jobs).padStart(5)} ${String(s.sent).padStart(5)} ${(s.jobs ? (100 * s.sent / s.jobs).toFixed(0) : '0').padStart(5)}%  ${per(s.calls, s.logs).toFixed(1).padStart(9)}  ${per(s.compactions, s.logs).toFixed(1).padStart(15)}  ${k(Math.round(per(s.tokens, s.jobs))).padStart(10)}  ${(s.sent ? k(Math.round(s.tokens / s.sent)) : '-').padStart(11)}  ${(s.sent && s.weekJobs ? (s.week * (s.jobs / s.weekJobs) / s.sent).toFixed(1) : '-').padStart(11)}`);
  }
  if (!Object.keys(by).length) console.log('(no Codex job has run under the test yet)');
  console.log('Week %: the change in Codex\'s weekly window during each job (whole %, so read it over many jobs).');
}
