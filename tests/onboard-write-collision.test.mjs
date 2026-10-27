import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'onboard-write.mjs');
const ANSWERS = {
  candidate: { full_name: 'Avery Quinn', email: ['avery.quinn', 'example.test'].join('@'), location: 'Denver, CO' },
  target_roles: ['Data Analyst'],
  compensation: { target_range: '$95K-120K', currency: 'USD' },
  location: { country: 'United States', city: 'Denver', timezone: 'America/Denver' },
  spend_tier: 'economy',
  portals: { positive: ['Data Analyst'], negative: ['Junior'], countries: ['United States'] },
};

for (const [only, rel] of [['profile', 'config/profile.yml'], ['portals', 'portals.yml']]) {
  test(`onboarding keeps a ${only} created after its initial existence check`, () => {
    const root = mkdtempSync(join(tmpdir(), 'onboard-collision-'));
    try {
      const target = join(root, rel);
      const answers = join(root, 'answers.json');
      const winnerAnswers = join(root, 'winner.json');
      const expected = join(root, 'winning-bytes');
      const preload = join(root, 'concurrent-writer.mjs');
      writeFileSync(answers, JSON.stringify(ANSWERS));
      writeFileSync(winnerAnswers, JSON.stringify({ ...ANSWERS, candidate: { ...ANSWERS.candidate, full_name: 'Morgan Lee' }, portals: { ...ANSWERS.portals, positive: ['Research Scientist'] } }));
      // Start a second real CLI at the first writer's mkdir, after it has
      // already planned to create the missing config. Neither uses --force.
      writeFileSync(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
const mkdir = fs.mkdirSync;
let fired = false;
fs.mkdirSync = (path, ...args) => {
  if (!fired && String(path) === ${JSON.stringify(dirname(target))}) {
    fired = true;
    const result = spawnSync(process.execPath, ${JSON.stringify([SCRIPT, '--answers', winnerAnswers, '--target', root, '--only', only])}, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'concurrent CLI failed');
    fs.writeFileSync(${JSON.stringify(expected)}, fs.readFileSync(${JSON.stringify(target)}));
  }
  return mkdir(path, ...args);
};
syncBuiltinESMExports();
`);
      const env = { ...process.env };
      for (const key of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_PROFILE', 'CAREER_OPS_PORTALS', 'NODE_OPTIONS']) delete env[key];
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, SCRIPT, '--answers', answers, '--target', root, '--only', only], { env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, describeSpawn(result));
      assert.ok(existsSync(expected), 'the second CLI actually completed during the race');
      assert.equal(readFileSync(target, 'utf8'), readFileSync(expected, 'utf8'), 'the completed configuration must remain byte-identical');
      const output = JSON.parse(result.stdout);
      assert.ok(output.kept.includes(rel));
      assert.equal(output.written.includes(rel), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
