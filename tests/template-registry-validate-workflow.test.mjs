// tests/template-registry-validate-workflow.test.mjs: the template registry gate
// must not run the code that a registry PR is allowed to change (#6010).
//
// Mirror of tests/plugin-registry-validate-workflow.test.mjs. The workflow used
// to check out the pull request and run `node validate-template-registry.mjs`
// from that checkout, so a PR that added one registry entry could also edit the
// validator (or lib/templates-registry.mjs) so that it always exits 0.
//
// The fix runs the validator from a second checkout of the BASE branch. This
// validator defaults its root to its own directory, so the workflow must also
// pass `--root .` to point it at the PR's files; without that the base copy
// would validate the base registry and the gate would pass vacuously.
//
// Run:  node --test tests/template-registry-validate-workflow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';
import { ROOT } from './helpers.mjs';

const text = readFileSync(join(ROOT, '.github/workflows/template-registry-validate.yml'), 'utf8');
const wf = load(text);
const steps = wf.jobs.validate.steps;
const checkouts = steps.filter(s => String(s.uses || '').startsWith('actions/checkout@'));
const runs = steps.filter(s => typeof s.run === 'string');

// ── 1. The workflow ──────────────────────────────────────────────────────

test('keeps its security posture: pull_request, contents: read, no secrets', () => {
  assert.deepEqual(Object.keys(wf.on || wf[true] || {}), ['pull_request']);
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.ok(!/\bsecrets\./.test(text), 'the job must not reference any secret');
  assert.ok(!/GITHUB_TOKEN/.test(text), 'the job must not hand the token to a step');
});

test('checks the base branch out beside the PR checkout', () => {
  const base = checkouts.filter(s => s.with && s.with.path === 'base');
  assert.equal(base.length, 1, 'exactly one checkout into base/');
  assert.equal(base[0].with.ref, '${{ github.base_ref }}');
  const pr = checkouts.filter(s => !(s.with && s.with.path));
  assert.equal(pr.length, 1);
  assert.ok(!pr[0].with || !pr[0].with.ref, 'the root checkout must stay the PR merge ref');
  assert.ok(steps.indexOf(pr[0]) < steps.indexOf(base[0]), 'checkout the PR first, then base/');
});

test('runs the base validator against the PR checkout', () => {
  const invocations = runs.flatMap(s => s.run.split('\n')).filter(l => l.includes('validate-template-registry.mjs'));
  assert.ok(invocations.length >= 1);
  for (const line of invocations) {
    assert.match(line.trim(), /^node base\/validate-template-registry\.mjs\b/, `must run the base copy: ${line.trim()}`);
    assert.match(line, /--root \.(\s|$)/, `must point --root at the PR checkout: ${line.trim()}`);
  }
});

test('runs nothing from the PR checkout', () => {
  for (const s of runs) {
    for (const line of s.run.split('\n')) {
      const t = line.trim();
      if (!/^(node|npm|npx|bash|sh|python3?)\b/.test(t)) continue;
      assert.match(t, /^node base\//, `only base/ code may run: ${t}`);
    }
  }
});

test('pins every action to a full commit SHA', () => {
  const uses = steps.map(s => s.uses).filter(Boolean);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `unpinned action: ${u}`);
});

// ── 2. The validator behaves as the workflow assumes ─────────────────────

const VALIDATOR = join(ROOT, 'validate-template-registry.mjs');
const dirs = [];
function prCheckout(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'co-tpl-pr-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'templates-registry'));
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, 'templates-registry', f), body);
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('the base validator judges the directory --root names', () => {
  const bad = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const r = run(VALIDATOR, '--root', bad);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /oops/);
  assert.equal(run(VALIDATOR, '--root', prCheckout()).status, 0, 'an empty registry is valid');
});

test('without --root the validator judges its own directory, which is why the workflow passes it', () => {
  const bad = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const withoutRoot = spawnSync(process.execPath, [VALIDATOR], { cwd: bad, encoding: 'utf8' });
  assert.equal(withoutRoot.status, 0, 'cwd is ignored: the base registry is what was checked');
});

test('a validator rewritten inside the PR is not the one that runs', () => {
  const pr = prCheckout({ 'evil.json': JSON.stringify({ name: 'oops', id: 'evil' }) });
  const tampered = join(pr, 'validate-template-registry.mjs');
  writeFileSync(tampered, 'console.log("ok");\n');
  assert.equal(run(tampered, '--root', pr).status, 0, 'the PR copy passes anything');
  assert.equal(run(VALIDATOR, '--root', pr).status, 1, 'the base copy still rejects the entry');
});
