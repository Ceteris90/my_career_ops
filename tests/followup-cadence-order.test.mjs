#!/usr/bin/env node

/**
 * followup-cadence.mjs lists the most pressing follow-up first inside each
 * urgency bucket, not in tracker order. The web follow-ups page shows this
 * order as-is, so a tracker-ordered overdue bucket put a 15-day-overdue row
 * above an 80-day-overdue one.
 *
 * Run: node test-all.mjs --only followup-cadence-order
 */

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nfollowup-cadence.mjs — entries ordered most overdue first within a bucket');

const DEFAULT_CADENCE_PROFILE = join(ROOT, 'tests', 'fixtures', 'profile-default-cadence.yml');
const NOW = '2026-08-20T12:00:00Z';

// Default cadence: an Applied row is due 7 days after its date; a Responded
// row with no follow-up logged is urgent for its first day.
const ROWS = [
  [1, '2026-08-05', 'Acme', 'Applied'],       // due 08-12, 8 days overdue
  [2, '2026-06-01', 'Globex', 'Applied'],     // due 06-08, 73 days overdue
  [3, '2026-08-19', 'Wonka', 'Applied'],      // due 08-26, waiting 6 days
  [4, '2026-08-20', 'Initech', 'Responded'],  // urgent
  [5, '2026-07-10', 'Umbrella', 'Applied'],   // due 07-17, 34 days overdue
  [6, '2026-08-17', 'Hooli', 'Applied'],      // due 08-24, waiting 4 days
  [7, '2026-07-25', 'Vandelay', 'Applied'],   // due 08-01, 19 days overdue
];
const EXPECTED = [
  'Initech',
  'Globex', 'Umbrella', 'Vandelay', 'Acme',
  'Hooli', 'Wonka',
];

const dir = mkdtempSync(join(tmpdir(), 'co-cadence-order-'));
try {
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...ROWS.map(([num, date, company, status]) =>
      `| ${num} | ${date} | ${company} | Platform Engineer | 4.0/5 | ${status} | ❌ | — | https://jobs.${company.toLowerCase()}.example/1 |`),
    '',
  ].join('\n'));

  const freeze = join(dir, 'freeze-clock.mjs');
  writeFileSync(freeze, [
    'const RealDate = Date;',
    `const FROZEN = new RealDate('${NOW}').getTime();`,
    'globalThis.Date = class extends RealDate {',
    '  constructor(...a) { if (a.length === 0) super(FROZEN); else super(...a); }',
    '  static now() { return FROZEN; }',
    '};',
  ].join('\n'));

  const env = {
    ...process.env,
    TZ: 'UTC',
    CAREER_OPS_ROOT: dir,
    CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
    CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
    CAREER_OPS_FOLLOWUPS_LOCK: join(dir, 'followups.lock'),
    CAREER_OPS_PROFILE: DEFAULT_CADENCE_PROFILE,
  };
  const out = execFileSync(process.execPath,
    ['--import', pathToFileURL(freeze).href, join(ROOT, 'followup-cadence.mjs'), '--json'],
    { cwd: ROOT, env, encoding: 'utf-8', timeout: 30000 });
  const result = JSON.parse(out);

  if (result.metadata?.analysisDate === '2026-08-20') pass('the engine ran at the frozen date');
  else fail(`the engine did not run at the frozen date: analysisDate ${result.metadata?.analysisDate}`);

  const got = result.entries.map(e => e.company);
  if (JSON.stringify(got) === JSON.stringify(EXPECTED)) {
    pass('urgent first, then overdue from most to least overdue, then waiting soonest due first');
  } else {
    fail(`entries order: expected ${JSON.stringify(EXPECTED)}, got ${JSON.stringify(got)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
