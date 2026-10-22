// tests/self-test-registration.test.mjs — every root script that answers
// `--self-test` must be run by something.
//
// A `--self-test` block lives inside the script it checks, so test discovery
// (tests/**/*.test.mjs, #1440) never sees it. It runs only when someone names
// it: an entry in the `scripts` list in test-all.mjs, or a suite under tests/
// that spawns `<script> --self-test`. Forgetting that entry costs nothing
// visible. linkedin-join.mjs (43 checks) and validate-profile.mjs (14 checks)
// both shipped that way and were never run by CI, the same shape
// tests/root-tests-registration.test.mjs guards for root *-tests.mjs suites
// and that #3303 found for a root *.test.mjs.
//
// The rule, kept deliberately narrow so a mention can never read as a run:
//
//   declares a self-test   a tracked root-level .mjs whose source holds the
//                          string literal '--self-test' (its argv check).
//                          A comment or usage line without quotes does not.
//   reached by test-all    a non-comment line inside the `scripts` array is
//                          the entry `'<script> --self-test'`.
//   reached by a suite     a non-comment line of a tests/**/*.test.mjs names
//                          the script as a quoted string AND passes the
//                          quoted '--self-test' flag on that same line.
//
// Both directions of error are possible and the safe one is chosen: a suite
// that builds the flag or the filename some other way reads as unreachable,
// a false red resolved by registering the script in test-all.mjs.
import { readFileSync } from 'fs';
import { basename, join, relative, sep } from 'path';
import { trackedFiles } from '../lib/mjs-files.mjs';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs — every --self-test is run by something');

const SELF_TEST_FLAG = /['"`]--self-test['"`]/;
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const codeLines = (src) => src.split('\n').filter((line) => !isComment(line));

/** The `scripts` array of test-all.mjs, or null when it cannot be found. */
function scriptsBlock(harnessSrc) {
  const m = harnessSrc.match(/const scripts\s*=\s*\[([\s\S]*?)\n\];/);
  return m ? m[1] : null;
}

/** Whether test-all.mjs's `scripts` array registers `<name> --self-test`. */
function registeredInHarness(block, name) {
  const entry = `'${name} --self-test'`;
  return codeLines(block).some((line) => line.includes(entry));
}

/** Whether a test suite's source spawns `<name> --self-test` on one line. */
function spawnedBySuite(suiteSrc, name) {
  const quoted = [`'${name}'`, `"${name}"`, `\`${name}\``];
  return codeLines(suiteSrc).some((line) =>
    SELF_TEST_FLAG.test(line) && quoted.some((q) => line.includes(q)));
}

// The rule itself, against fixtures, before it grades the tree: a rule that
// accepts a comment would pass on any tree.
{
  const failures = [];
  const block = [
    "  { name: 'real.mjs --self-test', expectExit: 0 },",
    "  // { name: 'commented.mjs --self-test', expectExit: 0 },",
  ].join('\n');
  if (!registeredInHarness(block, 'real.mjs')) failures.push('a scripts entry was not read as a registration');
  if (registeredInHarness(block, 'commented.mjs')) failures.push('a commented-out scripts entry read as a registration');
  if (registeredInHarness(block, 'al.mjs')) failures.push('a filename suffix read as a registration');
  if (!spawnedBySuite("const r = run(NODE, ['x.mjs', '--self-test']);", 'x.mjs')) failures.push('a spawn line was not read as a run');
  if (spawnedBySuite("// run(NODE, ['x.mjs', '--self-test'])", 'x.mjs')) failures.push('a commented spawn read as a run');
  if (spawnedBySuite("import { f } from '../x.mjs';\nconst flag = '--self-test';", 'x.mjs')) failures.push('the name and the flag on different lines read as a run');
  if (failures.length === 0) pass('the reachability rule rejects comments, suffixes and split lines (6 fixtures)');
  else fail(`reachability rule fixtures failed:\n${failures.map((f) => `    ${f}`).join('\n')}`);
}

const harnessSrc = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const block = scriptsBlock(harnessSrc);
if (block === null) {
  fail('test-all.mjs has no `const scripts = [ ... ];` array — this guard is reading the wrong shape and would pass on any tree');
} else {
  const rootScripts = trackedFiles(ROOT, (rel) => rel.endsWith('.mjs') && !rel.includes('/') && rel !== 'test-all.mjs');
  const declaring = rootScripts
    .filter((abs) => SELF_TEST_FLAG.test(readFileSync(abs, 'utf-8')))
    .map((abs) => basename(abs));

  // An empty set means the scan looked nowhere, not that the tree is clean.
  if (declaring.length === 0) {
    fail(`no tracked root script declares --self-test (${ROOT}) — the scan did not find what it grades`);
  } else {
    const suites = trackedFiles(ROOT, (rel) => rel.split('/')[0] === 'tests' && rel.endsWith('.test.mjs'))
      .map((abs) => ({ rel: relative(ROOT, abs).split(sep).join('/'), src: readFileSync(abs, 'utf-8') }));

    const unreachable = declaring.filter((name) =>
      !registeredInHarness(block, name) && !suites.some((s) => spawnedBySuite(s.src, name)));

    if (unreachable.length === 0) {
      pass(`every root script with a --self-test is run by test-all.mjs or a tests/ suite (${declaring.length} checked)`);
    } else {
      fail(
        `${unreachable.length} --self-test block(s) are never run — no scripts entry in test-all.mjs and no tests/ suite spawns them:\n` +
          unreachable.map((n) => `    ${n}`).join('\n') +
          "\n  Add an entry to the `scripts` list in test-all.mjs: { name: '<file> --self-test', expectExit: 0 }",
      );
    }
  }
}
