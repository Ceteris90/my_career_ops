/**
 * updater-local-edits-argv-limit.test.mjs — locallyModifiedSystemFiles() must
 * not over-report when the file list outgrows a Windows command line (#5103).
 *
 * The detector compares candidates file by file: against the update commit
 * that installed them, and against the blobs upstream published. Each of those
 * git calls used to name every candidate on argv. Windows caps a whole command
 * line at 32,767 characters, so an install with ~1,200 files changed since its
 * merge-base threw ENAMETOOLONG; the surrounding catch degrades to "keep every
 * candidate", and apply() then pinned ~135 untouched files at the old version
 * with a message blaming the user's edits.
 *
 * The runner below enforces that ceiling on every platform, so the property is
 * verified on macOS and Linux too, not only on a Windows runner.
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { locallyModifiedSystemFiles } from '../update-system.mjs';

const WINDOWS_ARGV_LIMIT = 32767;

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A fixture that cannot be removed must not change the suite's verdict.
    }
  }
});

// 400 names of ~100 characters: ~40 KB joined, comfortably past the ceiling.
const NAMES = Array.from({ length: 400 }, (_, i) =>
  `bulk/${String(i).padStart(3, '0')}-${'a-deliberately-long-fixture-filename-'.repeat(2)}x.md`);
const PATHS = ['bulk/'];

function makeRepo() {
  const repo = makeUpdaterRepo({ prefix: 'co-argv-limit-', includeRoot: true });
  fixtures.push(repo.dir);
  // Exact-content comparisons below; CRLF checkouts would muddy them.
  repo.g('config', 'core.autocrlf', 'false');
  mkdirSync(join(repo.dir, 'bulk'));
  writeAll(repo, 'v1');
  repo.g('add', '-A');
  repo.g('commit', '-qm', 'base');
  repo.g('branch', 'upstream');
  return repo;
}

function writeAll(repo, content) {
  for (const name of NAMES) writeFileSync(join(repo.dir, name), `${content}\n`);
}

function upstreamWrites(repo, content) {
  repo.g('checkout', '-q', 'upstream');
  writeAll(repo, content);
  repo.g('commit', '-qam', `upstream ${content}`);
  repo.g('checkout', '-q', 'main');
}

/** A git runner that fails the way spawnSync does on Windows. */
function limitedRunner(g, calls) {
  return (...args) => {
    const chars = args.join(' ').length + 'git '.length;
    calls.push({ sub: args.find((a) => !a.startsWith('-')), chars });
    if (chars > WINDOWS_ARGV_LIMIT) {
      const err = new Error('spawnSync git ENAMETOOLONG');
      err.code = 'ENAMETOOLONG';
      throw err;
    }
    return g(...args);
  };
}

console.log('\n🧪 Testing local-edit detection under the Windows argv ceiling (#5103)...');

if (NAMES.join(' ').length > WINDOWS_ARGV_LIMIT) {
  pass(`fixture names span ${NAMES.join(' ').length} chars, past the ${WINDOWS_ARGV_LIMIT} ceiling`);
} else {
  fail('fixture too small to exercise the argv ceiling');
}

// ── 1. Files an update commit installed, untouched since: nothing reported ──
//    Exercises the per-update-commit `diff --numstat <commit> -- <files>`.
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', 'chore: auto-update system files to v2');
  upstreamWrites(repo, 'v3');

  const calls = [];
  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, calls), root: repo.dir });
  if (atRisk.length === 0) {
    pass('an untouched install with 400 updated files reports no local edits');
  } else {
    fail(`#1 expected [], got ${atRisk.length} file(s) reported as local edits`);
  }
  const over = calls.filter((c) => c.chars > WINDOWS_ARGV_LIMIT);
  if (over.length === 0) {
    pass('no git call exceeds the Windows command-line ceiling');
  } else {
    fail(`#1 ${over.length} call(s) over the ceiling: ${over.map((c) => `${c.sub}(${c.chars})`).join(', ')}`);
  }
}

// ── 2. Same shape, one file genuinely edited locally: only that one ──
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  repo.g('checkout', 'upstream', '--', ...PATHS);
  repo.g('commit', '-qm', 'chore: auto-update system files to v2');
  upstreamWrites(repo, 'v3');
  const edited = NAMES[NAMES.length - 1];
  writeFileSync(join(repo.dir, edited), 'local fix\n');
  repo.g('commit', '-qam', 'local fix');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, []), root: repo.dir });
  if (atRisk.length === 1 && atRisk[0] === edited) {
    pass('a real local edit among 400 updated files is still the one reported');
  } else {
    fail(`#2 expected [${edited}], got ${atRisk.length} file(s)`);
  }
}

// ── 3. Files no update commit delivered, holding content upstream published ──
//    Exercises `diff --raw <ref> -- <undelivered>` and
//    `log --raw <range> -- <undelivered>`.
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  // The install adopted upstream's v2 by hand, not through an update commit.
  writeAll(repo, 'v2');
  repo.g('commit', '-qam', 'adopt upstream fix');
  upstreamWrites(repo, 'v3');

  const calls = [];
  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, calls), root: repo.dir });
  if (atRisk.length === 0) {
    pass('400 files holding content upstream published are not reported as local edits');
  } else {
    fail(`#3 expected [], got ${atRisk.length} file(s) reported as local edits`);
  }
  const over = calls.filter((c) => c.chars > WINDOWS_ARGV_LIMIT);
  if (over.length === 0) {
    pass('the raw diff/log comparison stays under the ceiling too');
  } else {
    fail(`#3 ${over.length} call(s) over the ceiling: ${over.map((c) => `${c.sub}(${c.chars})`).join(', ')}`);
  }
}

// ── 4. Same shape, one file holding content upstream never shipped ──
{
  const repo = makeRepo();
  upstreamWrites(repo, 'v2');
  writeAll(repo, 'v2');
  const edited = NAMES[0];
  writeFileSync(join(repo.dir, edited), 'local fix\n');
  repo.g('commit', '-qam', 'adopt upstream fix, plus one local edit');
  upstreamWrites(repo, 'v3');

  const atRisk = locallyModifiedSystemFiles(PATHS, 'upstream', { git: limitedRunner(repo.g, []), root: repo.dir });
  if (atRisk.length === 1 && atRisk[0] === edited) {
    pass('content upstream never shipped is still reported among 400 adopted files');
  } else {
    fail(`#4 expected [${edited}], got ${atRisk.length} file(s)`);
  }
}
