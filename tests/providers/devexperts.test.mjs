import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — devexperts');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/devexperts.mjs')).href);
  const provider = module.default;
  const { parseDevexpertsResponse } = module;
  if (provider.id === 'devexperts') pass('devexperts.id is "devexperts"');
  else fail(`id = ${JSON.stringify(provider.id)}`);

  const jobs = parseDevexpertsResponse([
    { id: 'abc-123', title: 'Middle/Senior Software Engineer (Frontend)', location: { country: 'Portugal', city: 'Porto' } },
    { id: '', title: 'Missing id' },
    { id: 'bad', title: '' },
  ], { name: 'Devexperts' });
  if (jobs.length === 1) pass('parser drops rows missing id or title');
  else fail(`parsed ${jobs.length} jobs`);
  if (jobs[0]?.url === 'https://careers.devexperts.com/position/abc-123/') pass('parser builds the canonical position URL');
  else fail(`url = ${JSON.stringify(jobs[0]?.url)}`);
  if (jobs[0]?.location === 'Portugal, Porto') pass('parser combines country and city');
  else fail(`location = ${JSON.stringify(jobs[0]?.location)}`);
  if (parseDevexpertsResponse([]).length === 0) pass('parser returns [] for an empty inventory');
  else fail('empty inventory should return []');

  if (provider.detect({ careers_url: 'https://careers.devexperts.com/vacancies/' }) && provider.detect({ api: 'https://api-careers.in.devexperts.com/v1/vacancies' })) pass('detect matches official careers and API URLs');
  else fail('detect should match Devexperts URLs');
  const invalid = [{ careers_url: 'http://careers.devexperts.com/vacancies/' }, { careers_url: 'https://careers.devexperts.com.evil.test/vacancies/' }, { careers_url: 'https://careers.devexperts.com/about/' }, {}];
  if (invalid.every((entry) => provider.detect(entry) === null)) pass('detect rejects invalid URLs');
  else fail('detect accepted an invalid URL');

  let calledUrl = null, calledOpts = null;
  const fetched = await provider.fetch({ name: 'Devexperts' }, { fetchJson: async (url, opts) => {
    calledUrl = url; calledOpts = opts;
    return [{ id: 'mock-id', title: 'Mock Role', location: { country: 'Global remote', city: '' } }];
  } });
  if (calledUrl === 'https://api-careers.in.devexperts.com/v1/vacancies') pass('fetch uses the public complete-inventory endpoint');
  else fail(`called URL = ${JSON.stringify(calledUrl)}`);
  if (calledOpts?.redirect === 'error') pass('fetch refuses redirects');
  else fail('fetch must refuse redirects');
  if (fetched.length === 1 && fetched[0].title === 'Mock Role') pass('fetch normalizes the API response');
  else fail(`fetched = ${JSON.stringify(fetched)}`);
} catch (error) {
  fail(`devexperts provider tests crashed: ${error.message}`);
}
