// tests/providers/globallogic.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — globallogic');

const mod = await import(pathToFileURL(join(ROOT, 'providers/globallogic.mjs')).href);
const globallogic = mod.default;
const { parseGlobalLogicPage, extractNextLink, assertListingUrl } = mod;

const HOST = 'https://www.globallogic.com';
const USER_URL = `${HOST}/ua/career-search-page/?work_models=freelance%2Cremote%2Chybrid`;

if (globallogic.id === 'globallogic') pass('globallogic.id is "globallogic"');
else fail(`globallogic.id is ${JSON.stringify(globallogic.id)}`);

// ── detect() ────────────────────────────────────────────────────────
{
  const hit = globallogic.detect({ name: 'GlobalLogic', careers_url: USER_URL });
  if (hit && hit.url === USER_URL) pass('globallogic.detect() claims the globallogic.com listing URL');
  else fail(`globallogic.detect() returned ${JSON.stringify(hit)}`);

  if (globallogic.detect({ name: 'X', careers_url: `${HOST}/en/career-search-page/` }) === null) fail('en career-search-page accepted');
  else if (globallogic.detect({ name: 'X', careers_url: `${HOST}/en/career-search-page/` })) pass('detect() claims a bare /career-search-page/ URL');

  if (globallogic.detect({ name: 'X', careers_url: 'https://example.com/career-search-page/' }) === null) pass('globallogic.detect() null for non-globallogic host');
  else fail('globallogic.detect() accepted a non-globallogic host');

  if (globallogic.detect({ name: 'X', careers_url: 'http://www.globallogic.com/ua/career-search-page/' }) === null) pass('globallogic.detect() rejects plain http');
  else fail('globallogic.detect() accepted http URL');

  if (globallogic.detect({ name: 'X', careers_url: 'www.globallogic.com/ua/career-search-page/' }) === null) pass('globallogic.detect() null for a malformed URL');
  else fail('globallogic.detect() accepted a malformed URL');

  if (globallogic.detect({ name: 'X', careers_url: null }) === null) pass('globallogic.detect() null for null careers_url');
  else fail('globallogic.detect() accepted null careers_url');

  if (globallogic.detect({ name: 'X' }) === null) pass('globallogic.detect() null when careers_url is missing');
  else fail('globallogic.detect() accepted a missing careers_url');

  if (globallogic.detect({ name: 'X', careers_url: 42 }) === null) pass('globallogic.detect() null for a non-string careers_url');
  else fail('globallogic.detect() accepted a non-string careers_url');
}

// ── assertListingUrl() ─────────────────────────────────────────────
{
  const good = assertListingUrl(USER_URL);
  if (good.href === USER_URL) pass('assertListingUrl() accepts the globallogic.com listing URL');
  else fail(`assertListingUrl() returned ${good.href}`);

  let threw = false;
  try { assertListingUrl('http://www.globallogic.com/ua/career-search-page/'); } catch (e) { threw = true; }
  if (threw) pass('assertListingUrl() rejects plain http');
  else fail('assertListingUrl() accepted http');

  threw = false;
  try { assertListingUrl('https://example.com/ua/career-search-page/'); } catch (e) { threw = true; }
  if (threw) pass('assertListingUrl() rejects an untrusted host');
  else fail('assertListingUrl() accepted an untrusted host');

  threw = false;
  try { assertListingUrl('https://www.globallogic.com/ua/careers/'); } catch (e) { threw = true; }
  if (threw) pass('assertListingUrl() rejects a non-listing path');
  else fail('assertListingUrl() accepted a non-listing path');
}

// ── parseGlobalLogicPage(): normalization ──────────────────────────
const mkCard = (slug, title, location) => `
<a href="${HOST}/ua/careers/${slug}-irc${slug.replace(/\D/g, '')}/" class="job_box">
    <div class="top_area">
        ${location}
    </div>
    <h4>${title}</h4>
</a>`;
const page = (...cards) => `<div class="career_filter_result">${cards.join('')}</div>`;

{
  const jobs = parseGlobalLogicPage(page(
    mkCard('senior-android-engineer', 'Senior Android Engineer', '<span class="job_location">Ukraine</span> <span class="job_tag">Remote</span>'),
  ), 'GlobalLogic');
  if (jobs.length === 1) pass('parses one job card');
  else fail(`expected 1 job, got ${jobs.length}: ${JSON.stringify(jobs)}`);

  const [j] = jobs;
  if (j.title === 'Senior Android Engineer') pass('title extracted');
  else fail(`title: ${JSON.stringify(j.title)}`);
  if (j.url === `${HOST}/ua/careers/senior-android-engineer-irc/`) pass('url extracted');
  else fail(`url: ${j.url}`);
  if (j.location === 'Ukraine, Remote') pass('location + work-model tag joined');
  else fail(`location: ${JSON.stringify(j.location)}`);
  if (j.company === 'GlobalLogic') pass('company is GlobalLogic');
  else fail(`company: ${JSON.stringify(j.company)}`);
}

// Multiple office locations joined with the tag.
{
  const jobs = parseGlobalLogicPage(page(
    mkCard('senior-data-engineer', 'Senior Data Engineer', '<span class="job_location">Poland</span><span class="job_location">Wroclaw</span><span class="job_tag">Hybrid</span>'),
  ), 'GlobalLogic');
  if (jobs[0]?.location === 'Poland, Wroclaw, Hybrid') pass('multiple locations joined');
  else fail(`multi-location: ${JSON.stringify(jobs[0]?.location)}`);
}

// Entities are decoded BEFORE the row is returned.
{
  const jobs = parseGlobalLogicPage(page(
    mkCard('senior-mobile', 'Senior Mobile &amp; Web Engineer', '<span class="job_location">Europe</span>'),
  ), 'GlobalLogic');
  if (jobs.length === 1 && jobs[0].title === 'Senior Mobile & Web Engineer') pass('title entities decoded');
  else fail(`title entities: ${JSON.stringify(jobs[0]?.title)}`);
}

// Whitespace collapsed.
{
  const [j] = parseGlobalLogicPage(page(mkCard('senior-fullstack', 'Senior   FullStack\n  Engineer', '<span class="job_location">Ukraine</span>')), 'GlobalLogic');
  if (j && j.title === 'Senior FullStack Engineer') pass('title whitespace collapsed');
  else fail(`whitespace: ${JSON.stringify(j?.title)}`);
}

// A card missing its title, or pointing off-host, is skipped, not fatal.
{
  const bad = '<a href="https://www.globallogic.com/ua/careers/bad-irc1/" class="job_box"><div class="top_area"></div></a>';
  const offHost = `<a href="https://example.com/evil" class="job_box"><h4>Evil</h4></a>`;
  const jobs = parseGlobalLogicPage(page(bad, offHost, mkCard('good', 'Good Role', '<span class="job_location">Poland</span>')), 'GlobalLogic');
  if (jobs.length === 1 && jobs[0].title === 'Good Role') pass('malformed/off-host cards skipped, good one kept');
  else fail(`malformed-card handling: ${JSON.stringify(jobs)}`);
}

// Empty / contentless input → [] not a throw.
{
  if (parseGlobalLogicPage('', 'GlobalLogic').length === 0
    && parseGlobalLogicPage(null, 'GlobalLogic').length === 0
    && parseGlobalLogicPage('<html>no cards</html>', 'GlobalLogic').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// ── extractNextLink() ──────────────────────────────────────────────
{
  const base = `${HOST}/ua/career-search-page/?work_models=freelance%2Cremote%2Chybrid`;
  const withNext = `<nav class="navigation pagination"><div class="nav-links">
    <span class="page-numbers current">1</span>
    <a class="page-numbers" href="${HOST}/ua/career-search-page/page/2/">2</a>
    <a class="next page-numbers" href="${HOST}/ua/career-search-page/page/2/?work_models=freelance%2Cremote%2Chybrid"><span><i class="icon"></i></span></a>
  </div></nav>`;
  const next = extractNextLink(withNext, base);
  if (next === `${HOST}/ua/career-search-page/page/2/?work_models=freelance%2Cremote%2Chybrid`) pass('extractNextLink() follows the site next link with filters preserved');
  else fail(`next link: ${JSON.stringify(next)}`);

  if (extractNextLink('<nav>no next</nav>', base) === null) pass('extractNextLink() null when no next link');
  else fail('extractNextLink() did not return null for no-next page');

  // A relative next href resolves against the current page.
  const rel = extractNextLink('<a class="next page-numbers" href="/ua/career-search-page/page/2/">2</a>', base);
  if (rel === `${HOST}/ua/career-search-page/page/2/`) pass('extractNextLink() resolves a relative next href');
  else fail(`relative next: ${JSON.stringify(rel)}`);

  if (extractNextLink('<a class="next page-numbers" href="">x</a>', base) === null) pass('extractNextLink() null for an empty href');
  else fail('extractNextLink() accepted an empty href');
}

// ── fetch(): pagination, redirect guard, probe cooperation ─────────
const mkCtx = (pages, baseUrl = USER_URL) => {
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

// Pagination: walks the next-link chain and stops when no next link exists.
{
  const p2 = `${HOST}/ua/career-search-page/page/2/?work_models=freelance%2Cremote%2Chybrid`;
  const p3 = `${HOST}/ua/career-search-page/page/3/?work_models=freelance%2Cremote%2Chybrid`;
  const pages = {
    [USER_URL]: page(mkCard('a', 'A', '<span class="job_location">Ukraine</span>')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard('b', 'B', '<span class="job_location">Poland</span>')) + `<nav><a class="next page-numbers" href="${p3}">3</a></nav>`,
    [p3]: page(mkCard('c', 'C', '<span class="job_location">Europe</span>')),
  };
  const ctx = mkCtx(pages);
  const jobs = await globallogic.fetch({ name: 'GlobalLogic', careers_url: USER_URL }, ctx);
  if (jobs.length === 3 && mkCtx.calls.length === 3) pass('fetch paginates through the next-link chain and stops on the last page');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// redirect: 'error' is passed on every request.
{
  const p2 = `${HOST}/ua/career-search-page/page/2/`;
  const ctx = mkCtx({
    [USER_URL]: page(mkCard('a', 'A', '<span class="job_location">Ukraine</span>')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard('b', 'B', '<span class="job_location">Poland</span>')),
  });
  await globallogic.fetch({ name: 'GlobalLogic', careers_url: USER_URL }, ctx);
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
    await globallogic.fetch({ name: 'X', careers_url: 'http://www.globallogic.com/ua/career-search-page/' }, ctx);
  } catch (e) {
    threw = true;
    if (!/https/i.test(String(e.message))) fail(`guard error message: ${e.message}`);
  }
  if (threw && !mkCtx.guardHit) pass('fetch rejects a non-HTTPS careers_url before any network call');
  else fail(`guard order: threw=${threw} networkHit=${mkCtx.guardHit}`);
}

// ctx.maxPages stops the walk early (probe cooperation): exactly one list request.
{
  const p2 = `${HOST}/ua/career-search-page/page/2/`;
  const pages = {
    [USER_URL]: page(mkCard('a', 'A', '<span class="job_location">Ukraine</span>')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard('b', 'B', '<span class="job_location">Poland</span>')),
  };
  const ctx = mkCtx(pages);
  const jobs = await globallogic.fetch({ name: 'GlobalLogic', careers_url: USER_URL }, { ...ctx, maxPages: 1 });
  if (jobs.length === 1 && mkCtx.calls.length === 1) pass('ctx.maxPages=1 fetches exactly one page (probe)');
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
    await globallogic.fetch({ name: 'GlobalLogic', careers_url: USER_URL }, ctx);
  } catch (e) {
    threw = true;
    if (String(e.message) !== 'HTTP 429') fail(`probe rejection rewrapped: ${e.message}`);
  }
  if (threw) pass('probe fetch rejection propagates unwrapped');
  else fail('probe fetch rejection was swallowed to []');
}