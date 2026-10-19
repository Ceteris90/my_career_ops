// tests/providers/intellias.test.mjs — Intellias WordPress admin-ajax provider.
import { pass, fail, captureConsoleErrors, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — intellias');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/intellias.mjs')).href);
  const intellias = mod.default;
  const { parseIntelliasAjax, parseIntelliasCard, parseIntelliasDetail, resolveOrigin } = mod;

  const ORIGIN = 'https://career.intellias.com';

  if (intellias.id === 'intellias') pass('intellias.id is "intellias"');
  else fail(`intellias.id is ${JSON.stringify(intellias.id)}`);

  // ── detect() ──
  const hit = intellias.detect({ name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` });
  if (hit && hit.url === `${ORIGIN}/wp-admin/admin-ajax.php`) {
    pass('intellias.detect() resolves career.intellias.com careers_url → admin-ajax endpoint');
  } else {
    fail(`intellias.detect(careers_url) returned ${JSON.stringify(hit)}`);
  }

  const hitApi = intellias.detect({ name: 'Intellias', api: `${ORIGIN}/vacancies/` });
  if (hitApi && hitApi.url === `${ORIGIN}/wp-admin/admin-ajax.php`) {
    pass('intellias.detect() also accepts an api: field on career.intellias.com');
  } else {
    fail(`intellias.detect(api) returned ${JSON.stringify(hitApi)}`);
  }

  // entry.api takes precedence over careers_url (mirrors greenhouse/ashby).
  const hitPrecedence = intellias.detect({
    name: 'X',
    careers_url: 'https://career.intellias.com/',
    api: `${ORIGIN}/vacancies/`,
  });
  if (hitPrecedence) pass('intellias.detect() accepts api + careers_url on the same host');
  else fail('intellias.detect() should accept api + careers_url on the same host');

  if (intellias.detect({ name: 'X', careers_url: 'https://evil.example/career.intellias.com' }) === null) {
    pass('intellias.detect() returns null for a path-spoofed host');
  } else {
    fail('intellias.detect() must NOT misdetect a path-spoofed URL');
  }
  if (intellias.detect({ name: 'X', careers_url: `http://career.intellias.com/vacancies/` }) === null) {
    pass('intellias.detect() returns null for a non-HTTPS careers_url');
  } else {
    fail('intellias.detect() should reject a non-HTTPS URL');
  }
  if (intellias.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('intellias.detect() returns null for an untrusted host');
  } else {
    fail('intellias.detect() should return null for an untrusted host');
  }
  for (const bad of [null, undefined, 42, { foo: 'bar' }, 'not a url', 'https://']) {
    if (intellias.detect({ name: 'X', careers_url: bad }) === null) pass(`intellias.detect() returns null for careers_url=${JSON.stringify(bad)}`);
    else fail(`intellias.detect() should return null for careers_url=${JSON.stringify(bad)}`);
  }
  if (intellias.detect({ name: 'X' }) === null) pass('intellias.detect() returns null when careers_url is missing');
  else fail('intellias.detect() should return null when careers_url is missing');

  // ── parseIntelliasAjax ──
  if (parseIntelliasAjax('').posts.length === 0 && parseIntelliasAjax('   ').posts.length === 0) {
    pass('parseIntelliasAjax() returns an empty page for an empty/contentless body');
  } else {
    fail('parseIntelliasAjax() should treat an empty body as an empty page');
  }
  if (parseIntelliasAjax('null').posts.length === 0 && parseIntelliasAjax('{}').posts.length === 0) {
    pass('parseIntelliasAjax() returns an empty page for null/{} JSON');
  } else {
    fail('parseIntelliasAjax() should return an empty page for null/{}');
  }
  let threwShape = false;
  try { parseIntelliasAjax('{"total":5}'); } catch { threwShape = true; }
  if (threwShape) pass('parseIntelliasAjax() throws when the documented posts[] container is absent');
  else fail('parseIntelliasAjax() should throw on a non-conforming response shape');
  threwShape = false;
  try { parseIntelliasAjax('not json at all'); } catch { threwShape = true; }
  if (threwShape) pass('parseIntelliasAjax() throws on a non-JSON body');
  else fail('parseIntelliasAjax() should throw on a non-JSON body');

  const ajaxEnd = parseIntelliasAjax('{"posts":[],"end":true,"total":0}');
  const ajaxOpen = parseIntelliasAjax('{"posts":["x"],"end":false,"total":146}');
  if (ajaxEnd.end === true && ajaxOpen.end === false && ajaxOpen.posts.length === 1) {
    pass('parseIntelliasAjax() surfaces the source end flag');
  } else {
    fail('parseIntelliasAjax() should surface the end flag');
  }

  // ── parseIntelliasCard ──
  const card = `
    <a href="https://career.intellias.com/vacancy/senior-manual-test-engineer-30835/" class="stb-item fdc tdn inter card_item">
      <div class="card_top">
        <div class="industry_line font14"><span class="fw500">Test Engineering</span></div>
        <div class="card_title">Senior Manual Test &amp; QA Engineer</div>
      </div>
      <div class="card_bottom">
        <div class="card_meta">
          <div class="position font14 df aic"><svg></svg><span class="fw500">Senior</span></div>
          <div class="location font14 df aic"><svg></svg><span class="fw500">Ukraine</span></div>
        </div>
        <div class="type_work"><span>Remote</span></div>
      </div>
    </a>`;
  const job = parseIntelliasCard(card, 'Intellias');
  if (job && job.title === 'Senior Manual Test & QA Engineer'
      && job.url === 'https://career.intellias.com/vacancy/senior-manual-test-engineer-30835/'
      && job.location === 'Ukraine'
      && job.company === 'Intellias') {
    pass('parseIntelliasCard() extracts title (decoded), url, location, company');
  } else {
    fail(`parseIntelliasCard() = ${JSON.stringify(job)}`);
  }

  if (parseIntelliasCard('', 'Intellias') === null && parseIntelliasCard('no anchor', 'Intellias') === null) {
    pass('parseIntelliasCard() drops rows with no usable href');
  } else {
    fail('parseIntelliasCard() should return null for a card with no href');
  }

  // A card whose href points off-host (or not under /vacancy/) is dropped.
  for (const href of ['https://evil.example/vacancy/x-1/', `${ORIGIN}/about/`, '/vacancy/rel-1/']) {
    if (parseIntelliasCard(`<a href="${href}"><div class="card_title">T</div></a>`, 'Intellias') === null) {
      pass(`parseIntelliasCard() drops a card with untrusted href ${href}`);
    } else {
      fail(`parseIntelliasCard() should drop href ${href}`);
    }
  }

  // A card with an empty title is dropped.
  if (parseIntelliasCard(`<a href="https://career.intellias.com/vacancy/x-1/"><div class="card_title">   </div></a>`, 'Intellias') === null) {
    pass('parseIntelliasCard() drops a card with a blank title');
  } else {
    fail('parseIntelliasCard() should drop a card with a blank title');
  }

  // ── parseIntelliasDetail ──
  const detailHtml = `
    <div class="vi_rows">
      <div class="vi_row vi_row--static"><span class="vi_row_icon"><img src="https://career.intellias.com/wp-content/themes/intellias/assets/icons/folder-icon.svg"></span><span class="vi_row_text">AI/ML Engineering</span></div>
      <div class="vi_row vi_row--static"><span class="vi_row_icon"><img src="https://career.intellias.com/wp-content/themes/intellias/assets/icons/mappin-icon.svg"></span><span class="vi_row_text">Bulgaria, Croatia, Egypt, Germany</span></div>
    </div>
    <div class="project_overview fdc"><h3 class="caption title_content">What project we have for you</h3><div class="text_overview inter body-reg"><p>Client is a &amp; leading <strong>platform</strong>.</p></div></div>
    <div class="project_overview fdc"><h3 class="caption title_content">What you will do</h3><div class="text_overview inter body-reg"><p>You will build things.</p></div></div>`;
  const detail = parseIntelliasDetail(detailHtml);
  if (detail.location === 'Bulgaria, Croatia, Egypt, Germany'
      && detail.description && detail.description.includes('&')
      && detail.description.includes('Client is a')
      && detail.description.includes('platform')
      && detail.description.includes('You will build things.')) {
    pass('parseIntelliasDetail() reads the full location and joins description blocks (decoded)');
  } else {
    fail(`parseIntelliasDetail() = ${JSON.stringify(detail)}`);
  }
  if (parseIntelliasDetail('<div>nothing here</div>').location === undefined) {
    pass('parseIntelliasDetail() returns no location when the mappin row is absent');
  } else {
    fail('parseIntelliasDetail() should not fabricate a location');
  }

  // ── fetch(): normalization, pagination, redirect guard ──
  {
    const calls = [];
    const jobs = await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
      {
        fetchText: async (url, opts) => {
          calls.push({ url, opts });
          const page = Number(new URLSearchParams(opts.body).get('page'));
          if (page === 1) {
            return JSON.stringify({
              posts: [
                `<a href="https://career.intellias.com/vacancy/a-1/"><div class="card_title">Role A</div><div class="location font14 df aic"><svg></svg><span class="fw500">Ukraine</span></div></a>`,
                `<a href="https://career.intellias.com/vacancy/b-2/"><div class="card_title">Role B</div></a>`,
                `<a href="https://evil.example/vacancy/c-3/"><div class="card_title">Dropped</div></a>`,  // off-host → dropped
                `<a href="https://career.intellias.com/vacancy/d-4/"></a>`,  // no title → dropped
              ],
              end: false,
              total: 3,
            });
          }
          return JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/e-5/"><div class="card_title">Role E</div></a>`], end: true, total: 3 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (jobs.length === 3 && jobs.map(j => j.title).join(',') === 'Role A,Role B,Role E') {
      pass('intellias.fetch() normalizes cards, drops bad rows, and aggregates across pages');
    } else {
      fail(`intellias.fetch() returned ${JSON.stringify(jobs)}`);
    }
    if (calls.length === 2 && calls.every(c => c.opts.redirect === 'error')) {
      pass('intellias.fetch() passes redirect:error on every request');
    } else {
      fail(`intellias.fetch() requests: ${JSON.stringify(calls.map(c => ({ body: c.opts.body, redirect: c.opts.redirect })))}`);
    }
    if (calls[0]?.opts.method === 'POST' && calls[0]?.opts.body.includes('action=fly_vacancies') && calls[0]?.opts.body.includes('page=1')) {
      pass('intellias.fetch() POSTs the fly_vacancies action with a page param');
    } else {
      fail(`intellias.fetch() request shape: ${JSON.stringify(calls[0])}`);
    }
  }

  // Empty board → []; first page 404 / wrong host → throw before any request.
  {
    const empty = await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
      { fetchText: async () => JSON.stringify({ posts: [], end: true, total: 0 }), sleep: () => Promise.resolve() },
    );
    if (Array.isArray(empty) && empty.length === 0) pass('intellias.fetch() returns [] for an empty board');
    else fail('intellias.fetch() should return [] for an empty board');

    let called = false;
    let threw = false;
    try {
      await intellias.fetch(
        { name: 'X', careers_url: 'https://evil.example/vacancies/' },
        { fetchText: async () => { called = true; return ''; }, sleep: () => Promise.resolve() },
      );
    } catch { threw = true; }
    if (threw && !called) pass('intellias.fetch() throws on an untrusted host before any request');
    else fail(`intellias.fetch() untrusted host: called=${called} threw=${threw}`);
  }

  // ctx.maxPages caps the walk (probe behavior): one list request, and a
  // fetch rejection propagates unwrapped (not swallowed to []).
  {
    let listCalls = 0;
    await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/`, intellias: { fetchDetails: true } },
      {
        maxPages: 1,
        fetchText: async () => {
          listCalls++;
          return JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/a-1/"><div class="card_title">A</div></a>`], end: false, total: 99 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (listCalls === 1) pass('intellias.fetch() honors ctx.maxPages and stops after one list page');
    else fail(`intellias.fetch() ctx.maxPages=1 made ${listCalls} list calls`);

    // A rejection while probing must surface as-is (verify-portals reads the
    // ProbePageBudgetReached identity from the raw rejection).
    let probeErr = null;
    try {
      await intellias.fetch(
        { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
        { maxPages: 1, fetchText: async () => { throw new Error('ProbePageBudgetReached'); }, sleep: () => Promise.resolve() },
      );
    } catch (e) { probeErr = e; }
    if (probeErr && probeErr.message === 'ProbePageBudgetReached') {
      pass('intellias.fetch() propagates a ctx.fetch rejection unwrapped while probing');
    } else {
      fail(`intellias.fetch() probe rejection was swallowed: ${probeErr && probeErr.message}`);
    }
  }

  // DEFAULT_MAX_PAGES bounds the walk even when the source never reports end.
  {
    let calls = 0;
    const cap = await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
      {
        fetchText: async () => {
          calls++;
          return JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/x-${calls}/"><div class="card_title">Role ${calls}</div></a>`], end: false, total: 99999 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (calls === 100 && cap.length === 100) pass('intellias.fetch() stops at DEFAULT_MAX_PAGES (100) when the source never ends');
    else fail(`intellias.fetch() cap: calls=${calls}, rows=${cap.length} (expected 100/100)`);
  }

  // Loop termination reads the raw source shape, not the parser output: a page
  // whose cards parse to nothing but that the source does NOT mark as end must
  // not read as a clean end. And a first page that shipped cards but parsed to
  // none is a markup break → throw (fail loud, not silently-empty).
  {
    let calls = 0;
    const parsedAll = await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
      {
        fetchText: async () => {
          calls++;
          // Page 1 parses; pages 2+ ship unparseable cards without end — this
          // is NOT the end, so the provider must keep walking rather than stop
          // early (loop termination reads the raw shape, not the parser output).
          const card = calls === 1
            ? '<a href="https://career.intellias.com/vacancy/a-1/"><div class="card_title">A</div></a>'
            : '<div>unparseable card</div>';
          return JSON.stringify({ posts: [card], end: false, total: 1000 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (calls === 100) pass('intellias.fetch() does not stop early when cards parse to none but the source has not ended');
    else fail(`intellias.fetch() stopped early: calls=${calls} (expected 100)`);

    let firstPageThrew = false;
    try {
      await intellias.fetch(
        { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
        { fetchText: async () => JSON.stringify({ posts: ['<div>unparseable card</div>'], end: false, total: 1000 }), sleep: () => Promise.resolve() },
      );
    } catch { firstPageThrew = true; }
    if (firstPageThrew) pass('intellias.fetch() throws when page 1 ships cards but none parse (markup break)');
    else fail('intellias.fetch() should throw on a page-1 markup break');
  }

  // The "raise max_pages" warning fires only when the config cap (not ctx) truncated a live board.
  {
    const { result, errors } = await captureConsoleErrors(async () => {
      const jobs = await intellias.fetch(
        { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
        {
          fetchText: async () => JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/x/"><div class="card_title">A</div></a>`], end: false, total: 9 }),
          sleep: () => Promise.resolve(),
        },
      );
      return jobs;
    });
    if (result.length && errors.some(e => String(e).includes('raise max_pages'))) {
      pass('intellias.fetch() warns to raise max_pages when the config cap truncates a board');
    } else {
      fail(`intellias.fetch() truncation warning: errors=${JSON.stringify(errors)}`);
    }

    const { errors: probeErrors } = await captureConsoleErrors(async () => {
      await intellias.fetch(
        { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
        { maxPages: 1, fetchText: async () => JSON.stringify({ posts: [], end: false, total: 9 }), sleep: () => Promise.resolve() },
      );
    });
    if (probeErrors.length === 0) pass('intellias.fetch() does not warn to raise max_pages on a ctx.maxPages (probe) stop');
    else fail(`intellias.fetch() probe should not warn: ${JSON.stringify(probeErrors)}`);
  }

  // ── fetchDetails enrichment ──
  {
    const detailCalls = [];
    const enriched = await intellias.fetch(
      {
        name: 'Intellias',
        careers_url: `${ORIGIN}/vacancies/`,
        intellias: { fetchDetails: true, detailLimit: 25 },
      },
      {
        fetchText: async (url, opts) => {
          const body = opts?.body || '';
          if (body.includes('action=fly_vacancies')) {
            return JSON.stringify({
              posts: [
                `<a href="https://career.intellias.com/vacancy/a-1/"><div class="card_title">Role A</div><div class="location font14 df aic"><svg></svg><span class="fw500">Bulgaria, Croatia, Egypt, Germ...</span></div></a>`,
                `<a href="https://career.intellias.com/vacancy/b-2/"><div class="card_title">Role B</div></a>`,
              ],
              end: true,
              total: 2,
            });
          }
          detailCalls.push(url);
          if (url.includes('/vacancy/a-1/')) {
            return '<div class="vi_rows"><div class="vi_row vi_row--static"><span class="vi_row_icon"><img src="https://career.intellias.com/wp-content/themes/intellias/assets/icons/mappin-icon.svg"></span><span class="vi_row_text">Bulgaria, Croatia, Egypt, Germany, Poland</span></div></div><div class="project_overview fdc"><div class="text_overview inter body-reg"><p>Full body of A.</p></div></div>';
          }
          throw new Error('HTTP 500');  // b-2 detail fails → enrichment only, keep the row
        },
        sleep: () => Promise.resolve(),
      },
    );
    const a = enriched.find(j => j.title === 'Role A');
    const b = enriched.find(j => j.title === 'Role B');
    if (a && a.location === 'Bulgaria, Croatia, Egypt, Germany, Poland' && a.description && a.description.startsWith('Full body of A.')) {
      pass('intellias.fetch(fetchDetails:true) fills the truncated location and description from the detail page');
    } else {
      fail(`enriched row A = ${JSON.stringify(a)}`);
    }
    if (b && b.title === 'Role B') pass('intellias.fetch(fetchDetails:true) keeps a listing row when its detail fetch fails');
    else fail(`enriched row B = ${JSON.stringify(b)}`);
    if (detailCalls.length === 2) pass('intellias.fetch(fetchDetails:true) requests one detail URL per posting');
    else fail(`detail calls = ${detailCalls.length} (expected 2)`);
  }

  // Default (no config): zero detail calls — the scanner stays zero-token.
  {
    let detailCalls = 0;
    await intellias.fetch(
      { name: 'Intellias', careers_url: `${ORIGIN}/vacancies/` },
      {
        fetchText: async (url, opts) => {
          if (!String(opts?.body || '').includes('action=fly_vacancies')) detailCalls++;
          return JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/x/"><div class="card_title">A</div></a>`], end: true, total: 1 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (detailCalls === 0) pass('intellias.fetch() without intellias.fetchDetails makes no per-posting requests');
    else fail(`expected 0 detail calls by default, saw ${detailCalls}`);
  }

  // detailLimit caps the per-sweep detail budget on a large board.
  {
    let detailCalls = 0;
    await intellias.fetch(
      {
        name: 'Intellias',
        careers_url: `${ORIGIN}/vacancies/`,
        intellias: { fetchDetails: true, detailLimit: 3 },
      },
      {
        fetchText: async (url, opts) => {
          if (String(opts?.body || '').includes('action=fly_vacancies')) {
            return JSON.stringify({
              posts: Array.from({ length: 6 }, (_, i) => `<a href="https://career.intellias.com/vacancy/p-${i}/"><div class="card_title">Role ${i}</div></a>`),
              end: true,
              total: 6,
            });
          }
          detailCalls++;
          return '<div class="vi_rows"><div class="vi_row vi_row--static"><span class="vi_row_icon"><img src="https://career.intellias.com/wp-content/themes/intellias/assets/icons/mappin-icon.svg"></span><span class="vi_row_text">Ukraine</span></div></div>';
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (detailCalls === 3) pass('intellias.fetch() caps detail calls at intellias.detailLimit (6 postings → 3 details)');
    else fail(`expected 3 detail calls (detailLimit=3), saw ${detailCalls}`);
  }

  // fetchDetails is skipped entirely while probing.
  {
    let probeDetailCalls = 0;
    await intellias.fetch(
      {
        name: 'Intellias',
        careers_url: `${ORIGIN}/vacancies/`,
        intellias: { fetchDetails: true },
      },
      {
        maxPages: 1,
        fetchText: async (url, opts) => {
          if (!String(opts?.body || '').includes('action=fly_vacancies')) probeDetailCalls++;
          return JSON.stringify({ posts: [`<a href="https://career.intellias.com/vacancy/x/"><div class="card_title">A</div></a>`], end: false, total: 9 });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (probeDetailCalls === 0) pass('intellias.fetch() skips detail enrichment while probing (ctx.maxPages set)');
    else fail(`expected 0 detail calls while probing, saw ${probeDetailCalls}`);
  }

} catch (e) {
  fail(`intellias provider tests crashed: ${e.message}\n${e.stack}`);
}