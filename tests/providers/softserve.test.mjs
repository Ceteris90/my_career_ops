import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — softserve');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/softserve.mjs')).href);
  const softserve = module.default;
  const { decodeNuxtPayload, parseSoftServePage, normalizeVacancy, resolveMaxPages } = module;

  // Build a proper devalue fixture by hand — a helper that produces the exact
  // live serialization for a known vacancy set, so the decoder is tested against
  // the real on-the-wire shape rather than a hand-wave. Mirrors the live
  // career.softserveinc.com layout where EVERY scalar sits behind its own index
  // (a vacancy's level is `{ id: <idx>, name: <idx> }` pointing at number/string
  // values, never inline — an inline number would be misread as a reference).
  const buildPayload = (rows, meta) => {
    const arr = [];
    let next = 7;
    const ref = (value) => {
      arr[next] = value;
      return next++;
    };
    arr[0] = { data: 1, prerenderedAt: -1 };
    arr[1] = ['ShallowReactive', 2];
    arr[2] = { 'vacancies-?filters=1': 3 };
    arr[3] = { data: 4, links: 99, meta: 100 };
    arr[4] = { vacancies: 5, filters: 6 };
    const vacancyRefs = rows.map((row) => {
      const levelRef = ref({ id: ref(row.levelId), name: ref(row.level) });
      const tagRef = ref({ id: ref('remote'), name: ref('Remote/Office') });
      return ref({
        id: ref(row.id), urlSegment: ref(row.urlSegment), name: ref(row.name), city: ref(row.city),
        direction: ref('Engineering & Technology'), highlight: ref(row.name),
        level: levelRef, tags: [tagRef],
      });
    });
    arr[5] = vacancyRefs;
    arr[6] = {};
    arr[99] = {};
    arr[100] = {
      current_page: ref(meta.current_page), from: ref(1), last_page: ref(meta.last_page),
      per_page: ref(12), to: ref(meta.to), total: ref(meta.total),
    };
    return arr;
  };

  const rows = [
    { id: 90734, urlSegment: 'senior-full-stack-engineer-netjs-90734', name: 'Senior Full Stack Engineer (Net+JS)', city: 'Ukraine', levelId: 3, level: 'Senior' },
    { id: 90544, urlSegment: 'middle-candroid-aosp-engineer-90544', name: 'Middle C++\\Android AOSP Engineer', city: 'Poland', levelId: 2, level: 'Middle' },
  ];
  const payload = buildPayload(rows, { current_page: 1, last_page: 1, to: 2, total: 2 });

  if (softserve.id === 'softserve') pass('softserve.id is "softserve"');
  else fail(`softserve.id is ${JSON.stringify(softserve.id)}`);

  const decoded = decodeNuxtPayload(payload);
  if (decoded?.data?.['vacancies-?filters=1']?.data?.vacancies?.length === 2) pass('decodeNuxtPayload resolves devalue references into a plain tree');
  else fail(`decodeNuxtPayload produced ${JSON.stringify(decoded?.data).slice(0, 80)}`);

  const parsed = parseSoftServePage(decoded, { name: 'SoftServe' });
  if (parsed.jobs.length === 2) pass('parseSoftServePage extracts every vacancy');
  else fail(`parsed ${parsed.jobs.length} jobs`);
  if (parsed.lastPage === 1 && parsed.total === 2) pass('parseSoftServePage reads last_page and total from meta');
  else fail(`lastPage=${parsed.lastPage} total=${parsed.total}`);
  if (parsed.jobs[0]?.url === 'https://career.softserveinc.com/en-us/vacancies/senior-full-stack-engineer-netjs-90734') pass('normalizeVacancy builds the canonical posting URL from urlSegment');
  else fail(`url = ${JSON.stringify(parsed.jobs[0]?.url)}`);
  if (parsed.jobs[0]?.company === 'SoftServe' && parsed.jobs[0]?.location === 'Ukraine') pass('normalizeVacancy sets company and location');
  else fail(`job = ${JSON.stringify(parsed.jobs[0])}`);

  if (normalizeVacancy({ urlSegment: 'x', name: '' }, { name: 'SoftServe' }) === null && normalizeVacancy({ name: 'X' }, {}) === null) pass('normalizeVacancy drops rows missing title or urlSegment');
  else fail('normalizeVacancy kept an incomplete row');

  // parseSoftServePage throws on a body that is recognizably not a listing.
  let threw = false;
  try { parseSoftServePage({ data: { unexpected: [] } }, {}); } catch { threw = true; }
  if (threw) pass('parseSoftServePage throws on a payload without a vacancies listing');
  else fail('parseSoftServePage accepted a listing-less payload');

  if (resolveMaxPages({}) === 20 && resolveMaxPages({ max_pages: 3 }) === 3 && resolveMaxPages({ max_pages: 500 }) === 100) pass('resolveMaxPages applies the provider default and the hard ceiling');
  else fail('resolveMaxPages mis-resolved the cap');

  // detect(): positive + junk input must not throw.
  const careersUrl = 'https://career.softserveinc.com/en-us/vacancies/direction-engineering-technology/subdirection-software-development,research-development/position-middle,senior';
  if (softserve.detect({ careers_url: careersUrl })) pass('detect matches a SoftServe careers_url');
  else fail('detect should match the SoftServe careers listing');
  const invalid = [
    { careers_url: 'http://career.softserveinc.com/en-us/vacancies' },
    { careers_url: 'https://career.softserveinc.com.evil.test/en-us/vacancies' },
    { careers_url: 'https://career.softserveinc.com/about' },
    { careers_url: 'https://evil.test/en-us/vacancies' },
    { careers_url: 'https://career.softserveinc.com' },
    {},
    { api: 42 },
  ];
  if (invalid.every((entry) => softserve.detect(entry) === null)) pass('detect rejects invalid / off-host / missing URLs without throwing');
  else fail('detect accepted an invalid URL');

  // fetch(): pagination, redirect refusal, and per-page URL shape. The live site
  // returns exactly 12 vacancies on a full page and fewer on the last; the
  // provider's short-page detector uses that to stop. Use a 13-row fixture so
  // page 1 is full (12) and page 2 holds the 13th.
  const allRows = Array.from({ length: 13 }, (_, i) => ({
    id: i + 1, urlSegment: `job-${i + 1}`, name: `Job ${i + 1}`,
    city: i % 2 ? 'Poland' : 'Ukraine', levelId: i % 2 ? 2 : 3, level: i % 2 ? 'Middle' : 'Senior',
  }));
  const calls = [];
  const fetchCtx = {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const page = url.includes('/page-') ? Number(url.match(/page-(\d+)\//)?.[1] || 1) : 1;
      const start = (page - 1) * 12;
      const slice = allRows.slice(start, start + 12);
      return buildPayload(slice, { current_page: page, last_page: 2, to: Math.min(start + 12, allRows.length), total: 13 });
    },
  };
  const fetched = await softserve.fetch({ name: 'SoftServe', careers_url: careersUrl }, fetchCtx);
  if (fetched.length === 13 && calls.length === 2) pass('fetch follows SSG /page-N pagination across pages');
  else fail(`fetch returned ${fetched.length} jobs over ${calls.length} calls`);
  if (calls[0].url.endsWith('/_payload.json') && calls[1].url.includes('/page-2/_payload.json')) pass('fetch uses the SSG payload URL shape for page 1 and /page-N');
  else fail(`fetch used URLs: ${calls.map((call) => call.url).join(', ')}`);
  if (calls.every((call) => call.opts?.redirect === 'error')) pass('fetch refuses redirects on every request');
  else fail('fetch must refuse redirects');

  // fetch(): health probe honors ctx.maxPages — exactly one request.
  let probeCalls = 0;
  await softserve.fetch({ name: 'SoftServe', careers_url: careersUrl }, {
    maxPages: 1,
    sleep: async () => {},
    fetchJson: async () => { probeCalls++; return buildPayload([], { current_page: 1, last_page: 1, to: 0, total: 0 }); },
  });
  if (probeCalls === 1) pass('fetch honors the health-probe ctx.maxPages=1 cap');
  else fail(`probe made ${probeCalls} requests`);

  // fetch(): empty board returns [] (endpoint alive, nothing matched).
  const empty = await softserve.fetch({ name: 'SoftServe', careers_url: careersUrl }, {
    sleep: async () => {},
    fetchJson: async () => buildPayload([], { current_page: 1, last_page: 1, to: 0, total: 0 }),
  });
  if (Array.isArray(empty) && empty.length === 0) pass('fetch returns [] for an empty board');
  else fail(`empty board returned ${JSON.stringify(empty)}`);

  // fetch(): the SSRF guard runs before any network call.
  let guardChecked = false;
  try {
    await softserve.fetch({ name: 'SoftServe', careers_url: 'https://evil.test/en-us/vacancies' }, {
      fetchJson: async () => { guardChecked = true; return []; },
    });
  } catch { /* expected throw */ }
  if (!guardChecked) pass('fetch rejects an off-host careers_url before any request');
  else fail('fetch issued a request to an off-host URL');
} catch (error) {
  fail(`softserve provider tests crashed: ${error.message}`);
}