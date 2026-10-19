import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — griddynamics');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/griddynamics.mjs')).href);
  const provider = module.default;
  const { parseGridDynamicsHtml } = module;
  if (provider.id === 'griddynamics') pass('griddynamics.id is "griddynamics"');
  else fail(`id = ${JSON.stringify(provider.id)}`);

  const rows = [
    { id: 1, title: 'React Native Developer', category: 'Mobile', relatedLocations: ['Krakow, Poland'], countryLocations: [{ city: 'Krakow', country: 'Poland' }] },
    { id: 2, title: 'Backend Developer', category: 'Custom Development', relatedLocations: ['Warsaw, Poland'], countryLocations: [{ city: 'Warsaw', country: 'Poland' }] },
    { id: 3, title: 'Data Engineer', category: 'Data Engineering', relatedLocations: ['Krakow, Poland'], countryLocations: [{ city: 'Krakow', country: 'Poland' }] },
    { id: 4, title: 'Remote Mobile Engineer', category: 'Mobile', relatedLocations: ['US Remote, US'], countryLocations: [{ city: 'US Remote', country: 'US' }] },
  ];
  const escaped = JSON.stringify(rows).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<div id="careers-vacancies-data" data-vacancies="${escaped}"></div>`;
  const jobs = parseGridDynamicsHtml(html, {
    name: 'Grid Dynamics',
    careers_url: 'https://www.griddynamics.com/careers/discover-openings?city=Krakow%2C+Poland&category=delivery_and_engineering',
    grid_dynamics: { categories: ['Custom Development', 'Mobile'], include_remote: true },
  });
  if (jobs.length === 2 && jobs.some((job) => job.title === 'React Native Developer') && jobs.some((job) => job.title === 'Remote Mobile Engineer')) pass('parser combines exact cities with explicit remote vacancies');
  else fail(`jobs = ${JSON.stringify(jobs)}`);
  if (jobs[0]?.url === 'https://www.griddynamics.com/careers/vacancy/1') pass('parser builds the canonical vacancy URL');
  else fail(`url = ${JSON.stringify(jobs[0]?.url)}`);
  if (jobs[0]?.location === 'Krakow, Poland') pass('parser keeps display locations');
  else fail(`location = ${JSON.stringify(jobs[0]?.location)}`);
  if (parseGridDynamicsHtml('').length === 0) pass('parser returns [] for empty HTML');
  else fail('empty HTML should return []');

  if (provider.detect({ careers_url: 'https://www.griddynamics.com/careers/discover-openings?city=Krakow' })) pass('detect matches the official openings page');
  else fail('detect should match Grid Dynamics');
  const invalid = [{ careers_url: 'http://www.griddynamics.com/careers/discover-openings' }, { careers_url: 'https://www.griddynamics.com.evil.test/careers/discover-openings' }, { careers_url: 'https://www.griddynamics.com/careers' }, {}];
  if (invalid.every((entry) => provider.detect(entry) === null)) pass('detect rejects invalid URLs');
  else fail('detect accepted an invalid URL');

  let calledUrl = null, calledOpts = null;
  const fetched = await provider.fetch({ careers_url: 'https://www.griddynamics.com/careers/discover-openings?city=Krakow%2C+Poland' }, {
    fetchText: async (url, opts) => { calledUrl = url; calledOpts = opts; return html; },
  });
  if (calledUrl?.includes('city=Krakow%2C+Poland')) pass('fetch preserves frontend query filters');
  else fail(`called URL = ${JSON.stringify(calledUrl)}`);
  if (calledOpts?.redirect === 'error') pass('fetch refuses redirects');
  else fail('fetch must refuse redirects');
  if (fetched.length === 2) pass('fetch parses all city-matching embedded rows when no category override is set');
  else fail(`fetch returned ${fetched.length}`);
} catch (error) {
  fail(`griddynamics provider tests crashed: ${error.message}`);
}
