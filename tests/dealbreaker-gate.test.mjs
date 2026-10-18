// tests/dealbreaker-gate.test.mjs — a posting that breaks one of the
// candidate's own hard rules stops before Block A.
//
// Without the gate the agent noticed the broken rule in its first turn and
// still wrote the full A-H report, so a skip took as long as a real candidate
// (about 5 to 8 minutes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const oferta = readFileSync(join(ROOT, 'modes', 'oferta.md'), 'utf8');
const autoPipeline = readFileSync(join(ROOT, 'modes', 'auto-pipeline.md'), 'utf8');

function section(text, heading) {
  const start = text.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `missing section: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

const gate = section(oferta, '## Dealbreaker gate');

test('the gate runs after the blacklist gate and before any evaluation', () => {
  const at = oferta.indexOf('\n## Dealbreaker gate');
  const blacklistAt = oferta.indexOf('\n## Blacklist gate');
  assert.ok(blacklistAt >= 0, 'missing blacklist gate');
  assert.ok(blacklistAt < at);
  assert.ok(at < oferta.indexOf('\n## Step 0'));
  assert.ok(at < oferta.indexOf('\n## Block A'));
});

test('the gate reads the candidate\'s own rules and no new config', () => {
  for (const source of ['config/profile.yml', 'modes/_profile.md', 'modes/_custom.md', 'compensation.minimum']) {
    assert.ok(gate.includes(source), `gate does not read ${source}`);
  }
});

test('only a stated JD fact against a hard rule stops the evaluation', () => {
  assert.match(gate, /states?/i);
  assert.match(gate, /inferred/i);
  assert.match(gate, /scored preference/i, 'a scored preference must not count as a hard rule');
});

test('a hit writes nothing and lets the candidate override', () => {
  assert.match(gate, /stop before Block A/i);
  for (const artifact of ['report', 'tracker', 'CV']) assert.ok(gate.includes(artifact), `gate does not rule out a ${artifact}`);
  assert.match(gate, /anyway\?/);
  assert.match(gate, /explicit yes/i);
});

test('auto-pipeline applies the same gate before Step 1', () => {
  const step = section(autoPipeline, '## Step 0.7 — Dealbreaker gate');
  assert.ok(step.includes('modes/oferta.md'));
  assert.ok(autoPipeline.indexOf('## Step 0.7') < autoPipeline.indexOf('## Step 1'));
});
