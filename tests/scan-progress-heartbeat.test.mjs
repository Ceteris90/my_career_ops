// scan.mjs prints a timestamped progress line on stderr every 25 sources, and
// after the last one, so a long --quiet or --json run is visibly alive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN = join(ROOT, 'scan.mjs');
const PARSER = join(ROOT, 'tests', 'fixtures', 'noc-board.mjs');

function scan(companyCount, flags) {
  const dir = mkdtempSync(join(tmpdir(), 'co-scan-progress-'));
  try {
    mkdirSync(join(dir, 'data'));
    const companies = Array.from({ length: companyCount }, (_, i) => [
      `  - name: Fabrikam Unit ${i + 1}`,
      `    careers_url: https://unit${i + 1}.example.invalid/jobs`,
      '    parser:',
      '      command: node',
      `      script: ${JSON.stringify(PARSER)}`,
    ].join('\n')).join('\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:\n  positive:\n    - "Engineer"\ntracked_companies:\n${companies}\njob_boards: []\n`);
    return spawnSync(process.execPath, [SCAN, '--dry-run', ...flags], {
      cwd: dir,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      timeout: 120_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LINE = /^\[\d{2}:\d{2}:\d{2}\] scan: (\d+)\/(\d+) sources done$/gm;

function progress(stderr) {
  return [...stderr.matchAll(LINE)].map(m => `${m[1]}/${m[2]}`);
}

test('--quiet still reports progress every 25 sources and at the end', () => {
  const run = scan(30, ['--quiet']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(progress(run.stderr), ['25/30', '30/30']);
  assert.doesNotMatch(run.stdout, /sources done/);
});

test('--json keeps stdout to the receipt and reports progress on stderr', () => {
  const run = scan(3, ['--json']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).version, 'careerops.scan.receipt@1');
  assert.deepEqual(progress(run.stderr), ['3/3']);
});
