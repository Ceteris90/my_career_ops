// tests/providers/agileengine.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — agileengine');

const mod = await import(pathToFileURL(join(ROOT, 'providers/agileengine.mjs')).href);
const agileengine = mod.default;
const { parseAgileEngineList } = mod;

const HOST = 'https://join.agileengine.com';

// A minimal card mirroring the live markup shape (2026-09-26).
const mkCard = (id, title, client, locations, url = `${HOST}/open-positions/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${client}-id${id}/`) => `
<div class="open-position">
  <div class="open-position-content">
    <div class="header-content">
      <p class="job-id hidden-cat">ID${id}</p>
      <p class="job-client"> ${client} </p>
    </div>
    <div class="description-content">
      <div class="job-cat job-location">
        <ul class="shown-locations">
          ${locations.map((l) => `<li>${l},</li>`).join('\n')}
        </ul>
        <ul class="hidden-cat"><li>LATAM,</li></ul>
      </div>
    </div>
  </div>
  <div class="footer-content hidden-in-single">
    <a class="explore-more" href="${url}" target="_blank">See details</a>
  </div>
</div>
<div class="open-position-title-holder">`;

// The real page renders the title inside h3.job-title with a canonical anchor.
const mkCardReal = (id, title, client, locations) => `
<div class="open-position">
  <div class="open-position-content">
    <div class="header-content">
      <p class="job-id hidden-cat">ID${id}</p>
      <h3 class="job-title"><a href="${HOST}/open-positions/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${client}-id${id}/">${title}</a></h3>
      <p class="job-client"> ${client} </p>
    </div>
    <div class="description-content">
      <div class="job-cat job-location">
        <ul class="shown-locations">
          ${locations.map((l) => `<li>${l},</li>`).join('\n')}
        </ul>
      </div>
    </div>
  </div>
</div>`;

if (agileengine.id === 'agileengine') pass('agileengine.id is "agileengine"');
else fail(`agileengine.id is ${JSON.stringify(agileengine.id)}`);

// detect(): matches the careers host + path; rejects everything else.
{
  const hit = agileengine.detect({ name: 'AgileEngine', careers_url: `${HOST}/open-positions/` });
  if (hit && hit.url === `${HOST}/open-positions/`) pass('agileengine.detect() matches the open-positions URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);

  const rejects = [
    { careers_url: `${HOST}/` },
    { careers_url: `${HOST}/why-us/` },
    { careers_url: 'https://example.com/open-positions/' },
    { careers_url: 'http://join.agileengine.com/open-positions/' },
    { careers_url: 'https://join.agileengine.com.evil.test/open-positions/' },
    {},
    null,
  ];
  if (rejects.every((e) => agileengine.detect(e) === null)) pass('agileengine.detect() rejects invalid/off-host/off-path URLs');
  else fail('agileengine.detect() accepted an invalid URL');
}

// parseAgileEngineList(): cards parsed; title/location decoded.
{
  const page = `<div id="general-open-positions-wrap">
    ${mkCardReal(90031, 'Senior Help Desk Technician', 'Arkestro', ['Argentina', 'Brazil', 'Colombia'])}
    ${mkCardReal(90958, 'Elixir Developer', 'Bright Harbor', ['Poland', 'Ukraine'])}
  </div>`;
  const jobs = parseAgileEngineList(page, 'AgileEngine');
  if (jobs.length === 2) pass('parses 2 job cards');
  else fail(`expected 2 jobs, got ${jobs.length}`);

  const [first, second] = jobs;
  if (first.title === 'Senior Help Desk Technician') pass('title extracted');
  else fail(`title: ${JSON.stringify(first.title)}`);
  if (first.url === `${HOST}/open-positions/senior-help-desk-technician-Arkestro-id90031/`) pass('url canonical');
  else fail(`url: ${first.url}`);
  if (first.location === 'Argentina, Brazil, Colombia') pass('locations joined (trailing commas stripped)');
  else fail(`location: ${JSON.stringify(first.location)}`);
  if (first.company === 'AgileEngine') pass('company passed through');
  else fail(`company: ${first.company}`);
  if (second.title === 'Elixir Developer' && second.location === 'Poland, Ukraine') pass('second card parsed');
  else fail(`second card: ${JSON.stringify(second)}`);
}

// HTML entities in a title are decoded before being used.
{
  const page = `<div>${mkCardReal(7, 'Dev &amp; Ops &amp;amp; Engineer', 'X', ['US'])}</div>`;
  const [job] = parseAgileEngineList(page, 'AgileEngine');
  if (job && job.title === 'Dev & Ops &amp; Engineer') pass('title entities decoded once');
  else fail(`title: ${JSON.stringify(job?.title)}`);
}

// A card whose href resolves off-host is dropped (defense in depth).
{
  const offHost = mkCardReal(1, 'Off Host', 'X', ['US']) .replace(HOST, 'https://evil.example.com');
  const jobs = parseAgileEngineList(`<div>${offHost}</div>`, 'AgileEngine');
  if (jobs.length === 0) pass('off-host card dropped');
  else fail('off-host card was not dropped');
}

// Rows missing a required field (no anchor) are skipped, not fatal.
{
  const bad = `<div class="open-position"><div class="header-content"><p class="job-client">X</p></div></div>`;
  const jobs = parseAgileEngineList(`<div>${bad}</div>`, 'AgileEngine');
  if (jobs.length === 0) pass('card without title anchor skipped');
  else fail('card without title anchor was parsed');
}

// Empty/garbage input → [] not a throw.
{
  if (parseAgileEngineList('', 'X').length === 0 && parseAgileEngineList('<html>no cards</html>', 'X').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// fetch(): single request to the canonical URL, redirect refused.
{
  let calls = [];
  const jobs = await agileengine.fetch({ name: 'AgileEngine' }, {
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return `<div id="general-open-positions-wrap">${mkCardReal(1, 'Role A', 'X', ['Poland'])}</div>`;
    },
  });
  if (calls.length === 1 && calls[0].url === `${HOST}/open-positions/`) pass('fetch() makes one request to the list URL');
  else fail(`calls: ${JSON.stringify(calls.map((c) => c.url))}`);
  if (calls[0].opts?.redirect === 'error') pass('fetch() refuses redirects');
  else fail('fetch() must refuse redirects');
  if (jobs.length === 1 && jobs[0].title === 'Role A') pass('fetch() returns parsed jobs');
  else fail(`jobs: ${JSON.stringify(jobs)}`);
}

// enrichDate(): reads datePosted (and description) from detail JSON-LD.
{
  const job = { title: 'X', url: `${HOST}/open-positions/x/`, company: 'AgileEngine', location: 'Poland' };
  const detail = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","datePosted":"2026-09-25T14:33:22+00:00","description":"Join AgileEngine as a Senior Help Desk Technician."}</script>`;
  await agileengine.enrichDate(job, { fetchText: async () => detail });
  if (job.postedAt === Date.parse('2026-09-25T14:33:22+00:00')) pass('enrichDate sets postedAt from JSON-LD datePosted');
  else fail(`postedAt: ${job.postedAt}`);
  if (job.description === 'Join AgileEngine as a Senior Help Desk Technician.') pass('enrichDate fills description');
  else fail(`description: ${job.description}`);
}
// datePosted nested under @graph is still found.
{
  const job = { title: 'X', url: `${HOST}/open-positions/x/`, company: 'AgileEngine', location: 'Poland' };
  const detail = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting","datePosted":"2026-09-24"}]}</script>`;
  await agileengine.enrichDate(job, { fetchText: async () => detail });
  if (job.postedAt === Date.parse('2026-09-24')) pass('enrichDate reads datePosted from an @graph JobPosting node');
  else fail(`@graph postedAt: ${job.postedAt}`);
}
// No JobPosting node → job stays undated.
{
  const job = { title: 'X', url: `${HOST}/open-positions/x/`, company: 'AgileEngine', location: 'Poland' };
  await agileengine.enrichDate(job, { fetchText: async () => '<html>no ldjson</html>' });
  if (job.postedAt === undefined) pass('enrichDate leaves job undated when JSON-LD missing');
  else fail(`postedAt unexpectedly set: ${job.postedAt}`);
}
// Malformed JSON-LD doesn't throw.
{
  const job = { title: 'X', url: `${HOST}/open-positions/x/`, company: 'AgileEngine', location: 'Poland' };
  await agileengine.enrichDate(job, { fetchText: async () => '<script type="application/ld+json">{broken json</script>' });
  if (job.postedAt === undefined) pass('enrichDate tolerates malformed JSON-LD without throwing');
  else fail(`postedAt unexpectedly set: ${job.postedAt}`);
}