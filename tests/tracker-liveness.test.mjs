import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import {
  trackerLivenessTargets,
  planExpiredDiscards,
  postingClosedNote,
  DEFAULT_DISCARD_STATUSES,
} from '../liveness-core.mjs';

const tracker = [
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-09-01 | Initech | Engineer | 4.0/5 | Evaluated | ❌ | — | no link |',
  '| 2 | 2026-09-02 | Globex | Staff Engineer | 4.2/5 | Applied | ✅ | [2](../reports/002-globex-2026-09-02.md) | |',
  '| 3 | 2026-09-03 | Acme | Platform Engineer | 4.1/5 | evaluated | ❌ | [3](../reports/003-acme-2026-09-03.md) | |',
  '| 4 | 2026-09-04 | Hooli | Engineer | 3.0/5 | SKIP | ❌ | [4](../reports/004-hooli-2026-09-04.md) | |',
  '| 5 | 2026-09-05 | Acme | Platform Engineer | 4.1/5 | Evaluated | ❌ | [5](../reports/005-acme-2026-09-05.md) | repost |',
  '| 6 | 2026-09-06 | Umbrella | Engineer | 4.0/5 | Applied | ❌ | [6](../reports/006-umbrella-2026-09-06.md) | |',
].join('\n');
const reports = {
  '002-globex-2026-09-02.md': '**URL:** https://jobs.example.test/globex/2',
  '003-acme-2026-09-03.md': '**Score:** 4.1/5 | **URL:** <https://jobs.example.test/acme/3>, | **PDF:** -',
  '004-hooli-2026-09-04.md': '**URL:** https://jobs.example.test/hooli/4',
  '005-acme-2026-09-05.md': '**URL:** https://jobs.example.test/acme/3',
  '006-umbrella-2026-09-06.md': '**URL:** N/A',
};

function reportsRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'liveness-reports-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(reports)) writeFileSync(join(dir, name), text);
  return dir;
}

test('open tracker rows resolve to their report posting URL, once per URL', (t) => {
  const { targets, noUrl } = trackerLivenessTargets(tracker, { reportsRoot: reportsRoot(t) });
  assert.deepEqual(targets, [
    { num: 2, company: 'Globex', role: 'Staff Engineer', status: 'Applied', url: 'https://jobs.example.test/globex/2' },
    { num: 3, company: 'Acme', role: 'Platform Engineer', status: 'evaluated', url: 'https://jobs.example.test/acme/3' },
  ]);
  assert.deepEqual(noUrl, [1, 6]);
});

test('--status picks which rows are swept', (t) => {
  const { targets } = trackerLivenessTargets(tracker, { statuses: ['SKIP'], reportsRoot: reportsRoot(t) });
  assert.deepEqual(targets.map((row) => row.num), [4]);
});

test('--tracker without a tracker file says so and exits 1', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'liveness-tracker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--tracker', '--no-record'], {
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root }, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /No tracker at /);
  assert.doesNotMatch(result.stderr, /Usage:/);
});

test('planExpiredDiscards keeps every Evaluated row that shares an expired URL', (t) => {
  const root = reportsRoot(t);
  const rows = planExpiredDiscards(tracker, ['https://jobs.example.test/acme/3'], { reportsRoot: root });
  assert.deepEqual(rows.map((row) => row.num), [3, 5]);
  assert.equal(rows.every((row) => row.url === 'https://jobs.example.test/acme/3'), true);
});

test('planExpiredDiscards ignores Applied even when that posting expired', (t) => {
  const root = reportsRoot(t);
  const rows = planExpiredDiscards(
    tracker,
    ['https://jobs.example.test/globex/2', 'https://jobs.example.test/acme/3'],
    { reportsRoot: root },
  );
  assert.deepEqual(rows.map((row) => row.num), [3, 5]);
  assert.deepEqual(DEFAULT_DISCARD_STATUSES, ['evaluated']);
});

test('postingClosedNote stamps the calendar day', () => {
  assert.equal(postingClosedNote('2026-10-14'), 'posting closed 2026-10-14');
});

test('--discard-expired without --tracker exits 1', () => {
  const result = spawnSync(process.execPath, [join(ROOT, 'check-liveness.mjs'), '--discard-expired', '--no-record'], {
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /requires --tracker/);
});

test('--tracker --discard-expired dry-runs set-status and leaves the tracker unchanged', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'liveness-discard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  const reportsDir = join(root, 'reports');
  mkdirSync(data, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(data, 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | |',
    '| 2 | 2026-09-02 | Globex | Engineer | 4.0/5 | Applied | ❌ | [2](../reports/002-globex.md) | |',
    '',
  ].join('\n'));
  writeFileSync(join(reportsDir, '001-acme.md'), '**URL:** https://job-boards.greenhouse.io/humeai/jobs/1\n');
  writeFileSync(join(reportsDir, '002-globex.md'), '**URL:** https://job-boards.eu.greenhouse.io/parloa/jobs/4566280101\n');
  const before = readFileSync(join(data, 'applications.md'), 'utf8');
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'check-liveness.mjs'), '--tracker', '--discard-expired', '--no-record', '--no-fallback'],
    {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: data },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.match(result.stdout, /Discard expired \(dry-run\)/, result.stdout + result.stderr);
  const discardSection = result.stdout.split('Discard expired')[1] ?? '';
  assert.match(discardSection, /#1 Acme/);
  assert.doesNotMatch(discardSection, /#2 Globex/);
  assert.match(discardSection, /would discard \(posting closed /);
  assert.equal(readFileSync(join(data, 'applications.md'), 'utf8'), before);
});

test('--tracker --discard-expired --apply writes Discarded with the closed note', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'liveness-discard-apply-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  const reportsDir = join(root, 'reports');
  mkdirSync(data, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(data, 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-09-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [1](../reports/001-acme.md) | |',
    '',
  ].join('\n'));
  writeFileSync(join(reportsDir, '001-acme.md'), '**URL:** https://job-boards.greenhouse.io/humeai/jobs/1\n');
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'check-liveness.mjs'), '--tracker', '--discard-expired', '--apply', '--no-record', '--no-fallback'],
    {
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: data },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  assert.match(result.stdout, /Discard expired \(apply\)/, result.stdout + result.stderr);
  assert.match(result.stdout, /discarded \(posting closed /, result.stdout);
  const after = readFileSync(join(data, 'applications.md'), 'utf8');
  assert.match(after, /\| Discarded \|/);
  assert.match(after, /posting closed \d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(after, /\| Evaluated \|/);
});

