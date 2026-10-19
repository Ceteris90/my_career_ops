// tests/providers/innovecs.test.mjs
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — innovecs');

const mod = await import(pathToFileURL(join(ROOT, 'providers/innovecs.mjs')).href);
const innovecs = mod.default;
const { parseInnovecsPage, isFullDocument, pageUrl } = mod;

const HOST = 'https://jobs.innovecs.com';
const USER_URL = `${HOST}/vacancies/`;
const CAT_URL = `${HOST}/vacancies/java/`;

if (innovecs.id === 'innovecs') pass('innovecs.id is "innovecs"');
else fail(`innovecs.id is ${JSON.stringify(innovecs.id)}`);

// ── detect() ────────────────────────────────────────────────────────
{
  const hit = innovecs.detect({ name: 'Innovecs', careers_url: USER_URL });
  if (hit && hit.url === USER_URL) pass('detect() claims the jobs.innovecs.com/vacancies/ URL');
  else fail(`detect() returned ${JSON.stringify(hit)}`);

  const cat = innovecs.detect({ name: 'Innovecs', careers_url: CAT_URL });
  if (cat && cat.url === CAT_URL) pass('detect() claims a category /vacancies/java/ URL');
  else fail(`detect() category: ${JSON.stringify(cat)}`);

  if (innovecs.detect({ name: 'X', careers_url: 'https://example.com/jobs' }) === null) pass('detect() null for a non-innovecs URL');
  else fail('detect() accepted a non-innovecs URL');

  if (innovecs.detect({ name: 'X', careers_url: 'http://jobs.innovecs.com/vacancies/' }) === null) pass('detect() rejects plain http');
  else fail('detect() accepted http URL');

  if (innovecs.detect({ name: 'X', careers_url: 'https://innovecs.com/vacancies/' }) === null) pass('detect() rejects the wrong (non-jobs) host');
  else fail('detect() accepted the wrong host');

  if (innovecs.detect({ name: 'X', careers_url: 'jobs.innovecs.com/vacancies/' }) === null) pass('detect() null for a malformed URL');
  else fail('detect() accepted a malformed URL');

  if (innovecs.detect({ name: 'X', careers_url: null }) === null) pass('detect() null for null careers_url');
  else fail('detect() accepted null careers_url');

  if (innovecs.detect({ name: 'X' }) === null) pass('detect() null when careers_url is missing');
  else fail('detect() accepted a missing careers_url');

  if (innovecs.detect({ name: 'X', careers_url: 42 }) === null) pass('detect() null for a non-string careers_url');
  else fail('detect() accepted a non-string careers_url');
}

// ── parseInnovecsPage(): normalization ─────────────────────────────
const mkCard = (id, title, locations) => `
<a  href='${HOST}/vacancies/${id}-${title.replace(/\s+/g, '-').toLowerCase()}/' class='box  box--archive-vacancies-v2--vacancies--item  cursor-apply wrap-animation-icon  col-12 item item-${id}' data-x-data data-x-scroller data-threshold="0.8"
		data-x-cursor='{"text": "APPLY"}'
>
	<div class="grid-middle-spaceBetween gutter-26 wrapper">
		<div class="col_xs-12 wrap-job-info">
			<div class="h12">
				<div class="title-item">${title}</div>
			</div>
			<div class="info h20">
				${locations}
			</div>
		</div>
	</div>
</a>`;
const FRAGMENT = (...cards) => cards.join('');
const FULL_PAGE = (...cards) => `<!doctype html><html><head><title>Vacancies</title></head><body>${cards.join('')}</body></html>`;

{
  const jobs = parseInnovecsPage(FRAGMENT(mkCard(1, 'Senior React Native Engineer', 'Ukraine<span class="line"></span>Poland')), 'Innovecs');
  if (jobs.length === 1) pass('parses one job card');
  else fail(`expected 1 job, got ${jobs.length}: ${JSON.stringify(jobs)}`);

  const [j] = jobs;
  if (j.title === 'Senior React Native Engineer') pass('title extracted');
  else fail(`title: ${JSON.stringify(j.title)}`);
  if (j.url === `${HOST}/vacancies/1-senior-react-native-engineer/`) pass('url extracted');
  else fail(`url: ${j.url}`);
  if (j.location === 'Ukraine, Poland') pass('locations joined with ", "');
  else fail(`location: ${JSON.stringify(j.location)}`);
  if (j.company === 'Innovecs') pass('company is the entry name');
  else fail(`company: ${JSON.stringify(j.company)}`);
}

// Entities are decoded BEFORE the row is returned.
{
  const jobs = parseInnovecsPage(FRAGMENT(mkCard(2, 'Senior Mobile &amp; Web Engineer', 'Europe')), 'Innovecs');
  if (jobs.length === 1 && jobs[0].title === 'Senior Mobile & Web Engineer') pass('title entities decoded');
  else fail(`title entities: ${JSON.stringify(jobs[0]?.title)}`);
}

// Whitespace collapsed in title.
{
  const [j] = parseInnovecsPage(FRAGMENT(mkCard(3, 'Senior   FullStack\n  Engineer', 'LATAM')), 'Innovecs');
  if (j && j.title === 'Senior FullStack Engineer') pass('title whitespace collapsed');
  else fail(`whitespace: ${JSON.stringify(j?.title)}`);
}

// A card missing its title is skipped, not fatal.
{
  const bad = `<a href='${HOST}/vacancies/9-broken/' class='box  box--archive-vacancies-v2--vacancies--item'></a>`;
  const jobs = parseInnovecsPage(FRAGMENT(bad, mkCard(4, 'Good Role', 'Poland')), 'Innovecs');
  if (jobs.length === 1 && jobs[0].title === 'Good Role') pass('malformed card skipped, good one kept');
  else fail(`malformed-card handling: ${JSON.stringify(jobs)}`);
}

// Empty / contentless input → [] not a throw.
{
  if (parseInnovecsPage('', 'Innovecs').length === 0
    && parseInnovecsPage(null, 'Innovecs').length === 0
    && parseInnovecsPage('<html>no cards</html>', 'Innovecs').length === 0) {
    pass('empty/garbage HTML parses to []');
  } else {
    fail('garbage HTML did not parse to []');
  }
}

// ── isFullDocument() / pageUrl() ───────────────────────────────────
{
  if (isFullDocument(FULL_PAGE(mkCard(1, 'A', 'UA'))) === true) pass('isFullDocument() true for a full page');
  else fail('isFullDocument() false for a full page');
  if (isFullDocument(FRAGMENT(mkCard(1, 'A', 'UA'))) === false) pass('isFullDocument() false for a card fragment');
  else fail('isFullDocument() true for a fragment');
  if (isFullDocument('') === false) pass('isFullDocument() false for empty input');
  else fail('isFullDocument() true for empty input');
}

{
  if (pageUrl(USER_URL, 1) === USER_URL) pass('pageUrl() page 1 is the careers_url');
  else fail(`pageUrl page1: ${pageUrl(USER_URL, 1)}`);
  if (pageUrl(USER_URL, 2) === `${HOST}/vacancies/page/2/`) pass('pageUrl() page 2 appends /page/N/');
  else fail(`pageUrl page2: ${pageUrl(USER_URL, 2)}`);
  if (pageUrl(CAT_URL, 2) === `${HOST}/vacancies/java/page/2/`) pass('pageUrl() preserves a category path');
  else fail(`pageUrl category: ${pageUrl(CAT_URL, 2)}`);
  if (pageUrl(`${HOST}/vacancies`, 2) === `${HOST}/vacancies/page/2/`) pass('pageUrl() normalizes a missing trailing slash');
  else fail(`pageUrl no-trailing: ${pageUrl(`${HOST}/vacancies`, 2)}`);
}

// ── fetch(): pagination, redirect guard, probe cooperation ─────────
const mkCtx = (pages, baseUrl = USER_URL) => {
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
    fetchText: async (url, opts) => {
      mkCtx.calls.push({ url, opts });
      return pages[url] ?? FRAGMENT();
    },
  };
  mkCtx.calls = [];
  return ctx;
};

// Page 1 full page → page 2 fragment → page 3 full document stops the walk.
{
  const p2 = `${HOST}/vacancies/page/2/`;
  const p3 = `${HOST}/vacancies/page/3/`;
  const pages = {
    [USER_URL]: FULL_PAGE(mkCard(1, 'A', 'UA'), mkCard(2, 'B', 'PL')),
    [p2]: FRAGMENT(mkCard(3, 'C', 'DE')),
    [p3]: FULL_PAGE(mkCard(1, 'A', 'UA')),
  };
  const ctx = mkCtx(pages);
  const jobs = await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, ctx);
  if (jobs.length === 3 && mkCtx.calls.length === 3) pass('fetch paginates and stops on a full-document past-the-end page');
  else fail(`jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// A full document on page 2 stops the walk after page 1.
{
  const p2 = `${HOST}/vacancies/page/2/`;
  const pages = {
    [USER_URL]: FULL_PAGE(mkCard(1, 'A', 'UA'), mkCard(2, 'B', 'PL')),
    [p2]: FULL_PAGE(mkCard(1, 'A', 'UA')),
  };
  const ctx = mkCtx(pages);
  const jobs = await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, ctx);
  if (jobs.length === 2 && mkCtx.calls.length === 2) pass('fetch stops on a full-document page 2');
  else fail(`full-doc page2: jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// An empty fragment on page 2 stops the walk (end of board).
{
  const p2 = `${HOST}/vacancies/page/2/`;
  const pages = {
    [USER_URL]: FULL_PAGE(mkCard(1, 'A', 'UA')),
    [p2]: '',
  };
  const ctx = mkCtx(pages);
  const jobs = await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, ctx);
  if (jobs.length === 1 && mkCtx.calls.length === 2) pass('fetch stops on an empty page-2 fragment');
  else fail(`empty fragment: jobs=${jobs.length} calls=${mkCtx.calls.length}`);
}

// redirect: 'error' is passed on every request.
{
  const p2 = `${HOST}/vacancies/page/2/`;
  const p3 = `${HOST}/vacancies/page/3/`;
  const ctx = mkCtx({
    [USER_URL]: FULL_PAGE(mkCard(1, 'A', 'UA')),
    [p2]: FRAGMENT(mkCard(2, 'B', 'PL')),
    [p3]: FULL_PAGE(mkCard(1, 'A', 'UA')),
  });
  await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, ctx);
  const bad = mkCtx.calls.filter(c => c.opts.redirect !== 'error');
  if (bad.length === 0 && mkCtx.calls.length === 3) pass('fetch passes redirect:"error" on every request');
  else fail(`redirect guard: ${bad.length} of ${mkCtx.calls.length} requests without redirect:"error"`);
}

// The allowlist/HTTPS guard throws BEFORE any fetch — a hostile careers_url
// never reaches the network.
{
  const ctx = {
    sleep: async () => {},
    fetchText: async () => { mkCtx.guardHit = true; return FULL_PAGE(); },
  };
  mkCtx.guardHit = false;
  let threw = false;
  try {
    await innovecs.fetch({ name: 'X', careers_url: 'http://jobs.innovecs.com/vacancies/' }, ctx);
  } catch (e) {
    threw = true;
    if (!/https:|unexpected host|must point/i.test(String(e.message))) fail(`guard error message: ${e.message}`);
  }
  if (threw && !mkCtx.guardHit) pass('fetch rejects a non-HTTPS/wrong-host careers_url before any network call');
  else fail(`guard order: threw=${threw} networkHit=${mkCtx.guardHit}`);
}

// ctx.maxPages stops the walk early (probe cooperation): exactly one list request.
{
  const p2 = `${HOST}/vacancies/page/2/`;
  const pages = {
    [USER_URL]: FULL_PAGE(mkCard(1, 'A', 'UA')),
    [p2]: FRAGMENT(mkCard(2, 'B', 'PL')),
  };
  const ctx = mkCtx(pages);
  const jobs = await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, { ...ctx, maxPages: 1 });
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
    await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, ctx);
  } catch (e) {
    threw = true;
    if (String(e.message) !== 'HTTP 429') fail(`probe rejection rewrapped: ${e.message}`);
  }
  if (threw) pass('probe fetch rejection propagates unwrapped');
  else fail('probe fetch rejection was swallowed to []');
}

// The "raise max_pages" warning fires only when the provider's own ceiling
// truncates a healthy board — not on a fetch-error stop.
{
  const originalError = console.error;
  const messages = [];
  console.error = (...args) => messages.push(args.join(' '));

  // A fetch error on page 2 keeps the pages so far and must NOT raise max_pages.
  const p2 = `${HOST}/vacancies/page/2/`;
  const errorCtx = {
    sleep: async () => {},
    fetchText: async (url) => {
      if (url === p2) throw new Error('HTTP 500');
      return FULL_PAGE(mkCard(1, 'A', 'UA'));
    },
  };
  await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL }, errorCtx);
  const fetchErrorWarned = messages.some(m => /raise max_pages/i.test(m));
  if (!fetchErrorWarned) pass('no max_pages warning on a fetch-error stop');
  else fail(`max_pages warning fired on a fetch-error stop: ${messages.join(' | ')}`);

  // A small max_pages that truncates a healthy board DOES raise it.
  messages.length = 0;
  const cappedCtx = {
    sleep: async () => {},
    fetchText: async () => FULL_PAGE(mkCard(1, 'A', 'UA')),
  };
  await innovecs.fetch({ name: 'Innovecs', careers_url: USER_URL, max_pages: 1 }, cappedCtx);
  const cappedWarned = messages.some(m => /raise max_pages/i.test(m));
  if (cappedWarned) pass('max_pages warning fired when the provider ceiling truncated a healthy board');
  else fail(`expected a max_pages warning for the capped walk: ${messages.join(' | ')}`);

  console.error = originalError;
}