// tests/providers/sigma.test.mjs — Sigma Software WordPress admin-ajax provider.
import { pass, fail, captureConsoleErrors, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — sigma');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/sigma.mjs')).href);
  const sigma = mod.default;
  const { buildSigmaFilters, parseSigmaAjax, parseSigmaCards } = mod;

  const ORIGIN = 'https://career.sigma.software';

  if (sigma.id === 'sigma') pass('sigma.id is "sigma"');
  else fail(`sigma.id is ${JSON.stringify(sigma.id)}`);

  // ── detect() ──
  const hit = sigma.detect({ name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/?direction=android,ios` });
  if (hit && hit.url === `${ORIGIN}/what-we-offer/vacancies/?direction=android,ios`) {
    pass('sigma.detect() resolves career.sigma.software careers_url');
  } else {
    fail(`sigma.detect(careers_url) returned ${JSON.stringify(hit)}`);
  }

  if (sigma.detect({ name: 'X', careers_url: 'https://evil.example/career.sigma.software' }) === null) {
    pass('sigma.detect() returns null for a path-spoofed host');
  } else {
    fail('sigma.detect() must NOT misdetect a path-spoofed URL');
  }
  if (sigma.detect({ name: 'X', careers_url: `http://career.sigma.software/vacancies/` }) === null) {
    pass('sigma.detect() returns null for a non-HTTPS careers_url');
  } else {
    fail('sigma.detect() should reject a non-HTTPS URL');
  }
  if (sigma.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('sigma.detect() returns null for an untrusted host');
  } else {
    fail('sigma.detect() should return null for an untrusted host');
  }
  for (const bad of [null, undefined, 42, { foo: 'bar' }, 'not a url', 'https://']) {
    if (sigma.detect({ name: 'X', careers_url: bad }) === null) pass(`sigma.detect() returns null for careers_url=${JSON.stringify(bad)}`);
    else fail(`sigma.detect() should return null for careers_url=${JSON.stringify(bad)}`);
  }
  if (sigma.detect({ name: 'X' }) === null) pass('sigma.detect() returns null when careers_url is missing');
  else fail('sigma.detect() should return null when careers_url is missing');

  // ── buildSigmaFilters ──
  const filters = buildSigmaFilters(`${ORIGIN}/what-we-offer/vacancies/?direction=android,ios,javascript&locations=Europe,Poland&keyword=react`);
  if (filters.get('direction') === '["android","ios","javascript"]'
      && filters.get('direction_type') === 'children'
      && filters.get('locations') === '["Europe","Poland"]'
      && filters.get('keyword') === 'react'
      && !filters.has('seniority')) {
    pass('buildSigmaFilters() maps comma-separated URL filters to JSON-array form fields, with direction_type=children');
  } else {
    fail(`buildSigmaFilters() = ${filters.toString()}`);
  }

  const noDirection = buildSigmaFilters(`${ORIGIN}/what-we-offer/vacancies/`);
  if (!noDirection.has('direction') && !noDirection.has('direction_type')) {
    pass('buildSigmaFilters() omits direction_type when no direction filter is present');
  } else {
    fail(`buildSigmaFilters() no-direction = ${noDirection.toString()}`);
  }

  // ── parseSigmaAjax ──
  if (parseSigmaAjax('').html === '' && parseSigmaAjax('   ').html === '') {
    pass('parseSigmaAjax() returns an empty page for an empty/contentless body');
  } else {
    fail('parseSigmaAjax() should treat an empty body as an empty page');
  }
  if (parseSigmaAjax('null').html === '' && parseSigmaAjax('{}').html === '' && parseSigmaAjax('[]').html === '') {
    pass('parseSigmaAjax() returns an empty page for null/{}/[]');
  } else {
    fail('parseSigmaAjax() should return an empty page for null/{}/[]');
  }
  let threwShape = false;
  try { parseSigmaAjax('{"total":5}'); } catch { threwShape = true; }
  if (threwShape) pass('parseSigmaAjax() throws when the documented data.html / data.has_more envelope is absent');
  else fail('parseSigmaAjax() should throw on a non-conforming response shape');
  threwShape = false;
  try { parseSigmaAjax('not json at all'); } catch { threwShape = true; }
  if (threwShape) pass('parseSigmaAjax() throws on a non-JSON body');
  else fail('parseSigmaAjax() should throw on a non-JSON body');

  const ajaxEnd = parseSigmaAjax('{"success":true,"data":{"html":"","has_more":false}}');
  const ajaxOpen = parseSigmaAjax('{"success":true,"data":{"html":"<a></a>","has_more":true}}');
  if (ajaxEnd.hasMore === false && ajaxOpen.hasMore === true && ajaxOpen.html.includes('<a>')) {
    pass('parseSigmaAjax() surfaces the source has_more flag');
  } else {
    fail('parseSigmaAjax() should surface the has_more flag');
  }

  // ── parseSigmaCards ──
  const cardsHtml = `
    <a class="vacancy-card-new" href="https://career.sigma.software/vacancy/javascript-developer-8/">
      <div class="vacancy-card-new__top"><h3 class="vacancy-card-new__title">JavaScript Developer <span class="subtitle">(CRM Platform)</span></h3></div>
      <div class="vacancy-card-new__bottom"><div class="vacancy-card-new__locations"><img src=".../location.svg"><span>Latin America, Brazil</span></div></div>
    </a>
    <a class="vacancy-card-new" href="https://career.sigma.software/vacancy/android-developer-4/">
      <div class="vacancy-card-new__top"><h3 class="vacancy-card-new__title">Android Developer</h3></div>
      <div class="vacancy-card-new__bottom"><div class="vacancy-card-new__locations"><img src=".../location.svg"><span>Europe, Poland</span></div></div>
    </a>`;
  const parsed = parseSigmaCards(cardsHtml);
  if (parsed.length === 2
      && parsed[0].title === 'JavaScript Developer (CRM Platform)'
      && parsed[0].url === 'https://career.sigma.software/vacancy/javascript-developer-8/'
      && parsed[0].location === 'Latin America, Brazil'
      && parsed[0].company === 'Sigma Software'
      && parsed[1].title === 'Android Developer') {
    pass('parseSigmaCards() extracts title (title + subtitle, decoded), url, location, company');
  } else {
    fail(`parseSigmaCards() = ${JSON.stringify(parsed)}`);
  }

  // An &amp; entity in a title must be decoded, not carry the raw entity.
  const entityCard = `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/x-1/"><h3 class="vacancy-card-new__title">Full Stack &amp; DevOps</h3></a>`;
  const entityJobs = parseSigmaCards(entityCard);
  if (entityJobs.length === 1 && entityJobs[0].title === 'Full Stack & DevOps') {
    pass('parseSigmaCards() decodes HTML entities in a title before the keyword match');
  } else {
    fail(`parseSigmaCards() entity title = ${JSON.stringify(entityJobs)}`);
  }

  if (parseSigmaCards('').length === 0) pass('parseSigmaCards() returns [] for an empty body');
  else fail('parseSigmaCards() should return [] for an empty body');

  // Off-host and empty-title cards are dropped.
  const badCards = `
    <a class="vacancy-card-new" href="https://evil.example/vacancy/c-3/"><h3 class="vacancy-card-new__title">Dropped</h3></a>
    <a class="vacancy-card-new" href="https://career.sigma.software/vacancy/d-4/"><h3 class="vacancy-card-new__title">   </h3></a>
    <a class="vacancy-card-new" href="/vacancy/rel-1/"><h3 class="vacancy-card-new__title">Rel</h3></a>`;
  const badJobs = parseSigmaCards(badCards);
  if (badJobs.length === 0) pass('parseSigmaCards() drops off-host, blank-title and relative-href cards');
  else fail(`parseSigmaCards() bad cards = ${JSON.stringify(badJobs)}`);

  // ── fetch(): normalization, pagination, redirect guard ──
  {
    const calls = [];
    const jobs = await sigma.fetch(
      { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/?direction=android,ios` },
      {
        fetchText: async (url, opts) => {
          calls.push({ url, opts });
          const page = Number(new URLSearchParams(opts.body).get('page'));
          if (page === 0) {
            return JSON.stringify({ success: true, data: {
              html: `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/a-1/"><h3 class="vacancy-card-new__title">Role A</h3><div class="vacancy-card-new__locations"><span>Poland</span></div></a>` +
                    `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/b-2/"><h3 class="vacancy-card-new__title">Role B</h3></a>` +
                    `<a class="vacancy-card-new" href="https://evil.example/vacancy/c-3/"><h3 class="vacancy-card-new__title">Dropped</h3></a>` +
                    `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/d-4/"><h3 class="vacancy-card-new__title">  </h3></a>`,
              has_more: true,
            } });
          }
          return JSON.stringify({ success: true, data: {
            html: `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/e-5/"><h3 class="vacancy-card-new__title">Role E</h3></a>`,
            has_more: false,
          } });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (jobs.length === 3 && jobs.map(j => j.title).join(',') === 'Role A,Role B,Role E') {
      pass('sigma.fetch() normalizes cards, drops bad rows, and aggregates across pages');
    } else {
      fail(`sigma.fetch() returned ${JSON.stringify(jobs)}`);
    }
    if (calls.length === 2 && calls.every(c => c.opts.redirect === 'error')) {
      pass('sigma.fetch() passes redirect:error on every request');
    } else {
      fail(`sigma.fetch() requests: ${JSON.stringify(calls.map(c => ({ body: c.opts.body, redirect: c.opts.redirect })))}`);
    }
    const body0 = calls[0]?.opts?.body || '';
    if (calls[0]?.opts?.method === 'POST'
        && body0.includes('action=filter_vacancies_v2_loadmore')
        && body0.includes('page=0')
        && body0.includes('direction')
        && body0.includes('direction_type=children')) {
      pass('sigma.fetch() POSTs the filter_vacancies_v2_loadmore action with page + parsed filters');
    } else {
      fail(`sigma.fetch() request shape: ${JSON.stringify(calls[0]?.opts)}`);
    }
  }

  // Empty board → []; first page 404 / wrong host → throw before any request.
  {
    const empty = await sigma.fetch(
      { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
      { fetchText: async () => JSON.stringify({ success: true, data: { html: '', has_more: false } }), sleep: () => Promise.resolve() },
    );
    if (Array.isArray(empty) && empty.length === 0) pass('sigma.fetch() returns [] for an empty board');
    else fail('sigma.fetch() should return [] for an empty board');

    let called = false;
    let threw = false;
    try {
      await sigma.fetch(
        { name: 'X', careers_url: 'https://evil.example/vacancies/' },
        { fetchText: async () => { called = true; return ''; }, sleep: () => Promise.resolve() },
      );
    } catch { threw = true; }
    if (threw && !called) pass('sigma.fetch() throws on an untrusted host before any request');
    else fail(`sigma.fetch() untrusted host: called=${called} threw=${threw}`);
  }

  // ctx.maxPages caps the walk (probe behavior): one list request, and a
  // fetch rejection propagates unwrapped (not swallowed to []).
  {
    let listCalls = 0;
    await sigma.fetch(
      { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
      {
        maxPages: 1,
        fetchText: async () => {
          listCalls++;
          return JSON.stringify({ success: true, data: { html: `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/a-1/"><h3 class="vacancy-card-new__title">A</h3></a>`, has_more: true } });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (listCalls === 1) pass('sigma.fetch() honors ctx.maxPages and stops after one list page');
    else fail(`sigma.fetch() ctx.maxPages=1 made ${listCalls} list calls`);

    let probeErr = null;
    try {
      await sigma.fetch(
        { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
        { maxPages: 1, fetchText: async () => { throw new Error('ProbePageBudgetReached'); }, sleep: () => Promise.resolve() },
      );
    } catch (e) { probeErr = e; }
    if (probeErr && probeErr.message === 'ProbePageBudgetReached') {
      pass('sigma.fetch() propagates a ctx.fetch rejection unwrapped while probing');
    } else {
      fail(`sigma.fetch() probe rejection was swallowed: ${probeErr && probeErr.message}`);
    }
  }

  // DEFAULT_MAX_PAGES bounds the walk even when the source never reports end.
  {
    let calls = 0;
    const cap = await sigma.fetch(
      { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
      {
        fetchText: async () => {
          calls++;
          return JSON.stringify({ success: true, data: { html: `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/x-${calls}/"><h3 class="vacancy-card-new__title">Role ${calls}</h3></a>`, has_more: true } });
        },
        sleep: () => Promise.resolve(),
      },
    );
    if (calls === 20 && cap.length === 20) pass('sigma.fetch() stops at DEFAULT_MAX_PAGES (20) when the source never ends');
    else fail(`sigma.fetch() cap: calls=${calls}, rows=${cap.length} (expected 20/20)`);
  }

  // A first page that shipped cards but parsed to none is a markup break → throw.
  {
    let firstPageThrew = false;
    try {
      await sigma.fetch(
        { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
        { fetchText: async () => JSON.stringify({ success: true, data: { html: '<div>unparseable card</div>', has_more: true } }), sleep: () => Promise.resolve() },
      );
    } catch { firstPageThrew = true; }
    if (firstPageThrew) pass('sigma.fetch() throws when page 0 ships cards but none parse (markup break)');
    else fail('sigma.fetch() should throw on a page-0 markup break');
  }

  // The "raise max_pages" warning fires only when the config cap (not ctx) truncated a live board.
  {
    const { result, errors } = await captureConsoleErrors(async () => {
      const jobs = await sigma.fetch(
        { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
        {
          fetchText: async () => JSON.stringify({ success: true, data: { html: `<a class="vacancy-card-new" href="https://career.sigma.software/vacancy/x/"><h3 class="vacancy-card-new__title">A</h3></a>`, has_more: true } }),
          sleep: () => Promise.resolve(),
        },
      );
      return jobs;
    });
    if (result.length && errors.some(e => String(e).includes('raise max_pages'))) {
      pass('sigma.fetch() warns to raise max_pages when the config cap truncates a board');
    } else {
      fail(`sigma.fetch() truncation warning: errors=${JSON.stringify(errors)}`);
    }

    const { errors: probeErrors } = await captureConsoleErrors(async () => {
      await sigma.fetch(
        { name: 'Sigma Software', careers_url: `${ORIGIN}/what-we-offer/vacancies/` },
        { maxPages: 1, fetchText: async () => JSON.stringify({ success: true, data: { html: '', has_more: true } }), sleep: () => Promise.resolve() },
      );
    });
    if (probeErrors.length === 0) pass('sigma.fetch() does not warn to raise max_pages on a ctx.maxPages (probe) stop');
    else fail(`sigma.fetch() probe should not warn: ${JSON.stringify(probeErrors)}`);
  }

} catch (e) {
  fail(`sigma provider tests crashed: ${e.message}\n${e.stack}`);
}