import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — epam');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/epam.mjs')).href);
  const epam = module.default;
  const { parseEpamResponse } = module;

  if (epam.id === 'epam') pass('epam.id is "epam"');
  else fail(`epam.id is ${JSON.stringify(epam.id)}`);

  const sample = {
    data: {
      total: 2,
      jobs: [
        {
          name: 'Senior React Native Developer',
          seo: { url: '/en/vacancy/senior-react-native-developer-abc_en' },
          country: 'Poland',
          city: null,
          vacancy_type: 'Remote',
          description: '<p>Build <strong>mobile</strong> products.</p>',
          created_at: '2026-08-31T12:16:16.603Z',
        },
        { name: '', seo: { url: '/bad' } },
        { name: 'Missing URL', seo: {} },
      ],
    },
  };
  const parsed = parseEpamResponse(sample, { name: 'EPAM' });
  if (parsed.length === 1) pass('parseEpamResponse drops malformed rows');
  else fail(`parseEpamResponse returned ${parsed.length} jobs`);
  if (parsed[0]?.url === 'https://careers.epam.com/en/vacancy/senior-react-native-developer-abc_en') pass('parseEpamResponse resolves the official job URL');
  else fail(`parsed url = ${JSON.stringify(parsed[0]?.url)}`);
  if (parsed[0]?.location === 'Poland, Remote') pass('parseEpamResponse combines location and work model');
  else fail(`parsed location = ${JSON.stringify(parsed[0]?.location)}`);
  if (parsed[0]?.description === 'Build mobile products.') pass('parseEpamResponse normalizes description HTML');
  else fail(`parsed description = ${JSON.stringify(parsed[0]?.description)}`);
  if (parsed[0]?.postedAt === Date.parse('2026-08-31T12:16:16.603Z')) pass('parseEpamResponse maps created_at');
  else fail(`parsed postedAt = ${JSON.stringify(parsed[0]?.postedAt)}`);

  for (const empty of [null, {}, [], { data: {} }, { data: { jobs: null } }]) {
    const result = parseEpamResponse(empty);
    if (result.length === 0) pass('parseEpamResponse returns [] for an empty response');
    else fail(`parseEpamResponse did not treat ${JSON.stringify(empty)} as empty`);
  }
  for (const bad of [{ meta: {} }, { data: { jobs: 'wrong', total: 1 } }]) {
    let threw = false;
    try { parseEpamResponse(bad); } catch { threw = true; }
    if (threw) pass('parseEpamResponse rejects an unexpected response shape');
    else fail(`parseEpamResponse accepted ${JSON.stringify(bad)}`);
  }

  const valid = epam.detect({ careers_url: 'https://careers.epam.com/en/jobs/poland' });
  if (valid?.url === 'https://careers.epam.com/api/jobs/v2/search/careers-i18n') pass('epam.detect() matches the exact EPAM host');
  else fail(`epam.detect() returned ${JSON.stringify(valid)}`);
  const invalid = [
    { careers_url: 'http://careers.epam.com/en/jobs' },
    { careers_url: 'https://careers.epam.com.evil.test/en/jobs' },
    { careers_url: 'https://evil.test/careers.epam.com' },
    { careers_url: 42 },
    {},
  ];
  if (invalid.every((entry) => epam.detect(entry) === null)) pass('epam.detect() rejects untrusted and malformed URLs');
  else fail('epam.detect() accepted an invalid URL');

  const calls = [];
  const ctx = {
    transport: 'http',
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const from = Number(new URL(url).searchParams.get('from'));
      return {
        data: {
          total: 51,
          jobs: Array.from({ length: from === 0 ? 50 : 1 }, (_, i) => ({
            name: `Role ${from + i}`,
            seo: { url: `/en/vacancy/role-${from + i}` },
          })),
        },
      };
    },
  };
  const fetched = await epam.fetch({
    name: 'EPAM',
    epam: { query: 'React Native', facets: 'seniority=senior;vacancy_type=remote;country=123' },
  }, ctx);
  if (fetched.length === 51 && calls.length === 2) pass('epam.fetch() paginates until total is reached');
  else fail(`epam.fetch() returned ${fetched.length} jobs across ${calls.length} calls`);
  const firstUrl = new URL(calls[0]?.url);
  if (firstUrl.searchParams.get('q') === 'React Native' && firstUrl.searchParams.get('facets') === 'seniority=senior;vacancy_type=remote;country=123') {
    pass('epam.fetch() forwards configured query and facets');
  } else fail(`epam.fetch() query = ${calls[0]?.url}`);
  if (calls.every(({ opts }) => opts?.redirect === 'error')) pass('epam.fetch() refuses redirects on every request');
  else fail('epam.fetch() must set redirect:"error"');

  let probeCalls = 0;
  await epam.fetch({}, {
    ...ctx,
    maxPages: 1,
    fetchJson: async () => {
      probeCalls++;
      return { data: { total: 100, jobs: Array.from({ length: 50 }, (_, i) => ({ name: `Probe ${i}`, seo: { url: `/en/vacancy/probe-${i}` } })) } };
    },
  });
  if (probeCalls === 1) pass('epam.fetch() honors ctx.maxPages during health probes');
  else fail(`epam.fetch() probe made ${probeCalls} requests`);

  const sentinel = new Error('probe cutoff');
  let propagated = null;
  try {
    await epam.fetch({}, { ...ctx, maxPages: 1, fetchJson: async () => { throw sentinel; } });
  } catch (error) { propagated = error; }
  if (propagated === sentinel) pass('epam.fetch() propagates probe errors unwrapped');
  else fail('epam.fetch() did not preserve the probe error identity');
} catch (error) {
  fail(`epam provider tests crashed: ${error.message}`);
}
