// tests/providers/traffit.test.mjs — direct provider-contract tests.
// Covers the id/detect/fetch contract scan.mjs calls: api: precedence with the
// host allowlist, careers_url auto-detection, normalization from the bare-array
// JSON shape, and the guard chain running before any request.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — traffit');

try {
  const traffitModule = await import(pathToFileURL(join(ROOT, 'providers/traffit.mjs')).href);
  const traffit = traffitModule.default;

  if (traffit.id === 'traffit') pass('traffit.id is "traffit"');
  else fail(`traffit.id is ${JSON.stringify(traffit.id)}`);

  // detect() — auto-detects a *.traffit.com careers_url → canonical feed.
  const hit = traffit.detect({ name: 'Pretius', careers_url: 'https://pretiushr.traffit.com/public/job_posts/published' });
  if (hit && hit.url === 'https://pretiushr.traffit.com/public/job_posts/published') {
    pass('traffit.detect() claims a *.traffit.com careers_url');
  } else {
    fail(`traffit.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect() — an explicit allowlisted api: wins over a branded careers_url.
  const hitApi = traffit.detect({
    name: 'Pretius',
    careers_url: 'https://pretius.com/pl/kariera',
    api: 'https://pretiushr.traffit.com/public/job_posts/published',
  });
  if (hitApi && hitApi.url === 'https://pretiushr.traffit.com/public/job_posts/published') {
    pass('traffit.detect() honors an allowlisted api: over a branded careers_url');
  } else {
    fail(`traffit.detect(api-pinned) returned ${JSON.stringify(hitApi)}`);
  }

  // detect() — a branded (non-traffit) careers_url with no api: must NOT be
  // claimed: the tenant host cannot be derived from the brand.
  if (traffit.detect({ name: 'Pretius', careers_url: 'https://pretius.com/pl/kariera' }) === null) {
    pass('traffit.detect() returns null for a branded careers_url with no api:');
  } else {
    fail('traffit.detect() must not auto-claim a branded (non-traffit) careers_url');
  }

  // detect() — api: with an untrusted host must NOT be claimed (SSRF guard).
  if (traffit.detect({ name: 'Evil', api: 'https://evil.example/public/job_posts/published' }) === null) {
    pass('traffit.detect() returns null for an api: on an untrusted host');
  } else {
    fail('traffit.detect() must reject an untrusted api: host');
  }

  // detect() — api: must be HTTPS.
  if (traffit.detect({ name: 'Insecure', api: 'http://pretiushr.traffit.com/public/job_posts/published' }) === null) {
    pass('traffit.detect() returns null for a non-HTTPS api:');
  } else {
    fail('traffit.detect() must reject an http:// api:');
  }

  // detect() — malformed api: URL → null, not a crash.
  if (traffit.detect({ name: 'Broken', api: 'not a url' }) === null) {
    pass('traffit.detect() returns null for a malformed api: URL');
  } else {
    fail('traffit.detect() should treat a malformed api: as unclaimable');
  }

  // detect() — missing / null / non-string careers_url and api.
  if (traffit.detect({ name: 'X' }) === null
      && traffit.detect({ name: 'X', careers_url: null }) === null
      && traffit.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('traffit.detect() returns null for missing / null / non-string careers_url');
  } else {
    fail('traffit.detect() should treat non-string careers_url as missing');
  }

  // fetch() — request URL, SSRF guard, and normalization from the real bare-array
  // shape: [{ url, advert: { name, values:[{field_id:"description",value}] }, options: {_location}, valid_start }].
  const sample = [
    {
      url: 'https://pretiushr.traffit.com/public/an/abc123?source=career_page',
      id: 305,
      advert: {
        id: 482,
        name: 'Senior React Native Developer',
        values: [
          {
            field_id: 'description',
            value: '<p>We are looking for a <strong>Senior React Native</strong> engineer.</p><ul><li>Remote-friendly.</li></ul>',
          },
        ],
        recruitment: { client_id: 30, workflow_id: 5, id: 635, nr_ref: '11/8/2026/MP/635' },
      },
      valid_start: '2026-08-24 21:33:03',
      options: { _rateFrom: '120', _rateTo: '150', _location: 'zdalnie i/lub Warszawa', remote: '0' },
    },
    {
      url: 'https://pretiushr.traffit.com/public/an/def456?source=career_page',
      id: 316,
      advert: {
        id: 490,
        name: '',                                       // no title → dropped
        values: [],
      },
      valid_start: '2026-09-30 13:51:58',
      options: {},
    },
    { url: 'https://pretiushr.traffit.com/public/an/ghi789?source=career_page', id: 317, advert: null },  // no advert → dropped
    {
      url: 'https://pretiushr.traffit.com/public/an/jkl012?source=career_page',
      id: 318,
      advert: { name: 'HR Specialist' },                // no url? no — has url; no description, no valid_start
      valid_start: 'not-a-date',
      options: { _location: 'Warszawa (praca hybrydowa)' },
    },
  ];

  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await traffit.fetch(
    { name: 'Pretius', careers_url: 'https://pretius.com/pl/kariera', api: 'https://pretiushr.traffit.com/public/job_posts/published' },
    { fetchJson: async (url, opts) => { capturedUrl = url; capturedOpts = opts; return sample; } },
  );

  if (capturedUrl === 'https://pretiushr.traffit.com/public/job_posts/published' && capturedOpts?.redirect === 'error') {
    pass('traffit.fetch() hits the api URL with redirect:"error" (SSRF guard)');
  } else {
    fail(`traffit.fetch() url=${JSON.stringify(capturedUrl)} opts=${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 2)
    pass('traffit.fetch() drops rows missing title or advert (2 of 4 kept)');
  else fail(`traffit.fetch() returned ${fetched.length} jobs (expected 2)`);

  if (fetched[0]?.title === 'Senior React Native Developer'
      && fetched[0]?.url === 'https://pretiushr.traffit.com/public/an/abc123?source=career_page'
      && fetched[0]?.company === 'Pretius'
      && fetched[0]?.location === 'zdalnie i/lub Warszawa'
      && fetched[0]?.postedAt === Date.parse('2026-08-24 21:33:03'))
    pass('traffit.fetch() maps advert.name/url/entry.name/options._location/valid_start');
  else fail(`traffit.fetch() row 0 = ${JSON.stringify(fetched[0])}`);

  if (fetched[0]?.description === 'We are looking for a Senior React Native engineer. Remote-friendly.')
    pass('traffit.fetch() strips the description HTML into clean plain text');
  else fail(`traffit.fetch() row 0 description = ${JSON.stringify(fetched[0]?.description)}`);

  if (fetched[1]?.location === 'Warszawa (praca hybrydowa)' && fetched[1]?.postedAt === undefined && !('description' in fetched[1]))
    pass('traffit.fetch() omits postedAt on an unparseable valid_start and the description key when absent');
  else fail(`traffit.fetch() row 1 = ${JSON.stringify(fetched[1])}`);

  // Guard chain runs BEFORE any request: an untrusted api: must throw without
  // ever calling fetchJson.
  let untrustedFetchCalled = false;
  try {
    await traffit.fetch(
      { name: 'Evil', api: 'https://evil.example/public/job_posts/published' },
      { fetchJson: async () => { untrustedFetchCalled = true; return []; } },
    );
    fail('traffit.fetch() should throw for an untrusted api: host');
  } catch (e) {
    if (!untrustedFetchCalled && /untrusted hostname/.test(e.message)) {
      pass('traffit.fetch() throws on an untrusted api: host before any request is made');
    } else {
      fail(`traffit.fetch() untrusted api: fetchCalled=${untrustedFetchCalled}, error=${e.message}`);
    }
  }

  // Malformed response bodies → the shape guard fires (non-array → throw), and
  // an empty array → [] (endpoint alive, nothing published).
  const emptyOk = await traffit.fetch(
    { name: 'Pretius', careers_url: 'https://pretius.com/pl/kariera', api: 'https://pretiushr.traffit.com/public/job_posts/published' },
    { fetchJson: async () => [] },
  );
  if (Array.isArray(emptyOk) && emptyOk.length === 0)
    pass('traffit.fetch() returns [] for an empty array (endpoint alive, nothing matched)');
  else fail(`traffit.fetch() empty array → ${JSON.stringify(emptyOk)}`);

  for (const body of [null, {}, { jobs: [] }, 'not json']) {
    let threw = null;
    try {
      await traffit.fetch(
        { name: 'Pretius', careers_url: 'https://pretius.com/pl/kariera', api: 'https://pretiushr.traffit.com/public/job_posts/published' },
        { fetchJson: async () => body },
      );
    } catch (e) {
      threw = e;
    }
    if (threw && /expected a JSON array/.test(threw.message)) {
      pass(`traffit.fetch() throws a descriptive error for a non-array body (${JSON.stringify(body)})`);
    } else {
      fail(`traffit.fetch() body=${JSON.stringify(body)} threw=${threw?.message}`);
    }
  }

  // Underivable entry → typed error, no request.
  try {
    await traffit.fetch(
      { name: 'NoTenant', careers_url: 'https://example.com/careers' },
      { fetchJson: async () => { throw new Error('must not be called'); } },
    );
    fail('traffit.fetch() should throw when no API URL can be derived');
  } catch (e) {
    if (/cannot derive API URL for NoTenant/.test(e.message)) {
      pass('traffit.fetch() throws "cannot derive API URL" for an undetectable entry');
    } else {
      fail(`traffit.fetch() threw the wrong error: ${e.message}`);
    }
  }

} catch (e) {
  fail(`traffit provider tests crashed: ${e.message}`);
}