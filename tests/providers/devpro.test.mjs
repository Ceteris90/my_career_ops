// tests/providers/devpro.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — devpro');

const mod = await import(pathToFileURL(join(ROOT, 'providers/devpro.mjs')).href);
const devpro = mod.default;
const { parseDevProPage, buildDevProPageUrl } = mod;

const HOST = 'https://career.dev.pro';
const BASE = `${HOST}/open-positions/`;
const FILTERED = `${HOST}/open-positions/?location=latin-america&level=senior`;

if (devpro.id === 'devpro') pass('devpro.id is "devpro"');
else fail(`devpro.id is ${JSON.stringify(devpro.id)}`);

// ── detect() ────────────────────────────────────────────────────────
{
  const hit = devpro.detect({ name: 'Dev.Pro', careers_url: BASE });
  if (hit && hit.url === BASE) pass('devpro.detect() claims the career.dev.pro URL');
  else fail(`devpro.detect() returned ${JSON.stringify(hit)}`);

  if (devpro.detect({ name: 'Dev.Pro', careers_url: `${HOST}/open-positions/page/2/` })) {
    pass('detect() claims a paginated career.dev.pro URL');
  } else fail('detect() did not claim a paginated career.dev.pro URL');

  if (devpro.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) pass('devpro.detect() null for a non-devpro URL');
  else fail('devpro.detect() accepted a non-devpro URL');

  if (devpro.detect({ name: 'X', careers_url: 'http://career.dev.pro/open-positions/' }) === null) pass('devpro.detect() rejects plain http');
  else fail('devpro.detect() accepted an http URL');

  if (devpro.detect({ name: 'X', careers_url: 'career.dev.pro/open-positions/' }) === null) pass('devpro.detect() null for a malformed URL');
  else fail('devpro.detect() accepted a malformed URL');

  if (devpro.detect({ name: 'X', careers_url: null }) === null) pass('devpro.detect() null for null careers_url');
  else fail('devpro.detect() accepted null careers_url');

  if (devpro.detect({ name: 'X' }) === null) pass('devpro.detect() null when careers_url is missing');
  else fail('devpro.detect() accepted a missing careers_url');

  if (devpro.detect({ name: 'X', careers_url: 42 }) === null) pass('devpro.detect() null for a non-string careers_url');
  else fail('devpro.detect() accepted a non-string careers_url');
}

// ── buildDevProPageUrl(): pagination + filter preservation ─────────
{
  if (buildDevProPageUrl(BASE, 1) === `${HOST}/open-positions/`) pass('page 1 is the bare root path');
  else fail(`page 1: ${buildDevProPageUrl(BASE, 1)}`);

  if (buildDevProPageUrl(BASE, 2) === `${HOST}/open-positions/page/2/`) pass('page 2 appends /page/2/');
  else fail(`page 2: ${buildDevProPageUrl(BASE, 2)}`);

  if (buildDevProPageUrl(FILTERED, 2) === `${HOST}/open-positions/page/2/?location=latin-america&level=senior`) {
    pass('pagination preserves the filter query string');
  } else fail(`filtered page 2: ${buildDevProPageUrl(FILTERED, 2)}`);

  // A careers_url that is already a /page/N/ URL stays on that page.
  const p2Url = `${HOST}/open-positions/page/2/?location=latin-america`;
  if (buildDevProPageUrl(p2Url, 2) === p2Url) pass('a /page/N/ careers_url is preserved at its own page');
  else fail(`page-2 base: ${buildDevProPageUrl(p2Url, 2)}`);

  if (buildDevProPageUrl(p2Url, 3) === `${HOST}/open-positions/page/3/?location=latin-america`) pass('pagination advances from a /page/N/ base');
  else fail(`advance from page 2: ${buildDevProPageUrl(p2Url, 3)}`);
}

// ── parseDevProPage(): normalization ───────────────────────────────
const mkRow = (id, title, location) => `
<a href="${HOST}/vacancy/${id}/" class="position-row">
    <div class="position-title"><h3>${title}</h3></div>
    <div class="position-info"> <span> ${location} </span></div>
</a>`;
const page = (...rows) => `<div class="position-wrapper">${rows.join('')}</div>`;

{
  const jobs = parseDevProPage(page(mkRow('5d2ea3', 'Intermediate Test Engineer', 'Europe, Remote')));
  if (jobs.length === 1) pass('parses one position row');
  else fail(`expected 1 job, got ${jobs.length}: ${JSON.stringify(jobs)}`);

  const [j] = jobs;
  if (j.title === 'Intermediate Test Engineer') pass('title extracted');
  else fail(`title: ${JSON.stringify(j.title)}`);
  if (j.url === `${HOST}/vacancy/5d2ea3/`) pass('url extracted');
  else fail(`url: ${j.url}`);
  if (j.location === 'Europe, Remote') pass('location extracted');
  else fail(`location: ${JSON.stringify(j.location)}`);
  if (j.company === 'Dev.Pro') pass('company is Dev.Pro');
  else fail(`company: ${JSON.stringify(j.company)}`);
}

// The template "Career Opportunities at Dev.Pro" title suffix is stripped.
{
  const jobs = parseDevProPage(page(mkRow('4eb1fb', 'Senior Software Engineer (.NET) Career Opportunities at Dev.Pro', 'Other, Remote')));
  if (jobs.length === 1 && jobs[0].title === 'Senior Software Engineer (.NET)') pass('title template suffix stripped');
  else fail(`title suffix: ${JSON.stringify(jobs[0]?.title)}`);
}

// Entities are decoded BEFORE the row is returned.
{
  const jobs = parseDevProPage(page(mkRow('5cf238', 'Intermediate Test Engineer Automation &amp; QA', 'Europe, Remote')));
  if (jobs.length === 1 && jobs[0].title === 'Intermediate Test Engineer Automation & QA') pass('title entities decoded');
  else fail(`title entities: ${JSON.stringify(jobs[0]?.title)}`);
}

// Whitespace collapsed and a location-less row yields an empty location.
{
  const [j] = parseDevProPage(page(mkRow('5d1d83', 'Intermediate   Test\n  Engineer', '')));
  if (j && j.title === 'Intermediate Test Engineer') pass('title whitespace collapsed');
  else fail(`whitespace: ${JSON.stringify(j?.title)}`);
  if (j && j.location === '') pass('a row with no location keeps an empty location');
  else fail(`empty location: ${JSON.stringify(j?.location)}`);
}

// A row missing its title is skipped, not fatal.
{
  const bad = `<a href="${HOST}/vacancy/aaaaaa/" class="position-row"><div class="position-info"> <span> Europe </span></div></a>`;
  const jobs = parseDevProPage(page(bad, mkRow('5cb0c5', 'Good Role', 'Latin America, Remote')));
  if (jobs.length === 1 && jobs[0].title === 'Good Role') pass('malformed row skipped, good one kept');
  else fail(`malformed-row handling: ${JSON.stringify(jobs)}`);
}

// Empty / contentless input → [] not a throw.
{
  if (parseDevProPage('').length === 0 && parseDevProPage(null).length === 0 && parseDevProPage('<html>no rows</html>').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// ── fetch(): pagination, redirect guard, probe cooperation ─────────
const fullPage = (rows) => {
  const out = [];
  for (let i = 0; i < rows; i++) out.push(mkRow(String(i).padStart(6, '0'), `Role ${i}`, 'Europe, Remote'));
  return page(out.join(''));
};
const mkCtx = (pages, baseUrl = BASE) => {
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    fetchText: async (url, opts) => {
      mkCtx.calls.push({ url, opts });
      return pages[url] ?? page();
    },
  };
  mkCtx.calls = [];
  return ctx;
};

// Pagination: walks pages incrementally and stops on a partial page (< PAGE_SIZE).
{
  const p2 = `${HOST}/open-positions/page/2/`;
  const p3 = `${HOST}/open-positions/page/3/`;
  const pages = {
    [BASE]: fullPage(10),                        // full page → keep going
    [p2]: fullPage(10),                          // full page → keep going
    [p3]: page(mkRow('abc123', 'Last Role', 'Europe')), // partial → last page
  };
  const ctx = mkCtx(pages);
  const jobs = await devpro.fetch({ name: 'Dev.Pro', careers_url: BASE }, ctx);
  if (jobs.length === 21 && mkCtx.calls.length === 3) pass('fetch paginates and stops on a partial page');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// An empty past-the-end page (the source 200s) also stops the walk.
{
  const p2 = `${HOST}/open-positions/page/2/`;
  const ctx = mkCtx({ [BASE]: fullPage(10), [p2]: page() });
  const jobs = await devpro.fetch({ name: 'Dev.Pro', careers_url: BASE }, ctx);
  if (jobs.length === 10 && mkCtx.calls.length === 2) pass('fetch stops on an empty past-the-end page');
  else fail(`empty-page stop: jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// A careers_url already on page 2 starts there.
{
  const p2 = `${HOST}/open-positions/page/2/`;
  const p3 = `${HOST}/open-positions/page/3/`;
  const ctx = mkCtx({ [p2]: fullPage(10), [p3]: page(mkRow('abc123', 'Last', 'Europe')) });
  const jobs = await devpro.fetch({ name: 'Dev.Pro', careers_url: p2 }, ctx);
  if (jobs.length === 11 && mkCtx.calls.length === 2) pass('fetch starts from the careers_url page');
  else fail(`start-page: jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// redirect: 'error' is passed on every request.
{
  const p2 = `${HOST}/open-positions/page/2/`;
  const ctx = mkCtx({ [BASE]: fullPage(10), [p2]: page(mkRow('abc123', 'Last', 'Europe')) });
  await devpro.fetch({ name: 'Dev.Pro', careers_url: BASE }, ctx);
  const bad = mkCtx.calls.filter(c => c.opts.redirect !== 'error');
  if (bad.length === 0 && mkCtx.calls.length === 2) pass('fetch passes redirect:"error" on every request');
  else fail(`redirect guard: ${bad.length} of ${mkCtx.calls.length} requests without redirect:"error"`);
}

// The allowlist/HTTPS guard throws BEFORE any fetch — a hostile careers_url
// never reaches the network.
{
  const ctx = {
    sleep: async () => {},
    fetchText: async () => { mkCtx.guardHit = true; return page(); },
  };
  mkCtx.guardHit = false;
  let threw = false;
  try {
    await devpro.fetch({ name: 'X', careers_url: 'http://career.dev.pro/open-positions/' }, ctx);
  } catch (e) {
    threw = true;
    if (!/untrusted/i.test(String(e.message))) fail(`guard error message: ${e.message}`);
  }
  if (threw && !mkCtx.guardHit) pass('fetch rejects a non-HTTPS careers_url before any network call');
  else fail(`guard order: threw=${threw} networkHit=${mkCtx.guardHit}`);
}

// ctx.maxPages stops the walk early (probe cooperation): exactly one list request.
{
  const p2 = `${HOST}/open-positions/page/2/`;
  const pages = { [BASE]: fullPage(10), [p2]: page(mkRow('abc123', 'Last', 'Europe')) };
  const ctx = mkCtx(pages);
  const jobs = await devpro.fetch({ name: 'Dev.Pro', careers_url: BASE }, { ...ctx, maxPages: 1 });
  if (jobs.length === 10 && mkCtx.calls.length === 1) pass('ctx.maxPages=1 fetches exactly one page (probe)');
  else fail(`probe: jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// A ctx.fetch* rejection during a probe propagates unwrapped (so the
// ProbePageBudgetReached sentinel identity survives for verify-portals).
{
  const ctx = {
    sleep: async () => {},
    fetchText: async () => { throw new Error('HTTP 429'); },
    maxPages: 1,
  };
  let threw = false;
  try {
    await devpro.fetch({ name: 'Dev.Pro', careers_url: BASE }, ctx);
  } catch (e) {
    threw = true;
    if (String(e.message) !== 'HTTP 429') fail(`probe rejection rewrapped: ${e.message}`);
  }
  if (threw) pass('probe fetch rejection propagates unwrapped');
  else fail('probe fetch rejection was swallowed to []');
}