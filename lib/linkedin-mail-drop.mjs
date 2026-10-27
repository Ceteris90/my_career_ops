import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { linkedInOffers, planLinkedInImport } from './linkedin-import.mjs';

const MAIL_EXT = new Set(['.eml', '.txt', '.mbox']);

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function mailDropFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MAIL_EXT.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(dir, name));
}

function readIf(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

function park(file) {
  const dir = join(dirname(file), 'imported');
  mkdirSync(dir, { recursive: true });
  const base = file.slice(dirname(file).length + 1);
  let dest = join(dir, base);
  let n = 1;
  while (existsSync(dest)) {
    dest = join(dir, `${base}.${n}`);
    n += 1;
  }
  renameSync(file, dest);
}

/**
 * @param {{ root: string, dir: string, dryRun?: boolean }} input
 * @returns {Promise<{ added: number, already: number, found: number, message: string }>}
 */
export async function importMailDrop({ root, dir, dryRun = false }) {
  const files = mailDropFiles(dir);
  const pipelinePath = join(root, 'data', 'pipeline.md');
  const applicationsPath = join(root, 'data', 'applications.md');
  let seen = `${readIf(pipelinePath)}\n${readIf(applicationsPath)}`;
  const added = [];
  const already = [];
  let found = 0;
  const parked = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const plan = planLinkedInImport(text, seen);
    found += plan.found;
    if (plan.error) continue;
    for (const job of plan.added) {
      added.push(job);
      seen += `\n${job.url}`;
    }
    already.push(...plan.already);
    parked.push(file);
  }
  if (!dryRun && added.length > 0) {
    const { appendToPipeline, appendToScanHistory } = await import('../scan.mjs');
    const { localToday } = await import('./local-today.mjs');
    const offers = linkedInOffers(added);
    mkdirSync(dirname(pipelinePath), { recursive: true });
    await appendToPipeline(offers, { pipelinePath });
    await appendToScanHistory(offers, localToday(), 'added');
  }
  if (!dryRun) {
    for (const file of parked) park(file);
  }
  const message = added.length === 0
    ? (found === 0 ? 'No LinkedIn jobs found in the alert folder.' : `${already.length} LinkedIn job${already.length === 1 ? ' was' : 's were'} already in your list.`)
    : `${added.length} LinkedIn job${added.length === 1 ? '' : 's'} added.`;
  return { added: added.length, already: already.length, found, message };
}
