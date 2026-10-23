// tests/providers/elempleo.test.mjs: ElEmpleo provider (providers/elempleo.mjs).
// Offline only. The card fixture reproduces the markup measured on
// www.elempleo.com/co/ofertas-empleo/ on 2026-10-23: each result card carries
// its data as entity-encoded JSON in data-ga4-offerdata. Values are fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseCards } from '../../providers/elempleo.mjs';

const BASE = 'https://www.elempleo.com/co/ofertas-empleo/';

/** Encode the way the board does: JSON, then &quot; and numeric entities for non-ASCII. */
function attr(obj) {
  return JSON.stringify(obj)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`);
}

function card(id, { title = `Analista ${id}`, company = 'Acme S.A.S', location = 'Bogotá' } = {}) {
  const offerdata = attr({ section: 'SEARCH', id, title, company, location, position: 1 });
  const path = `/co/ofertas-trabajo/analista-${id}`;
  return `
  <div class="col-md-12 result-item mb-3 bg-white">
    <div class="col-md-12 p-0 js-area-bind area-bind" data-url="${path}" data-ga4-offerdata="${offerdata}" style="position: relative;">
      <h2 class="h4 item-title"><a class="js-offer-title" href="${path}" title="x">${title}</a></h2>
      <h3 class="company-name-text"><span class="info-company-name js-offer-company">${company}</span></h3>
      <a href="https://web.whatsapp.com/send?text=https://www.elempleo.com${path}">WhatsApp</a>
      <a class="js-view-offer" href="${path}" data-ga4-offerdata="">Ver oferta</a>
    </div>
  </div>`;
}

function page(...cards) {
  return `<html><body><div class="js-results-container">${cards.join('\n')}</div></body></html>`;
}

function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const p = Number(new URL(url).searchParams.get('pagina'));
        const body = pages[p];
        if (body instanceof Error) throw body;
        return body ?? page();
      },
      ...extra,
    },
  };
}

test('id is elempleo', () => {
  assert.equal(provider.id, 'elempleo');
});

test('detect() claims elempleo.com over https only and never throws', () => {
  assert.deepEqual(provider.detect({ careers_url: BASE }), { url: BASE });
  for (const careers_url of [
    'https://evil.example/?u=elempleo.com',
    'https://www.elempleo.com.evil.example/co/',
    'https://notelempleo.com/co/',
    'http://www.elempleo.com/co/ofertas-empleo/',
    'nope',
  ]) {
    assert.equal(provider.detect({ careers_url }), null, careers_url);
  }
  assert.equal(provider.detect({}), null);
  assert.equal(provider.detect(null), null);
  assert.equal(provider.detect({ careers_url: {} }), null);
});

test('fetch() refuses a foreign host before any request', async () => {
  const { ctx, calls } = makeCtx({});
  await assert.rejects(provider.fetch({ name: 'X', provider: 'elempleo', careers_url: 'https://evil.example/co/' }, ctx), /not an elempleo.com host/);
  assert.equal(calls.length, 0);
});

test('entities decode once: Mec&#225;nico becomes Mecánico', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card(101, { title: 'Mecánico de mantenimiento' }), card(102, { title: 'Ingeniero R&D' })) });
  const jobs = await provider.fetch({ name: 'ElEmpleo', careers_url: BASE }, ctx);
  assert.ok(page(card(101, { title: 'Mecánico de mantenimiento' })).includes('Mec&#225;nico'), 'fixture carries the encoded form');
  assert.equal(jobs[0].title, 'Mecánico de mantenimiento');
  assert.equal(jobs[1].title, 'Ingeniero R&D');
  assert.equal(jobs[0].location, 'Bogotá');
  assert.ok(calls.every((c) => c.opts.redirect === 'error'), 'every request passes redirect: error');
  assert.ok(calls.every((c) => !('User-Agent' in (c.opts.headers || {}))), 'no provider-set User-Agent');
});

test('one row per posting: share links and empty offerdata are not postings', async () => {
  const jobs = await provider.fetch({ name: 'ElEmpleo', careers_url: BASE }, makeCtx({ 1: page(card(201), card(202)) }).ctx);
  assert.deepEqual(jobs.map((j) => j.url), [
    'https://www.elempleo.com/co/ofertas-trabajo/analista-201',
    'https://www.elempleo.com/co/ofertas-trabajo/analista-202',
  ]);
});

test('"Empresa confidencial" and a missing company become ?, never the board name', () => {
  const cards = parseCards(page(card(301, { company: 'Empresa confidencial' }), card(302, { company: '' }), card(303)), 'https://www.elempleo.com');
  assert.deepEqual(cards.map((c) => c.company), ['?', '?', 'Acme S.A.S']);
});

test('a malformed offerdata row is skipped, the rest of the page stands', () => {
  const broken = card(401).replace(/data-ga4-offerdata="[^"]+"/, 'data-ga4-offerdata="{&quot;id&quot;:"');
  const cards = parseCards(page(broken, card(402)), 'https://www.elempleo.com');
  assert.deepEqual(cards.map((c) => c.id), ['402']);
});

test('pagination: ?pagina=N, stops on a page with no new ids, honours max_pages', async () => {
  const p1 = page(card(1), card(2));
  const repeat = makeCtx({ 1: p1, 2: p1 });
  assert.equal((await provider.fetch({ name: 'X', careers_url: BASE }, repeat.ctx)).length, 2);
  assert.deepEqual(repeat.calls.map((c) => new URL(c.url).searchParams.get('pagina')), ['1', '2']);

  const walk = makeCtx({ 1: page(card(1)), 2: page(card(2)), 3: page(card(3)) });
  assert.equal((await provider.fetch({ name: 'X', careers_url: BASE, max_pages: 2 }, walk.ctx)).length, 2);
  assert.equal(walk.calls.length, 2);
});

test('empty search -> [], markup change -> throw', async () => {
  assert.deepEqual(await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page() }).ctx), []);
  const changed = page('<div class="new-card"><a href="/co/ofertas-trabajo/analista-77">Analista</a></div>');
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: changed }).ctx), /markup change/);
});

test('a page-1 fetch error is thrown; a later one keeps the earlier pages and warns', async () => {
  const boom = Object.assign(new Error('HTTP 404'), { status: 404 });
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: boom }).ctx), /HTTP 404/);
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page(card(1)), 2: boom }).ctx);
    assert.equal(jobs.length, 1);
    assert.match(warnings.join('\n'), /page 2 failed/);
    assert.doesNotMatch(warnings.join('\n'), /Raise max_pages/);
  } finally {
    console.warn = warn;
  }
});

test('health probe: ctx.maxPages 1 makes exactly one request and propagates a rejection unwrapped', async () => {
  const probe = makeCtx({ 1: page(card(1)), 2: page(card(2)) }, { maxPages: 1 });
  await provider.fetch({ name: 'X', careers_url: BASE }, probe.ctx);
  assert.equal(probe.calls.length, 1);

  const sentinel = new Error('budget');
  const failing = makeCtx({ 1: sentinel }, { maxPages: 1 });
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, failing.ctx), (err) => err === sentinel);
  assert.equal(failing.calls.length, 1);
});
