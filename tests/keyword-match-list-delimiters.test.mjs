import assert from 'node:assert/strict';
import { analyzeCoverage, extractKeywords } from '../keyword-match.mjs';
import { fail, finish, pass } from './helpers.mjs';

console.log('\nkeyword-match: list delimiters');

try {
  const keywords = extractKeywords('## Keywords extracted\n\nSQL · Tableau · forecasting\n\n## Next\n');
  const result = analyzeCoverage(keywords, 'Built Tableau dashboards on SQL.');
  assert.deepEqual(keywords, ['SQL', 'Tableau', 'forecasting']);
  assert.equal(result.coveragePct, 67);
  pass('middle-dot separated keywords are scored independently');
} catch (error) {
  fail(`middle-dot separated keywords are scored independently: ${error.message}`);
}

finish();
