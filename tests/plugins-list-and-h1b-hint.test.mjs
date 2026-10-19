// `plugins.mjs available` names who publishes each community plugin, and
// `plugins.mjs run h1b-sponsor` says why it finds nothing instead of printing a
// bare "0 found, 0 new".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { registryAuthor } = await import(pathToFileURL(join(ROOT, 'plugins', '_registry.mjs')).href);

function plugins(args, { env = {}, dataRoot } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.CAREER_OPS_ROOT;
  if (!('H1B_API_BASE' in env)) delete childEnv.H1B_API_BASE;
  if (dataRoot) childEnv.CAREER_OPS_ROOT = dataRoot;
  return spawnSync(process.execPath, [join(ROOT, 'plugins.mjs'), ...args], { cwd: ROOT, env: childEnv, encoding: 'utf8' });
}

test('registryAuthor prefers author, then the GitHub repo owner', () => {
  assert.equal(registryAuthor({ author: 'fabrikam-dev', repo: 'https://github.com/contoso/career-ops-plugin-x' }), 'fabrikam-dev');
  assert.equal(registryAuthor({ repo: 'https://github.com/contoso/career-ops-plugin-x' }), 'contoso');
  assert.equal(registryAuthor({ author: '  ', repo: 'https://github.com/contoso/career-ops-plugin-x.git' }), 'contoso');
  assert.equal(registryAuthor({ repo: 'https://gitlab.example/contoso/x' }), null);
  assert.equal(registryAuthor({}), null);
});

test('available never prints "by undefined"', () => {
  const r = plugins(['available']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Community plugins approved/);
  assert.doesNotMatch(r.stdout, /by undefined/);
});

function h1bDataRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'co-h1b-hint-'));
  mkdirSync(join(dir, 'config'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'config', 'plugins.yml'), 'plugins:\n  h1b-sponsor:\n    enabled: true\n');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n## Pendientes\n\n## Procesadas\n');
  return dir;
}

test('h1b-sponsor run points at the install command when no index is installed', (t) => {
  const dir = h1bDataRoot();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = plugins(['run', 'h1b-sponsor', '--dry-run'], { dataRoot: dir, env: { H1B_INDEX_PATH: join(dir, 'no-index.jsonl.gz') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 found, 0 new/);
  assert.match(r.stdout, /node plugins\/h1b-sponsor\/install-h1b-index\.mjs/);
  assert.match(r.stdout, /node plugins\/h1b-sponsor\/check\.mjs/);
});

test('h1b-sponsor run skips the install hint when an index is present', (t) => {
  const dir = h1bDataRoot();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const index = join(dir, 'index.jsonl.gz');
  writeFileSync(index, '');
  const r = plugins(['run', 'h1b-sponsor', '--dry-run'], { dataRoot: dir, env: { H1B_INDEX_PATH: index } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /install-h1b-index/);
  assert.match(r.stdout, /node plugins\/h1b-sponsor\/check\.mjs/);
});

test('h1b-sponsor run skips the install hint when H1B_API_BASE is set', (t) => {
  const dir = h1bDataRoot();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = plugins(['run', 'h1b-sponsor', '--dry-run'], {
    dataRoot: dir,
    env: { H1B_INDEX_PATH: join(dir, 'no-index.jsonl.gz'), H1B_API_BASE: 'https://h1b.example' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /install-h1b-index/);
});
