// tests/test-queue.test.mjs — full test-all.mjs runs take turns (lib/test-queue.mjs).
//
// Each case points the queue at a lock of its own, so it never waits behind (or
// holds up) a real full run in another session.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { holdTestQueue } from '../lib/test-queue.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QUEUE = pathToFileURL(join(ROOT, 'lib', 'test-queue.mjs')).href;

/** A process that holds the queue for `holdMs`, logging when it held it. */
function holder(lockDir, holdMs, { env = {} } = {}) {
  const script = `
    import { holdTestQueue } from ${JSON.stringify(QUEUE)};
    await holdTestQueue({ retryMs: 20 });
    const start = Date.now();
    console.log('HELD ' + start);
    await new Promise((r) => setTimeout(r, ${holdMs}));
    console.log('DONE ' + Date.now());
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CAREER_OPS_TEST_QUEUE: '', CAREER_OPS_TEST_QUEUE_LOCK: lockDir, ...env },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => child.on('close', (status) => resolve({ status, out })));
  const held = new Promise((resolve) => {
    const look = () => (out.includes('HELD ') ? resolve() : setTimeout(look, 10));
    look();
  });
  return { child, done, held };
}

const span = (out) => ({
  start: Number(/HELD (\d+)/.exec(out)?.[1]),
  end: Number(/DONE (\d+)/.exec(out)?.[1]),
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-test-queue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'queue.lock');
}

test('a second full run waits until the first has finished', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir, 800);
  await first.held;
  const second = holder(lockDir, 50);
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.status, 0, a.out);
  assert.equal(b.status, 0, b.out);
  assert.ok(span(b.out).start >= span(a.out).end, `runs overlapped:\n${a.out}\n${b.out}`);
  assert.match(b.out, /another full test-all\.mjs run holds the queue \(pid \d+ in /);
  assert.match(b.out, /test queue free after \d+s/);
  assert.doesNotMatch(a.out, /holds the queue/, 'the first run had nothing to wait for');
});

test('a killed holder does not wedge the queue', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir, 60_000);
  await first.held;
  first.child.kill('SIGKILL');
  await first.done;
  const startedAt = Date.now();
  const second = await holder(lockDir, 10).done;
  assert.equal(second.status, 0, second.out);
  assert.ok(Date.now() - startedAt < 20_000, 'the dead holder was reclaimed, not waited out');
});

test('CAREER_OPS_TEST_QUEUE=0 runs without the queue', async (t) => {
  const lockDir = scratch(t);
  const env = { CAREER_OPS_TEST_QUEUE: '0', CAREER_OPS_TEST_QUEUE_LOCK: lockDir };
  assert.equal(await holdTestQueue({ env }), null);
  assert.equal(existsSync(lockDir), false);
});

test('the holder turns the queue off for what it starts, so a nested test-all does not wait for its parent', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir, 2_000);
  await first.held;
  // What the holder's children inherit: CAREER_OPS_TEST_QUEUE=0.
  const nested = holder(lockDir, 10, { env: { CAREER_OPS_TEST_QUEUE: '0' } });
  const n = await nested.done;
  assert.equal(n.status, 0, n.out);
  assert.ok(span(n.out).start < span((await first.done).out).end, 'the nested run did not wait');

  const env = { CAREER_OPS_TEST_QUEUE_LOCK: join(dirname(lockDir), 'own.lock') };
  const held = await holdTestQueue({ env });
  assert.ok(held);
  assert.equal(env.CAREER_OPS_TEST_QUEUE, '0');
});

test('a holder that never lets go ends the wait with a message naming it', async (t) => {
  const lockDir = scratch(t);
  const first = holder(lockDir, 5_000);
  t.after(() => first.child.kill());
  await first.held;
  const lines = [];
  await assert.rejects(
    holdTestQueue({
      env: { CAREER_OPS_TEST_QUEUE_LOCK: lockDir },
      log: (l) => lines.push(l),
      holderTimeoutMs: 300,
      retryMs: 20,
    }),
    (err) => /gave up after \d+ min waiting for the test queue/.test(err.message)
      && err.message.includes(`pid ${first.child.pid}`)
      && err.message.includes('CAREER_OPS_TEST_QUEUE=0'),
  );
  assert.equal(lines.length, 1);
});

test('a lock left by a run that no longer exists is taken over at once', async (t) => {
  const lockDir = scratch(t);
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 2 ** 30, started_at: new Date(0).toISOString() }));
  const env = { CAREER_OPS_TEST_QUEUE_LOCK: lockDir };
  const held = await holdTestQueue({ env, log: () => {} });
  assert.ok(held);
  const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf-8'));
  assert.equal(owner.pid, process.pid);
});
