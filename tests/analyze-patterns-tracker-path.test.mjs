// tests/analyze-patterns-tracker-path.test.mjs — which tracker analyze-patterns
// reads, and whether its report links still resolve once that path is
// canonicalized.
//
// analyze-patterns used to pick data/applications.md or applications.md under
// the data root itself, ignoring CAREER_OPS_TRACKER, so `patterns` and
// `calibrate` analysed a different file than set-status.mjs writes whenever
// that override was set. It now goes through resolveTrackerPath(), which
// realpaths the result; report links must still resolve when the data root is
// reached through a symlink (macOS's /var -> /private/var tmpdir is one).
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nanalyze-patterns — tracker path resolution');

const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
];

function writeReport(root, num, archetype) {
  const file = `${String(num).padStart(3, '0')}-co${num}-2026-01-01.md`;
  writeFileSync(join(root, 'reports', file), [
    `# Evaluation: Co${num} — ${archetype}`, '',
    '## Machine Summary', '',
    '```yaml',
    `company: "Co${num}"`,
    `role: "${archetype}"`,
    'score: 4.0',
    `archetype: "${archetype}"`,
    '```', '',
  ].join('\n'));
  return file;
}

function trackerRow(num, link) {
  return `| ${num} | 2026-01-01 | Co${num} | Engineer | 4.0/5 | Rejected | ❌ | [${num}](${link}) | fixture |`;
}

function analyze(env) {
  const out = execFileSync(NODE, [join(ROOT, 'analyze-patterns.mjs'), '--min-threshold', '1'], {
    encoding: 'utf-8',
    timeout: 60000,
    env: { ...process.env, CAREER_OPS_TRACKER: '', ...env },
  });
  return JSON.parse(out);
}

const archetypesOf = (result) => (result.archetypeBreakdown || []).map((a) => a.archetype).sort();

const work = mkdtempSync(join(tmpdir(), 'co-ap-tracker-'));
try {
  const root = join(work, 'root');
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });

  // The data root's own tracker: one row, linked tracker-relative.
  const inRoot = writeReport(root, 1, 'In-Root Archetype');
  writeFileSync(join(root, 'data', 'applications.md'),
    [...HEADER, trackerRow(1, `../reports/${inRoot}`)].join('\n') + '\n');

  // A tracker outside the data root: two different rows, linked root-relative.
  const outside = join(work, 'elsewhere');
  mkdirSync(outside);
  const a = writeReport(root, 2, 'Override Archetype A');
  const b = writeReport(root, 3, 'Override Archetype B');
  const overrideTracker = join(outside, 'tracker.md');
  writeFileSync(overrideTracker,
    [...HEADER, trackerRow(2, `reports/${a}`), trackerRow(3, `reports/${b}`)].join('\n') + '\n');

  try {
    const result = analyze({ CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: overrideTracker });
    const got = archetypesOf(result);
    if (result.metadata?.total === 2 && got.join('|') === 'Override Archetype A|Override Archetype B') {
      pass('CAREER_OPS_TRACKER outside the data root: its rows are read and their reports resolve');
    } else {
      fail(`CAREER_OPS_TRACKER ignored or reports unresolved: total=${result.metadata?.total}, archetypes=${JSON.stringify(got)}`);
    }
  } catch (e) {
    fail(`analyze-patterns.mjs failed with CAREER_OPS_TRACKER set: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  try {
    const result = analyze({ CAREER_OPS_ROOT: root });
    const got = archetypesOf(result);
    if (result.metadata?.total === 1 && got.join('|') === 'In-Root Archetype') {
      pass('no override: the data root tracker is read and its tracker-relative link resolves');
    } else {
      fail(`data root tracker: total=${result.metadata?.total}, archetypes=${JSON.stringify(got)}`);
    }
  } catch (e) {
    fail(`analyze-patterns.mjs failed on the data root tracker: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }

  // The data root reached through a symlink: the tracker realpaths to the
  // link's target, but tracker-relative report links must still land inside
  // the reports/ directory the containment guard checks against.
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
      const result = analyze({ CAREER_OPS_ROOT: link });
      const got = archetypesOf(result);
      if (got.join('|') === 'In-Root Archetype') {
        pass('symlinked data root: tracker-relative report links still resolve after the tracker is realpathed');
      } else {
        fail(`symlinked data root lost its report data: archetypes=${JSON.stringify(got)}`);
      }
    } catch (e) {
      fail(`analyze-patterns.mjs failed through a symlinked data root: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
