import { copyFileSync, mkdtempSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, warn, linkNodeModules, rmSync, ROOT } from './helpers.mjs';

console.log('\n🧪 Testing updater .gitignore reconciliation after an old resolver was cached...');

const root = mkdtempSync(join(tmpdir(), 'co-updater-gitignore-cache-'));
try {
  for (const file of ['tracker-utils.mjs', 'tracker-parse.mjs', 'pipeline-lock.mjs', 'tracker-aliases.json']) {
    copyFileSync(join(ROOT, file), join(root, file));
  }
  const nodeModulesReason = linkNodeModules(root);
  writeFileSync(join(root, 'path-resolver.mjs'), [
    'export function getCareerOpsRoot() { return process.cwd(); }',
    'export function canonicalizeTrackerPath(path) { return path; }',
    '',
  ].join('\n'));

  if (nodeModulesReason) {
    warn(`cannot run the module-cache reproduction: ${nodeModulesReason}`);
  } else {
    const script = `
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      await import(pathToFileURL(root + '/path-resolver.mjs'));
      try {
        await import(pathToFileURL(root + '/tracker-utils.mjs'));
      } catch (error) {
        console.log(error.name + ': ' + error.message);
        process.exitCode = 1;
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    if (result.status === 0) {
      pass('tracker-utils loads after the pre-checkout path resolver was cached');
    } else {
      fail(`tracker-utils failed after the old resolver was cached: ${(result.stdout || result.stderr).trim()}`);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
