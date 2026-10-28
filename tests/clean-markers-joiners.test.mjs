import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INPUT = ['👨‍💻', '❤️', 'می‌خواهم', 'क्‍ष'].join('\n') + '\n';

for (const mode of ['audit', 'clean']) {
  test(`${mode} --keep-script-joiners preserves script-significant joiners`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'career-ops-clean-markers-joiners-'));
    const file = join(dir, 'input.md');
    writeFileSync(file, INPUT);
    try {
      const result = spawnSync(process.execPath, [join(ROOT, 'clean-markers.mjs'), mode, '--keep-script-joiners', file], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      assert.equal(result.error, undefined, `spawn failed: ${result.error?.message}`);
      assert.equal(result.signal, null, `process was killed by ${result.signal}`);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.equal(readFileSync(file, 'utf8'), INPUT);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    }
  });
}
