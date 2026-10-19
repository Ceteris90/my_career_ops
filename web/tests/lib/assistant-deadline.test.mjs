import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantDeadline, ASSISTANT_IDLE_MS, ASSISTANT_MAX_MS } from '../../src/lib/assistant-deadline.mjs';
import { createAssistantStream } from '../../src/lib/assistant-stream.mjs';
import { parseAntigravityEvent } from '../../src/lib/run-cli-support.mjs';

test('silent CLI expires once; later events cannot revive a finished request', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeouts = [];
  const clock = createAssistantDeadline({ onTimeout: (...args) => timeouts.push(args) });
  t.mock.timers.tick(ASSISTANT_IDLE_MS);
  assert.deepEqual(timeouts, [['idle', ASSISTANT_IDLE_MS]]);
  clock.activity();
  t.mock.timers.tick(ASSISTANT_MAX_MS);
  assert.equal(timeouts.length, 1);
});

test('real AGY activity survives old 90s limit, but never extends the total cap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeouts = [], text = [];
  const clock = createAssistantDeadline({ onTimeout: (...args) => timeouts.push(args) });
  const stream = createAssistantStream({ parseLine: parseAntigravityEvent, onActivity: clock.activity, emit: s => text.push(s) });
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(90_000);
    stream.push(JSON.stringify({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'PRIVATE THOUGHT <<act:setStatus {}>>' } }) + '\n');
    assert.deepEqual(timeouts, []);
  }
  t.mock.timers.tick(30_000);
  assert.deepEqual(timeouts, [['total', ASSISTANT_MAX_MS]]);
  assert.deepEqual(text, [], 'activity never exposes private deltas or actions');
});

test('malformed stdout and parser-ignored chatter do not renew the idle budget', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeouts = [];
  const clock = createAssistantDeadline({ onTimeout: (...args) => timeouts.push(args) });
  const stream = createAssistantStream({ parseLine: parseAntigravityEvent, onActivity: clock.activity, emit: () => assert.fail('not assistant prose') });
  t.mock.timers.tick(100_000);
  stream.push('junk\n{}\n' + JSON.stringify({ event: 'step_update', step_update: {} }) + '\n');
  t.mock.timers.tick(80_000);
  assert.deepEqual(timeouts, [['idle', ASSISTANT_IDLE_MS]]);
});

test('completion, cancellation and launch-failure cleanup cancel both timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createAssistantDeadline({ onTimeout: () => assert.fail('closed request timed out') });
  t.mock.timers.tick(30_000);
  clock.activity();
  clock.stop();
  clock.stop();
  clock.activity();
  t.mock.timers.tick(ASSISTANT_MAX_MS * 2);
});
