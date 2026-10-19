// tests/providers/creatio.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — creatio');

const mod = await import(pathToFileURL(join(ROOT, 'providers/creatio.mjs')).href);
const creatio = mod.default;
const { parseCreatioList } = mod;

const HOST = 'https://www.creatio.com';

// A minimal group/row mirroring the live Drupal Views markup (2026-09-26).
const mkGroup = (department, rows) => `
<div class="views-group">
  <div class="creatio-animation creatio-animation_fade-in">
    <div class="views-group__title">${department}</div>
  </div>
  ${rows.join('')}
</div>`;
const mkRow = (slug, title, location, region) => `
<div class="creatio-animation creatio-animation_fade-in">
  <div class="views-row">
    <div class="views-field views-field-field-hot"><div class="field-content">HOT</div></div>
    <div class="views-field views-field-title"><a href="/company/careers/job-openings/${slug}" hreflang="und">${title} </a></div>
    <div class="views-field views-field-field-vacancy-location"><a href="/company/careers/job-openings/${slug}" title="Location">${location}</a></div>
    <div class="views-field views-field-field-vacancy-region"><a href="/company/careers/job-openings/${slug}" title="Market">${region}</a></div>
  </div>
</div>`;

if (creatio.id === 'creatio') pass('creatio.id is "creatio"');
else fail(`creatio.id is ${JSON.stringify(creatio.id)}`);

// detect(): matches the careers host + path; rejects everything else.
{
  const hit = creatio.detect({ name: 'Creatio', careers_url: `${HOST}/company/careers/job-openings` });
  if (hit && hit.url === `${HOST}/company/careers/job-openings`) pass('creatio.detect() matches the job-openings URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);

  // A sub-path (a single posting) is still on the list page and is claimed.
  const sub = creatio.detect({ careers_url: `${HOST}/company/careers/job-openings/ai-consultant` });
  if (sub && sub.url === `${HOST}/company/careers/job-openings`) pass('creatio.detect() matches a posting sub-path');
  else fail(`detect() did not match a posting sub-path: ${JSON.stringify(sub)}`);

  const rejects = [
    { careers_url: `${HOST}/company/careers` },
    { careers_url: `${HOST}/` },
    { careers_url: 'https://example.com/company/careers/job-openings' },
    { careers_url: 'http://www.creatio.com/company/careers/job-openings' },
    { careers_url: 'https://www.creatio.com.evil.test/company/careers/job-openings' },
    {},
    null,
  ];
  if (rejects.every((e) => creatio.detect(e) === null)) pass('creatio.detect() rejects invalid/off-host/off-path URLs');
  else fail('creatio.detect() accepted an invalid URL');
}

// parseCreatioList(): groups + rows parsed; title/location/region extracted.
{
  const page = mkGroup('Engineering, Product &amp; Platform', [
    mkRow('full-stack-developer-netangular', 'Full-Stack Developer (.NET + Angular)', 'Poland', 'Europe'),
    mkRow('ai-engineer', 'AI Engineer', 'Ukraine', 'Global market'),
  ]);
  const jobs = parseCreatioList(page, 'Creatio');
  if (jobs.length === 2) pass('parses 2 job cards');
  else fail(`expected 2 jobs, got ${jobs.length}`);

  const [first, second] = jobs;
  if (first.title === 'Full-Stack Developer (.NET + Angular)') pass('title extracted');
  else fail(`title: ${JSON.stringify(first.title)}`);
  if (first.url === `${HOST}/company/careers/job-openings/full-stack-developer-netangular`) pass('url canonical');
  else fail(`url: ${first.url}`);
  if (first.location === 'Poland, Europe') pass('location + region joined');
  else fail(`location: ${JSON.stringify(first.location)}`);
  if (first.company === 'Creatio') pass('company passed through');
  else fail(`company: ${first.company}`);
  if (second.title === 'AI Engineer' && second.location === 'Ukraine, Global market') pass('second card parsed');
  else fail(`second card: ${JSON.stringify(second)}`);
}

// HTML entities in a title are decoded before being used.
{
  const page = mkGroup('Operations, Finance &amp; Legal', [mkRow('analyst', 'Dev &amp; Ops &amp;amp; Analyst', 'US', 'Global market')]);
  const [job] = parseCreatioList(page, 'Creatio');
  if (job && job.title === 'Dev & Ops &amp; Analyst') pass('title entities decoded once');
  else fail(`title: ${JSON.stringify(job?.title)}`);
}

// A card whose href resolves off-host is dropped (defense in depth).
{
  const offHost = mkRow('role', 'Off Host', 'US', 'Global market').replace('/company/careers/job-openings/', 'https://evil.example.com/job/');
  const jobs = parseCreatioList(mkGroup('Sales', [offHost]), 'Creatio');
  if (jobs.length === 0) pass('off-host card dropped');
  else fail('off-host card was not dropped');
}

// A group with no rows (department header only) yields nothing.
{
  const jobs = parseCreatioList(mkGroup('HR', []), 'Creatio');
  if (jobs.length === 0) pass('empty group yields no jobs');
  else fail('empty group yielded jobs');
}

// Rows missing a required field (no title anchor) are skipped, not fatal.
{
  const bad = `<div class="views-row"><div class="views-field views-field-title"><a href="/company/careers/job-openings/x"></a></div></div>`;
  const jobs = parseCreatioList(mkGroup('HR', [bad]), 'Creatio');
  if (jobs.length === 0) pass('row without title skipped');
  else fail('row without title was parsed');
}

// Empty/garbage input → [] not a throw.
{
  if (parseCreatioList('', 'X').length === 0 && parseCreatioList('<html>no cards</html>', 'X').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// fetch(): single request to the canonical URL, redirect refused.
{
  let calls = [];
  const jobs = await creatio.fetch({ name: 'Creatio' }, {
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return mkGroup('Sales', [mkRow('role-a', 'Role A', 'Poland', 'Europe')]);
    },
  });
  if (calls.length === 1 && calls[0].url === `${HOST}/company/careers/job-openings`) pass('fetch() makes one request to the list URL');
  else fail(`calls: ${JSON.stringify(calls.map((c) => c.url))}`);
  if (calls[0].opts?.redirect === 'error') pass('fetch() refuses redirects');
  else fail('fetch() must refuse redirects');
  if (jobs.length === 1 && jobs[0].title === 'Role A') pass('fetch() returns parsed jobs');
  else fail(`jobs: ${JSON.stringify(jobs)}`);
}