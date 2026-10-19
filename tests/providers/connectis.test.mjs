// tests/providers/connectis.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — connectis');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/connectis.mjs')).href);
  const connectis = mod.default;
  const { parseOffers } = mod;

  if (connectis.id === 'connectis') pass('connectis.id is "connectis"');
  else fail(`connectis.id is ${JSON.stringify(connectis.id)}`);

  // parseOffers — happy path: title/url/location/description/requisitionId.
  const sample = {
    data: {
      publicJobBoardOffers: [
        {
          id: '465be326-c417-465c-af4d-3c5061718736',
          jobOrderId: '41AE3423-B004-449F-9B4E-3A224E1B5353',
          jobOrder: {
            role: 'Mobile app developer',
            leadingTechnologyName: 'React native',
            locationPreference: 'Warszawa, Polska',
            workMode: 'Remote',
            seniority: 'Senior',
            description: '<p>Build <strong>mobile</strong> apps.</p>',
            skillsMustHave: [{ id: '1', name: 'React Native' }],
            skillsNiceToHave: [],
          },
        },
        {
          id: '83e1874d-844e-4103-9d97-1bb8b7966c3a',
          jobOrderId: '34353AEA-75DC-452C-A6A6-0DBCFD10F6D0',
          jobOrder: {
            role: 'Backend developer',
            leadingTechnologyName: 'Java',
            locationPreference: 'Gdynia, Polska',
            description: '',
          },
        },
      ],
    },
  };
  const jobs = parseOffers(sample, 'Connectis');
  if (jobs.length === 2) pass('parseOffers extracts 2 jobs');
  else fail(`parseOffers returned ${jobs.length} jobs`);

  if (jobs[0].title === 'Mobile app developer (React native)') pass('parseOffers folds the leading technology into the title');
  else fail(`job[0].title = ${JSON.stringify(jobs[0]?.title)}`);

  if (jobs[0].url === 'https://hub.connectis.pl/offer/465be326-c417-465c-af4d-3c5061718736') pass('parseOffers builds the offer URL from the id');
  else fail(`job[0].url = ${JSON.stringify(jobs[0]?.url)}`);

  if (jobs[0].company === 'Connectis') pass('parseOffers sets company from entry name');
  else fail(`job[0].company = ${JSON.stringify(jobs[0]?.company)}`);

  if (jobs[0].location === 'Warszawa, Polska') pass('parseOffers maps locationPreference to location');
  else fail(`job[0].location = ${JSON.stringify(jobs[0]?.location)}`);

  if (jobs[0].description === 'Build mobile apps.') pass('parseOffers strips HTML from the description');
  else fail(`job[0].description = ${JSON.stringify(jobs[0]?.description)}`);

  if (!('description' in jobs[1])) pass('parseOffers omits description when the payload has an empty string');
  else fail(`job[1] should omit description, got ${JSON.stringify(jobs[1]?.description)}`);

  if (jobs[0].requisitionId === '41AE3423-B004-449F-9B4E-3A224E1B5353') pass('parseOffers sets requisitionId from jobOrderId');
  else fail(`job[0].requisitionId = ${JSON.stringify(jobs[0]?.requisitionId)}`);

  // Title fold is skipped when tech is absent, "none", or already in the role.
  const noFold = parseOffers({
    data: {
      publicJobBoardOffers: [
        { id: 'a', jobOrder: { role: 'PMO', leadingTechnologyName: null } },
        { id: 'b', jobOrder: { role: 'Analyst', leadingTechnologyName: 'none' } },
        { id: 'c', jobOrder: { role: 'React Native Developer', leadingTechnologyName: 'React Native' } },
      ],
    },
  }, {});
  if (noFold.map((j) => j.title).join('|') === 'PMO|Analyst|React Native Developer') pass('parseOffers does not fold a null/none/duplicate technology');
  else fail(`parseOffers titles = ${JSON.stringify(noFold.map((j) => j.title))}`);

  // Drops malformed rows (missing role, missing id, null jobOrder) without throwing.
  const dirty = parseOffers({
    data: {
      publicJobBoardOffers: [
        { id: 'x', jobOrder: null },
        { id: 'y', jobOrder: { role: '   ' } },
        { jobOrderId: 'z', jobOrder: { role: 'No id' } },
        null,
        { id: 'good', jobOrder: { role: 'Good Role' } },
      ],
    },
  }, {});
  if (dirty.length === 1 && dirty[0].title === 'Good Role') pass('parseOffers drops malformed rows and keeps the valid one');
  else fail(`dirty = ${JSON.stringify(dirty.map((j) => j.title))}`);

  // A lone surrogate in a host-controlled id drops just that posting.
  const surrogate = parseOffers({
    data: {
      publicJobBoardOffers: [
        { id: '\uD800', jobOrder: { role: 'Bad' } },
        { id: 'ok', jobOrder: { role: 'Ok' } },
      ],
    },
  }, {});
  if (surrogate.length === 1 && surrogate[0].url.endsWith('/offer/ok')) pass('parseOffers drops a lone-surrogate id, keeps the rest');
  else fail(`surrogate = ${JSON.stringify(surrogate.map((j) => j.url))}`);

  // Empty board — documented container present and empty → [].
  if (parseOffers({ data: { publicJobBoardOffers: [] } }, {}).length === 0) pass('parseOffers returns [] for an empty board');
  else fail('parseOffers should return [] for an empty board');

  // Broken envelope → descriptive throw.
  const throwers = [
    { data: {} },
    { data: { publicJobBoardOffers: null } },
    { data: { offers: [] } },
    { data: { publicJobBoardOffers: {} } },
    {},
    '',
    null,
  ];
  let allThrew = true;
  for (const bad of throwers) {
    try { parseOffers(bad, {}); allThrew = false; } catch { /* expected */ }
  }
  if (allThrew) pass('parseOffers throws on a missing / wrong-typed / empty envelope');
  else fail('parseOffers should throw on an unexpected response shape');

  // GraphQL errors surface as a descriptive throw.
  let gqlThrew = null;
  try { parseOffers({ errors: [{ message: 'Cannot query field "x"' }] }, {}); } catch (e) { gqlThrew = e; }
  if (gqlThrew && /Cannot query field/.test(gqlThrew.message)) pass('parseOffers throws a descriptive error on GraphQL errors');
  else fail(`parseOffers GraphQL error = ${gqlThrew && gqlThrew.message}`);

  // detect() — fixed host match only; spoofs and non-strings return null.
  if (connectis.detect({ careers_url: 'https://jobs.connectis.pl/?seniority=Regular' })) pass('detect() matches jobs.connectis.pl');
  else fail('detect() should match jobs.connectis.pl');

  if (connectis.detect({ careers_url: 'https://hub.connectis.pl/job-board' })) pass('detect() matches hub.connectis.pl');
  else fail('detect() should match hub.connectis.pl');

  if (connectis.detect({ api: 'https://api.hub.connectis.pl/graphql' })) pass('detect() matches the api host');
  else fail('detect() should match the api host');

  if (connectis.detect({ careers_url: 'http://jobs.connectis.pl/' }) === null) pass('detect() rejects non-HTTPS');
  else fail('detect() should reject non-HTTPS');

  if (connectis.detect({ careers_url: 'https://evil.com/jobs.connectis.pl' }) === null) pass('detect() rejects a path-spoofed host');
  else fail('detect() should reject a path-spoofed host');

  if (connectis.detect({ careers_url: 'https://jobs.connectis.pl.evil.com/' }) === null) pass('detect() rejects a suffix-spoofed host');
  else fail('detect() should reject a suffix-spoofed host');

  if (connectis.detect({ careers_url: 42 }) === null && connectis.detect({}) === null) pass('detect() returns null for non-string / missing url');
  else fail('detect() should return null for non-string / missing url');

  // fetch() — POSTs the GraphQL query with redirect:'error' via a mock ctx.
  let calledUrl = null, calledOpts = null;
  const mockCtx = {
    fetchJson: async (url, opts) => {
      calledUrl = url;
      calledOpts = opts;
      return { data: { publicJobBoardOffers: [{ id: 'mock', jobOrder: { role: 'Mocked Role' } }] } };
    },
  };
  const fetched = await connectis.fetch({ name: 'Connectis' }, mockCtx);
  if (calledUrl === 'https://api.hub.connectis.pl/graphql') pass('fetch() posts to the GraphQL endpoint');
  else fail(`fetch() url = ${JSON.stringify(calledUrl)}`);

  if (calledOpts?.method === 'POST' && calledOpts?.redirect === 'error') pass('fetch() sends a POST with redirect:"error"');
  else fail(`fetch() opts = ${JSON.stringify(calledOpts)}`);

  if (calledOpts?.headers?.['target-service'] === 'hub-api') pass('fetch() sends the required target-service header');
  else fail(`fetch() headers = ${JSON.stringify(calledOpts?.headers)}`);

  let body = null;
  try { body = JSON.parse(calledOpts?.body); } catch { /* leave null */ }
  if (body?.operationName === 'publicJobBoardOffers' && /publicJobBoardOffers/.test(body?.query || '')) pass('fetch() body carries the publicJobBoardOffers operation');
  else fail(`fetch() body = ${JSON.stringify(calledOpts?.body)}`);

  if (fetched.length === 1 && fetched[0].title === 'Mocked Role') pass('fetch() returns parsed jobs from the mock response');
  else fail(`fetch() returned ${JSON.stringify(fetched)}`);

} catch (e) {
  fail(`connectis provider tests crashed: ${e.message}`);
}
