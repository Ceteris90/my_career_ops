// tests/openrouter-no-tools-prompt.test.mjs — the runner tells the model it has
// no tools (#5809).
//
// buildSystemPrompt() sends modes/_shared.md and modes/oferta.md, which are
// written for Claude Code and tell the model to navigate with Playwright, use
// WebFetch and Bash, and read cv.md. The runner's request carries no `tools`, so
// free models answered with tool calls and the runner found no score (23 replies,
// 0 scores). A runner note now comes first and says there are no tools.
//
// fetch() is captured, so no network is used.
//
// Run:  node --test tests/openrouter-no-tools-prompt.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SHARED = '# Shared rules\n\n| Playwright | Verify offers (browser_navigate + browser_snapshot) |';
const CTX = { shared: SHARED, profileMode: '# Profile', profile: 'candidate:\n  full_name: Test', cv: '# Test Candidate' };

/** Import a fresh copy of the runner against a throwaway data root. */
async function loadRunner(dataRoot, label) {
  const names = ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR', 'CAREER_OPS_MODEL', 'OPENROUTER_API_KEY'];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.CAREER_OPS_ROOT = dataRoot;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_MODEL;
  try {
    return await import(`${pathToFileURL(join(ROOT, 'openrouter-runner.mjs')).href}?no-tools=${label}`);
  } finally {
    for (const n of names) {
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
    }
  }
}

async function withRunner(label, body) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'career-ops-no-tools-'));
  try {
    await body(await loadRunner(dataRoot, label));
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('the system prompt says there are no tools, before the mode files', async () => {
  await withRunner('prompt', async (runner) => {
    const prompt = runner.buildSystemPrompt('# Mode: oferta\n\nnavigate with Playwright', CTX);
    const note = prompt.indexOf('you have no tools');
    assert.notEqual(note, -1, 'the system prompt has no no-tools note');
    assert.ok(note < prompt.indexOf(SHARED), 'the no-tools note comes after modes/_shared.md');
    assert.match(prompt, /Do not navigate, fetch, read files or run commands/);
    assert.match(prompt, /---DEAD_POSTING---/);
    assert.match(prompt, /needs_confirmation/);
  });
});

test('the request body carries no tools, pinned and rotated', async () => {
  for (const pinned of ['vendor/pinned-model:free', null]) {
    await withRunner(pinned ? 'pinned' : 'rotated', async (runner) => {
      const bodies = [];
      const realFetch = globalThis.fetch;
      const env = { model: process.env.CAREER_OPS_MODEL, key: process.env.OPENROUTER_API_KEY };
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, status: 200, json: async () => ({ data: [{ id: 'vendor/free-model:free', pricing: { prompt: '0', completion: '0' } }] }) };
        }
        bodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Score: 4/5' } }], usage: {} }) };
      };
      if (pinned) process.env.CAREER_OPS_MODEL = pinned;
      else delete process.env.CAREER_OPS_MODEL;
      process.env.OPENROUTER_API_KEY = 'test-key';
      try {
        await runner.callOpenRouter(runner.buildSystemPrompt('# Mode', CTX), 'Evaluate this job listing:\n\nJD');
      } finally {
        globalThis.fetch = realFetch;
        for (const [n, v] of [['CAREER_OPS_MODEL', env.model], ['OPENROUTER_API_KEY', env.key]]) {
          if (v === undefined) delete process.env[n];
          else process.env[n] = v;
        }
      }
      assert.equal(bodies.length, 1, 'expected one model request');
      assert.equal('tools' in bodies[0], false, 'the request body has a tools field');
      assert.match(JSON.stringify(bodies[0].messages[0]), /you have no tools/);
    });
  }
});
