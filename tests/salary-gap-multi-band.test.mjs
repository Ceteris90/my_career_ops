// tests/salary-gap-multi-band.test.mjs — an advertised_comp with a country
// label, a trailing "+ equity", or one band per country used to parse as null
// and drop the posting out of salary-gap.mjs's analysis. All companies and
// amounts below are invented.
//
// Run: node --test tests/salary-gap-multi-band.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAdvertisedBands, reportToObservation } from '../salary-gap.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'salary-gap.mjs');

const TWO_BANDS = 'Canada: CA$123,000–CA$137,000 + equity / United States: $112,000–$128,000 + equity';

const report = (advertisedComp) => [
  '# Eval: Acme — Platform Engineer',
  '',
  '## Machine Summary',
  '',
  '```yaml',
  'company: "Acme"',
  'role: "Platform Engineer"',
  `advertised_comp: "${advertisedComp}"`,
  '```',
  '',
].join('\n');

test('a label prefix is stripped before parsing', () => {
  const r = parseAdvertisedBands('United States: $112,000 - $128,000');
  assert.deepEqual(r.parsed, { min: 112000, max: 128000, mid: 120000 });
  assert.equal(r.band.label, 'United States');
  assert.equal(r.band.of, 1);
});

test('a trailing "+ equity" (and similar named extras) is stripped, prose is not', () => {
  assert.equal(parseAdvertisedBands('$112,000 - $128,000 + equity').parsed.mid, 120000);
  assert.equal(parseAdvertisedBands('$112,000 + bonus + RSUs').parsed.mid, 112000);
  assert.equal(parseAdvertisedBands('competitive + equity'), null);
  assert.equal(parseAdvertisedBands('$112,000 + relocation package'), null, 'unlisted extras stay unparseable');
});

test('several bands: the profile currency wins', () => {
  const r = parseAdvertisedBands(TWO_BANDS, { currency: 'CAD', country: 'United States' });
  assert.equal(r.currency, 'CAD');
  assert.equal(r.parsed.mid, 130000);
  assert.deepEqual([r.band.index, r.band.of, r.band.chosenBy], [1, 2, 'profile-currency']);
});

test('several bands: the profile country picks a band whose `$` names no currency', () => {
  const r = parseAdvertisedBands(TWO_BANDS, { currency: 'USD', country: 'United States' });
  assert.equal(r.parsed.mid, 120000);
  assert.equal(r.currency, null, 'a bare $ is never read as USD');
  assert.deepEqual([r.band.label, r.band.index, r.band.chosenBy], ['United States', 2, 'profile-country']);
});

test('several bands, no profile match: the first band naming its currency', () => {
  const r = parseAdvertisedBands('United States: $112,000–$128,000 / Germany: €90.000–€110.000', { currency: 'JPY' });
  assert.equal(r.currency, 'EUR');
  assert.equal(r.parsed.mid, 100000);
  assert.equal(r.band.chosenBy, 'first-with-currency');
});

test('a "/year" suffix is not mistaken for a band separator', () => {
  const r = parseAdvertisedBands('United States: $112k–$128k / year + equity');
  assert.equal(r.band.of, 1);
  assert.equal(r.parsed.mid, 120000);
});

test('reportToObservation: a multi-band value is parsed with the chosen band\'s currency, never a blend', () => {
  const r = reportToObservation(report(TWO_BANDS), '050', '2026-09-01', { currency: 'CAD' });
  assert.equal(r.observation.parsed.mid, 130000);
  assert.equal(r.observation.currency, 'CAD');
  assert.equal(r.observation.band.label, 'Canada');
  assert.equal(r.observation.amount, TWO_BANDS, 'the verbatim value is kept as the raw amount');
});

test('reportToObservation: values parseAmount already reads are untouched and carry no band', () => {
  const r = reportToObservation(report('80-90k EUR'), '051', '2026-09-01', { currency: 'USD' });
  assert.equal(r.observation.parsed.mid, 85000);
  assert.equal(r.observation.currency, 'EUR');
  assert.equal(r.observation.band, null);
});

test('CLI: the posting stays in the analysis and --summary names the chosen band', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-salary-bands-'));
  try {
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    mkdirSync(join(dataRoot, 'reports'), { recursive: true });
    mkdirSync(join(dataRoot, 'config'), { recursive: true });
    writeFileSync(join(dataRoot, 'config', 'profile.yml'), [
      'compensation:',
      '  target_range: "160k"',
      '  currency: "CAD"',
      'location:',
      '  country: "Canada"',
      '',
    ].join('\n'));
    writeFileSync(join(dataRoot, 'reports', '050-acme-2026-09-01.md'), report(TWO_BANDS));
    writeFileSync(join(dataRoot, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-09-01 | Acme | Platform Engineer | 4.0/5 | Applied | ❌ | [50](reports/050-acme-2026-09-01.md) | |',
      '',
    ].join('\n'));
    const env = { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PROFILE: '' };
    const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000, env });

    const json = run([]);
    assert.equal(json.status, 0, describeSpawn(json));
    const out = JSON.parse(json.stdout);
    const app = out.applications.find((a) => a.company === 'Acme');
    assert.ok(app?.advertised, `advertised missing: ${json.stdout}`);
    assert.equal(app.advertised.value, 130000);
    assert.equal(app.advertised.currency, 'CAD');
    assert.equal(app.advertised.band.chosenBy, 'profile-currency');
    assert.ok(!out.quality.unparseable.some((u) => u.type === 'advertised'), 'no longer reported as unparseable');

    const summary = run(['--summary']);
    assert.equal(summary.status, 0, describeSpawn(summary));
    assert.match(summary.stdout, /advertised band 1 of 2: "Canada: CA\$123,000–CA\$137,000 \+ equity" \(chosen by profile-currency\)/);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
