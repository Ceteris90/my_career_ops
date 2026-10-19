import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — dataart');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/dataart.mjs')).href);
  const dataart = module.default;
  const { parseDataartResponse } = module;
  if (dataart.id === 'dataart') pass('dataart.id is "dataart"');
  else fail(`dataart.id is ${JSON.stringify(dataart.id)}`);

  const sample = { vacancies: { pagesTotal: 1, items: [
    { contentType: 0, title: 'Senior React Native Engineer', fullUrl: 'https://www.dataart.team/vacancies/rct001', locationTags: [{ title: 'Remote.Poland' }], countriesTags: [{ title: 'Poland' }], text: '<p>Build mobile products.</p>' },
    { contentType: 1, title: 'Promotional banner', fullUrl: 'https://www.dataart.team/vacancies/banner' },
    { contentType: 0, title: 'Bad host', fullUrl: 'https://evil.test/vacancies/bad' },
  ] } };
  const parsed = parseDataartResponse(sample, { name: 'DataArt' });
  if (parsed.length === 1) pass('parseDataartResponse drops promotional and off-host rows');
  else fail(`parsed ${parsed.length} jobs`);
  if (parsed[0]?.location === 'Remote.Poland, Poland') pass('parseDataartResponse combines locations and countries');
  else fail(`location = ${JSON.stringify(parsed[0]?.location)}`);
  if (parsed[0]?.description === 'Build mobile products.') pass('parseDataartResponse normalizes the summary');
  else fail(`description = ${JSON.stringify(parsed[0]?.description)}`);
  if (parseDataartResponse({}).length === 0) pass('parseDataartResponse returns [] for an empty response');
  else fail('empty response should return []');

  if (dataart.detect({ careers_url: 'https://www.dataart.team/advance-career' }) && dataart.detect({ careers_url: 'https://www.dataart.team/vacancies' })) pass('dataart.detect() matches both official entry pages');
  else fail('dataart.detect() should match DataArt careers pages');
  const invalid = [{ careers_url: 'http://www.dataart.team/vacancies' }, { careers_url: 'https://www.dataart.team.evil.test/vacancies' }, { careers_url: 'https://www.dataart.team/articles' }, {}];
  if (invalid.every((entry) => dataart.detect(entry) === null)) pass('dataart.detect() rejects invalid URLs');
  else fail('dataart.detect() accepted an invalid URL');

  const calls = [];
  const result = await dataart.fetch({ name: 'DataArt' }, {
    sleep: async () => {},
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const page = Number(new URL(url).searchParams.get('page'));
      const pageData = { pagesTotal: 2, items: [
        { contentType: 0, title: `Role ${page}`, fullUrl: `https://www.dataart.team/vacancies/role${page}` },
        ...(page === 2 ? [{ contentType: 0, title: 'Repeated Role', fullUrl: 'https://www.dataart.team/vacancies/role1' }] : []),
      ] };
      return page === 1 ? { vacancies: pageData } : pageData;
    },
  });
  if (result.length === 2 && calls.length === 2) pass('dataart.fetch() follows pagination and deduplicates moving rows');
  else fail(`dataart.fetch() returned ${result.length} jobs over ${calls.length} calls`);
  if (calls.every((call) => call.opts?.redirect === 'error')) pass('dataart.fetch() refuses redirects');
  else fail('dataart.fetch() must refuse redirects');
  if (calls.every((call) => call.opts?.headers?.['x-language'] === 'en-US')) pass('dataart.fetch() sends the observed locale header');
  else fail('dataart.fetch() omitted the locale header');
  if (calls[0].url.includes('/filter-fields-page?') && calls[1].url.includes('/filter-content-page?')) pass('dataart.fetch() uses the fields endpoint once, then the content endpoint');
  else fail(`dataart.fetch() used wrong endpoints: ${calls.map((call) => call.url).join(', ')}`);

  let probeCalls = 0;
  await dataart.fetch({}, { maxPages: 1, fetchJson: async () => { probeCalls++; return { vacancies: { pagesTotal: 10, items: [] } }; } });
  if (probeCalls === 1) pass('dataart.fetch() honors health-probe limits');
  else fail(`probe made ${probeCalls} requests`);
} catch (error) {
  fail(`dataart provider tests crashed: ${error.message}`);
}
