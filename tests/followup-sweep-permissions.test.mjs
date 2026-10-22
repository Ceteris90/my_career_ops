#!/usr/bin/env node
/**
 * scripts/followup-sweep.sh runs `claude -p` unattended. Headless Claude Code
 * denies every tool call that would need approval, so a bare `claude -p`
 * could not run followup-cadence.mjs or write the draft file, and the sweep
 * left no drafts behind. The script must grant exactly those calls, and must
 * not grant the scripts that record a follow-up as sent.
 *
 * Run: node test-all.mjs --only followup-sweep-permissions
 */

import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, ROOT, rmSync } from './helpers.mjs';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

console.log('\nfollowup-sweep.sh grants the tools the headless run needs');

const zshProbe = spawnSync('zsh', ['-c', 'exit 0'], { encoding: 'utf8' });
if (zshProbe.error?.code === 'ENOENT') {
  pass('sweep permission check skipped: zsh is not available (launchd sweep is macOS-only)');
} else if (zshProbe.error || zshProbe.status !== 0) {
  fail(`zsh probe failed before the sweep could run: error=${zshProbe.error} status=${zshProbe.status} stderr=${zshProbe.stderr}`);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'co-followup-sweep-perms-'));
  try {
    mkdirSync(join(dir, 'data'));
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'data', 'applications.md'), [
      '# Applications Tracker',
      '',
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-05 | Acme | Engineer | 4.0/5 | Applied | ❌ | — | Applied 2026-01-05 |',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'config', 'profile.yml'), 'follow_ups:\n  enabled: true\n');

    // The stub records its argv one per line and writes no draft, so the
    // sweep's macOS notification never fires.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const argvFile = join(dir, 'claude-argv');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}'\nexit 0\n`);
    chmodSync(join(bin, 'claude'), 0o755);

    const sweep = join(ROOT, 'scripts', 'followup-sweep.sh');
    const result = spawnSync('zsh', [sweep], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md'),
        CAREER_OPS_FOLLOWUPS: join(dir, 'data', 'follow-ups.md'),
        CAREER_OPS_PROFILE: join(dir, 'config', 'profile.yml'),
      },
      encoding: 'utf8',
      timeout: 30000,
    });

    if (result.status === 0) pass('sweep exits 0 with follow-ups on');
    else fail(`sweep exit ${result.status}: ${result.stdout}\n${result.stderr}`);

    if (!existsSync(argvFile)) {
      fail(`sweep did not start claude.\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    } else {
      const argv = readFileSync(argvFile, 'utf8').split('\n');
      const after = (flag) => {
        const i = argv.indexOf(flag);
        if (i === -1) return [];
        const values = [];
        for (const arg of argv.slice(i + 1)) {
          if (arg.startsWith('--')) break;
          values.push(arg);
        }
        return values;
      };
      const allowed = after('--allowedTools');

      if (argv[0] === '-p') pass('claude runs headless (-p)');
      else fail(`claude argv did not start with -p: ${JSON.stringify(argv.slice(0, 2))}`);

      if (after('--add-dir').includes(dir)) pass('--add-dir names the data root');
      else fail(`--add-dir does not name the data root ${dir}: ${JSON.stringify(after('--add-dir'))}`);

      if (allowed.includes('Bash(node followup-cadence.mjs *)')) pass('followup-cadence.mjs is allowed');
      else fail(`followup-cadence.mjs is not in --allowedTools: ${JSON.stringify(allowed)}`);

      // `//` anchors a permission path at the filesystem root; a single `/`
      // would anchor it at the working directory.
      const draftRule = new RegExp(`^Edit\\(/${escapeRe(join(dir, 'output'))}/followup-drafts-\\d{4}-\\d{2}-\\d{2}\\.md\\)$`);
      if (allowed.some((rule) => draftRule.test(rule))) pass('today\'s draft file under the data root may be written (absolute // rule)');
      else fail(`no absolute Edit rule for the draft file under ${dir}/output: ${JSON.stringify(allowed)}`);

      if (allowed.filter((rule) => rule.startsWith('Edit(')).length === 1) pass('exactly one Edit rule');
      else fail(`expected one Edit rule: ${JSON.stringify(allowed)}`);

      const recording = allowed.filter((rule) => /set-status|followup-seed|^Bash$|^Edit$|^Write/.test(rule));
      if (recording.length === 0) pass('nothing that records a follow-up as sent, and no blanket Bash/Edit/Write');
      else fail(`sweep grants more than drafting needs: ${JSON.stringify(recording)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
