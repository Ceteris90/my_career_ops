#!/usr/bin/env node
// node freemotion-night/report-outcome.mjs <num> <run-id>
//
// L52 (#38): the agent filled and sent a form, then its own record/finalize call crashed (exit
// -1073741502, sandbox EOF), so the claim stayed in-progress and run.sh closed it as errored: "run
// ended without recording a result". A sent application then looks like a failure, can be tried
// again (a duplicate), and the counts are wrong.
//
// run.sh calls this after a job whose claim is still in-progress. It reads the job's report
// (tmp/fm/night/report-<num>.md), whose last "Outcome:" line the sheet asks for
// (make-jobs.mjs), and records that outcome itself, outside the agent's session:
//   Outcome: submitted — "<page text after submitting>"   → record.mjs (tracker row), only with page text
//   Outcome: already-applied | validation-failed | captcha | blocked-waf | errored — <why>   → finalize
// Prints what it did. Exit 0 = recorded, 1 = nothing usable in the report (run.sh then closes the
// claim as errored, as before).
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from '../lib/is-main-module.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTCOMES = ['submitted', 'already-applied', 'validation-failed', 'captcha', 'blocked-waf', 'errored'];

/**
 * The last "Outcome:" line of a report.
 * @param {string} report
 * @returns {{ outcome: string, note: string } | null}
 */
export function outcomeFromReport(report) {
  const lines = String(report || '').split(/\r?\n/).filter((l) => /^\W*outcome\W*:/i.test(l));
  if (!lines.length) return null;
  const m = lines.at(-1).match(/outcome\W*:[*_\s]*([a-z-]+)[*_\s]*(?:[—–:-]\s*)?(.*)$/i);
  if (!m) return null;
  const outcome = m[1].toLowerCase();
  if (!OUTCOMES.includes(outcome)) return null;
  const note = m[2].replace(/[\x60*]+$/g, '').trim();   // trailing backticks / asterisks (markdown)
  // A submission counts only with the page's own words after sending: no quote, no record.
  if (outcome === 'submitted' && !/["«“].{8,}["»”]/.test(note)) return null;
  return { outcome, note };
}

const USAGE = 'Usage: node freemotion-night/report-outcome.mjs <num> <run-id>\nRecords the Outcome line of tmp/fm/night/report-<num>.md for a job still in progress.';

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return 0; }
  const [num, run] = argv;
  if (!num || !run || argv.length > 2) { console.error(USAGE); return 2; }
  const reportPath = join(ROOT, `tmp/fm/night/report-${num}.md`);
  const jobPath = join(ROOT, `tmp/fm/night/job-${num}.json`);
  if (!existsSync(reportPath) || !existsSync(jobPath)) { console.log(`job ${num}: no report to read`); return 1; }
  const found = outcomeFromReport(readFileSync(reportPath, 'utf8'));
  if (!found) { console.log(`job ${num}: the report has no usable Outcome line`); return 1; }
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  const note = `${found.note} (from the agent's report: its own record call did not finish)`.slice(0, 500);
  const node = (...a) => execFileSync(process.execPath, a.map((x, i) => (i === 0 ? join(ROOT, x) : x)), { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (found.outcome === 'submitted') node('freemotion-night/record.mjs', run, String(num), job.slug, job.co, job.title, job.url, note);
    else node('lib/freemotion-submissions.mjs', 'finalize', '--url', job.url, '--outcome', found.outcome, '--run-id', run, '--notes', note);
  } catch (e) {
    console.log(`job ${num}: could not record ${found.outcome} from the report: ${String(e.stdout || e.message).trim().slice(-200)}`);
    return 1;
  }
  console.log(`note: job ${num}: recorded ${found.outcome} from the agent's report (L52)`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
