import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A plugin run that throws was reported as "0 found, 0 new" and exit 0.
// An agent treating that as an empty inbox never sees the bad setting.

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'plugins.mjs');
const PLUGIN = join(ROOT, 'plugins.local', 'fixture-run');

function dataRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fixture-run-'));
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n');
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n');
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [CLI, 'run', 'fixture-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, CAREER_OPS_ROOT: root, NO_COLOR: '1' },
  });
}

test('a plugin run that rejects its settings exits 1 and does not claim zero jobs', (t) => {
  mkdirSync(PLUGIN, { recursive: true });
  t.after(() => rmSync(PLUGIN, { recursive: true, force: true }));
  writeFileSync(join(PLUGIN, 'manifest.json'), JSON.stringify({
    id: 'fixture-run',
    name: 'Fixture run',
    version: '0.0.0',
    apiVersion: 1,
    description: 'Throws unless settings.mode is list.',
    hooks: ['ingest'],
    requiredEnv: [],
    allowedHosts: [],
    humanInTheLoop: true,
    entry: 'index.mjs',
  }));
  writeFileSync(join(PLUGIN, 'index.mjs'), `export default { async ingest(ctx) {
  if (ctx.settings?.mode !== 'list') {
    throw new Error('settings.mode must be list. Set plugins.fixture-run.mode: list in config/plugins.yml.');
  }
  return [];
}};
`);

  const bad = dataRoot();
  t.after(() => rmSync(bad, { recursive: true, force: true }));
  writeFileSync(join(bad, 'config', 'plugins.yml'), 'plugins:\n  fixture-run:\n    enabled: true\n    mode: nope\n');
  const failed = run(bad);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /settings\.mode must be list/);
  assert.match(failed.stderr, /config\/plugins\.yml/);
  assert.doesNotMatch(failed.stdout, /0 found/);

  const good = dataRoot();
  t.after(() => rmSync(good, { recursive: true, force: true }));
  writeFileSync(join(good, 'config', 'plugins.yml'), 'plugins:\n  fixture-run:\n    enabled: true\n    mode: list\n');
  const ok = run(good);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0 found, 0 new/);
});
