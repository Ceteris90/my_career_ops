// tests/providers/dou.test.mjs — provider-contract tests for the DOU provider
// (providers/dou.mjs). DOU serves a board-wide RSS feed and per-company feeds
// from the same format; this provider covers both.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dou');

const FEED_URL = 'https://jobs.dou.ua/vacancies/feeds/';

try {
  const douModule = await import(pathToFileURL(join(ROOT, 'providers/dou.mjs')).href);
  const dou = douModule.default;
  const { parseDouFeed } = douModule;

  if (dou.id === 'dou') pass('dou.id is "dou"');
  else fail(`dou.id is ${JSON.stringify(dou.id)}`);

  // detect() — explicit provider:dou selects the board-wide feed
  const boardHit = dou.detect({ name: 'DOU', provider: 'dou' });
  if (boardHit && boardHit.url === FEED_URL) pass('dou.detect() resolves provider:dou → board feed URL');
  else fail(`dou.detect() board hit = ${JSON.stringify(boardHit)}`);

  // detect() — a company vacancies careers_url maps to that company's feed
  const companyHit = dou.detect({ name: 'Acme', careers_url: 'https://jobs.dou.ua/companies/acme-co/vacancies/' });
  if (companyHit && companyHit.url === 'https://jobs.dou.ua/vacancies/acme-co/feeds/') {
    pass('dou.detect() maps a company vacancies page to its feed');
  } else {
    fail(`dou.detect() company hit = ${JSON.stringify(companyHit)}`);
  }

  // detect() — untrusted / malformed / missing input returns null (never throws)
  const badCases = [
    null,
    {},
    { name: 'X' },
    { name: 'X', careers_url: 'not a url' },
    { name: 'X', careers_url: 'http://jobs.dou.ua/companies/acme-co/vacancies/' },
    { name: 'X', careers_url: 'https://evil.example.com/companies/acme-co/vacancies/' },
    { name: 'X', careers_url: 'https://jobs.dou.ua/companies/acme-co/about/' },
    { name: 'X', careers_url: 'https://jobs.dou.ua/companies/acme-co/' },
    { name: 'X', careers_url: 'https://jobs.dou.ua/vacancies/' },
  ];
  const allNull = badCases.every(entry => dou.detect(entry) === null);
  if (allNull) pass('dou.detect() returns null for untrusted, malformed and non-company URLs (no throw)');
  else fail('dou.detect() should return null for every bad input case');

  // parseDouFeed — a sample with the real DOU item shape (company/location in title,
  // utm query on the link, HTML description)
  const sampleXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0"><channel><title>Вакансії «Genesis» на DOU.ua</title>',
    '<item>',
    '  <title>Senior PPC Specialist в Genesis, Київ, гібрид</title>',
    '  <link>https://jobs.dou.ua/companies/acme-co/vacancies/374140/?utm_source=jobsrss</link>',
    '  <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description>',
    '  <pubDate>Tue, 22 Sep 2026 13:13:37 +0300</pubDate>',
    '</item>',
    '<item>',
    '  <title>Backend &amp; Frontend Developer в Fallback Co</title>',
    '  <link>https://jobs.dou.ua/companies/acme-co/vacancies/374141/?utm_source=jobsrss</link>',
    '</item>',
    '<item>',
    '  <title>Ghost (no link)</title>',
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parseDouFeed(sampleXml);
  if (jobs.length === 2) pass('parseDouFeed keeps 2 valid items (drops the link-less one)');
  else fail(`parseDouFeed returned ${jobs.length} jobs, expected 2`);

  if (jobs[0]?.title === 'Senior PPC Specialist' && jobs[0]?.company === 'Genesis' && jobs[0]?.location === 'Київ, гібрид') {
    pass('parseDouFeed extracts title/company/location from the "title в company, location" form');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://jobs.dou.ua/companies/acme-co/vacancies/374140/') {
    pass('parseDouFeed strips the utm query from the job URL (clean dedup key)');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('Tue, 22 Sep 2026 13:13:37 +0300')) {
    pass('parseDouFeed parses pubDate → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[0]?.description?.includes('welcome')) {
    pass('parseDouFeed decodes the HTML description');
  } else {
    fail(`row 0 description = ${JSON.stringify(jobs[0]?.description)}`);
  }

  if (jobs[1]?.title === 'Backend & Frontend Developer' && jobs[1]?.company === 'Fallback Co') {
    pass('parseDouFeed decodes an &amp; entity in the title before keyword matching');
  } else {
    fail(`row 1 = ${JSON.stringify(jobs[1])}`);
  }

  // Robustness
  if (parseDouFeed('').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');
  if (parseDouFeed(null).length === 0) pass('null input → empty result (no crash)');
  else fail('null input should yield empty result without crashing');

  // fetch() — board entry hits the board feed with redirect:'error'
  const boardJobs = await dou.fetch(
    { name: 'DOU', provider: 'dou' },
    {
      fetchText: async (url, options) => {
        if (url !== FEED_URL) throw new Error(`fetchText called with unexpected URL: ${url}`);
        if (options?.redirect !== 'error') throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (boardJobs.length === 2) pass('dou.fetch() (board) hits the board feed with redirect:error and returns parsed jobs');
  else fail(`dou.fetch() (board) returned ${boardJobs.length} jobs, expected 2`);

  // fetch() — company entry hits that company's feed with redirect:'error'
  const companyJobs = await dou.fetch(
    { name: 'Acme', careers_url: 'https://jobs.dou.ua/companies/acme-co/vacancies/' },
    {
      fetchText: async (url, options) => {
        if (url !== 'https://jobs.dou.ua/vacancies/acme-co/feeds/') throw new Error(`fetchText called with unexpected URL: ${url}`);
        if (options?.redirect !== 'error') throw new Error(`fetchText called without redirect:'error': ${JSON.stringify(options)}`);
        return sampleXml;
      },
      fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    },
  );
  if (companyJobs.length === 2) pass('dou.fetch() (company) hits the company feed with redirect:error and returns parsed jobs');
  else fail(`dou.fetch() (company) returned ${companyJobs.length} jobs, expected 2`);

} catch (e) {
  fail(`dou provider tests crashed: ${e.message}`);
}