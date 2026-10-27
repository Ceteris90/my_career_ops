import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadYaml } from './yaml-document.mjs';
import { importMailDrop } from './linkedin-mail-drop.mjs';

export const LINKEDIN_DROP_DIR = join('data', 'linkedin-alerts');

function gmailSettings(root) {
  const path = join(root, 'config', 'plugins.yml');
  if (!existsSync(path)) return null;
  try {
    const doc = loadYaml(readFileSync(path, 'utf8'));
    const gmail = doc?.plugins?.gmail;
    // Opt-in: an install that already ran gmail by hand keeps doing so until it sets auto: true.
    if (!gmail || gmail.enabled !== true || gmail.auto !== true) return null;
    return gmail;
  } catch {
    return null;
  }
}

function envHasGmail(root) {
  const path = join(root, '.env');
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']
    .every((key) => new RegExp(`^${key}=\\S`, 'm').test(text));
}

/**
 * @param {string} root
 * @param {{ codeRoot?: string, spawnSyncImpl?: typeof spawnSync, log?: (line: string) => void }} [options]
 */
export async function pollLinkedInInbox(root, { codeRoot = root, spawnSyncImpl = spawnSync, log = () => {} } = {}) {
  const dir = join(root, LINKEDIN_DROP_DIR);
  const report = {};
  if (existsSync(dir)) {
    try {
      report.drop = await importMailDrop({ root, dir });
    } catch (err) {
      report.dropError = err instanceof Error ? err.message : String(err);
      log(`linkedin drop: ${report.dropError}`);
    }
  }
  if (gmailSettings(root) && envHasGmail(root)) {
    const result = spawnSyncImpl(process.execPath, [join(codeRoot, 'plugins.mjs'), 'run', 'gmail'], {
      cwd: codeRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CAREER_OPS_ROOT: root },
    });
    report.gmail = { status: result.status };
    if (result.status !== 0) log(`gmail: ${result.stderr || result.stdout || 'failed'}`);
  }
  return report;
}
