// @ts-check
// lib/templates-install.mjs — install, list and remove template packs (#5951,
// #1778). The analog of plugin-install.mjs plus plugins/_lock.mjs, for passive
// data: it reads the files a validated pack declares and copies them into
// templates/<id>/, the one-level pack directory cv-templates.mjs already
// discovers (#3202). Nothing from the pack is executed.
//
// templates.lock is a USER-layer, gitignored file. Like plugins.lock it is
// tamper-evidence, not containment: it records a sha256 per installed file so
// `list` can say a file changed and `remove` can refuse to delete an edit.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listTemplates } from '../cv-templates.mjs';
import { validatePack } from '../validate-template-pack.mjs';

const LOCK_VERSION = 1;
const SHA_RE = /^[0-9a-f]{40}$/;
const GITHUB_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)$/;
const NAME_PREFIX = 'career-ops-template-';

export const lockPath = (root) => path.join(root, 'templates.lock');
const templatesDir = (root) => path.join(root, 'templates');
const sha256 = (buf) => 'sha256-' + createHash('sha256').update(buf).digest('hex');

/** Read templates.lock; an absent or unreadable file is an empty lock. */
export function readLock(root) {
  try {
    const p = JSON.parse(readFileSync(lockPath(root), 'utf8'));
    if (p && typeof p === 'object' && p.packs && typeof p.packs === 'object') return p;
  } catch { /* fall through */ }
  return { lockfileVersion: LOCK_VERSION, packs: {} };
}

function writeLock(root, lock) {
  lock.lockfileVersion = LOCK_VERSION;
  writeFileSync(lockPath(root), JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/** `https://github.com/<owner>/career-ops-template-<id>` -> `{url, id}`; throws otherwise. */
export function parseRepoUrl(arg) {
  const url = String(arg || '').replace(/\.git$/, '');
  const m = GITHUB_RE.exec(url);
  if (!m) throw new Error(`refusing a non-GitHub repo URL: ${arg} (expected https://github.com/<owner>/${NAME_PREFIX}<id>)`);
  if (!m[1].startsWith(NAME_PREFIX) || m[1].length === NAME_PREFIX.length) {
    throw new Error(`repo must be named "${NAME_PREFIX}<id>" (got "${m[1]}")`);
  }
  return { url, id: m[1].slice(NAME_PREFIX.length) };
}

/** Names a pack's templates would claim, per kind. */
function claims(pack) {
  const out = { cv: [], cover: [] };
  for (const t of pack.templates) {
    if (t.kind === 'cv' || t.kind === 'both') out.cv.push(t.id);
    if (t.kind === 'cover' || t.kind === 'both') out.cover.push(t.id);
  }
  return out;
}

function checkAgainstRegistry(entry, pack) {
  const themes = pack.templates.length;
  const kinds = new Set(pack.templates.flatMap((t) => (t.kind === 'both' ? ['cv', 'cover'] : [t.kind])));
  const problems = [];
  if (pack.id !== entry.id) problems.push(`id: registry "${entry.id}", pack.json "${pack.id}"`);
  if (pack.version !== entry.version) problems.push(`version: registry "${entry.version}", pack.json "${pack.version}"`);
  if (themes !== entry.themes) problems.push(`themes: registry ${entry.themes}, pack.json ${themes}`);
  if (pack.templates.every((t) => t.ats === true) !== entry.ats) problems.push(`ats: registry ${entry.ats}, pack.json disagrees`);
  if ([...kinds].sort().join() !== [...entry.kind].sort().join()) problems.push(`kind: registry ${JSON.stringify(entry.kind)}, pack.json ${JSON.stringify([...kinds])}`);
  if (problems.length) throw new Error(`the pack at the pinned commit disagrees with its registry entry:\n  ✗ ${problems.join('\n  ✗ ')}`);
}

/**
 * Install a pack. Pass a registry `entry` (its repo and sha are used) or a
 * `repoUrl` plus `sha` for an unregistered pack. `clone(url, sha)` returns a
 * temp directory holding the pack at exactly that commit.
 * @returns {{id: string, version: string, sha: string, source: string, files: string[]}}
 */
export function installPack(root, { entry = null, repoUrl = null, sha = null, clone, force = false }) {
  const url = entry ? entry.repo : repoUrl;
  const pin = entry ? entry.sha : sha;
  const source = entry ? 'registry' : 'unverified';
  const parsed = parseRepoUrl(url);
  if (!SHA_RE.test(pin || '')) throw new Error(`a 40-hex commit sha is required (got ${JSON.stringify(pin)})`);

  const dir = clone(parsed.url, pin);
  try {
    const problems = validatePack(dir);
    if (problems.length) throw new Error(`the pack failed validation:\n  ✗ ${problems.join('\n  ✗ ')}`);
    const pack = JSON.parse(readFileSync(path.join(dir, 'pack.json'), 'utf8'));
    if (pack.id !== parsed.id) throw new Error(`repo "${parsed.url}" is named for id "${parsed.id}" but pack.json says "${pack.id}"`);
    if (entry) checkAgainstRegistry(entry, pack);

    const id = pack.id;
    const lock = readLock(root);
    const dest = path.join(templatesDir(root), id);
    const lockedHere = Boolean(lock.packs[id]);
    if (existsSync(dest) && !lockedHere) throw new Error(`templates/${id}/ exists and was not installed by templates.mjs; move it aside first`);
    if (lockedHere && !force) throw new Error(`pack "${id}" is already installed; pass --force to replace it`);

    // The collision check ignores this pack's own previous files, so a forced
    // reinstall can be checked before anything is deleted.
    for (const kind of /** @type {const} */ (['cv', 'cover'])) {
      const taken = new Set(listTemplates(kind, { dir: templatesDir(root) }).filter((t) => t.pack !== id).map((t) => t.name));
      for (const name of claims(pack)[kind]) {
        if (taken.has(name)) throw new Error(`${kind} template name "${name}" is already taken; discovery would reject two files with one name`);
      }
    }

    if (lockedHere) removePack(root, id, { force: true });
    mkdirSync(dest, { recursive: true });
    const files = {};
    for (const t of pack.templates) {
      for (const kind of t.kind === 'both' ? ['cv', 'cover'] : [t.kind]) {
        const base = path.basename(t.files[kind]);
        copyFileSync(path.join(dir, t.files[kind]), path.join(dest, base));
        files[`templates/${id}/${base}`] = sha256(readFileSync(path.join(dest, base)));
      }
    }
    const written = Object.keys(files);
    lock.packs[id] = { repo: parsed.url, sha: pin, version: pack.version, source, files };
    writeLock(root, lock);
    return { id, version: pack.version, sha: pin, source, files: written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Installed packs, each with the lock-attributed files that changed or vanished. */
export function installedPacks(root) {
  return Object.entries(readLock(root).packs).map(([id, p]) => {
    const modified = Object.entries(p.files || {})
      .filter(([rel, hash]) => {
        try { return sha256(readFileSync(path.join(root, rel))) !== hash; } catch { return true; }
      })
      .map(([rel]) => rel);
    return { id, version: p.version, sha: p.sha, source: p.source, repo: p.repo, files: Object.keys(p.files || {}), modified };
  });
}

/** Remove exactly the files the lock attributes to a pack. */
export function removePack(root, id, { force = false } = {}) {
  const lock = readLock(root);
  const p = lock.packs[id];
  if (!p) throw new Error(`pack "${id}" is not installed`);
  const base = path.join(templatesDir(root), id);
  const targets = Object.entries(p.files || {}).map(([rel, hash]) => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(base + path.sep)) throw new Error(`refusing a lock path outside templates/${id}/: ${rel}`);
    return { rel, abs, hash };
  });
  const modified = targets.filter(({ abs, hash }) => {
    try { return sha256(readFileSync(abs)) !== hash; } catch { return false; }
  }).map(({ rel }) => rel);
  if (modified.length && !force) throw new Error(`these files were modified since install; pass --force to delete them:\n  ${modified.join('\n  ')}`);
  const removed = [];
  for (const { rel, abs } of targets) {
    if (existsSync(abs)) { rmSync(abs); removed.push(rel); }
  }
  try { if (existsSync(base) && readdirSync(base).length === 0) rmdirSync(base); } catch { /* keep a directory we cannot empty */ }
  delete lock.packs[id];
  writeLock(root, lock);
  return { id, removed };
}
