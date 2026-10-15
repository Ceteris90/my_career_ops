// tests/freemotion-agy-usage.test.mjs — freemotion-night/agy-usage.mjs: agy's windows read from
// `agy -p /usage`, and what a run cost of the week. Offline: no agy call.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nagy usage — the week and 5-hour windows per model group');

const { parseUsage, spent } = await import(pathToFileURL(join(ROOT, 'freemotion-night/agy-usage.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

// Copied from agy 2026-10-15.
const out = [
  'Gemini Models\tWeekly Limit Remaining\t94%\t2026-10-22T09:43:43Z',
  'Gemini Models\tFive Hour Limit Remaining\t100%\t2026-10-16T02:06:52Z',
  'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-10-17T01:53:15Z',
  'Claude and GPT models\tFive Hour Limit Remaining\tdisabled',
].join('\r\n');
const now = parseUsage(out);

check('four windows', now.length, 4);
check('Gemini week', now[0], { group: 'Gemini Models', window: 'week', left: 94, reset: '2026-10-22T09:43:43Z' });
check('Gemini 5 hours', now[1].window, '5h');
check('a disabled window has no %', now[3], { group: 'Claude and GPT models', window: '5h', left: null, reset: '' });
check('other text is ignored', parseUsage('Here is the summary regarding C:/Program Files/Git\n### 1. Disk Usage'), []);

const before = parseUsage('Gemini Models\tWeekly Limit Remaining\t100%\t2026-10-22T09:43:43Z');
const [g] = spent(before, now, 8);
check('6% over 8 jobs', [g.from, g.left, g.used, g.perJob, g.jobsPerWindow], [100, 94, 6, 0.75, 133]);

const renewed = parseUsage('Gemini Models\tWeekly Limit Remaining\t3%\t2026-10-15T09:43:43Z');
check('a week renewed during the run gives no figure', spent(renewed, now, 8)[0].renewed, true);
check('no agy job: no per-job figure', spent(before, now, 0)[0].perJob, null);
