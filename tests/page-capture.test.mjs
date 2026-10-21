// tests/page-capture.test.mjs — the pure parts of lib/page-capture.mjs (no browser):
// slug shape/stability, and the capture index append/read round-trip.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, captureRoot, appendCaptureIndex, readCaptureIndex } from '../lib/page-capture.mjs';
import { pruneCaptures } from '../investigate.mjs';

console.log('\npage-capture — slug + index (no browser)');

// slug: readable prefix from the label, stable hash suffix from the url.
{
  const a = slugify('Acme Corp', 'https://x.test/job/1');
  const b = slugify('Acme Corp', 'https://x.test/job/1');
  const c = slugify('Acme Corp', 'https://x.test/job/2');
  if (a === b) pass('slug is deterministic for the same label+url'); else fail(`slug not stable: ${a} vs ${b}`);
  if (a.startsWith('acme-corp-')) pass('slug keeps a readable label prefix'); else fail(`slug prefix wrong: ${a}`);
  if (a !== c) pass('slug changes with the url (hash suffix)'); else fail('slug ignored the url');
  if (/^[a-z0-9-]+$/.test(a)) pass('slug is filesystem-safe'); else fail(`slug has unsafe chars: ${a}`);
  if (slugify('', 'https://x.test/1') && /^[0-9a-f]{8}$/.test(slugify('', 'https://x.test/1'))) pass('empty label degrades to the bare hash'); else fail('empty label slug wrong');
}

// index: append several rows, read back newest-first with every field intact.
{
  const root = mkdtempSync(join(tmpdir(), 'cap-'));
  try {
    if (captureRoot(root).endsWith(join('data', 'captures'))) pass('captureRoot points at data/captures'); else fail(`captureRoot = ${captureRoot(root)}`);
    if (readCaptureIndex(root).length === 0) pass('missing index reads as []'); else fail('missing index not empty');

    appendCaptureIndex(root, { ts: '2026-01-01T00:00:00Z', slug: 'one', requestedUrl: 'https://a/1', finalUrl: 'https://a/1f', title: 'T1', company: 'C1', reason: 'r1', status: 'unconfirmed', dir: join(root, 'data', 'captures', '2026-01-01', 'one') });
    appendCaptureIndex(root, { ts: '2026-01-02T00:00:00Z', slug: 'two', requestedUrl: 'https://a/2', title: 'T\t2', company: 'C2', reason: 'r2\nline', status: 'expired', dir: join(root, 'data', 'captures', '2026-01-02', 'two') });

    const rows = readCaptureIndex(root);
    if (rows.length === 2) pass('two rows indexed'); else fail(`expected 2, got ${rows.length}`);
    if (rows[0].slug === 'two') pass('index reads newest-first'); else fail(`order wrong: ${rows[0].slug}`);
    if (rows[0].title === 'T 2') pass('tabs in a field are sanitized to a space'); else fail(`title not sanitized: ${JSON.stringify(rows[0].title)}`);
    if (!/[\n\t]/.test(rows[0].reason)) pass('newlines in a field are sanitized'); else fail('reason kept a newline/tab');
    if (rows[1].finalUrl === 'https://a/1f') pass('final_url round-trips'); else fail(`finalUrl wrong: ${rows[1].finalUrl}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// prune: drop date-folders older than N days, keep recent ones, rewrite the index.
{
  const root = mkdtempSync(join(tmpdir(), 'cap-prune-'));
  try {
    const base = captureRoot(root);
    const oldDir = join(base, '2000-01-01', 'old-bundle');
    const p = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const newDir = join(base, today, 'keep-bundle');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(base, 'index.tsv'),
      'ts\tslug\turl\tfinal_url\ttitle\tcompany\treason\tstatus\tdir\n'
      + `2000-01-01T00:00:00Z\told-bundle\thttps://a/1\t\tt\tc\tr\ts\t${oldDir}\n`
      + `${today}T00:00:00Z\tkeep-bundle\thttps://a/2\t\tt\tc\tr\ts\t${newDir}\n`);

    pruneCaptures(root, 30);
    if (!existsSync(oldDir)) pass('prune deletes a capture folder older than N days'); else fail('old folder survived prune');
    if (existsSync(newDir)) pass('prune keeps a recent capture folder'); else fail('recent folder was wrongly pruned');
    const rows = readCaptureIndex(root);
    if (rows.length === 1 && rows[0].slug === 'keep-bundle') pass('prune drops the removed row from the index'); else fail(`index after prune wrong: ${JSON.stringify(rows.map((r) => r.slug))}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
