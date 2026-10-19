import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — luxoft');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/luxoft.mjs')).href);
  const luxoft = module.default;
  const { parseLuxoftHtml } = module;
  if (luxoft.id === 'luxoft') pass('luxoft.id is "luxoft"');
  else fail(`luxoft.id is ${JSON.stringify(luxoft.id)}`);

  const item = (row) => `<a class="jobs__list__job"><div data-job="${JSON.stringify(row).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div></a>`;
  const parsed = parseLuxoftHtml(
    item({ title: "Senior React & UI Developer's Role", city: 'Remote Poland', location: 'Poland', url: '/jobs/react-ui-123' }) +
    item({ title: "Senior React & UI Developer's Role", city: 'Remote Poland', location: 'Poland', url: '/jobs/react-ui-123' }) +
    item({ title: 'Bad', url: 'https://evil.test/jobs/bad' }),
    { name: 'Luxoft' },
  );
  if (parsed.length === 1 && parsed[0].title === "Senior React & UI Developer's Role") pass('parseLuxoftHtml decodes apostrophes and deduplicates repeated card payloads');
  else fail(`parsed = ${JSON.stringify(parsed)}`);
  if (parsed[0]?.location === 'Remote Poland, Poland') pass('parseLuxoftHtml combines city and country');
  else fail(`location = ${JSON.stringify(parsed[0]?.location)}`);
  if (parsed[0]?.url === 'https://career.luxoft.com/jobs/react-ui-123') pass('parseLuxoftHtml resolves official URLs');
  else fail(`url = ${JSON.stringify(parsed[0]?.url)}`);
  if (parseLuxoftHtml('').length === 0) pass('parseLuxoftHtml returns [] for empty HTML');
  else fail('parseLuxoftHtml should return [] for empty HTML');

  if (luxoft.detect({ careers_url: 'https://career.luxoft.com/jobs?country[]=Poland' })) pass('luxoft.detect() matches filtered job URLs');
  else fail('luxoft.detect() should match Luxoft jobs');
  const invalid = [{ careers_url: 'http://career.luxoft.com/jobs' }, { careers_url: 'https://career.luxoft.com.evil.test/jobs' }, { careers_url: 'https://career.luxoft.com/about' }, {}];
  if (invalid.every((entry) => luxoft.detect(entry) === null)) pass('luxoft.detect() rejects invalid URLs');
  else fail('luxoft.detect() accepted an invalid URL');

  const calls = [];
  const result = await luxoft.fetch({ name: 'Luxoft', careers_url: 'https://career.luxoft.com/jobs?country[]=Poland&perPage=2' }, {
    sleep: async () => {},
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      const page = Number(new URL(url).searchParams.get('page')) || 1;
      return page === 1
        ? item({ title: 'One', url: '/jobs/one' }) + item({ title: 'Two', url: '/jobs/two' })
        : item({ title: 'Three', url: '/jobs/three' });
    },
  });
  if (result.length === 3 && calls.length === 2) pass('luxoft.fetch() paginates until a short page');
  else fail(`luxoft.fetch() returned ${result.length} across ${calls.length} calls`);
  if (calls.every((call) => new URL(call.url).searchParams.getAll('country[]')[0] === 'Poland')) pass('luxoft.fetch() preserves array filters');
  else fail('luxoft.fetch() lost array filters');
  if (calls.every((call) => call.opts?.redirect === 'error')) pass('luxoft.fetch() refuses redirects');
  else fail('luxoft.fetch() must refuse redirects');

  let probeCalls = 0;
  await luxoft.fetch({ careers_url: 'https://career.luxoft.com/jobs?perPage=1' }, {
    maxPages: 1,
    fetchText: async () => { probeCalls++; return item({ title: 'Probe', url: '/jobs/probe' }); },
  });
  if (probeCalls === 1) pass('luxoft.fetch() honors health-probe page limits');
  else fail(`probe made ${probeCalls} requests`);
} catch (error) {
  fail(`luxoft provider tests crashed: ${error.message}`);
}
