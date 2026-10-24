// tests/verify-pipeline-hints.test.mjs — every verify-pipeline finding carries a
// one-line fix hint (#5796).
//
//   1. static   — every error(...) and warn(...) call site in verify-pipeline.mjs
//                 passes a non-empty second argument, so a new check cannot be
//                 added without telling the user what to do about it.
//   2. runtime  — against a fixture tracker in a temp dir: findings are followed
//                 by an indented "→ fix:" line, a repeated kind prints its hint
//                 only once, `--no-hints` restores hint-free output, and neither
//                 the counts nor the exit code depend on hints.
//
// Fixtures live entirely in a temp dir (tracker + reports via the same env
// overrides the sibling verify-pipeline suites use). No dates are computed.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, NODE, rmSync, codeMask } from './helpers.mjs';

console.log('\nverify-pipeline — fix hints under every error and warning (#5796)');

// --- 1. Static: every call site passes a hint --------------------------------
const SRC = readFileSync(join(ROOT, 'verify-pipeline.mjs'), 'utf-8');
const isCode = codeMask(SRC);

// Number of top-level arguments of the call whose "(" is at `open`. Only code
// characters count (strings, template text and comments are masked out), so a
// comma or paren inside a message cannot confuse the count; the code inside a
// ${...} substitution is balanced and is skipped by depth.
function argCount(open) {
  let depth = 0;
  let args = 1;
  let sawContent = false;
  for (let i = open; i < SRC.length; i++) {
    const ch = SRC[i];
    if (!isCode[i]) { if (depth === 1) sawContent = true; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; if (depth > 1) sawContent = true; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return sawContent ? args : 0;
      continue;
    }
    if (depth === 1 && ch === ',') args++;
    else if (depth === 1 && !/\s/.test(ch)) sawContent = true;
  }
  return -1;
}

const sites = [];
for (const m of SRC.matchAll(/\b(error|warn)\(/g)) {
  const at = m.index;
  if (!isCode[at]) continue;                              // inside a comment or string
  if (/function\s+$/.test(SRC.slice(Math.max(0, at - 12), at))) continue; // the declaration
  const line = SRC.slice(0, at).split('\n').length;
  sites.push({ kind: m[1], line, args: argCount(at + m[0].length - 1) });
}

if (sites.filter(s => s.kind === 'error').length >= 10 && sites.filter(s => s.kind === 'warn').length >= 10) {
  pass(`found ${sites.length} error()/warn() call sites to check`);
} else {
  fail(`call-site scan found too few sites (${sites.length}) — the scanner is broken`);
}
const unhinted = sites.filter(s => s.args < 2);
if (unhinted.length === 0) {
  pass('every error()/warn() call site passes a hint');
} else {
  fail(`call site(s) without a hint: ${unhinted.map(s => `${s.kind}() at verify-pipeline.mjs:${s.line}`).join(', ')}`);
}

// --- 2. Runtime ---------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'co-vp-hints-'));
try {
  const reports = join(tmp, 'reports');
  mkdirSync(reports, { recursive: true });
  const tracker = join(tmp, 'applications.md');
  const row = (num, score, status, report) =>
    `| ${num} | 2026-01-01 | Co${num} | Role ${num} | ${score} | ${status} | ❌ | ${report} | — |\n`;
  writeFileSync(tracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    // two dead report links (same kind), one score holding a status word
    row(1, '4.0/5', 'Evaluated', '[1](reports/001-gone-2026-01-01.md)') +
    row(2, '4.0/5', 'Evaluated', '[2](reports/002-gone-2026-01-01.md)') +
    row(3, 'Applied', 'Evaluated', '—'));

  const runVp = (extraArgs = []) => {
    const env = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_REPORTS: reports };
    try {
      const stdout = execFileSync(NODE, [join(ROOT, 'verify-pipeline.mjs'), ...extraArgs],
        { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 });
      return { status: 0, stdout };
    } catch (err) {
      return { status: typeof err.status === 'number' ? err.status : 1, stdout: typeof err.stdout === 'string' ? err.stdout : '' };
    }
  };
  const summary = (out) => (out.match(/Pipeline Health: (\d+) errors, (\d+) warnings/) || []).slice(1).join('/');
  const withoutHints = (out) => out.split('\n').filter(l => !/^ {3}→ fix: /.test(l)).join('\n');

  const on = runVp();
  const off = runVp(['--no-hints']);

  if (on.status === 1 && off.status === 1 && summary(on.stdout) !== '' && summary(on.stdout) === summary(off.stdout)) {
    pass(`exit code and counts are identical with and without hints (${summary(on.stdout)})`);
  } else {
    fail(`exit/counts differ with hints: on=${on.status} ${summary(on.stdout)} off=${off.status} ${summary(off.stdout)}`);
  }

  if (!/→ fix:/.test(off.stdout)) pass('--no-hints prints no hint lines');
  else fail('--no-hints still printed a hint line');

  if (withoutHints(on.stdout) === off.stdout) pass('hints only add lines: stripping them gives the --no-hints output byte-for-byte');
  else fail('hint output differs from --no-hints output beyond the hint lines');

  const lines = on.stdout.split('\n');
  const idx = lines.findIndex(l => l.startsWith('❌ #1: Report not found'));
  if (idx >= 0 && /^ {3}→ fix: .*fix-report-links\.mjs/.test(lines[idx + 1] || '')) {
    pass('a Report-not-found error is followed by its fix hint naming fix-report-links.mjs');
  } else {
    fail(`no fix hint under the Report-not-found error:\n${lines.slice(Math.max(0, idx), idx + 3).join('\n')}`);
  }

  const second = lines.findIndex(l => l.startsWith('❌ #2: Report not found'));
  if (second >= 0 && !/→ fix:/.test(lines[second + 1] || '')) {
    pass('a second finding of the same kind does not repeat the hint');
  } else {
    fail('the hint was repeated under every finding of the same kind');
  }
  if (lines.filter(l => /fix-report-links\.mjs/.test(l)).length === 1) {
    pass('the grouped hint is printed exactly once for both dead links');
  } else {
    fail('grouped hint printed an unexpected number of times');
  }

  const score = lines.findIndex(l => l.startsWith('❌ #3: Invalid score format'));
  if (score >= 0 && /^ {3}→ fix: /.test(lines[score + 1] || '')) {
    pass('a different kind of finding gets its own hint');
  } else {
    fail('Invalid-score error has no hint');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
