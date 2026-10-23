/**
 * tests/salary-gap-third-party.test.mjs — `third-party` advertised source (#5741).
 * Run: node test-all.mjs --only salary-gap-third-party
 */
import { parseObservations, fold } from '../salary-gap.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nsalary-gap third-party source');

const assert = (cond, name) => (cond ? pass(name) : fail(name));
const apps = { 1: { company: 'Acme', role: 'Eng' }, 2: { company: 'Globex', role: 'Ops' } };
const adv = (r) => r.applications.find(a => a.num === '1').advertised;

// third-party alone: used, flagged unverified
let r = fold(parseObservations('1\t2026-07-01\tadvertised\t80-90k\tUSD\tthird-party\taggregator estimate'), apps, null);
assert(adv(r)?.value === 85000 && adv(r).source === 'third-party' && adv(r).unverified === true,
  'third-party alone is the effective advertised value and is flagged unverified');
assert(r.quality.invalidSources.length === 0, 'third-party is a valid source for advertised');

// ranking: jd, recruiter-verbal, user each outrank a (newer) third-party row
for (const [src, amt] of [['jd', 100], ['recruiter-verbal', 110], ['user', 120]]) {
  r = fold(parseObservations(
    `1\t2026-08-01\tadvertised\t200k\tUSD\tthird-party\tnewer estimate\n1\t2026-07-01\tadvertised\t${amt}k\tUSD\t${src}\t`), apps, null);
  assert(adv(r).source === src && adv(r).value === amt * 1000 && adv(r).unverified === undefined,
    `${src} row supersedes a newer third-party row, no unverified flag`);
}

// two third-party rows: latest date wins, still unverified
r = fold(parseObservations(
  '1\t2026-07-01\tadvertised\t70k\tUSD\tthird-party\t\n1\t2026-07-09\tadvertised\t75k\tUSD\tthird-party\t'), apps, null);
assert(adv(r).value === 75000 && adv(r).unverified === true, 'latest third-party wins among third-party rows');

// rejected for desired / actual
r = fold(parseObservations(
  '2\t2026-07-01\tdesired\t90k\tUSD\tthird-party\t\n2\t2026-07-01\tactual\t95k\tUSD\tthird-party\t'), apps, null);
const a2 = r.applications.find(a => a.num === '2');
assert(r.quality.invalidSources.length === 2 &&
  r.quality.invalidSources.every(s => s.source === 'third-party' && (s.type === 'desired' || s.type === 'actual')),
  'third-party reported as invalid for desired and actual');
assert(a2.desired === null && a2.actual === null, 'third-party desired/actual rows are not folded');

// unchanged output for data without the new source
r = fold(parseObservations('1\t2026-07-01\tadvertised\t85k\tUSD\tjd\t'), apps, null);
assert(!('unverified' in adv(r)), 'no unverified key emitted for existing sources');
assert(Object.keys(adv(r)).sort().join() === 'currency,date,period,postingLocation,raw,source,value',
  'advertised object shape unchanged for jd');
