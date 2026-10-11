// tests/board-employer.test.mjs — the employer behind a board's name.
//
// On 2026-10-07 a Capgemini posting reached a night run as "Hellowork" (APEC's
// feed relays HelloWork postings under the board's name), past data/blacklist.md.
// lib/board-employer.mjs reads the real name from the page's JSON-LD.
//
// Run: node test-all.mjs --only board-employer

import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';

console.log('\nboard-employer — the employer behind a board\'s name');

const { isBoardName, employerFromHtml, resolveBoardEmployers } =
  await import(pathToFileURL(join(ROOT, 'lib/board-employer.mjs')).href);

const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

check('Hellowork is a board', isBoardName('Hellowork'), true);
check('France Travail is a board', isBoardName('France Travail'), true);
check('Capgemini is not', isBoardName('Capgemini'), false);

// HelloWork's own tag spelling (2026-10-07): the "+" as an entity.
const page = (org) => `<html><script type="application/ld&#x2B;json">${JSON.stringify({ '@type': 'JobPosting', title: 'Architecte', hiringOrganization: org })}</script></html>`;
check('HelloWork page: entity-spelled tag', employerFromHtml(page({ '@type': 'Organization', name: 'Capgemini' })), 'Capgemini');
check('plain ld+json tag, string org', employerFromHtml(page('Astek').replace('ld&#x2B;json', 'ld+json')), 'Astek');
check('a board as the org is no answer', employerFromHtml(page({ name: 'HelloWork' })), null);
check('no JSON-LD', employerFromHtml('<html></html>'), null);
// #43: a HelloWork page with no JobPosting block names the employer in its title.
check('no JobPosting: the title names the employer', employerFromHtml('<title>Offre Emploi CDI Ing&#xE9;nieur Data Science Paris - Recrutement par Assystem &amp; Co | Hellowork</title>'), 'Assystem & Co');
check('no JobPosting, anonymous posting', employerFromHtml('<title>Offre Emploi CDI Ing&#xE9;nieur QA &#xCE;le-de-France | Hellowork</title>'), null);

const dir = mkdtempSync(join(tmpdir(), 'board-employer-'));
const cachePath = join(dir, 'employer-names.json');
let calls = 0;
const fetchImpl = async () => { calls++; return { ok: true, text: async () => page({ name: 'Capgemini' }) }; };
const rows = [
  { co: 'Hellowork', url: 'https://www.hellowork.com/fr-fr/emplois/84041101.html' },
  { co: 'Astek', url: 'https://www.hellowork.com/fr-fr/emplois/1.html' },
];
const r = await resolveBoardEmployers(rows, { cachePath, fetchImpl, sleep: async () => {} });
check('board row resolved, real employer row untouched', [rows[0].co, rows[0].boardCo, rows[1].co, calls], ['Capgemini', 'Hellowork', 'Astek', 1]);
check('counts', r, { resolved: 1, unknown: 0 });
check('answer kept', JSON.parse(readFileSync(cachePath, 'utf8'))[rows[0].url], 'Capgemini');
const again = [{ co: 'Hellowork', url: rows[0].url }];
await resolveBoardEmployers(again, { cachePath, fetchImpl, sleep: async () => {} });
check('second run reads the kept answer', [again[0].co, calls], ['Capgemini', 1]);
