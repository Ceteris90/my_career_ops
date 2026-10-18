#!/usr/bin/env node
/**
 * remember-cli.mjs — record the agent CLI this install runs in.
 *
 *   node remember-cli.mjs <cli>
 *
 * Writes CAREER_OPS_CLI=<cli> to the data root's .env. doctor, rank-pipeline
 * and the web UI read it, so they all use the CLI the user set up in.
 */
import { AGENT_CLIS, rememberCli } from './lib/agent-cli.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const USAGE = `Usage: node remember-cli.mjs <cli>
CLIs: ${AGENT_CLIS.join(', ')}`;

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return argv.length === 1 ? 0 : 1;
  }
  try {
    rememberCli(getCareerOpsRoot(), argv[0]);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  console.log(`Remembered ${argv[0]} as your agent CLI in .env.`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
