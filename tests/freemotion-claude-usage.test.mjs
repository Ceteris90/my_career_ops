// tests/freemotion-claude-usage.test.mjs — freemotion-night/claude-usage.mjs: Claude's week and 5-hour
// windows read from a print-mode stream-json output (the rate_limit_event). Offline: no claude call.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nclaude usage — the week and 5-hour windows before a run');

const { parseWindows, describe } = await import(pathToFileURL(join(ROOT, 'freemotion-night/claude-usage.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

const event = (five, week) => JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: five, resetsAt: 1791890400 }, seven_day: { utilization: week, resetsAt: 1792440000 } } } });
const out = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{}}', event(0.02, 0.12), '{"type":"result","result":"OK"}'].join('\n');

check('both windows, in %', parseWindows(out), { fiveHour: { pct: 2, resetsAt: 1791890400 }, week: { pct: 12, resetsAt: 1792440000 }, status: 'allowed' });
check('the last event wins', parseWindows([event(0.1, 0.5), event(0.2, 0.98)].join('\n')).week.pct, 98);
check('no event, nothing read', parseWindows('{"type":"result","is_error":true,"result":"Not logged in"}'), null);
check('a torn line is skipped', parseWindows('{"type":"rate_limit_event", "rate_li\n' + event(0, 0.66)).week.pct, 66);
check('a window missing is shown as ?', /5 hours \?/.test(describe({ week: { pct: 12, resetsAt: 1792440000 }, fiveHour: null })), true);
check('described week first', /^week 12% \(resets .+\) · 5 hours 2%/.test(describe(parseWindows(out))), true);
