import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

export const AGENT_CLIS = ['claude', 'codex', 'opencode', 'pi', 'antigravity', 'grok', 'qwen', 'kimi', 'copilot', 'gemini', 'hermes'];

/**
 * The agent CLI the user chose: CAREER_OPS_CLI from the shell, else from the
 * data root's .env. Reads .env without loading it into process.env.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function readRememberedCli(root, env = process.env) {
  if (env.CAREER_OPS_CLI) return env.CAREER_OPS_CLI;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  return dotenv.parse(readFileSync(file, 'utf8')).CAREER_OPS_CLI || null;
}

/**
 * Set CAREER_OPS_CLI in the data root's .env, keeping every other line.
 *
 * @param {string} root
 * @param {string} cli
 */
export function rememberCli(root, cli) {
  if (!AGENT_CLIS.includes(cli)) throw new Error(`"${cli}" is not a supported CLI. Use one of: ${AGENT_CLIS.join(', ')}.`);
  const file = join(root, '.env');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  if (lines.at(-1) === '') lines.pop();
  const kept = lines.filter((line) => !/^\s*(?:export\s+)?CAREER_OPS_CLI\s*=/.test(line));
  writeFileSync(file, [...kept, `CAREER_OPS_CLI=${cli}`, ''].join('\n'));
}
