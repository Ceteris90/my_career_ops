#!/usr/bin/env node
// @ts-check
// templates.mjs — list, add and remove community template packs (#5951, #1778).
// The analog of plugins.mjs. A registered pack installs at its pinned SHA after
// validate-template-pack.mjs passes; templates.lock records what came from where.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadRegistry } from './lib/templates-registry.mjs';
import { installPack, installedPacks, removePack } from './lib/templates-install.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: node templates.mjs [list | available | add <id|owner/repo> [--sha <commit> --confirm] [--force] | remove <id> [--force]]';

function cmdList() {
  const packs = installedPacks(ROOT);
  if (!packs.length) { console.log('No template packs installed.'); return 0; }
  for (const p of packs) {
    const flag = p.modified.length ? `  ⚠️ ${p.modified.length} file(s) changed since install` : '';
    console.log(`${p.id.padEnd(20)} v${p.version}  ${String(p.sha).slice(0, 10)}  ${p.source}  ${p.files.length} file(s)${flag}`);
  }
  return 0;
}

function cmdAvailable() {
  const reg = loadRegistry(ROOT).packs;
  if (!reg.length) { console.log('No packs in the registry yet.'); return 0; }
  const have = new Set(installedPacks(ROOT).map((p) => p.id));
  for (const e of reg) {
    console.log(`${e.id.padEnd(20)} v${e.version}  ${e.themes} theme(s)  ${e.kind.join('+')}  ats=${e.ats}  ${e.sha.slice(0, 10)}${have.has(e.id) ? '  ✓ installed' : ''}`);
  }
  return 0;
}

async function cmdAdd(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--') && a !== '--sha'));
  const i = args.indexOf('--sha');
  const sha = i >= 0 ? args[i + 1] : null;
  const target = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--sha');
  if (!target) { console.error(USAGE); return 2; }
  const { safeClone } = await import('./plugin-install.mjs');
  const registered = loadRegistry(ROOT).packs.find((p) => p.id === target || p.name === target);
  let result;
  if (registered) {
    if (sha) { console.error('--sha applies to an unregistered owner/repo; a registered pack installs at its pinned commit.'); return 2; }
    result = installPack(ROOT, { entry: registered, clone: safeClone, force: flags.has('--force') });
  } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target) || target.startsWith('https://')) {
    if (!sha || !flags.has('--confirm')) {
      console.error(`"${target}" is not in the registry. To install it as unverified, pass --sha <40-hex commit> --confirm after reading its templates.`);
      return 2;
    }
    const repoUrl = target.startsWith('https://') ? target : `https://github.com/${target}`;
    result = installPack(ROOT, { repoUrl, sha, clone: safeClone, force: flags.has('--force') });
  } else {
    console.error(`No registered pack "${target}". Run \`node templates.mjs available\`.`);
    return 1;
  }
  console.log(`✓ installed ${result.id} v${result.version} (${result.source}, ${result.sha.slice(0, 10)}): ${result.files.length} file(s) in templates/${result.id}/`);
  return 0;
}

function cmdRemove(args) {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) { console.error(USAGE); return 2; }
  const res = removePack(ROOT, id, { force: args.includes('--force') });
  console.log(`✓ removed ${res.id}: ${res.removed.length} file(s)`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === '--help' || cmd === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
  try {
    let code;
    switch (cmd) {
      case 'list': case undefined: code = cmdList(); break;
      case 'available': code = cmdAvailable(); break;
      case 'add': code = await cmdAdd(rest); break;
      case 'remove': code = cmdRemove(rest); break;
      default: console.error(USAGE); code = 2;
    }
    process.exit(code);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
