import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, pass, fail } from './helpers.mjs';

const SCRIPT = join(ROOT, 'debrief-sync.mjs');
const SENTENCE = 'No on-site roles outside the home city';
const LOW_SENTENCE = 'Requires a clearance the candidate does not hold';
const REPORT_REL = 'reports/007-northwind-2026-01-05.md';

function check(label, fn) {
  try {
    fn();
    pass(label);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

function run(root, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_FOLLOWUPS: '',
      CAREER_OPS_PROFILE: '',
    },
  });
}

function summary(root, script, args) {
  return spawnSync(process.execPath, [join(ROOT, script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: '',
      CAREER_OPS_FOLLOWUPS: '',
      CAREER_OPS_PROFILE: '',
    },
  });
}

function snapshot(root) {
  const files = [
    'data/applications.md',
    REPORT_REL,
    'data/follow-ups.md',
    'data/contacts.tsv',
  ];
  const out = {};
  for (const rel of files) {
    const path = join(root, rel);
    out[rel] = existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  return out;
}

function reportText(score, decision, hardStops) {
  return `# Evaluation: Northwind — Platform Engineer

**Score:** ${score}/5
**URL:** https://jobs.northwind.example/platform
**Legitimacy:** High

## Machine Summary

\`\`\`yaml
company: "Northwind"
role: "Platform Engineer"
score: ${score}
final_decision: "${decision}"
hard_stops: ${hardStops}
soft_gaps: []
\`\`\`
`;
}

function writeFixture(root, {
  headerScore = '4.2',
  yamlScore = '4.2',
  trackerScore = '4.2',
  status = 'Interview',
  decision = 'Apply',
  hardStops = '[]',
  notes = 'screen done',
  followups = '# Follow-ups\n\n- next #7 2026-02-01 (set 2026-01-06)\n',
} = {}) {
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    `| 7 | 2026-01-05 | Northwind | Platform Engineer | ${trackerScore}/5 | ${status} | — | [7](${REPORT_REL}) | ${notes} |`,
    '',
  ].join('\n'));
  const report = reportText(headerScore, decision, hardStops).replace(
    `score: ${headerScore}`,
    `score: ${yamlScore}`,
  );
  writeFileSync(join(root, REPORT_REL), report);
  if (followups != null) writeFileSync(join(root, 'data', 'follow-ups.md'), followups);
}

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'career-ops-debrief-'));
}

function readRoot(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const fullArgs = [
  '--app', '7',
  '--dealbreaker', SENTENCE,
  '--contact-name', 'Avery Quinn',
  '--contact-email', 'avery.quinn@northwind.example',
  '--contact-type', 'interviewer',
  '--contact-name', 'Casey Bloom',
  '--contact-email', 'casey.bloom@northwind.example',
  '--next', '2026-12-15',
  '--why', 'panel debrief',
];

{
  const root = freshRoot();
  try {
    writeFixture(root);
    const before = summary(root, 'followup-cadence.mjs', ['--summary']);
    check('an overdue pin is OVERDUE before the debrief command', () => {
      assert.equal(before.status, 0, before.stderr);
      assert.match(before.stdout, /OVERDUE/);
    });

    const first = run(root, fullArgs);
    check('debrief command records the dealbreaker, both contacts, and the future pin', () => {
      assert.equal(first.status, 0, first.stderr || first.error?.message);
      const tracker = readRoot(root, 'data/applications.md');
      const report = readRoot(root, REPORT_REL);
      assert.match(report, /\*\*Score:\*\*\s*3\.4\/5/);
      assert.match(report, /^score:\s*3\.4$/m);
      assert.match(report, /final_decision:\s*"Skip"/);
      assert.match(report, /No on-site roles outside the home city/);
      assert.match(tracker, /\| 3\.4\/5 \|/);
      assert.match(tracker, /\| Interview \|/);
      assert.equal((tracker.match(/Dealbreaker: No on-site roles outside the home city/g) || []).length, 1);
      const contacts = summary(root, 'contacts.mjs', ['--summary']);
      assert.equal(contacts.status, 0, contacts.stderr);
      assert.match(contacts.stdout, /Avery Quinn/);
      assert.match(contacts.stdout, /interviewer/);
      assert.match(contacts.stdout, /Casey Bloom/);
      assert.match(contacts.stdout, /Northwind/);
      assert.match(contacts.stdout, /#7/);
      assert.match(contacts.stdout, /total: 2 contacts/);
      const tsv = readRoot(root, 'data/contacts.tsv');
      assert.match(tsv, /Avery Quinn\tNorthwind\tinterviewer\t\t\tavery\.quinn@northwind\.example/);
      assert.match(tsv, /Casey Bloom\tNorthwind\t\t\t\tcasey\.bloom@northwind\.example/);
      const cadence = summary(root, 'followup-cadence.mjs', ['--summary']);
      assert.equal(cadence.status, 0, cadence.stderr);
      assert.doesNotMatch(cadence.stdout, /OVERDUE/);
      assert.match(cadence.stdout, /2026-12-15/);
      const pins = readRoot(root, 'data/follow-ups.md');
      assert.equal((pins.match(/^- next #7 /gm) || []).length, 1);
      assert.match(pins, /^- next #7 2026-12-15 \(set \d{4}-\d{2}-\d{2}\) — panel debrief$/m);
    });

    if (first.status !== 0) {
      fail('a second run keeps the note, the contacts, the pin, and the pin set date: the first command did not exit 0');
    } else {
      const pinned = readRoot(root, 'data/follow-ups.md');
      const trackerAfter = readRoot(root, 'data/applications.md');
      const reportAfter = readRoot(root, REPORT_REL);
      const contactsAfter = readRoot(root, 'data/contacts.tsv');
      const second = run(root, fullArgs);
      check('a second run keeps the note, the contacts, the pin, and the pin set date', () => {
        assert.equal(second.status, 0, second.stderr);
        const body = JSON.parse(second.stdout);
        assert.equal(body.wrote, false);
        assert.equal(readRoot(root, 'data/applications.md'), trackerAfter);
        assert.equal(readRoot(root, REPORT_REL), reportAfter);
        assert.equal(readRoot(root, 'data/contacts.tsv'), contactsAfter);
        assert.equal(readRoot(root, 'data/follow-ups.md'), pinned);
        assert.equal((readRoot(root, 'data/applications.md').match(/Dealbreaker: No on-site roles outside the home city/g) || []).length, 1);
        const contacts = summary(root, 'contacts.mjs', ['--summary']);
        assert.match(contacts.stdout, /total: 2 contacts/);
        assert.match(contacts.stdout, /duplicates: none/);
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = freshRoot();
  try {
    writeFixture(root, {
      headerScore: '3.0',
      yamlScore: '3.0',
      trackerScore: '3.0',
      followups: null,
    });
    const result = run(root, ['--app', '7', '--dealbreaker', LOW_SENTENCE]);
    check('a score already at 3.0 stays 3.0 and still records the dealbreaker', () => {
      assert.equal(result.status, 0, result.stderr);
      const report = readRoot(root, REPORT_REL);
      const tracker = readRoot(root, 'data/applications.md');
      assert.match(report, /\*\*Score:\*\*\s*3\.0\/5/);
      assert.match(report, /^score:\s*3\.0$/m);
      assert.match(report, /final_decision:\s*"Skip"/);
      assert.match(report, /Requires a clearance the candidate does not hold/);
      assert.match(tracker, /\| 3\.0\/5 \|/);
      assert.equal((tracker.match(/Dealbreaker: Requires a clearance the candidate does not hold/g) || []).length, 1);
    });
    const trackerAfter = readRoot(root, 'data/applications.md');
    const again = run(root, ['--app', '7', '--dealbreaker', LOW_SENTENCE]);
    check('a second 3.0 run does not duplicate the dealbreaker note', () => {
      assert.equal(again.status, 0, again.stderr);
      assert.equal(JSON.parse(again.stdout).wrote, false);
      assert.equal(readRoot(root, 'data/applications.md'), trackerAfter);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = freshRoot();
  try {
    writeFixture(root, { trackerScore: '3.4', followups: null });
    const result = run(root, ['--app', '7', '--dealbreaker', SENTENCE]);
    check('a tracker score already at the cap is kept while the report drops to 3.4', () => {
      assert.equal(result.status, 0, result.stderr);
      const report = readRoot(root, REPORT_REL);
      const tracker = readRoot(root, 'data/applications.md');
      assert.match(report, /\*\*Score:\*\*\s*3\.4\/5/);
      assert.match(report, /^score:\s*3\.4$/m);
      assert.match(tracker, /\| 3\.4\/5 \|/);
      assert.match(tracker, /Dealbreaker: No on-site roles outside the home city/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function refuses(label, args, mutate = {}) {
  const root = freshRoot();
  try {
    writeFixture(root, mutate);
    const before = snapshot(root);
    const result = run(root, args);
    check(label, () => {
      assert.notEqual(result.status, 0, result.stdout);
      assert.deepEqual(snapshot(root), before);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

refuses('a weekday --next writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--next', 'Thursday']);
refuses('an impossible --next writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--next', '2026-02-31']);
refuses('an unknown flag writes nothing', ['--app', '7', '--dealbreaker', SENTENCE, '--bogus']);
refuses('a dealbreaker with a semicolon writes nothing', ['--app', '7', '--dealbreaker', 'No on-site; relocation']);
refuses('a header and YAML score mismatch writes nothing', ['--app', '7', '--dealbreaker', SENTENCE], {
  headerScore: '4.2',
  yamlScore: '3.9',
});
refuses('a tracker score that is neither the header nor the cap writes nothing', ['--app', '7', '--dealbreaker', SENTENCE], {
  trackerScore: '2.0',
});

check('Step 10 tells the agent how to record the call', () => {
  const mode = readFileSync(join(ROOT, 'modes/interview/debrief.md'), 'utf8');
  const step9 = mode.indexOf('## Step 9 — Write Session Transcript');
  const step10 = mode.indexOf('## Step 10 — Record the call on the tracker');
  const rules = mode.indexOf('## Rules');
  assert.ok(step9 > 0 && step10 > step9 && rules > step10);
  const section = mode.slice(step10, rules);
  for (const phrase of [
    'modes/_profile.md',
    'config/profile.yml',
    'Record this dealbreaker on the report and the tracker? [y/N]',
    '--dealbreaker',
    'Save this contact to data/contacts.tsv? [y/N]',
    '--next YYYY-MM-DD',
    'local calendar day',
    'today counts',
    'next week',
    'node debrief-sync.mjs',
    'node contacts.mjs --summary',
    'node followup-cadence.mjs --summary',
    'set-status.mjs',
    'Do not change status unless the user names a new status',
    'A second run of the same command is safe',
  ]) {
    assert.ok(section.includes(phrase), `missing ${phrase}`);
  }
});
