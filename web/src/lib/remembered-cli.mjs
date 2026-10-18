import fs from "node:fs";
import path from "node:path";

const LINE = /^\s*(?:export\s+)?CAREER_OPS_CLI\s*=\s*(.*?)\s*$/;

/**
 * The agent CLI the user chose: CAREER_OPS_CLI from the shell, else from the
 * data root's .env (written by `node remember-cli.mjs`). Null when unset.
 *
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function readRememberedCli(root, env = process.env) {
  if (env.CAREER_OPS_CLI) return env.CAREER_OPS_CLI;
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return null;
  }
  let value = null;
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m) value = m[1].replace(/^(['"])(.*)\1$/, "$2") || null;
  }
  return value;
}
