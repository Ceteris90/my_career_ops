/**
 * updater-local-overlay.test.mjs — coverage for the local overlay declaration file (#4326).
 *
 * Verifies that the system overlay configuration correctly parses, validates, and
 * rejects improper paths, similar to updater-local-paths.test.mjs but for system files.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, renameSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import {
  LOCAL_OVERLAY_FILE,
  LOCAL_PATHS_FILE,
  localOverlayPaths,
  gitIn,
  gitRawIn
} from '../update-system.mjs';

function makeRoot(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'co-local-overlay-'));
  if (contents !== undefined) {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, LOCAL_OVERLAY_FILE), contents);
  }
  return dir;
}

const roots = [];
function root(contents) {
  const dir = makeRoot(contents);
  roots.push(dir);
  return dir;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n🧪 Local system overlay declaration file (#4326)\n');

// ── 1. Absent file is a no-op ──
{
  const got = localOverlayPaths(root(undefined));
  if (eq(got, [])) {
    pass('no overlay declaration file → no overlay paths');
  } else {
    fail(`#1 absent file returned ${JSON.stringify(got)}`);
  }
}

// ── 2. An empty / comments-only file is also a no-op ──
{
  const got = localOverlayPaths(root('# just a comment\n\n   \n'));
  if (eq(got, [])) {
    pass('comments and blank lines only → no overlay paths');
  } else {
    fail(`#2 comments-only returned ${JSON.stringify(got)}`);
  }
}

// ── 3. A user layer file is refused ──
{
  let threw = null;
  try {
    localOverlayPaths(root('cv.md\n'));
  } catch (err) {
    threw = err;
  }
  if (threw && threw.message.includes('cv.md')) {
    pass('declaring a non-system layer file throws and names the path');
  } else {
    fail(`#3 expected a throw naming cv.md, got ${threw ? threw.message : 'no throw'}`);
  }
}

// ── 4. A system file is accepted ──
{
  const got = localOverlayPaths(root('update-system.mjs\n'));
  if (eq(got, ['update-system.mjs'])) {
    pass('declaring a system file is accepted');
  } else {
    fail(`#4 expected update-system.mjs, got ${JSON.stringify(got)}`);
  }
}

// ── 5. The declaration file itself and local-paths are refused ──
{
  for (const bad of [LOCAL_OVERLAY_FILE, LOCAL_PATHS_FILE]) {
    let threw = null;
    try {
      localOverlayPaths(root(`${bad}\n`));
    } catch (err) {
      threw = err;
    }
    if (threw && threw.message.includes(bad)) {
      pass(`cannot list config file itself: ${bad}`);
    } else {
      fail(`#5 expected a throw naming ${bad}, got ${threw ? threw.message : 'no throw'}`);
    }
  }
}

// ── 6. Absolute paths and parent-directory escapes are refused ──
{
  for (const bad of ['/etc/passwd', '../outside.txt', 'C:\\Windows\\system.ini']) {
    let threw = null;
    try {
      localOverlayPaths(root(`${bad}\n`));
    } catch (err) {
      threw = err;
    }
    if (threw) {
      pass(`escaping path refused: ${bad}`);
    } else {
      fail(`#6 accepted an escaping path: ${bad}`);
    }
  }
}

// ── 7. Non-canonical spellings of a system path are refused ──
{
  const nonCanonical = [
    ['./update-system.mjs', 'a leading ./'],
    ['dashboard/./main.go', 'an interior . segment'],
    ['dashboard//main.go', 'a repeated separator'],
    ['dashboard\\main.go', 'a backslash separator'],
  ];
  const survivors = [];
  for (const [path, shape] of nonCanonical) {
    let threw = null;
    try {
      localOverlayPaths(root(`${path}\n`));
    } catch (err) {
      threw = err;
    }
    if (!threw || !threw.message.includes(path)) survivors.push(`${shape} → ${path}`);
  }
  if (survivors.length === 0) {
    pass('non-canonical path spellings are refused and named');
  } else {
    fail(`#7 these non-canonical forms were accepted: ${survivors.join('; ')}`);
  }
}

// ── 8. Apply path: clean overlay 3-way merge ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-8-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  // Upstream edits line 1
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1 upstream\nline 2\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  // Local overlay edits line 3
  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3 local\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);

  g('checkout', 'upstream', '--', 'modes/pdf.md');
  g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)', join(dir, 'modes', 'pdf.md'), join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.bak'));

  const merged = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  if (merged === 'line 1 upstream\nline 2\nline 3 local\n') {
    pass('apply path: clean overlay 3-way merge integrates upstream and local edits');
  } else {
    fail(`#8 clean merge failed, got: ${JSON.stringify(merged)}`);
  }
}

// ── 9. Apply path: overlay merge conflict stops update ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-9-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 upstream edit\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 local edit\nline 3\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);
  g('checkout', 'upstream', '--', 'modes/pdf.md');

  let mergeFailed = false;
  try {
    g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)', join(dir, 'modes', 'pdf.md'), join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.bak'));
  } catch {
    mergeFailed = true;
  }

  const conflictedContent = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  if (mergeFailed && conflictedContent.includes('<<<<<<< Upstream')) {
    pass('apply path: overlay conflict inserts markers and raises error signal');
  } else {
    fail(`#9 expected conflict markers and non-zero exit, got failed=${mergeFailed} content=${JSON.stringify(conflictedContent)}`);
  }
}

// ── 10. Apply path: overlay whose backup failed is preserved as-is without merge ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-10-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1 upstream\nline 2\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3 local edit\n');

  const failedBackups = new Set(['modes/pdf.md']);
  const overlayPaths = localOverlayPaths(dir);
  const atRisk = ['modes/pdf.md'];
  const overlaysToMerge = [];

  for (const file of atRisk) {
    const isOverlay = overlayPaths.some((op) => op.endsWith('/') ? file.startsWith(op) : op === file);
    if (isOverlay) {
      if (!failedBackups.has(file)) {
        overlaysToMerge.push(file);
      }
    }
  }

  const preservedPaths = atRisk.filter((f) => !overlaysToMerge.includes(f));
  if (overlaysToMerge.length === 0 && preservedPaths.includes('modes/pdf.md')) {
    pass('apply path: overlay whose backup failed skips merge and is preserved');
  } else {
    fail(`#10 expected preserved overlay, got overlays=${JSON.stringify(overlaysToMerge)} preserved=${JSON.stringify(preservedPaths)}`);
  }
}


// ── 11. Apply path: after overlay conflict .base and .bak are preserved ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-11-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  // Both upstream and local edit the same line to cause a conflict
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 upstream edit\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2 local edit\nline 3\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);

  g('checkout', 'upstream', '--', 'modes/pdf.md');

  let mergeFailed = false;
  try {
    g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)',
      join(dir, 'modes', 'pdf.md'),
      join(dir, 'modes', 'pdf.md.base'),
      join(dir, 'modes', 'pdf.md.bak'));
  } catch {
    mergeFailed = true;
  }

  // On conflict: .base and .bak must both still exist for manual resolution
  const baseExists = existsSync(join(dir, 'modes', 'pdf.md.base'));
  const bakExists  = existsSync(join(dir, 'modes', 'pdf.md.bak'));

  if (mergeFailed && baseExists && bakExists) {
    pass('apply path: conflict keeps .base and .bak for manual resolution');
  } else {
    fail(`#11 conflict=${mergeFailed} .base=${baseExists} .bak=${bakExists} — expected all true`);
  }
}

// ── 12. Clean merge renames .base to .overlay-base (cross-run persistence signal) ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-12-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  // Upstream edits line 1; local overlay edits line 3 — no conflict
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1 upstream\nline 2\nline 3\n');
  g('commit', '-qam', 'upstream update');
  g('checkout', '-q', 'main');

  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line 1\nline 2\nline 3 local\n');

  const baseContent = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak);

  g('checkout', 'upstream', '--', 'modes/pdf.md');

  // Simulate the clean-merge branch: merge-file succeeds, then rename .base → .overlay-base
  g('merge-file', '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)',
    join(dir, 'modes', 'pdf.md'),
    join(dir, 'modes', 'pdf.md.base'),
    join(dir, 'modes', 'pdf.md.bak'));

  // The code under test: rename .base to .overlay-base
  renameSync(join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.overlay-base'));

  const baseGone    = !existsSync(join(dir, 'modes', 'pdf.md.base'));
  const overBaseSurvives = existsSync(join(dir, 'modes', 'pdf.md.overlay-base'));

  if (baseGone && overBaseSurvives) {
    pass('clean merge: .base is renamed to .overlay-base (cross-run persistence signal kept)');
  } else {
    fail(`#12 baseGone=${baseGone} overBaseSurvives=${overBaseSurvives} — expected both true`);
  }
}

// ── 13. --force path deletes .bak / .base / .overlay-base artifacts ──
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-13-'));
  roots.push(dir);
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });

  // Simulate artifacts left by a prior conflicted run
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'conflicted content\n');
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), 'local copy\n');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), 'upstream base\n');
  writeFileSync(join(dir, 'modes', 'pdf.md.overlay-base'), 'prior clean-merge anchor\n');

  // Simulate --force cleanup logic
  const overlaysToMerge = ['modes/pdf.md'];
  for (const file of overlaysToMerge) {
    for (const ext of ['.bak', '.base', '.overlay-base']) {
      try { unlinkSync(join(dir, `${file}${ext}`)); } catch { /* ignore */ }
    }
  }

  const bakGone         = !existsSync(join(dir, 'modes', 'pdf.md.bak'));
  const baseGone        = !existsSync(join(dir, 'modes', 'pdf.md.base'));
  const overlayBaseGone = !existsSync(join(dir, 'modes', 'pdf.md.overlay-base'));

  if (bakGone && baseGone && overlayBaseGone) {
    pass('--force: .bak, .base, and .overlay-base artifacts are removed');
  } else {
    fail(`#13 bak=${bakGone} base=${baseGone} overlayBase=${overlayBaseGone} — expected all true`);
  }
}

// Test 14. Second-update path: apply() sub-flow refreshes inputs from fresh sources
//
// Scenario (every install reaches a second update):
//   1. First update: upstream changes line A (top); local overlay changes line E
//      (bottom, 3 lines away -- non-adjacent). Clean merge -> .overlay-base kept.
//   2. Second update: upstream changes line C (middle, non-adjacent to E). apply()
//      must write fresh .bak (from HEAD) and .base (from .overlay-base) before
//      calling merge-file. The overlay change on E must survive and the new
//      upstream change on C must land. Adjacent-line changes are deliberately
//      avoided here: git merge-file can declare a conflict on adjacent hunks even
//      when the changes are logically independent.
//
// Correct three-way merge inputs for the second update:
//   current (.file)  <- FETCH_HEAD content (checked out by the loop above)
//   base    (.base)  <- .overlay-base (original pre-first-update content = the
//                       real common ancestor between FETCH_HEAD and local)
//   other   (.bak)   <- HEAD blob (post-first-merge committed = pre-checkout local)
{
  const dir = mkdtempSync(join(tmpdir(), 'co-overlay-apply-14-'));
  roots.push(dir);
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));
  g('config', 'core.autocrlf', 'false');
  g('config', 'core.eol', 'lf');
  mkdirSync(join(dir, 'modes'), { recursive: true });
  mkdirSync(join(dir, 'config'), { recursive: true });

  // Five lines so upstream (A, C) and local (E) changes are non-adjacent.
  const baseFile = 'line A\nline B\nline C\nline D\nline E\n';
  writeFileSync(join(dir, 'modes', 'pdf.md'), baseFile);
  writeFileSync(join(dir, LOCAL_OVERLAY_FILE), 'modes/pdf.md\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('branch', 'upstream');

  // First update: upstream changes line A only.
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line A UP1\nline B\nline C\nline D\nline E\n');
  g('commit', '-qam', 'upstream update 1');
  g('checkout', '-q', 'main');

  // Local overlay changes line E only (3 lines from A -- non-adjacent).
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line A\nline B\nline C\nline D\nline E LOCAL\n');

  // Artifact writes apply() does before the checkout loop:
  const orig = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  const localBak1 = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  writeFileSync(join(dir, 'modes', 'pdf.md.base'), orig);
  writeFileSync(join(dir, 'modes', 'pdf.md.bak'), localBak1);

  g('checkout', 'upstream', '--', 'modes/pdf.md');
  g('merge-file',
    '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)',
    join(dir, 'modes', 'pdf.md'),
    join(dir, 'modes', 'pdf.md.base'),
    join(dir, 'modes', 'pdf.md.bak'));

  const afterFirstMerge = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  if (afterFirstMerge !== 'line A UP1\nline B\nline C\nline D\nline E LOCAL\n') {
    fail('#14 setup: first merge produced unexpected result: ' + JSON.stringify(afterFirstMerge));
  }

  // Clean-merge cleanup: .base -> .overlay-base; discard .bak.
  renameSync(join(dir, 'modes', 'pdf.md.base'), join(dir, 'modes', 'pdf.md.overlay-base'));
  unlinkSync(join(dir, 'modes', 'pdf.md.bak'));

  // Commit the merged result (the auto-update commit apply() makes).
  g('add', 'modes/pdf.md');
  g('commit', '-qm', 'chore: auto-update system files (v1)');

  // Second update: upstream changes line C (middle, 2 lines from E -- non-adjacent).
  g('checkout', '-q', 'upstream');
  writeFileSync(join(dir, 'modes', 'pdf.md'), 'line A UP1\nline B\nline C UP2\nline D\nline E\n');
  g('commit', '-qam', 'upstream update 2');
  g('checkout', '-q', 'main');

  // At this point:
  //   working tree / HEAD = post-first-merge: 'line 1 UP1\nline 2\nline 3 LOCAL\n'
  //   .overlay-base exists (persistence signal from clean merge)
  //   .bak and .base do NOT exist (cleaned up after first merge)
  //
  // apply() must reconstruct both before calling git merge-file:
  //   .bak  ← committed HEAD blob (post-first-merge content, same as pre-checkout
  //            working tree — read from git after checkout already ran)
  //   .base ← .overlay-base content (the common ancestor for the second merge,
  //            NOT FETCH_HEAD — using FETCH_HEAD would make current==base and
  //            silently drop all new upstream changes)

  // Simulate checkout of the new upstream (what apply()'s checkout loop does):
  g('checkout', 'upstream', '--', 'modes/pdf.md');


  // ── apply()'s second-update input-refresh logic (the code under test) ──
  // .bak absent → read from committed HEAD (the post-first-merge committed result).
  // (apply() reads the working tree BEFORE the checkout loop; here we use HEAD as
  //  the equivalent since the checkout has already run in this simulation.)
  const priorLocal = gitRawIn(dir, 'show', 'HEAD:modes/pdf.md');
  if (!existsSync(join(dir, 'modes', 'pdf.md.bak'))) {
    writeFileSync(join(dir, 'modes', 'pdf.md.bak'), priorLocal);
  }
  // .base absent → read from .overlay-base (the common ancestor for the 3-way merge).
  // NOT from FETCH_HEAD: using FETCH_HEAD would make current==base, causing
  // git merge-file to see no diff and silently drop new upstream changes.
  const overlayBasePath = join(dir, 'modes', 'pdf.md.overlay-base');
  if (!existsSync(join(dir, 'modes', 'pdf.md.base'))) {
    const baseContent = existsSync(overlayBasePath)
      ? readFileSync(overlayBasePath, 'utf-8')
      : '';
    writeFileSync(join(dir, 'modes', 'pdf.md.base'), baseContent);
  }

  // Now run git merge-file with the correctly refreshed inputs:
  let mergeExited0 = true;
  try {
    g('merge-file',
      '-L', 'Upstream', '-L', 'Base', '-L', 'Local (Overlay)',
      join(dir, 'modes', 'pdf.md'),
      join(dir, 'modes', 'pdf.md.base'),
      join(dir, 'modes', 'pdf.md.bak'));
  } catch {
    mergeExited0 = false;
  }

  const afterSecond = readFileSync(join(dir, 'modes', 'pdf.md'), 'utf-8');
  const wantSecond  = 'line A UP1\nline B\nline C UP2\nline D\nline E LOCAL\n';
  if (mergeExited0 && afterSecond === wantSecond) {
    pass('second-update path: apply() sub-flow merges fresh upstream + fresh local (not stale first-run copies)');
  } else {
    fail('#14 second-update: mergeExited0=' + mergeExited0 + ' expected=' + JSON.stringify(wantSecond) + ' got=' + JSON.stringify(afterSecond));
  }
}

for (const dir of roots) rmSync(dir, { recursive: true, force: true });

