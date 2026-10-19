// tests/providers/nix.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — nix');

const mod = await import(pathToFileURL(join(ROOT, 'providers/nix.mjs')).href);
const nix = mod.default;
const { parseNixPage, extractNextLink } = mod;

const HOST = 'https://careers.n-ix.com';
const USER_URL = `${HOST}/jobs/?subcat%5B%5D=Android&subcat%5B%5D=iOS&subcat%5B%5D=JavaScript&work_type%5B%5D=Remote&work_type%5B%5D=Office+based&keyword=`;

if (nix.id === 'nix') pass('nix.id is "nix"');
else fail(`nix.id is ${JSON.stringify(nix.id)}`);

// ── detect() ────────────────────────────────────────────────────────
{
  const hit = nix.detect({ name: 'N-iX', careers_url: USER_URL });
  if (hit && hit.url === USER_URL) pass('nix.detect() claims the careers.n-ix.com URL');
  else fail(`nix.detect() returned ${JSON.stringify(hit)}`);

  if (nix.detect({ name: 'X', careers_url: `${HOST}/jobs/` }) === null) fail('careers.n-ix.com base accepted');
  else if (nix.detect({ name: 'X', careers_url: `${HOST}/jobs/` })) pass('detect() claims a bare careers.n-ix.com/jobs URL');

  if (nix.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) pass('nix.detect() null for non-nix URL');
  else fail('nix.detect() accepted a non-nix URL');

  if (nix.detect({ name: 'X', careers_url: 'http://careers.n-ix.com/jobs/' }) === null) pass('nix.detect() rejects plain http');
  else fail('nix.detect() accepted http URL');

  if (nix.detect({ name: 'X', careers_url: 'careers.n-ix.com/jobs/' }) === null) pass('nix.detect() null for a malformed URL');
  else fail('nix.detect() accepted a malformed URL');

  if (nix.detect({ name: 'X', careers_url: null }) === null) pass('nix.detect() null for null careers_url');
  else fail('nix.detect() accepted null careers_url');

  if (nix.detect({ name: 'X' }) === null) pass('nix.detect() null when careers_url is missing');
  else fail('nix.detect() accepted a missing careers_url');

  if (nix.detect({ name: 'X', careers_url: 42 }) === null) pass('nix.detect() null for a non-string careers_url');
  else fail('nix.detect() accepted a non-string careers_url');
}

// ── parseNixPage(): normalization ──────────────────────────────────
const mkCard = (id, title, location) => `
<div class="job-card-sm">
    <div class="top-title-info">
        <a href="${HOST}/jobs/${id}-android-senior/" class="title">${title}</a>
            </div>
    <div class="info-list">
        <div><span>Type:</span>
            Office/Remote        </div>
        <div><span>Category:</span> Software Development</div>
            </div>
    <div class="info-list">
        <div><span><img src="${HOST}/wp-content/themes/careers/assets/theme/img/location.svg"/> ${location}</span></div>
    </div>
</div>`;
const page = (...cards) => `<div class="jobs-list">${cards.join('')}</div>`;

{
  const jobs = parseNixPage(page(mkCard(1, 'Senior Android Engineer', 'LATAM')));
  if (jobs.length === 1) pass('parses one job card');
  else fail(`expected 1 job, got ${jobs.length}: ${JSON.stringify(jobs)}`);

  const [j] = jobs;
  if (j.title === 'Senior Android Engineer') pass('title extracted');
  else fail(`title: ${JSON.stringify(j.title)}`);
  if (j.url === `${HOST}/jobs/1-android-senior/`) pass('url extracted');
  else fail(`url: ${j.url}`);
  if (j.location === 'LATAM') pass('location extracted');
  else fail(`location: ${JSON.stringify(j.location)}`);
  if (j.company === 'N-iX') pass('company is N-iX');
  else fail(`company: ${JSON.stringify(j.company)}`);
}

// Entities are decoded BEFORE the row is returned.
{
  const jobs = parseNixPage(page(mkCard(2, 'Senior Mobile &amp; Web Engineer', 'Europe, Ukraine')));
  if (jobs.length === 1 && jobs[0].title === 'Senior Mobile & Web Engineer') pass('title entities decoded');
  else fail(`title entities: ${JSON.stringify(jobs[0]?.title)}`);
}

// Whitespace collapsed.
{
  const [j] = parseNixPage(page(mkCard(3, 'Senior   FullStack\n  Engineer', 'LATAM')));
  if (j && j.title === 'Senior FullStack Engineer') pass('title whitespace collapsed');
  else fail(`whitespace: ${JSON.stringify(j?.title)}`);
}

// A card missing its title is skipped, not fatal.
{
  const bad = '<div class="job-card-sm"><div class="top-title-info"></div></div>';
  const jobs = parseNixPage(page(bad, mkCard(4, 'Good Role', 'Poland')));
  if (jobs.length === 1 && jobs[0].title === 'Good Role') pass('malformed card skipped, good one kept');
  else fail(`malformed-card handling: ${JSON.stringify(jobs)}`);
}

// Empty / contentless input → [] not a throw.
{
  if (parseNixPage('').length === 0 && parseNixPage(null).length === 0 && parseNixPage('<html>no cards</html>').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// ── extractNextLink() ──────────────────────────────────────────────
{
  const base = `${HOST}/jobs/?subcat%5B%5D=JavaScript`;
  const withNext = `<nav class="navigation pagination"><div class="nav-links">
    <span class="page-numbers current">1</span>
    <a class="page-numbers" href="${HOST}/jobs/page/2/">2</a>
    <a class="next page-numbers" href="${HOST}/jobs/page/2/?subcat%5B0%5D=JavaScript"><span><i class="icon"></i></span></a>
  </div></nav>`;
  const next = extractNextLink(withNext, base);
  if (next === `${HOST}/jobs/page/2/?subcat%5B0%5D=JavaScript`) pass('extractNextLink() follows the site next link with filters preserved');
  else fail(`next link: ${JSON.stringify(next)}`);

  if (extractNextLink('<nav>no next</nav>', base) === null) pass('extractNextLink() null when no next link');
  else fail('extractNextLink() did not return null for no-next page');

  // A relative next href resolves against the current page.
  const rel = extractNextLink('<a class="next page-numbers" href="/jobs/page/2/">2</a>', `${HOST}/jobs/?keyword=x`);
  if (rel === `${HOST}/jobs/page/2/`) pass('extractNextLink() resolves a relative next href');
  else fail(`relative next: ${JSON.stringify(rel)}`);

  // A next href that is not a valid URL (the regex would never produce this,
  // but an empty/whitespace href is possible in the wild) yields null rather
  // than throwing out of fetch().
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
  const p2 = `${HOST}/jobs/page/2/?subcat%5B0%5D=JavaScript`;
  const p3 = `${HOST}/jobs/page/3/?subcat%5B0%5D=JavaScript`;
  const pages = {
    [USER_URL]: page(mkCard(1, 'A', 'LATAM')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard(2, 'B', 'Poland')) + `<nav><a class="next page-numbers" href="${p3}">3</a></nav>`,
    [p3]: page(mkCard(3, 'C', 'Europe')),
  };
  const ctx = mkCtx(pages);
  const jobs = await nix.fetch({ name: 'N-iX', careers_url: USER_URL }, ctx);
  if (jobs.length === 3 && mkCtx.calls.length === 3) pass('fetch paginates through the next-link chain and stops on the last page');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// redirect: 'error' is passed on every request.
{
  const p2 = `${HOST}/jobs/page/2/`;
  const ctx = mkCtx({
    [USER_URL]: page(mkCard(1, 'A', 'LATAM')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard(2, 'B', 'Poland')),
  });
  await nix.fetch({ name: 'N-iX', careers_url: USER_URL }, ctx);
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
    await nix.fetch({ name: 'X', careers_url: 'http://careers.n-ix.com/jobs/' }, ctx);
  } catch (e) {
    threw = true;
    if (!/untrusted/i.test(String(e.message))) fail(`guard error message: ${e.message}`);
  }
  if (threw && !mkCtx.guardHit) pass('fetch rejects a non-HTTPS careers_url before any network call');
  else fail(`guard order: threw=${threw} networkHit=${mkCtx.guardHit}`);
}

// ctx.maxPages stops the walk early (probe cooperation): exactly one list request.
{
  const p2 = `${HOST}/jobs/page/2/`;
  const pages = {
    [USER_URL]: page(mkCard(1, 'A', 'LATAM')) + `<nav><a class="next page-numbers" href="${p2}">2</a></nav>`,
    [p2]: page(mkCard(2, 'B', 'Poland')),
  };
  const ctx = mkCtx(pages);
  const jobs = await nix.fetch({ name: 'N-iX', careers_url: USER_URL }, { ...ctx, maxPages: 1 });
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
    await nix.fetch({ name: 'N-iX', careers_url: USER_URL }, ctx);
  } catch (e) {
    threw = true;
    if (String(e.message) !== 'HTTP 429') fail(`probe rejection rewrapped: ${e.message}`);
  }
  if (threw) pass('probe fetch rejection propagates unwrapped');
  else fail('probe fetch rejection was swallowed to []');
}