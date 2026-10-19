// tests/providers/miratech.test.mjs — Miratech (SmartRecruiters tenant) provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — miratech');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/miratech.mjs')).href);
  const miratech = mod.default;
  const { parseMiratechPage } = mod;

  if (miratech.id === 'miratech') pass('miratech.id is "miratech"');
  else fail(`miratech.id is ${JSON.stringify(miratech.id)}`);

  // ── detect() ──
  const hit = miratech.detect({ name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' });
  if (hit && hit.url.startsWith('https://api.smartrecruiters.com/v1/companies/Miratech1/postings')) {
    pass('miratech.detect() claims the branded miratechgroup.com/career/ URL → api URL');
  } else {
    fail(`miratech.detect(career) returned ${JSON.stringify(hit)}`);
  }

  const hitWww = miratech.detect({ name: 'Miratech', careers_url: 'https://www.miratechgroup.com/career/' });
  if (hitWww && hitWww.url.includes('/Miratech1/postings')) {
    pass('miratech.detect() also handles the www host');
  } else {
    fail(`miratech.detect(www) returned ${JSON.stringify(hitWww)}`);
  }

  const hitApi = miratech.detect({ name: 'Miratech', api: 'https://miratechgroup.com/career/' });
  if (hitApi && hitApi.url.includes('/Miratech1/postings')) {
    pass('miratech.detect() honors an api: field pointing at the branded host');
  } else {
    fail(`miratech.detect(api) returned ${JSON.stringify(hitApi)}`);
  }

  // The generic SmartRecruiters hosts belong to the smartrecruiters provider —
  // miratech must NOT claim them.
  if (miratech.detect({ name: 'X', careers_url: 'https://jobs.smartrecruiters.com/Miratech1' }) === null) {
    pass('miratech.detect() leaves generic SmartRecruiters hosts to the smartrecruiters provider');
  } else {
    fail('miratech.detect() must not claim jobs.smartrecruiters.com');
  }

  const nullCases = [
    ['non-miratech host', { name: 'X', careers_url: 'https://example.com/career/' }],
    ['http scheme', { name: 'X', careers_url: 'http://miratechgroup.com/career/' }],
    ['malformed URL', { name: 'X', careers_url: 'not a url' }],
    ['non-string careers_url', { name: 'X', careers_url: { foo: 'bar' } }],
    ['missing URL', { name: 'X' }],
    ['miratech host, non-career path', { name: 'X', careers_url: 'https://miratechgroup.com/about/' }],
    ['careers-neighbour path', { name: 'X', careers_url: 'https://miratechgroup.com/careers/' }],
    ['path-spoofed host', { name: 'X', careers_url: 'https://evil.example/miratechgroup.com/career/' }],
  ];
  let nullOk = true;
  for (const [label, entry] of nullCases) {
    if (miratech.detect(entry) !== null) { nullOk = false; fail(`miratech.detect() should return null for ${label}`); }
  }
  if (nullOk) pass('miratech.detect() returns null (no throw) for untrusted/invalid inputs');

  // ── parseMiratechPage() ──
  const sample = {
    totalFound: 2,
    content: [
      {
        id: 744000156193149,
        name: 'Senior React Native Engineer',
        refNumber: 'REF5879D',
        releasedDate: '2026-10-18T18:37:32.146Z',
        language: { code: 'en' },
        location: { fullLocation: 'Lviv, Ukraine', remote: true },
      },
      {
        id: '744000156193039',
        name: '  Data   Engineer  ',
        location: { city: 'Warsaw', country: 'Poland', remote: false },
      },
    ],
  };
  const parsed = parseMiratechPage(sample, 'Miratech');
  if (parsed.rawCount === 2 && parsed.rows.length === 2) pass('parseMiratechPage() reads both rows and rawCount');
  else fail(`parseMiratechPage() = ${JSON.stringify(parsed)}`);

  const [first, second] = parsed.rows;
  if (first.title === 'Senior React Native Engineer'
      && first.url === 'https://jobs.smartrecruiters.com/Miratech1/744000156193149-senior-react-native-engineer'
      && first.company === 'Miratech'
      && first.location === 'Lviv, Ukraine, Remote'
      && first.postedAt === Date.parse('2026-10-18T18:37:32.146Z')
      && first.requisitionId === 'REF5879D'
      && first.language === 'en') {
    pass('parseMiratechPage() maps title/url/location/postedAt/requisitionId/language');
  } else {
    fail(`row 0 = ${JSON.stringify(first)}`);
  }

  if (second.title === 'Data Engineer'
      && second.url === 'https://jobs.smartrecruiters.com/Miratech1/744000156193039-data-engineer'
      && second.location === 'Warsaw, Poland'
      && !('postedAt' in second) && !('requisitionId' in second) && !('language' in second)) {
    pass('parseMiratechPage() collapses whitespace and omits absent optional keys');
  } else {
    fail(`row 1 = ${JSON.stringify(second)}`);
  }

  // Rows missing name/id are dropped, never fatal.
  const dropped = parseMiratechPage({ content: [
    { id: 'A', name: 'Keep Me' },
    { id: 'B' },
    { name: 'No Id' },
    null,
    'nope',
  ] }, 'Miratech');
  if (dropped.rows.length === 1 && dropped.rawCount === 5 && dropped.rows[0].title === 'Keep Me') {
    pass('parseMiratechPage() drops malformed rows but keeps rawCount at the source page size');
  } else {
    fail(`dropped = ${JSON.stringify(dropped)}`);
  }

  // Empty vs broken split.
  const empty = parseMiratechPage({ content: [] }, 'Miratech');
  if (empty.rows.length === 0 && empty.rawCount === 0) pass('parseMiratechPage() treats a present-and-empty content[] as an empty page');
  else fail(`empty = ${JSON.stringify(empty)}`);

  const brokenCases = [
    ['missing content', {}],
    ['null content', { content: null }],
    ['non-array content', { content: 'nope' }],
    ['wrong container key', { results: [] }],
    ['bare non-object', ''],
    ['number body', 5],
  ];
  let brokenOk = true;
  for (const [label, body] of brokenCases) {
    let threw = false;
    try { parseMiratechPage(body, 'Miratech'); } catch { threw = true; }
    if (!threw) { brokenOk = false; fail(`parseMiratechPage() should throw on ${label}`); }
  }
  if (brokenOk) pass('parseMiratechPage() throws a descriptive error on a non-documented envelope');

  // ── fetch(): pagination ──
  const pageOf = (n, start) => ({ totalFound: n, content: Array.from({ length: n }, (_, i) => ({ id: `P${start + i}`, name: `Role ${start + i}` })) });
  {
    const seen = [];
    const jobs = await miratech.fetch(
      { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' },
      {
        fetchJson: async (url, opts) => {
          seen.push({ url, opts });
          const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
          if (offset === 0) return pageOf(100, 0);
          if (offset === 100) return pageOf(50, 100); // short page → walk ends
          return pageOf(0, 0);
        },
      },
    );
    if (seen.length === 2 && jobs.length === 150) pass('fetch() paginates and aggregates (2 pages → 150 jobs)');
    else fail(`pagination: requests=${seen.length}, jobs=${jobs.length}`);
    if (seen.every((s) => s.opts?.redirect === 'error')) pass("fetch() passes redirect:'error' on every list request");
    else fail(`redirect opts = ${JSON.stringify(seen.map((s) => s.opts))}`);
  }

  // Empty first page → [] and a single request.
  {
    let calls = 0;
    const jobs = await miratech.fetch(
      { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' },
      { fetchJson: async () => { calls++; return { content: [] }; } },
    );
    if (calls === 1 && jobs.length === 0) pass('fetch() stops on the first empty page');
    else fail(`empty: calls=${calls}, jobs=${jobs.length}`);
  }

  // ctx.maxPages caps the walk (the health probe).
  {
    let calls = 0;
    await miratech.fetch(
      { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' },
      { maxPages: 1, fetchJson: async () => { calls++; return pageOf(100, 0); } },
    );
    if (calls === 1) pass('fetch() honors ctx.maxPages=1 (one list request)');
    else fail(`ctx.maxPages=1: ${calls} list calls (expected 1)`);
  }

  // A probe's fetch rejection propagates unwrapped (not swallowed to []).
  {
    const boom = Object.assign(new Error('ProbePageBudgetReached'), { name: 'ProbePageBudgetReached' });
    let caught = null;
    try {
      await miratech.fetch(
        { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' },
        { maxPages: 1, fetchJson: async () => { throw boom; } },
      );
    } catch (e) { caught = e; }
    if (caught === boom) pass('fetch() propagates a probe fetch rejection unwrapped');
    else fail(`probe rejection = ${JSON.stringify(caught && caught.message)}`);
  }

  // The provider's own cap stops the walk even when the source keeps serving full pages.
  {
    let calls = 0;
    const jobs = await miratech.fetch(
      { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/', max_pages: 2 },
      { fetchJson: async () => { calls++; return pageOf(100, calls * 1000); } },
    );
    if (calls === 2 && jobs.length === 200) pass('fetch() stops at the entry max_pages even when pages stay full');
    else fail(`cap: calls=${calls}, jobs=${jobs.length}`);
  }

  // A transient page-2 failure keeps the pages already collected and does not throw.
  {
    let calls = 0;
    const jobs = await miratech.fetch(
      { name: 'Miratech', careers_url: 'https://miratechgroup.com/career/' },
      {
        fetchJson: async (url) => {
          calls++;
          const offset = parseInt(new URL(url).searchParams.get('offset') || '0', 10);
          if (offset === 0) return pageOf(100, 0);
          throw Object.assign(new Error('HTTP 500'), { status: 500 });
        },
      },
    );
    if (jobs.length === 100) pass('fetch() keeps the postings collected when a later page exhausts retry');
    else fail(`transient: jobs=${jobs.length}`);
    if (calls > 2) pass('fetch() retried the failing page before giving up');
    else fail(`transient: expected retries, saw ${calls} calls`);
  }

} catch (e) {
  fail(`miratech provider tests crashed: ${e.message}`);
}
