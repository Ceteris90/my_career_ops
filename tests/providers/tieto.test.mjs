import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — tieto');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/tieto.mjs')).href);
  const tieto = module.default;
  const { parseTietoHtml } = module;
  if (tieto.id === 'tieto') pass('tieto.id is "tieto"');
  else fail(`tieto.id is ${JSON.stringify(tieto.id)}`);

  const tile = (id, title, href, loc) =>
    `<div class="attrax-vacancy-tile  sector-tieto-tech-consulting  attrax-vacancy-tile--software-engineer" data-jobid="${id}">` +
    `<a aria-level="3" class="attrax-vacancy-tile__title attrax-vacancy-tile__item attrax-button" href="${href}" role="heading">${title}</a>` +
    `<div class="attrax-vacancy-tile__location-freetext attrax-vacancy-tile__item">` +
    `<p class="attrax-vacancy-tile__item-label">Location</p>` +
    `<p class="attrax-vacancy-tile__item-value">${loc}</p>` +
    `</div></div>`;

  const parsed = parseTietoHtml(
    tile('2857', 'Python &amp; React Developer', '/job/python-react-jid-2857', 'Wroc&#x142;aw, Poland') +
    tile('2857', 'Python &amp; React Developer', '/job/python-react-jid-2857', 'Wroc&#x142;aw, Poland') +
    tile('2856', 'Other', 'https://evil.test/job/other-jid-2856', 'Kyiv, Ukraine'),
    { name: 'Tieto' },
  );
  if (parsed.length === 1 && parsed[0].title === 'Python & React Developer') pass('parseTietoHtml decodes entities and deduplicates repeated tiles');
  else fail(`parsed = ${JSON.stringify(parsed)}`);
  if (parsed[0]?.location === 'Wrocław, Poland') pass('parseTietoHtml decodes location entities');
  else fail(`location = ${JSON.stringify(parsed[0]?.location)}`);
  if (parsed[0]?.url === 'https://careers.tieto.com/job/python-react-jid-2857') pass('parseTietoHtml resolves official URLs');
  else fail(`url = ${JSON.stringify(parsed[0]?.url)}`);
  if (parseTietoHtml('').length === 0) pass('parseTietoHtml returns [] for empty HTML');
  else fail('parseTietoHtml should return [] for empty HTML');

  if (tieto.detect({ careers_url: 'https://careers.tieto.com/jobs?options=193%2C403%2C414%2C413&page=1' })) pass('tieto.detect() matches filtered job URLs');
  else fail('tieto.detect() should match Tieto jobs');
  const invalid = [{ careers_url: 'http://careers.tieto.com/jobs' }, { careers_url: 'https://careers.tieto.com.evil.test/jobs' }, { careers_url: 'https://careers.tieto.com/about' }, {}];
  if (invalid.every((entry) => tieto.detect(entry) === null)) pass('tieto.detect() rejects invalid URLs');
  else fail('tieto.detect() accepted an invalid URL');

  const calls = [];
  const page1 = Array.from({ length: 10 }, (_, i) => tile(String(i + 1), `Job ${i + 1}`, `/job/job-${i + 1}-jid-${i + 1}`, 'Kyiv, Ukraine')).join('');
  const result = await tieto.fetch({ name: 'Tieto', careers_url: 'https://careers.tieto.com/jobs?options=193%2C403%2C414%2C413' }, {
    sleep: async () => {},
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      const page = Number(new URL(url).searchParams.get('page')) || 1;
      return page === 1
        ? page1
        : tile('11', 'Eleven', '/job/eleven-jid-11', 'Lviv, Ukraine');
    },
  });
  if (result.length === 11 && calls.length === 2) pass('tieto.fetch() paginates until a short page');
  else fail(`tieto.fetch() returned ${result.length} across ${calls.length} calls`);
  if (calls.every((call) => new URL(call.url).searchParams.get('options') === '193,403,414,413')) pass('tieto.fetch() preserves the options filter');
  else fail('tieto.fetch() lost the options filter');
  if (calls.every((call) => call.opts?.redirect === 'error')) pass('tieto.fetch() refuses redirects');
  else fail('tieto.fetch() must refuse redirects');

  let probeCalls = 0;
  await tieto.fetch({ careers_url: 'https://careers.tieto.com/jobs?options=193%2C403%2C414%2C413' }, {
    maxPages: 1,
    fetchText: async () => { probeCalls++; return tile('1', 'Probe', '/job/probe-jid-1', 'Kyiv, Ukraine'); },
  });
  if (probeCalls === 1) pass('tieto.fetch() honors health-probe page limits');
  else fail(`probe made ${probeCalls} requests`);
} catch (error) {
  fail(`tieto provider tests crashed: ${error.message}`);
}