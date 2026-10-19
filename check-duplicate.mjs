#!/usr/bin/env node
/**
 * check-duplicate.mjs — pre-application duplicate-vacancy gate.
 *
 * The same opening reaches the tracker several times under different URLs,
 * different company spellings and different boards (justjoin / theprotocol /
 * pracuj / LinkedIn), so URL and company+role dedup both miss it — you can
 * apply to one Pretius requisition three times without ever seeing a warning.
 *
 * This gate answers one question before evaluation or submission: "have we
 * already seen (or applied to) this vacancy?" It compares a candidate posting
 * against every tracker row on independent signals:
 *
 *   1. JD content fingerprint — 64-bit SimHash over the archived JD body
 *      (fingerprint-core.mjs). Cross-board re-posts rarely rewrite the
 *      requirements, so a near-identical body is the signal that catches what
 *      the structured keys cannot. The scanner's own 0.92 threshold is tuned
 *      for a different job (cross-listing a NEW offer before any row exists);
 *      across boards the same body drifts to ~0.90, so this gate uses 0.90.
 *   2. Canonical URL key (url-key.mjs) — the exact posting re-listed.
 *   3. Req/job id from Notes (tracker-parse.mjs) — same requisition, any board.
 *   4. Company (fuzzy) + role — catches board re-posts whose bodies differ
 *      (e.g. a Polish and an English rendering of the same listing).
 *
 * A match is reported as DUPLICATE (recommend SKIP) unless the salary differs
 * materially — a genuine re-post at a different rate is a reason to re-evaluate,
 * not to skip, so it is reported as MATERIAL-CHANGE. Salary is a best-effort
 * heuristic over the JD text and is never the sole reason to declare a match.
 *
 * Read-only: never writes the tracker, never changes a status. The caller (the
 * apply/oferta gate) decides what to do with the verdict.
 *
 * Usage:
 *   node check-duplicate.mjs --jd path/to/jd.txt [--company X] [--role Y] [--url Z] [--req ID]
 *   node check-duplicate.mjs --report 124          # re-check a tracked report's JD
 *   node check-duplicate.mjs --company X --role Y --url Z
 *   node check-duplicate.mjs --json                # machine-readable output
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { resolveColumns, parseTrackerRow, extractReqNumber, extractTrackerReportNumbers, normalizeTextKey } from './tracker-parse.mjs';
import { fingerprintText, similarity } from './fingerprint-core.mjs';
import { normalizeUrl } from './url-key.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { extractStrippedJdSection } from './check-jd-archive.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const KNOWN_FLAGS = ['--jd', '--report', '--company', '--role', '--url', '--req', '--json', '--help', '-h'];
const USAGE = `Usage:
  node check-duplicate.mjs --jd <file> [--company X] [--role Y] [--url Z] [--req ID]
  node check-duplicate.mjs --report <N>          # re-check a tracked report's JD
  node check-duplicate.mjs --company X --role Y --url Z
  node check-duplicate.mjs --json                # machine-readable output`;

/** Same-JD threshold for this gate. Below fingerprint-core's 0.92 on purpose —
 * see the header note on board-to-board drift. */
export const FP_DUPLICATE_THRESHOLD = 0.90;

/** Tracker states that mean a real submission was made. */
const SUBMITTED_STATUSES = new Set(['Applied', 'Responded', 'Interview', 'Offer', 'Hired']);

// ── Salary heuristic ────────────────────────────────────────────────
// Best-effort: pull the numbers attached to a currency token out of the JD so a
// re-post at a different rate can be told apart from a verbatim re-post. It is
// deliberately narrow (currency must be explicit) so free text never invents a
// range — a false "salary changed" is cheaper than a false "same job, skip".
const CURRENCY = { pln: 'PLN', 'zł': 'PLN', zl: 'PLN', eur: 'EUR', '€': 'EUR', usd: 'USD', '$': 'USD', gbp: 'GBP', '£': 'GBP' };
const CURRENCY_ALT = 'pln|zł|zl|eur|€|usd|\\$|gbp|£';

function parseAmount(raw) {
  // "1 050" → 1050, "20,000" → 20000, "4.200" → 4200, "120,00" → 120, "1050.50" → 1050.5.
  // A single separator followed by exactly 2 digits is a decimal; otherwise it groups thousands.
  const s = String(raw).trim().replace(/\s/g, '');
  const decimal = /^\d{1,3}[.,]\d{2}$/.test(s);
  const normalized = decimal
    ? s.replace(',', '.')
    : s.replace(/[.,]/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function extractSalary(text) {
  const s = String(text ?? '');
  const found = new Map(); // currency -> [numbers]
  const push = (cur, nums) => {
    const key = CURRENCY[cur.toLowerCase()];
    if (!key) return;
    const list = found.get(key) ?? [];
    for (const n of nums) if (n != null) list.push(n);
    found.set(key, list);
  };
  const rangeRe = new RegExp(`(\\d[\\d\\s.,]*)\\s*(?:[-–—]|do|to)\\s*(\\d[\\d\\s.,]*)\\s*(${CURRENCY_ALT})`, 'gi');
  const singleRe = new RegExp(`(\\d[\\d\\s.,]*)\\s*(${CURRENCY_ALT})`, 'gi');
  let m;
  while ((m = rangeRe.exec(s))) push(m[3], [parseAmount(m[1]), parseAmount(m[2])]);
  while ((m = singleRe.exec(s))) push(m[2], [parseAmount(m[1])]);
  if (found.size === 0) return null;
  // Pick the most frequently cited currency; tie-break alphabetically for determinism.
  const [currency] = [...found.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))[0];
  const nums = found.get(currency);
  return { currency, min: Math.min(...nums), max: Math.max(...nums) };
}

/** True when both ranges carry the same currency and overlap. */
export function salaryOverlaps(a, b) {
  if (!a || !b || a.currency !== b.currency) return false;
  return a.min <= b.max && b.min <= a.max;
}

/** True when both ranges carry the same currency and do not overlap. */
export function salaryChanged(a, b) {
  if (!a || !b || a.currency !== b.currency) return false;
  return !salaryOverlaps(a, b);
}

// ── Company fuzzy match ─────────────────────────────────────────────
// Board re-posts spell the employer differently ("Pretius" vs "PRETIUS SOFTWARE
// SP. Z O.O."). Exact key equality misses that; containment after
// normalizeTextKey catches it. Guarded to keys of length >= 4 so a short
// acronym never swallows a longer unrelated name.
function companyFuzzy(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

// Job boards / ATS portals that show up in the Company cell when the real
// employer is hidden. A row (or candidate) whose "company" is one of these
// carries no employer identity, so the weak same-title signal treats it the
// same as an explicit '?'. Agencies (TeamQuest, Annapurna, …) are deliberately
// absent — they are real distinct channels, handled by the cross-channel check.
const BOARD_TOKENS = [
  'jobgether', 'ipracujzdalnie', 'pracuj', 'justjoin', 'theprotocol', 'linkedin',
  'solidjobs', 'indeed', 'glassdoor', 'nofluffjobs', 'bulldogjob', 'rocketjobs',
  'jooble', 'adzuna', 'welcometothejungle', 'lever', 'greenhouse', 'ashby',
  'workday', 'smartrecruiters', 'taleo', 'bamboohr', 'recruitee', 'teamtailor',
  'personio', 'workable', 'djinni', 'dou', 'jobsdb', 'dothejob', 'jobs',
];

/** Employer key with job-board/portal names mapped to "unknown" (''). */
function effectiveEmployerKey(key) {
  if (!key) return '';
  return BOARD_TOKENS.some((t) => key.includes(t)) ? '' : key;
}

// ── Tracker / report index ──────────────────────────────────────────
/** Map every report number to its file, from one readdir of reports/. */
function indexReports(reportsDir) {
  const byNum = new Map();
  if (!existsSync(reportsDir)) return byNum;
  for (const name of readdirSync(reportsDir)) {
    const m = name.match(/^0*(\d+)-.+\.md$/);
    if (m) byNum.set(parseInt(m[1], 10), join(reportsDir, name));
  }
  return byNum;
}

function readJdFromReport(path) {
  try {
    return extractStrippedJdSection(readFileSync(path, 'utf-8')) || '';
  } catch {
    return '';
  }
}

/** Company / role from a report's Machine Summary YAML block, if present. */
function readReportMeta(path) {
  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return { company: '', role: '' };
  }
  const block = content.match(/```ya?ml\s*([\s\S]*?)```/i);
  const yaml = block ? block[1] : '';
  const pick = (key) => {
    const m = yaml.match(new RegExp(`^\\s*${key}\\s*:\\s*"?([^"\\n]+?)"?\\s*$`, 'mi'));
    return m ? m[1].trim() : '';
  };
  return { company: pick('company'), role: pick('role') };
}

/** Build one comparable record per tracker row. */
export function indexTracker(trackerPath, reportsDir) {
  const lines = readFileSync(trackerPath, 'utf-8').split('\n');
  const colmap = resolveColumns(lines);
  const reports = indexReports(reportsDir);
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    let jdText = '';
    const nums = extractTrackerReportNumbers(row.report, row.notes);
    for (const n of nums) {
      const file = reports.get(n);
      if (!file) continue;
      const text = readJdFromReport(file);
      if (text) { jdText = text; break; }
    }
    rows.push({
      num: row.num,
      date: row.date,
      company: row.company,
      role: row.role,
      status: row.status,
      url: row.url || '',
      req: extractReqNumber(row.notes),
      companyKey: normalizeTextKey(row.company),
      urlKey: normalizeUrl(row.url || ''),
      fingerprint: fingerprintText(jdText),
      salary: extractSalary(jdText),
    });
  }
  return rows;
}

// ── Comparison ──────────────────────────────────────────────────────
/**
 * Compare a candidate posting against indexed tracker rows.
 *
 * @param {{company?:string, role?:string, url?:string, req?:string, jdText?:string}} candidate
 * @param {Array} rows - From indexTracker().
 * @returns {Array<{row:object, verdict:string, score:number, reasons:string[], salaryChange:boolean}>}
 */
export function findDuplicates(candidate, rows) {
  const cand = {
    companyKey: normalizeTextKey(candidate.company || ''),
    role: candidate.role || '',
    urlKey: normalizeUrl(candidate.url || ''),
    req: candidate.req ? candidate.req.toUpperCase() : null,
    fingerprint: fingerprintText(candidate.jdText || ''),
    salary: extractSalary(candidate.jdText || ''),
  };
  const matches = [];
  for (const row of rows) {
    const reasons = [];
    const fpSim = cand.fingerprint && row.fingerprint ? similarity(cand.fingerprint, row.fingerprint) : 0;
    const fpMatch = fpSim >= FP_DUPLICATE_THRESHOLD;
    const urlMatch = Boolean(cand.urlKey && row.urlKey && cand.urlKey === row.urlKey);
    const reqMatch = Boolean(cand.req && row.req && cand.req === row.req);
    const companyMatch = companyFuzzy(effectiveEmployerKey(cand.companyKey), effectiveEmployerKey(row.companyKey));
    const roleMatch = Boolean(cand.role && row.role && roleFuzzyMatch(cand.role, row.role));

    const strong = fpMatch || urlMatch || reqMatch || (companyMatch && roleMatch);
    // A weak match is the CANDIDATE's employer being undisclosed — an explicit
    // '?' or a job board standing in for a hidden client. The strong signals
    // cannot reach that case, and a human should see it. Deliberately one-sided:
    // a KNOWN candidate employer never fires weak, or a legitimate new
    // application would be flagged by every old row whose employer was '?'.
    // Same title alone is too common; salary is only the MATERIAL-CHANGE
    // override below.
    const weak = roleMatch && !effectiveEmployerKey(cand.companyKey);

    if (fpMatch) reasons.push(`jd ${fpSim.toFixed(2)}`);
    if (urlMatch) reasons.push('url');
    if (reqMatch) reasons.push(`req ${cand.req}`);
    if (companyMatch && roleMatch) reasons.push('company+role');
    if (!strong && weak) reasons.push('same title, undisclosed employer');
    if (!strong && !weak) continue;

    const salaryChange = salaryChanged(cand.salary, row.salary);
    const verdict = strong
      ? (salaryChange ? 'MATERIAL-CHANGE' : 'DUPLICATE')
      : 'POSSIBLE';
    // Rank strong matches first, then already-submitted rows (the ones a repeat
    // application actually burns) above merely-evaluated ones.
    const submitted = SUBMITTED_STATUSES.has(row.status);
    const score = (strong ? 3 : submitted ? 2 : 1) + fpSim;
    matches.push({ row, verdict, score, reasons, salaryChange });
  }
  return matches.sort((a, b) => b.score - a.score);
}

// ── CLI ─────────────────────────────────────────────────────────────
function resolveCandidate(args) {
  const candidate = {
    company: flagValue(args, '--company') || '',
    role: flagValue(args, '--role') || '',
    url: flagValue(args, '--url'),
    req: flagValue(args, '--req'),
    jdText: '',
  };
  const jdFile = flagValue(args, '--jd');
  if (jdFile) {
    if (!existsSync(jdFile)) throw new Error(`--jd file not found: ${jdFile}`);
    candidate.jdText = readFileSync(jdFile, 'utf-8');
  }
  const report = flagValue(args, '--report');
  if (report) {
    const root = getCareerOpsRoot();
    const reports = indexReports(join(root, 'reports'));
    const file = reports.get(parseInt(report, 10));
    if (!file) throw new Error(`--report ${report}: no reports/${report}-*.md found`);
    candidate.jdText = readJdFromReport(file);
    const meta = readReportMeta(file);
    if (!candidate.company) candidate.company = meta.company;
    if (!candidate.role) candidate.role = meta.role;
  }
  return candidate;
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  const root = getCareerOpsRoot();
  const trackerPath = resolveTrackerPath(root);
  if (!existsSync(trackerPath)) throw new Error(`tracker not found: ${trackerPath}`);

  const candidate = resolveCandidate(args);
  if (!candidate.jdText && !candidate.company && !candidate.role && !candidate.url) {
    throw new Error('nothing to check — pass --jd/--report, or --company/--role/--url');
  }

  const rows = indexTracker(trackerPath, join(root, 'reports'));
  const matches = findDuplicates(candidate, rows);
  const top = matches[0];
  const verdict = !top ? 'NEW' : top.verdict;

  if (hasFlag(args, '--json')) {
    console.log(JSON.stringify({
      verdict,
      candidate: { company: candidate.company || null, role: candidate.role || null, url: candidate.url || null },
      matches: matches.slice(0, 10).map((m) => ({
        num: m.row.num,
        date: m.row.date,
        company: m.row.company,
        role: m.row.role,
        status: m.row.status,
        verdict: m.verdict,
        reasons: m.reasons,
        salaryChange: m.salaryChange,
      })),
    }, null, 2));
    return;
  }

  if (verdict === 'NEW') {
    console.log('✅ NEW — no tracked vacancy matches this posting. Safe to evaluate / apply.');
    return;
  }

  const label = {
    DUPLICATE: '⛔ DUPLICATE — already tracked. Recommend SKIP (or update the existing row).',
    'MATERIAL-CHANGE': '⚠️  MATERIAL-CHANGE — same JD but the salary differs. Re-evaluate instead of skipping.',
    POSSIBLE: '🟡 POSSIBLE — same title with an undisclosed employer (agency re-post?). Review before applying.',
  }[verdict];
  console.log(label);
  console.log('');
  for (const m of matches.slice(0, 10)) {
    console.log(`  #${m.row.num} ${m.row.date}  ${m.row.company} — ${m.row.role}  [${m.row.status}]`);
    console.log(`      via: ${m.reasons.join(', ')}`);
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`check-duplicate: ${err.message}`);
    process.exit(1);
  }
}
