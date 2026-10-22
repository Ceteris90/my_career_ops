// tests/keyword-match-backtick-wrap.test.mjs — keyword cleanup should strip
// wrapping backticks from list items without removing interior backticks.
import assert from 'node:assert/strict';
import { extractKeywords } from '../keyword-match.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nkeyword-match: backtick-wrapped items');

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

const block = (body) => `## Keywords extracted\n\n${body}\n\n## Next\n`;

check('strips symmetric wrapping backticks from list items', () => {
  const report = block('- `Python`, ``Kubernetes``, ```CI/CD```');
  assert.deepEqual(extractKeywords(report), ['Python', 'Kubernetes', 'CI/CD']);
});

check('strips one-sided wrapping backticks from copied markdown fragments', () => {
  const report = block('- `Python\n- Kubernetes`\n- ``CI/CD');
  assert.deepEqual(extractKeywords(report), ['Python', 'Kubernetes', 'CI/CD']);
});

check('keeps interior backticks untouched', () => {
  const report = block('- `node` and `bun` runtimes');
  assert.deepEqual(extractKeywords(report), ['node` and `bun` runtimes']);
});
