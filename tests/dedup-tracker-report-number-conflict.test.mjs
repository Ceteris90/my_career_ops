// tests/dedup-tracker-report-number-conflict.test.mjs — two different report
// numbers are two report identities, even when the tracker numbers collide.
//
// Duplicate tracker numbers are a known artifact of the old merge bug, which
// is why verify-pipeline has Check 12. dedup-tracker's sameReportIdentity()
// accepted a shared tracker number plus the same title as proof of one report
// identity, and it did so even when the two rows linked two DIFFERENT reports.
// Report identity skips the advanced-status guard, so `#7 … Applied [12]` and
// `#7 … Evaluated [40]` were clustered and the Applied row was deleted: its
// report link, PDF flag and date were gone, and "Applied" was stamped onto
// the other posting's row. The same pair with distinct tracker numbers was
// kept with a warning, so the guard existed and was bypassed only by the
// collision.
//
// Drives the REAL dedup-tracker.mjs CLI against a temp tracker via the
// CAREER_OPS_TRACKER hook, because the deletion is what loses data.
import { pass, fail, rmSync } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEDUP = join(HERE, '..', 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

/** Run dedup on the rows; hand back the surviving rows and what dedup printed. */
function dedup(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-report-num-test-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const r = spawnSync(process.execPath, [DEDUP], {
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_TRACKER: tracker },
    });
    assert.strictEqual(r.status, 0, `dedup-tracker exited ${r.status}: ${r.stderr}`);
    // The keep-both warning is console.warn, so it is on stderr.
    const out = `${r.stdout}${r.stderr}`;
    const kept = readFileSync(tracker, 'utf-8').split('\n')
      .filter(l => /^\|\s*\d+\s*\|/.test(l))
      .map(l => l.split('|').map(c => c.trim()))
      .map(c => ({ num: c[1], status: c[6], report: (c[8].match(/^\[(\d+)\]/) || [])[1] ?? null }));
    return { kept, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const row = (num, score, status, report, notes = '') =>
  `| ${num} | 2026-10-01 | Acme | Platform Engineer | ${score} | ${status} | ❌ | ${report} | ${notes} |`;

console.log('\ndedup-tracker — different report numbers are different identities');

ok('a colliding tracker number does not make two reports one identity', () => {
  // THE BUG: the Applied row was deleted and its report link lost.
  const { kept, out } = dedup([
    row(7, '4.0/5', 'Applied', '[12](reports/012-acme.md)', 'applied via referral'),
    row(7, '4.5/5', 'Evaluated', '[40](reports/040-acme.md)'),
  ]);
  assert.deepStrictEqual(kept.map(r => r.report).sort(), ['12', '40'], `both reports must keep their row, got ${JSON.stringify(kept)}`);
  assert.deepStrictEqual(kept.map(r => r.status).sort(), ['Applied', 'Evaluated'], 'no status may move between the two rows');
  assert.match(out, /advanced status requires exact report identity/, 'the user is told why both rows were kept');
});

ok('premise: the same pair with distinct tracker numbers is kept by the advanced-status guard', () => {
  // The guard the collision used to bypass. If this fails, the case above
  // proves nothing about the collision.
  const { kept, out } = dedup([
    row(7, '4.0/5', 'Applied', '[12](reports/012-acme.md)'),
    row(8, '4.5/5', 'Evaluated', '[40](reports/040-acme.md)'),
  ]);
  assert.strictEqual(kept.length, 2);
  assert.match(out, /Keep #7 and #8: exact-title match but advanced status requires exact report identity/);
});

ok('the same report number is still one identity, even past the advanced-status guard', () => {
  // Exact identity must keep merging: one report, copied onto two rows. The
  // higher score is kept and inherits the Applied status.
  const { kept } = dedup([
    row(7, '4.0/5', 'Applied', '[12](reports/012-acme.md)'),
    row(7, '4.5/5', 'Evaluated', '[12](reports/012-acme.md)'),
  ]);
  assert.deepStrictEqual(kept, [{ num: '7', status: 'Applied', report: '12' }]);
});

ok('a row with no report link still falls back to the tracker number + title rule', () => {
  // Only two PRESENT and different report numbers rule identity out. A missing
  // link is unknown, so the existing number+title rule still decides.
  const { kept } = dedup([
    row(7, '4.0/5', 'Applied', '—'),
    row(7, '4.5/5', 'Evaluated', '[40](reports/040-acme.md)'),
  ]);
  assert.deepStrictEqual(kept, [{ num: '7', status: 'Applied', report: '40' }]);
});
