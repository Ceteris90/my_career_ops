import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editTrackerIdentity } from '../lib/tracker-identity.mjs';
import { runTracker } from '../tracker.mjs';

const tracker = '# Applications\r\n\r\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\r\n|---|---|---|---|---|---|---|---|---|---|\r\n| 15 | 2026-10-25 | Fixture Alpha | Student | 4.1/5 | Evaluated | ❌ | [015](../reports/015.md) | keep | https://example.com |\r\n| 16 | 2026-10-25 | Other | Engineer | 4/5 | Applied | ❌ | — | untouched | — |\r\n';
const edit = { num: '15', company: 'Fixture Updated', role: 'AI Engineer', expectedCompany: 'Fixture Alpha', expectedRole: 'Student' };

test('preserves other columns, rows, links and CRLF exactly', () => {
  assert.equal(editTrackerIdentity(tracker, edit), tracker.replace('| Fixture Alpha | Student |', '| Fixture Updated | AI Engineer |'));
});

test('uses customized column positions', () => {
  const input = '| Role | Location | Status | Company | # | Score |\n|---|---|---|---|---|---|\n| Student | Berlin | Evaluated | Fixture Alpha | 15 | 4.1/5 |\n';
  assert.equal(editTrackerIdentity(input, edit), input.replace('| Student |', '| AI Engineer |').replace('| Fixture Alpha |', '| Fixture Updated |'));
});

test('rejects missing, ambiguous and stale entries', () => {
  assert.throws(() => editTrackerIdentity(tracker, { ...edit, num: '99' }), { code: 'not-found' });
  assert.throws(() => editTrackerIdentity(tracker + tracker, edit), { code: 'conflict' });
  assert.throws(() => editTrackerIdentity(tracker, { ...edit, expectedRole: 'Old title' }), { code: 'conflict' });
});

test('rejects table-breaking input and malformed rows', () => {
  for (const value of ['', '  ', 'x|y', 'x\ny', 'x\ry', 'x\ty', 'x'.repeat(501)]) {
    assert.throws(() => editTrackerIdentity(tracker, { ...edit, company: value }), { code: 'invalid-input' });
    assert.throws(() => editTrackerIdentity(tracker, { ...edit, role: value }), { code: 'invalid-input' });
  }
  assert.throws(() => editTrackerIdentity(tracker.replace('| keep |', '| keep | extra |'), edit), { code: 'malformed-row' });
});

test('core command persists and reindexes, then refuses stale writes without touching files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'career-identity-'));
  const mdPath = join(dir, 'applications.md');
  writeFileSync(mdPath, tracker);
  const output = { write() {} };
  try {
    const args = ['--num', '15', '--company', 'Fixture Updated', '--role', 'AI Engineer', '--expect-company', 'Fixture Alpha', '--expect-role', 'Student'];
    assert.equal(await runTracker('edit', args, { mdPath, stdout: output, stderr: output }), 0);
    const expected = tracker.replace('| Fixture Alpha | Student |', '| Fixture Updated | AI Engineer |');
    assert.equal(readFileSync(mdPath, 'utf8'), expected);
    assert.equal(readFileSync(`${mdPath}.bak`, 'utf8'), tracker);
    let json = '';
    assert.equal(await runTracker('query', ['--id', '15', '--json'], { mdPath, stdout: { write(chunk) { json += chunk; } }, stderr: output }), 0);
    const row = JSON.parse(json)[0];
    assert.equal(row.company, 'Fixture Updated');
    assert.equal(row.role, 'AI Engineer');
    assert.equal(await runTracker('edit', args, { mdPath, stdout: output, stderr: output }), 1);
    assert.equal(readFileSync(mdPath, 'utf8'), expected);
    assert.equal(readFileSync(`${mdPath}.bak`, 'utf8'), tracker);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
