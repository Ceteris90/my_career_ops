// tests/upskill-tracker-path.test.mjs — upskill's report links once the
// tracker path is canonicalized.
//
// upskill reads the tracker through resolveTrackerPath(), which realpaths the
// result. Report links used to be resolved against that realpathed directory,
// while withinReports() compares candidates lexically against the data root,
// so through a symlinked data root (macOS's /var -> /private/var tmpdir is
// one) every tracker-relative link failed containment and the skill-gap map
// was built from no reports at all.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nupskill — report links through the resolved tracker path');

function writeFixture(root) {
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  const file = '001-co1-2026-01-01.md';
  writeFileSync(join(root, 'reports', file), [
    '# Evaluation: Co1 — Engineer', '',
    '**Score:** 2.5/5', '',
    '## Gaps', '',
    '- Kubernetes experience missing', '',
  ].join('\n'));
  writeFileSync(join(root, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    `| 1 | 2026-01-01 | Co1 | Engineer | 2.5/5 | Evaluated | ❌ | [1](../reports/${file}) | fixture |`,
  ].join('\n') + '\n');
}

function reportsRead(root) {
  const out = execFileSync(NODE, [join(ROOT, 'upskill.mjs'), '--min-reports', '1'], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: '' },
  });
  // With no report read, upskill answers with its "Not enough data" error
  // instead of metadata; surface that rather than a bare undefined.
  const result = JSON.parse(out);
  return result.metadata?.reportsRead ?? `none (${result.error})`;
}

const work = mkdtempSync(join(tmpdir(), 'co-upskill-tracker-'));
try {
  const root = join(work, 'root');
  writeFixture(root);

  try {
    const read = reportsRead(root);
    if (read === 1) pass('data root under the tmpdir: the tracker-relative report link is read');
    else fail(`data root under the tmpdir: reportsRead=${read}, expected 1`);
  } catch (e) {
    fail(`upskill.mjs failed on the data root: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  const link = join(work, 'linked-root');
  let linked = false;
  try {
    symlinkSync(root, link, 'dir');
    linked = true;
  } catch {
    pass('symlinked data root: skipped (symlinks unavailable on this filesystem)');
  }
  if (linked) {
    try {
      const read = reportsRead(link);
      if (read === 1) pass('symlinked data root: the tracker-relative report link still resolves after the tracker is realpathed');
      else fail(`symlinked data root lost its reports: reportsRead=${read}, expected 1`);
    } catch (e) {
      fail(`upskill.mjs failed through a symlinked data root: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
