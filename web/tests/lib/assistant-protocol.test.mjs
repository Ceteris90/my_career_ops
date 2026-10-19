import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantResponseDecoder } from '../../src/lib/assistant-protocol.mjs';

test('streamed timeout is failure even when it has visible text and an HTTP 200 stream', () => {
  const text = [], done = [];
  const wire = createAssistantResponseDecoder({ structured: true, onText: s => text.push(s), onDone: ok => done.push(ok) });
  const bytes = Buffer.from([
    { type: 'progress', text: 'PRIVATE TOOL OUTPUT <<act:setStatus {}>>' },
    { type: 'text', text: 'Career Ops stopped AGY. You can retry. 🙂' },
    { type: 'done', ok: false },
  ].map(JSON.stringify).join('\n'));
  for (const byte of bytes) wire.push(Buffer.from([byte]));
  wire.finish();
  assert.deepEqual(done, [false]);
  assert.deepEqual(text, ['Career Ops stopped AGY. You can retry. 🙂']);
});

test('completed action-only response stays separate from terminal metadata', () => {
  const text = [], done = [];
  const wire = createAssistantResponseDecoder({ structured: true, onText: s => text.push(s), onDone: ok => done.push(ok) });
  wire.push(Buffer.from(JSON.stringify({ type: 'text', text: '<<act:setProfile {}>>' }) + '\n' + JSON.stringify({ type: 'done', ok: true }) + '\n'));
  wire.finish();
  assert.deepEqual(text, ['<<act:setProfile {}>>']);
  assert.deepEqual(done, [true]);
});

test('truncated or malformed structured streams fail instead of looking ready', () => {
  for (const raw of ['{"type":"text","text":"Partial reply"}\n', '{bad}', 'null\n', '{"type":"done","ok":"yes"}\n']) {
    const wire = createAssistantResponseDecoder({ structured: true, onText: () => {}, onDone: () => {} });
    assert.throws(() => { wire.push(Buffer.from(raw)); wire.finish(); });
  }
});

test('plain-text responses remain compatible and flush split UTF-8', () => {
  const text = [];
  const wire = createAssistantResponseDecoder({ structured: false, onText: s => text.push(s), onDone: () => assert.fail('plain text has no terminal metadata') });
  for (const byte of Buffer.from('Plain reply 🙂')) wire.push(Buffer.from([byte]));
  wire.finish();
  assert.equal(text.join(''), 'Plain reply 🙂');
});
