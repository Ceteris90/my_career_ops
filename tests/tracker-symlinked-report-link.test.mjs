// tests/tracker-symlinked-report-link.test.mjs: a report link inside a symlinked
// data/applications.md resolves from the folder the symlink LIVES in, not only
// from the folder its target lives in (#5374).
//
// The fixture is the layout from the report: reports/ stays in the checkout
// while the tracker file is a symlink to a file kept outside it. Every base the
// rule used to try — the realpathed tracker dir and the data root — points at a
// `reports/` that is not there, so before the fix all three scripts sharing
// findDeadReportLink() called a live link dead, and fix-report-links.mjs without
// --dry-run would have rewritten every Report cell to `—`.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pass, fail, warn, run, lastRunFailure, NODE, rmSync } from './helpers.mjs';
import { findDeadReportLink, trackerLinkDirFor } from '../tracker-utils.mjs';

console.log("\ntracker: a report link in a symlinked tracker resolves from the symlink's own folder (#5374)");

const TMP = mkdtempSync(join(tmpdir(), 'co-symlinked-tracker-'));

/** stdout whether or not the child exited non-zero: these scripts report findings and still fail. */
function outputOf(script, args = [], env = {}) {
  const o = run(NODE, [script, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  return o === null ? (lastRunFailure()?.stdout ?? '') : o;
}

try {
  const repo = join(TMP, 'repo');
  const privateData = join(TMP, 'private', 'data');
  mkdirSync(join(repo, 'data'), { recursive: true });
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(privateData, { recursive: true });

  // The report exists ONLY under the symlink's own folder. Nothing is written
  // beside the symlink target, so the old two bases provably cannot resolve it
  // and a passing row can only come from the base added here.
  writeFileSync(join(repo, 'reports', '001-acme-2026-07-15.md'),
    '# Evaluación: Acme — Coordinator\n\n## Machine Summary\n\n```yaml\ncompany: "Acme"\nrole: "Coordinator"\nscore: 3.2\n```\n');

  const LIVE = '[1](../reports/001-acme-2026-07-15.md)';
  const DEAD = '[2](../reports/002-ghost-2026-07-16.md)';
  writeFileSync(join(privateData, 'applications.md'),
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    `| 1 | 2026-07-15 | Acme | Coordinator | 3.2/5 | Applied | ❌ | ${LIVE} | ok |\n` +
    `| 2 | 2026-07-16 | Ghost | Analyst | 2.0/5 | Applied | ❌ | ${DEAD} | ok |\n`);

  let linked = true;
  try { symlinkSync(join(privateData, 'applications.md'), join(repo, 'data', 'applications.md'), 'file'); }
  catch { linked = false; }

  if (!linked) {
    warn('symlinked-tracker checks skipped: this platform refused the file symlink');
  } else {
    const env = { CAREER_OPS_ROOT: repo, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '' };
    const trackerLinkDir = trackerLinkDirFor(repo);
    // What the three scripts themselves pass: the realpathed tracker dir, and the
    // data root for legacy root-relative links.
    const trackerDir = dirname(join(privateData, 'applications.md'));

    // The base is the folder the symlink lives in, spelled lexically. Asserted
    // rather than assumed, because a helper that realpathed here would put the
    // bug straight back.
    if (trackerLinkDir === join(repo, 'data')) pass('trackerLinkDirFor keeps the tracker\'s lexical folder, symlink unresolved');
    else fail(`trackerLinkDirFor returned ${trackerLinkDir}, expected ${join(repo, 'data')}`);

    // The defect itself: with only the two old bases the live row is called dead.
    if (findDeadReportLink(LIVE, trackerDir, repo) === '../reports/001-acme-2026-07-15.md') {
      pass('without the lexical base the live link reads as dead (the #5374 defect)');
    } else {
      fail('the #5374 fixture no longer reproduces: the live link resolved from the old bases alone');
    }

    // ...and resolves once the base is supplied.
    if (findDeadReportLink(LIVE, trackerDir, repo, { trackerLinkDir }) === null) pass('the live link resolves from the symlink\'s own folder');
    else fail('a report reachable through the tracker symlink is still reported dead');

    // The new base is an addition, not a replacement: a link that exists nowhere
    // is still dead, or the fix would silence Check 3 entirely.
    if (findDeadReportLink(DEAD, trackerDir, repo, { trackerLinkDir }) === '../reports/002-ghost-2026-07-16.md') {
      pass('a link that exists in none of the three bases is still dead');
    } else {
      fail('the extra base made a genuinely missing report look present');
    }

    // fix-report-links.mjs --dry-run: the row whose report is reachable must not
    // be listed for rewrite, and the one that is genuinely missing must be.
    const dry = outputOf('fix-report-links.mjs', ['--dry-run'], env);
    if (!/Acme/.test(dry) && /Ghost/.test(dry)) pass('fix-report-links --dry-run rewrites only the genuinely missing report');
    else fail(`fix-report-links --dry-run picked the wrong rows:\n${dry}`);

    // verify-pipeline.mjs Check 3, end to end. Row 1 must pass, row 2 must still
    // be flagged, which also proves the check actually ran on this fixture.
    const vp = outputOf('verify-pipeline.mjs', [], env);
    if (!/#1: Report not found/.test(vp) && /#2: Report not found/.test(vp)) {
      pass('verify-pipeline Check 3 accepts the symlinked row and still flags the missing one');
    } else {
      fail(`verify-pipeline Check 3 resolved the wrong rows:\n${vp}`);
    }
  }
} catch (e) {
  fail(`symlinked-tracker checks crashed: ${e.message}`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}