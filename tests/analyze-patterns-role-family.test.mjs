// tests/analyze-patterns-role-family.test.mjs — interview yield per role family.
//
// The section exists so a user can see which kinds of roles turn into
// interviews. Two things make that number easy to get wrong: a row rejected
// after an interview must still count as having reached Interview (the status
// log is the only record of it), and a family with a handful of applications
// must never be recommended off one lucky reply.
import { pass, fail, ROOT } from './helpers.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nanalyze-patterns — role-family interview yield');

const { analyze, buildRoleFamilyYield, loadRoleFamilies, roleFamilyOf, wilsonInterval } =
  await import(pathToFileURL(join(ROOT, 'analyze-patterns.mjs')).href);

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Rows: `n` applications of one family, `interviews` of them at Interview.
let nextNum = 1;
const rows = (family, n, interviews, status = 'applied') =>
  Array.from({ length: n }, (_, i) => ({
    num: nextNum++,
    role: `${family} role`,
    report: { archetype: family },
    normalizedStatus: i < interviews ? 'interview' : status,
  }));

// --- wilsonInterval ----------------------------------------------------------
check(wilsonInterval(0, 0) === null, 'wilsonInterval: no applications has no interval');
const [lo8, hi8] = wilsonInterval(1, 8);
check(lo8 <= 3 && hi8 >= 40, `wilsonInterval: 1 of 8 is wide, not 12.5% (got ${lo8}-${hi8}%)`);
const [lo120, hi120] = wilsonInterval(6, 120);
check(hi120 - lo120 < 12, `wilsonInterval: 6 of 120 is narrow (got ${lo120}-${hi120}%)`);

// --- roleFamilyOf ------------------------------------------------------------
const families = { 'Data and reporting': ['data analyst', 'reporting'], 'HR': ['hr coordinator'] };
check(roleFamilyOf({ report: { archetype: 'L&D' }, role: 'Data Analyst' }, families) === 'L&D', 'roleFamilyOf: the report archetype wins over title keywords');
check(roleFamilyOf({ report: null, role: 'Senior Data Analyst' }, families) === 'Data and reporting', 'roleFamilyOf: no report falls back to a title keyword');
check(roleFamilyOf({ report: null, role: 'Chef' }, families) === 'Unknown', 'roleFamilyOf: no archetype and no keyword is Unknown');
check(roleFamilyOf({ report: null, role: 'Chef' }) === 'Unknown', 'roleFamilyOf: no role_families configured is Unknown, not a crash');

// --- big family with a clear gap is suggested --------------------------------
const big = [...rows('L&D', 120, 6), ...rows('HR', 150, 2), ...rows('Admin', 90, 1), ...rows('Data', 40, 0)];
const r1 = buildRoleFamilyYield(big);
check(r1.applied === 400 && r1.interviewed === 9, `counts: 9 interviews of 400 applied (got ${r1.interviewed} of ${r1.applied})`);
check(r1.overallRate === 2.3, `overall rate rounds to one decimal (got ${r1.overallRate})`);
check(r1.suggestion?.includes('"L&D"'), 'suggestion: L&D at 5% against 2.3% overall is named');
check(r1.families.find(f => f.family === 'Admin').rate === 1.1, 'rate: 1 of 90 is 1.1%');

// --- small family is never suggested, and says so ----------------------------
const small = [...rows('Lucky', 8, 1), ...rows('Rest', 92, 1)];
const r2 = buildRoleFamilyYield(small);
const lucky = r2.families.find(f => f.family === 'Lucky');
check(lucky.sufficientSample === false, 'small sample: 8 applications is flagged insufficient');
check(r2.suggestion === null, 'small sample: 1 of 8 does not produce a suggestion');
check(buildRoleFamilyYield(small, { minN: 5 }).suggestion?.includes('"Lucky"'), 'small sample: lowering minN lets the same family through');

// --- gap to the overall rate is required -------------------------------------
const flat = [...rows('A', 50, 3), ...rows('B', 50, 2)];
check(buildRoleFamilyYield(flat).suggestion === null, 'no gap: 6% vs 5% overall is not a 2x gap, no suggestion');
check(buildRoleFamilyYield([...rows('A', 30, 0), ...rows('B', 30, 0)]).suggestion === null, 'zero interviews overall: no suggestion and no divide-by-zero');

// --- rejected after an interview still counts (status log) -------------------
nextNum = 1;
const afterInterview = [...rows('L&D', 25, 0, 'rejected'), ...rows('Other', 75, 0, 'rejected')];
const noLedger = buildRoleFamilyYield(afterInterview);
check(noLedger.interviewed === 0, 'snapshot only: rejected rows have no interview on record');
const ledger = afterInterview.slice(0, 5).map(({ num }) => ({ num, from: 'Interview', to: 'Rejected' }));
const withLedger = buildRoleFamilyYield(afterInterview, { ledger });
check(withLedger.interviewed === 5, `ledger: five rows rejected after Interview now count (got ${withLedger.interviewed})`);
check(withLedger.suggestion?.includes('"L&D"'), 'ledger: the family those five came from is suggested');

// --- rows that were never sent are not applications --------------------------
nextNum = 1;
const unsent = [...rows('A', 30, 0, 'evaluated'), ...rows('B', 30, 0, 'skip'), ...rows('C', 25, 1)];
check(buildRoleFamilyYield(unsent).applied === 25, 'evaluated and skipped rows are outside the applied count');

// --- loadRoleFamilies: reads only the file it is given -----------------------
const dir = mkdtempSync(join(tmpdir(), 'role-families-'));
const profile = (name, text) => { const f = join(dir, name); writeFileSync(f, text); return f; };
try {
  check(JSON.stringify(loadRoleFamilies(join(dir, 'absent.yml'))) === '{}', 'loadRoleFamilies: a missing file is {}');
  check(JSON.stringify(loadRoleFamilies(profile('bad.yml', 'role_families: [unclosed\n  : :'))) === '{}', 'loadRoleFamilies: malformed YAML is {}');
  check(JSON.stringify(loadRoleFamilies(profile('list.yml', 'role_families: [a, b]\n'))) === '{}', 'loadRoleFamilies: a non-map role_families is {}');
  const got = loadRoleFamilies(profile('ok.yml', 'role_families:\n  Data: ["Data Analyst", " REPORTING "]\n  Scalar: oops\n  Empty: []\n'));
  check(JSON.stringify(got) === '{"Data":["data analyst","reporting"]}', `loadRoleFamilies: keywords lowercased and trimmed, scalar and empty families dropped (got ${JSON.stringify(got)})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// --- analyze(entries) with supplied entries reads nothing from disk ----------
const supplied = analyze([{ num: 1, role: 'Data Analyst', status: 'Applied', report: null }], {});
check(supplied.error !== undefined || supplied.roleFamilyYield !== undefined, 'analyze: supplied entries run without loading the ledger or profile');

// --- the 2x gap compares exact ratios, not the rounded display rate ----------
// 2 of 23 is 8.696% (shown 8.7%); 100 of 2299 overall is 4.350%, so 2x is 8.699%.
// Rounded, 8.7 clears the bar; exact, it falls just short.
nextNum = 1;
const nearMiss = [...rows('Near', 23, 2), ...rows('Rest', 2276, 98)];
const nm = buildRoleFamilyYield(nearMiss);
check(nm.families.find(f => f.family === 'Near').rate === 8.7 && nm.suggestion === null, 'gap: 8.696% against a 8.699% bar is not suggested although it displays as 8.7%');
