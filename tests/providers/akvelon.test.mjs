// tests/providers/akvelon.test.mjs — Akvelon WordPress REST API provider.
import { pass, fail, captureConsoleErrors, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — akvelon');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/akvelon.mjs')).href);
  const akvelon = mod.default;
  const { parseAkvelonResponse, resolveOrigin } = mod;

  const ORIGIN = 'https://akvelon.com';

  if (akvelon.id === 'akvelon') pass('akvelon.id is "akvelon"');
  else fail(`akvelon.id is ${JSON.stringify(akvelon.id)}`);

  // ── detect() ──
  const hit = akvelon.detect({ name: 'Akvelon', careers_url: `${ORIGIN}/careers/#search-box` });
  if (hit && hit.url === `${ORIGIN}/wp-json/wp/v2/vacancy?per_page=100&page=1`) {
    pass('akvelon.detect() resolves akvelon.com/careers → WP REST vacancy collection');
  } else {
    fail(`akvelon.detect(careers_url) returned ${JSON.stringify(hit)}`);
  }

  const hitApi = akvelon.detect({ name: 'Akvelon', api: `${ORIGIN}/vacancy/` });
  if (hitApi && hitApi.url.includes('/wp-json/wp/v2/vacancy')) {
    pass('akvelon.detect() also accepts an api: field on akvelon.com');
  } else {
    fail(`akvelon.detect(api) returned ${JSON.stringify(hitApi)}`);
  }

  // www host is allowed too.
  if (akvelon.detect({ name: 'Akvelon', careers_url: 'https://www.akvelon.com/careers/' }) !== null) {
    pass('akvelon.detect() accepts the www.akvelon.com host');
  } else {
    fail('akvelon.detect() should accept www.akvelon.com');
  }

  for (const [label, entry] of [
    ['path-spoofed host', { name: 'X', careers_url: 'https://evil.example/akvelon.com/careers' }],
    ['non-HTTPS', { name: 'X', careers_url: 'http://akvelon.com/careers/' }],
    ['untrusted host', { name: 'X', careers_url: 'https://example.com/careers' }],
    ['null', { name: 'X', careers_url: null }],
    ['undefined', { name: 'X', careers_url: undefined }],
    ['number', { name: 'X', careers_url: 42 }],
    ['object', { name: 'X', careers_url: { foo: 'bar' } }],
    ['missing', { name: 'X' }],
  ]) {
    if (akvelon.detect(entry) === null) pass(`akvelon.detect() returns null for ${label}`);
    else fail(`akvelon.detect() should return null for ${label}`);
  }

  // ── parseAkvelonResponse ──
  const items = [
    { title: { rendered: 'Senior React Native &amp; Engineer' }, link: `${ORIGIN}/vacancy/senior-react-native/`, date: '2026-09-20T10:00:00' },
    { title: { rendered: 'DevOps Engineer' }, link: `${ORIGIN}/vacancy/devops-engineer/`, date: 'bad-date' },
    { title: { rendered: 'No link' } },                              // missing link → dropped
    { title: { rendered: '' }, link: `${ORIGIN}/vacancy/empty-title/` }, // empty title → dropped
    { title: { rendered: 'Off-host' }, link: 'https://evil.example/vacancy/off-host/' }, // off-host → dropped
    { title: { rendered: 'Not under vacancy' }, link: `${ORIGIN}/about/` }, // wrong path → dropped
  ];
  const jobs = parseAkvelonResponse(items, { name: 'Akvelon' });
  if (jobs.length === 2
      && jobs[0].title === 'Senior React Native & Engineer'
      && jobs[0].url === `${ORIGIN}/vacancy/senior-react-native/`
      && jobs[0].postedAt === Date.parse('2026-09-20T10:00:00')
      && jobs[1].postedAt === undefined
      && jobs[0].company === 'Akvelon') {
    pass('parseAkvelonResponse() decodes title, normalizes url, parses date, drops bad rows');
  } else {
    fail(`parseAkvelonResponse() = ${JSON.stringify(jobs)}`);
  }

  if (parseAkvelonResponse([], { name: 'Akvelon' }).length === 0) pass('parseAkvelonResponse([]) returns an empty list');
  else fail('parseAkvelonResponse([]) should return an empty list');

  let threwShape = false;
  try { parseAkvelonResponse({ code: 'rest_no_route' }, { name: 'Akvelon' }); } catch { threwShape = true; }
  if (threwShape) pass('parseAkvelonResponse() throws when the body is not the documented array shape');
  else fail('parseAkvelonResponse() should throw on a non-array body');

  // resolveOrigin allowlist guard.
  if (resolveOrigin({ careers_url: `${ORIGIN}/careers/` }) === ORIGIN
      && resolveOrigin({ careers_url: 'https://www.akvelon.com/careers/' }) === 'https://www.akvelon.com'
      && resolveOrigin({ careers_url: 'https://evil.example/careers/' }) === null) {
    pass('resolveOrigin() accepts allowed hosts and rejects the rest');
  } else {
    fail('resolveOrigin() allowlist behavior');
  }

  // ── fetch(): normalization, pagination, redirect guard, header-bounded walk ──
  {
    const calls = [];
    const jobs = await akvelon.fetch(
      { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
      {
        fetchResponse: async (url, opts) => {
          calls.push({ url, opts, via: 'fetchResponse' });
          const page = Number(new URL(url).searchParams.get('page'));
          const headers = new Headers({ 'x-wp-totalpages': String(page === 1 ? 2 : 1) });
          const body = page === 1
            ? JSON.stringify([
                { title: { rendered: 'Role A' }, link: `${ORIGIN}/vacancy/a/`, date: '2026-01-01T00:00:00' },
                { title: { rendered: 'Off-host' }, link: 'https://evil.example/vacancy/x/' },
                { title: { rendered: '' }, link: `${ORIGIN}/vacancy/y/` },
              ])
            : JSON.stringify([{ title: { rendered: 'Role B' }, link: `${ORIGIN}/vacancy/b/`, date: '2026-01-02T00:00:00' }]);
          return new Response(body, { status: 200, headers });
        },
        fetchJson: async (url, opts) => {
          calls.push({ url, opts, via: 'fetchJson' });
          return [{ title: { rendered: 'Role B' }, link: `${ORIGIN}/vacancy/b/`, date: '2026-01-02T00:00:00' }];
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (jobs.length === 2 && jobs.map(j => j.title).join(',') === 'Role A,Role B') {
      pass('akvelon.fetch() normalizes rows, drops bad ones, aggregates across pages');
    } else {
      fail(`akvelon.fetch() returned ${JSON.stringify(jobs)}`);
    }
    if (calls.length === 2 && calls.every(c => c.opts.redirect === 'error')) {
      pass('akvelon.fetch() passes redirect:error on every request');
    } else {
      fail(`akvelon.fetch() requests: ${JSON.stringify(calls.map(c => ({ via: c.via, redirect: c.opts.redirect })))}`);
    }
  }

  // Empty board → []; untrusted host → throw before any request.
  {
    const empty = await akvelon.fetch(
      { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
      {
        fetchResponse: async () => new Response('[]', { status: 200, headers: new Headers({ 'x-wp-totalpages': '1' }) }),
        fetchJson: async () => [],
        sleep: () => Promise.resolve(),
      },
    );
    if (Array.isArray(empty) && empty.length === 0) pass('akvelon.fetch() returns [] for an empty board');
    else fail('akvelon.fetch() should return [] for an empty board');

    let called = false;
    let threw = false;
    try {
      await akvelon.fetch(
        { name: 'X', careers_url: 'https://evil.example/careers/' },
        { fetchResponse: async () => { called = true; return new Response('[]'); }, sleep: () => Promise.resolve() },
      );
    } catch { threw = true; }
    if (threw && !called) pass('akvelon.fetch() throws on an untrusted host before any request');
    else fail(`akvelon.fetch() untrusted host: called=${called} threw=${threw}`);
  }

  // ctx.maxPages caps the walk (probe behavior): one list request, and a
  // rejection propagates unwrapped (not swallowed to []).
  {
    let listCalls = 0;
    await akvelon.fetch(
      { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
      {
        maxPages: 1,
        fetchResponse: async () => {
          listCalls++;
          return new Response(JSON.stringify([{ title: { rendered: 'A' }, link: `${ORIGIN}/vacancy/a/` }]),
            { status: 200, headers: new Headers({ 'x-wp-totalpages': '99' }) });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (listCalls === 1) pass('akvelon.fetch() honors ctx.maxPages and stops after one list page');
    else fail(`akvelon.fetch() ctx.maxPages=1 made ${listCalls} list calls`);

    let probeErr = null;
    try {
      await akvelon.fetch(
        { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
        { maxPages: 1, fetchResponse: async () => { throw new Error('ProbePageBudgetReached'); }, sleep: () => Promise.resolve() },
      );
    } catch (e) { probeErr = e; }
    if (probeErr && probeErr.message === 'ProbePageBudgetReached') {
      pass('akvelon.fetch() propagates a ctx.fetch rejection unwrapped while probing');
    } else {
      fail(`akvelon.fetch() probe rejection was swallowed: ${probeErr && probeErr.message}`);
    }
  }

  // DEFAULT_MAX_PAGES bounds the walk even when the header never ends it.
  {
    let calls = 0;
    const cap = await akvelon.fetch(
      { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
      {
        fetchResponse: async (url) => {
          calls++;
          const page = Number(new URL(url).searchParams.get('page'));
          return new Response(JSON.stringify([{ title: { rendered: `Role ${calls}` }, link: `${ORIGIN}/vacancy/x-${calls}/` }]),
            { status: 200, headers: new Headers({ 'x-wp-totalpages': '99999' }) });
        },
        fetchJson: async (url) => {
          calls++;
          return [{ title: { rendered: `Role ${calls}` }, link: `${ORIGIN}/vacancy/x-${calls}/` }];
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (calls === 20 && cap.length === 20) pass('akvelon.fetch() stops at DEFAULT_MAX_PAGES (20) even when the header is huge');
    else fail(`akvelon.fetch() cap: calls=${calls}, rows=${cap.length} (expected 20/20)`);
  }

  // The "raise max_pages" warning fires only when the config cap (not ctx) truncated a live board.
  {
    const { result, errors } = await captureConsoleErrors(async () => {
      return akvelon.fetch(
        { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
        {
          fetchResponse: async (url) => {
            const page = Number(new URL(url).searchParams.get('page'));
            return new Response(JSON.stringify([{ title: { rendered: `A${page}` }, link: `${ORIGIN}/vacancy/a-${page}/` }]),
              { status: 200, headers: new Headers({ 'x-wp-totalpages': '999' }) });
          },
          fetchJson: async (url) => {
            const page = Number(new URL(url).searchParams.get('page'));
            return [{ title: { rendered: `A${page}` }, link: `${ORIGIN}/vacancy/a-${page}/` }];
          },
          sleep: () => Promise.resolve(),
        },
      );
    });
    if (result.length && errors.some(e => String(e).includes('raise max_pages'))) {
      pass('akvelon.fetch() warns to raise max_pages when the config cap truncates a board');
    } else {
      fail(`akvelon.fetch() truncation warning: errors=${JSON.stringify(errors)}`);
    }

    const { errors: probeErrors } = await captureConsoleErrors(async () => {
      await akvelon.fetch(
        { name: 'Akvelon', careers_url: `${ORIGIN}/careers/` },
        {
          maxPages: 1,
          fetchResponse: async () => new Response('[]', { status: 200, headers: new Headers({ 'x-wp-totalpages': '1' }) }),
          sleep: () => Promise.resolve(),
        },
      );
    });
    if (probeErrors.length === 0) pass('akvelon.fetch() does not warn to raise max_pages on a ctx.maxPages (probe) stop');
    else fail(`akvelon.fetch() probe should not warn: ${JSON.stringify(probeErrors)}`);
  }

} catch (e) {
  fail(`akvelon provider tests crashed: ${e.message}\n${e.stack}`);
}