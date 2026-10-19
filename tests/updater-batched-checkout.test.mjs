/**
 * updater-batched-checkout.test.mjs — apply() checked system paths out one git
 * process per manifest entry (~360 per update). checkoutSystemPathsBatched()
 * plans the skips from one listing of the target tree and checks the rest out
 * in a few argv-bounded runs; apply() falls back to the per-path loop if any
 * run fails.
 *
 * Driven against a throwaway repo through the ctx `git` seam, the same way
 * updater-local-system-edits.test.mjs drives the per-path rules.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { pass, fail, makeUpdaterRepo } from './helpers.mjs';
import { planSystemCheckout, checkoutSystemPathsBatched } from '../update-system.mjs';

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

const check = (ok, name, detail = '') => (ok ? pass(name) : fail(detail ? `${name} — ${detail}` : name));

// --- planning from the tree listing ----------------------------------------
{
  const upstream = ['modes/a.md', 'modes/b.md', 'docs/x.md', 'kept/only.md', 'tool.mjs', 'pinned.mjs'];
  const plan = planSystemCheckout(
    ['modes/', 'docs/', 'gone/', 'kept/', 'tool.mjs', 'removed.mjs', 'pinned.mjs'],
    ['modes/b.md', 'kept/only.md', 'pinned.mjs'],
    upstream,
  );
  check(JSON.stringify(plan.checkout) === JSON.stringify(['modes/', 'docs/', 'tool.mjs']),
    'paths with upstream content left to check out are batched, a partly preserved directory included', JSON.stringify(plan));
  check(JSON.stringify(plan.absent) === JSON.stringify(['gone/', 'removed.mjs']),
    'a directory or file absent from the target tree is the absent-upstream skip', JSON.stringify(plan));
  check(JSON.stringify(plan.preserved) === JSON.stringify(['kept/', 'pinned.mjs']),
    'a directory whose upstream files are all preserved, and a preserved file, are skipped', JSON.stringify(plan));

  const prefix = planSystemCheckout(['mode/'], [], ['modes/a.md']);
  check(JSON.stringify(prefix.absent) === JSON.stringify(['mode/']), 'a name prefix is not a parent directory', JSON.stringify(prefix));
}

// --- the batched checkout on a real repo ------------------------------------
function makeRepo(fileCount) {
  const { dir, g } = makeUpdaterRepo({ prefix: 'co-batched-checkout-' });
  fixtures.push(dir);
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'lib'), { recursive: true });
  const files = [];
  for (let i = 0; i < fileCount; i++) {
    const file = `lib/module-${String(i).padStart(4, '0')}-${'with-a-long-name-'.repeat(3)}.mjs`;
    writeFileSync(join(dir, file), `old ${i}\n`);
    files.push(file);
  }
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'old pdf\n');
  writeFileSync(join(dir, 'modes', 'mine.md'), 'old mine\n');
  g('add', '-A');
  g('commit', '-qm', 'installed');
  const installed = g('rev-parse', 'HEAD');
  for (let i = 0; i < fileCount; i++) writeFileSync(join(dir, files[i]), `new ${i}\n`);
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'new pdf\n');
  writeFileSync(join(dir, 'modes', 'mine.md'), 'new mine\n');
  g('add', '-A');
  g('commit', '-qm', 'upstream');
  const target = g('rev-parse', 'HEAD');
  g('checkout', '-q', installed);
  // The user's own edit to a file the update keeps out.
  writeFileSync(join(dir, 'modes', 'mine.md'), 'my edit\n');
  const upstreamFiles = g('ls-tree', '-r', '--name-only', '-z', target).split('\0').filter(Boolean);
  return { dir, g, files, target, upstreamFiles };
}

{
  // 300 long file entries: well past one argv budget, so this also covers the runs.
  const fx = makeRepo(300);
  const calls = [];
  const git = (...args) => { calls.push(args); return fx.g(...args); };
  const updatePaths = [...fx.files, 'modes/', 'gone/'];
  const result = checkoutSystemPathsBatched(updatePaths, ['modes/mine.md'], fx.upstreamFiles, fx.target, { git });

  const checkouts = calls.filter((a) => a[0] === 'checkout');
  check(checkouts.length >= 2 && checkouts.length <= 5,
    `${updatePaths.length} manifest entries take ${checkouts.length} checkout runs, not one each`);
  check(checkouts.every((a) => a.join(' ').length < 9000), 'every run stays within the argv budget');
  check(checkouts.every((a) => a.includes(':(exclude)modes/mine.md')), 'every run carries the preserved-file exclusions');
  check(JSON.stringify(result.skipped) === JSON.stringify(['gone/']), 'the path absent upstream is reported as skipped', JSON.stringify(result.skipped));
  check(result.updated.length === fx.files.length + 1, 'every other path is reported updated');
  check(readFileSync(join(fx.dir, fx.files[0]), 'utf-8') === 'new 0\n' && readFileSync(join(fx.dir, fx.files[299]), 'utf-8') === 'new 299\n',
    'files in the first and last run are at the target version');
  check(readFileSync(join(fx.dir, 'modes', 'pdf.md'), 'utf-8') === 'new pdf\n', 'a directory entry is checked out');
  check(readFileSync(join(fx.dir, 'modes', 'mine.md'), 'utf-8') === 'my edit\n', "the preserved file keeps the user's edit");
  check(!existsSync(join(fx.dir, 'gone')), 'nothing is created for the absent path');
}

{
  // A run that fails reports every path it had started, for the caller's restore.
  const fx = makeRepo(300);
  let runs = 0;
  const git = (...args) => {
    if (args[0] === 'checkout' && ++runs === 2) throw new Error('simulated failure on the second run');
    return fx.g(...args);
  };
  const attempted = [];
  let threw = false;
  try {
    checkoutSystemPathsBatched(fx.files, [], fx.upstreamFiles, fx.target, { git, attempted });
  } catch {
    threw = true;
  }
  check(threw, 'a failed run throws, so apply() falls back to the per-path loop');
  check(attempted.length > 0 && attempted.length < fx.files.length && attempted[0] === fx.files[0],
    'attempted holds the paths of every run started, the failed one included', `${attempted.length} of ${fx.files.length}`);
}
