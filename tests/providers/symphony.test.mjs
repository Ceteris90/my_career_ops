// tests/providers/symphony.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — symphony');

const mod = await import(pathToFileURL(join(ROOT, 'providers/symphony.mjs')).href);
const symphony = mod.default;
const { parseSymphonyList } = mod;

const HOST = 'https://symphony-solutions.com';

// A minimal card mirroring the live markup shape (2026-09-26).
const mkCard = (id, title, locations, url = `${HOST}/vacancy/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`) => `
<article data-id="${id}" class="item-vacancy">
  <a href="${url}" class="box-vacancy--link"></a>
  <div class="item-vacancy--content ss-grid--box row align-items-center">
    <div class="item-vacancy--main col-md">
      <h3 class="item-vacancy--title fw-500 txt-ttl-4 mb-3">
        ${title}      </h3>
      <div class="flex-align-center cl-muted">
        <div class="mr-1">
          <svg class="svg-icon"><use xlink:href="#icon-location"></use></svg>
        </div>
        ${locations.map((l) => `<span>\n  ${l}            </span>`).join('\n')}
      </div>
    </div>
    <div class="item-vacancy--actions col-auto">
      <a href="${url}" class="ss-btn btn-sm btn-alt relative-z1 mt-2 mt-md-0">Check more</a>
    </div>
  </div>
</article>`;

if (symphony.id === 'symphony') pass('symphony.id is "symphony"');
else fail(`symphony.id is ${JSON.stringify(symphony.id)}`);

// detect(): matches the careers host + path; rejects everything else.
{
  const hit = symphony.detect({ name: 'Symphony Solutions', careers_url: `${HOST}/vacancies` });
  if (hit && hit.url === `${HOST}/vacancies`) pass('symphony.detect() matches the vacancies URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);

  const rejects = [
    { careers_url: `${HOST}/` },
    { careers_url: `${HOST}/quick-apply` },
    { careers_url: 'https://example.com/vacancies' },
    { careers_url: 'http://symphony-solutions.com/vacancies' },
    { careers_url: 'https://symphony-solutions.com.evil.test/vacancies' },
    {},
    null,
  ];
  if (rejects.every((e) => symphony.detect(e) === null)) pass('symphony.detect() rejects invalid/off-host/off-path URLs');
  else fail('symphony.detect() accepted an invalid URL');
}

// parseSymphonyList(): cards parsed; title/location decoded.
{
  const page = `<div class="filterItemsWrapper multiMixer multimixer-el" data-limit="100">
    <div class="listing-grid--item is-active staticFilterItem mb-2 mb-lg-4 mix loc-macedonia loc-poland">
      ${mkCard(93639, 'Voice AI Consultant', ['Macedonia', 'Poland'])}
    </div>
    <div class="listing-grid--item is-active staticFilterItem mb-2 mb-lg-4 mix loc-ukraine">
      ${mkCard(93477, 'Middle Full-Stack Software Engineer (React + .NET)', ['Ukraine'], `${HOST}/vacancy/middle-senior-full-stack-software-engineer-react-net`)}
    </div>
  </div>`;
  const jobs = parseSymphonyList(page, 'Symphony Solutions');
  if (jobs.length === 2) pass('parses 2 job cards');
  else fail(`expected 2 jobs, got ${jobs.length}`);

  const [first, second] = jobs;
  if (first.title === 'Voice AI Consultant') pass('title extracted');
  else fail(`title: ${JSON.stringify(first.title)}`);
  if (first.url === `${HOST}/vacancy/voice-ai-consultant`) pass('url canonical');
  else fail(`url: ${first.url}`);
  if (first.location === 'Macedonia, Poland') pass('locations joined');
  else fail(`location: ${JSON.stringify(first.location)}`);
  if (first.company === 'Symphony Solutions') pass('company passed through');
  else fail(`company: ${first.company}`);
  if (second.title === 'Middle Full-Stack Software Engineer (React + .NET)' && second.location === 'Ukraine') pass('second card parsed');
  else fail(`second card: ${JSON.stringify(second)}`);
}

// HTML entities in a title are decoded before being used.
{
  const page = `<div>${mkCard(7, 'Dev &amp; Ops &amp;amp; Engineer', ['US'])}</div>`;
  const [job] = parseSymphonyList(page, 'Symphony Solutions');
  if (job && job.title === 'Dev & Ops &amp; Engineer') pass('title entities decoded once');
  else fail(`title: ${JSON.stringify(job?.title)}`);
}

// A card whose href resolves off-host is dropped (defense in depth).
{
  const offHost = mkCard(1, 'Off Host', ['US']).replace(HOST, 'https://evil.example.com');
  const jobs = parseSymphonyList(`<div>${offHost}</div>`, 'Symphony Solutions');
  if (jobs.length === 0) pass('off-host card dropped');
  else fail('off-host card was not dropped');
}

// A non-vacancy <article> (no item-vacancy class) is skipped.
{
  const notVacancy = `<article class="post"><h2>Blog post</h2></article>`;
  const jobs = parseSymphonyList(`<div>${notVacancy}</div>`, 'Symphony Solutions');
  if (jobs.length === 0) pass('non-item-vacancy article skipped');
  else fail('non-item-vacancy article was parsed');
}

// Rows missing a required field (no title anchor) are skipped, not fatal.
{
  const bad = `<article class="item-vacancy"><a class="box-vacancy--link"></a><div>no title</div></article>`;
  const jobs = parseSymphonyList(`<div>${bad}</div>`, 'Symphony Solutions');
  if (jobs.length === 0) pass('card without title skipped');
  else fail('card without title was parsed');
}

// Empty/garbage input → [] not a throw.
{
  if (parseSymphonyList('', 'X').length === 0 && parseSymphonyList('<html>no cards</html>', 'X').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// fetch(): single request to the canonical URL, redirect refused.
{
  let calls = [];
  const jobs = await symphony.fetch({ name: 'Symphony Solutions' }, {
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return `<div class="filterItemsWrapper">${mkCard(1, 'Role A', ['Poland'])}</div>`;
    },
  });
  if (calls.length === 1 && calls[0].url === `${HOST}/vacancies`) pass('fetch() makes one request to the list URL');
  else fail(`calls: ${JSON.stringify(calls.map((c) => c.url))}`);
  if (calls[0].opts?.redirect === 'error') pass('fetch() refuses redirects');
  else fail('fetch() must refuse redirects');
  if (jobs.length === 1 && jobs[0].title === 'Role A') pass('fetch() returns parsed jobs');
  else fail(`jobs: ${JSON.stringify(jobs)}`);
}