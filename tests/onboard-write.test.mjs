import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'onboard-write.mjs');
const TEMPLATE = yaml.load(readFileSync(join(ROOT, 'templates', 'portals.example.yml'), 'utf8'));

const FICTIONAL_EMAIL = ['avery.quinn', 'example.test'].join('@');

const ANSWERS = {
  candidate: {
    full_name: 'Avery Quinn',
    email: FICTIONAL_EMAIL,
    location: 'Denver, CO',
    linkedin: 'linkedin.com/in/avery-quinn-example',
  },
  target_roles: ['Data Analyst', 'Analytics Engineer'],
  compensation: { target_range: '$95K-120K', currency: 'USD', minimum: '$85K' },
  location: { country: 'United States', city: 'Denver', timezone: 'America/Denver' },
  spend_tier: 'economy',
  portals: {
    positive: ['Data Analyst', 'Analytics Engineer', 'BI Analyst'],
    negative: ['Junior', 'Data Entry'],
    countries: ['United States'],
  },
};

function run(answers, ...flags) {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-write-'));
  mkdirSync(join(dir, 'config'));
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify(answers));
  const env = { ...process.env };
  for (const k of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_PORTALS']) delete env[k];
  const res = spawnSync(process.execPath, [SCRIPT, '--answers', file, '--target', dir, ...flags], { encoding: 'utf8', env });
  return { dir, res, read: (p) => readFileSync(join(dir, p), 'utf8') };
}

function cleanup(dir) { rmSync(dir, { recursive: true, force: true }); }

test('writes the profile from answers and keeps the template comments', () => {
  const { dir, res, read } = run(ANSWERS);
  try {
    assert.equal(res.status, 0, res.stderr);
    const text = read('config/profile.yml');
    const p = yaml.load(text);
    assert.equal(p.candidate.full_name, 'Avery Quinn');
    assert.equal(p.candidate.email, FICTIONAL_EMAIL);
    assert.equal(p.candidate.location, 'Denver, CO');
    assert.equal(p.candidate.linkedin, 'linkedin.com/in/avery-quinn-example');
    assert.deepEqual(p.target_roles.primary, ['Data Analyst', 'Analytics Engineer']);
    assert.equal(p.compensation.target_range, '$95K-120K');
    assert.equal(p.compensation.minimum, '$85K');
    assert.equal(p.location.city, 'Denver');
    assert.equal(p.location.timezone, 'America/Denver');
    assert.equal(p.spend_tier, 'economy');
    assert.match(text, /^# Career-Ops Profile Configuration/);
    assert.ok(p.narrative, 'sections the answers do not cover stay in place');
  } finally { cleanup(dir); }
});

test('contact fields the user did not give are blanked, not left as the example person', () => {
  const { dir, res, read } = run(ANSWERS);
  try {
    assert.equal(res.status, 0, res.stderr);
    const p = yaml.load(read('config/profile.yml'));
    for (const key of ['phone', 'portfolio_url', 'github', 'twitter']) {
      assert.equal(p.candidate[key], '', `${key} should be blank`);
    }
    assert.doesNotMatch(JSON.stringify(p.candidate), /janesmith|Jane Smith|555-0123/);
  } finally { cleanup(dir); }
});

test('portals.yml gets the user titles, keeps the shipped negatives, and keeps every company', () => {
  const { dir, res, read } = run(ANSWERS);
  try {
    assert.equal(res.status, 0, res.stderr);
    const c = yaml.load(read('portals.yml'));
    assert.deepEqual(c.title_filter.positive, ['Data Analyst', 'Analytics Engineer', 'BI Analyst']);
    const neg = c.title_filter.negative;
    for (const kept of TEMPLATE.title_filter.negative) assert.ok(neg.includes(kept), `template negative "${kept}" was dropped`);
    assert.ok(neg.includes('Data Entry'));
    assert.equal(neg.filter((n) => n.toLowerCase() === 'junior').length, 1, 'duplicates are not added twice');
    assert.equal(c.tracked_companies.length, TEMPLATE.tracked_companies.length);
    assert.match(read('portals.yml'), /# -- Title filter --/);
  } finally { cleanup(dir); }
});

test('countries become an allow-list, and posting age defaults to 45 days', () => {
  const { dir, res, read } = run(ANSWERS);
  try {
    assert.equal(res.status, 0, res.stderr);
    const c = yaml.load(read('portals.yml'));
    assert.deepEqual(c.location_filter.always_allow, ['United States']);
    assert.deepEqual(c.location_filter.allow, ['United States']);
    assert.equal(c.location_filter.block, undefined);
    assert.equal(c.max_posting_age_days, 45);
  } finally { cleanup(dir); }
});

test('cities go to allow only, and max_posting_age_days 0 leaves the age filter off', () => {
  const answers = { ...ANSWERS, portals: { ...ANSWERS.portals, countries: [], cities: ['Berlin', 'Hamburg'], max_posting_age_days: 0 } };
  const { dir, res, read } = run(answers);
  try {
    assert.equal(res.status, 0, res.stderr);
    const c = yaml.load(read('portals.yml'));
    assert.deepEqual(c.location_filter.allow, ['Berlin', 'Hamburg']);
    assert.equal(c.location_filter.always_allow, undefined);
    assert.equal(c.max_posting_age_days, undefined);
  } finally { cleanup(dir); }
});

test('no location answer leaves location_filter off', () => {
  const answers = { ...ANSWERS, portals: { positive: ['Data Analyst'] } };
  const { dir, res, read } = run(answers);
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.equal(yaml.load(read('portals.yml')).location_filter, undefined);
  } finally { cleanup(dir); }
});

test('existing files are kept unless --force, and the summary says which', () => {
  const { dir, res } = run(ANSWERS);
  try {
    assert.equal(res.status, 0, res.stderr);
    writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive: ["Mine"]\n');
    const env = { ...process.env };
    delete env.CAREER_OPS_ROOT;
    const again = spawnSync(process.execPath, [SCRIPT, '--answers', join(dir, 'answers.json'), '--target', dir], { encoding: 'utf8', env });
    assert.equal(again.status, 0, again.stderr);
    const out = JSON.parse(again.stdout);
    assert.deepEqual(out.written, []);
    assert.deepEqual(out.kept.sort(), ['config/profile.yml', 'portals.yml']);
    assert.match(readFileSync(join(dir, 'portals.yml'), 'utf8'), /Mine/);
    const forced = spawnSync(process.execPath, [SCRIPT, '--answers', join(dir, 'answers.json'), '--target', dir, '--force'], { encoding: 'utf8', env });
    assert.equal(forced.status, 0, forced.stderr);
    assert.deepEqual(JSON.parse(forced.stdout).written.sort(), ['config/profile.yml', 'portals.yml']);
  } finally { cleanup(dir); }
});

test('a missing required answer exits 1, names the field, and writes nothing', () => {
  const answers = { ...ANSWERS, candidate: { ...ANSWERS.candidate, full_name: '' } };
  const { dir, res } = run(answers);
  try {
    assert.equal(res.status, 1);
    assert.match(res.stderr, /candidate\.full_name/);
    assert.equal(existsSync(join(dir, 'config', 'profile.yml')), false);
    assert.equal(existsSync(join(dir, 'portals.yml')), false);
  } finally { cleanup(dir); }
});

test('archetypes and narrative replace the example person, and proof points never carry over', () => {
  const answers = {
    ...ANSWERS,
    archetypes: [{ name: 'Product Analyst', level: 'Entry', fit: 'primary' }, { name: 'BI Developer', level: 'Entry', fit: 'adjacent' }],
    narrative: { headline: 'Analyst who ships dashboards people use', superpowers: ['SQL', 'Clear charts'] },
  };
  const { dir, res, read } = run(answers);
  try {
    assert.equal(res.status, 0, res.stderr);
    const p = yaml.load(read('config/profile.yml'));
    assert.deepEqual(p.target_roles.archetypes, answers.archetypes);
    assert.equal(p.narrative.headline, 'Analyst who ships dashboards people use');
    assert.equal(p.narrative.exit_story, '');
    assert.deepEqual(p.narrative.superpowers, ['SQL', 'Clear charts']);
    assert.deepEqual(p.narrative.proof_points, []);
    assert.doesNotMatch(read('config/profile.yml'), /Project Alpha|ML Engineer turned/);
  } finally { cleanup(dir); }
});

test('Remote or Hybrid as a location exits 1, since an allow-list entry admits every country', () => {
  for (const word of ['Remote', 'hybrid']) {
    const answers = { ...ANSWERS, portals: { ...ANSWERS.portals, countries: ['United States', word] } };
    const { dir, res } = run(answers);
    try {
      assert.equal(res.status, 1);
      assert.match(res.stderr, new RegExp(word, 'i'));
      assert.equal(existsSync(join(dir, 'portals.yml')), false);
    } finally { cleanup(dir); }
  }
});

test('AGENTS.md onboarding calls the writer and builds the finish from doctor', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  const first = agents.split('### First Run')[1].split('### Personalization')[0];
  const steps23 = first.split('#### Step 2')[1].split('#### Step 4')[0];
  assert.match(steps23, /node onboard-write\.mjs --answers/);
  assert.match(steps23, /do not edit `portals\.yml`[^.]*afterward/i);
  assert.match(steps23, /rerun with `--force`/);
  const step6 = first.split('#### Step 6')[1];
  assert.match(step6, /node doctor\.mjs/);
  assert.match(step6, /only[^.]*fail/i);
  assert.match(step6, /playwright install chromium/);
});
