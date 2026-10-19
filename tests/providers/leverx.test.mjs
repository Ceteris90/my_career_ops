import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — leverx');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/leverx.mjs')).href);
  const leverx = module.default;
  const { parseLeverxHtml } = module;

  if (leverx.id === 'leverx') pass('leverx.id is "leverx"');
  else fail(`leverx.id is ${JSON.stringify(leverx.id)}`);

  const payload = (objects) => `<script>const blogpost = ${JSON.stringify({ total: objects.length, objects })};</script>`;
  const rows = [
    {
      name: 'Senior React & Native Developer',
      absoluteUrl: 'https://career.leverx.com/vacancies/react-native-developer',
      tagNames: ['location_Poland', 'location_Worldwide', 'work_Remote', 'seniority_Middle-Senior'],
      postBody: '<p>Build mobile products.</p>',
      publishDate: 1788773396000,
    },
    { name: 'Wrong seniority', absoluteUrl: 'https://career.leverx.com/vacancies/junior', tagNames: ['location_Poland', 'work_Remote', 'seniority_Junior'] },
    { name: 'Bad host', absoluteUrl: 'https://evil.test/vacancies/bad', tagNames: ['location_Poland', 'work_Remote', 'seniority_Middle-Senior'] },
  ];
  const parsed = parseLeverxHtml(payload(rows), {
    name: 'LeverX',
    careers_url: 'https://career.leverx.com/vacancies?tag=location_worldwide&tag=location_poland&tag=seniority_middle-senior&tag=work_remote',
  });
  if (parsed.length === 1) pass('parseLeverxHtml applies grouped tags and drops off-host links');
  else fail(`parseLeverxHtml returned ${parsed.length} jobs`);
  if (parsed[0]?.title === 'Senior React & Native Developer') pass('parseLeverxHtml extracts the vacancy name');
  else fail(`title = ${JSON.stringify(parsed[0]?.title)}`);
  if (parsed[0]?.url === 'https://career.leverx.com/vacancies/react-native-developer') pass('parseLeverxHtml keeps the official vacancy URL');
  else fail(`url = ${JSON.stringify(parsed[0]?.url)}`);
  if (parsed[0]?.location.includes('poland') && parsed[0]?.location.includes('remote')) pass('parseLeverxHtml extracts location and work tags');
  else fail(`location = ${JSON.stringify(parsed[0]?.location)}`);
  if (parsed[0]?.description === 'Build mobile products.') pass('parseLeverxHtml extracts the list payload description');
  else fail(`description = ${JSON.stringify(parsed[0]?.description)}`);
  if (parsed[0]?.postedAt === 1788773396000) pass('parseLeverxHtml extracts publishDate');
  else fail(`postedAt = ${JSON.stringify(parsed[0]?.postedAt)}`);
  if (parseLeverxHtml('').length === 0) pass('parseLeverxHtml returns [] for empty HTML');
  else fail('parseLeverxHtml should return [] for empty HTML');

  if (leverx.detect({ careers_url: 'https://career.leverx.com/vacancies?tag=work_remote' })) pass('leverx.detect() matches the filtered vacancies URL');
  else fail('leverx.detect() should match LeverX vacancies');
  const invalid = [
    { careers_url: 'http://career.leverx.com/vacancies' },
    { careers_url: 'https://career.leverx.com.evil.test/vacancies' },
    { careers_url: 'https://career.leverx.com/blog' },
    { careers_url: 42 },
    {},
  ];
  if (invalid.every((entry) => leverx.detect(entry) === null)) pass('leverx.detect() rejects invalid and spoofed URLs');
  else fail('leverx.detect() accepted an invalid URL');

  let calledUrl = null, calledOpts = null;
  const jobs = await leverx.fetch({
    name: 'LeverX',
    careers_url: 'https://career.leverx.com/vacancies?tag=work_remote&tag=location_poland',
  }, {
    fetchText: async (url, opts) => {
      calledUrl = url;
      calledOpts = opts;
      return payload([{ name: 'Mobile Engineer', absoluteUrl: 'https://career.leverx.com/vacancies/mobile-engineer', tagNames: ['location_Poland', 'work_Remote'] }]);
    },
  });
  if (calledUrl?.includes('tag=work_remote') && calledUrl?.includes('tag=location_poland')) pass('leverx.fetch() preserves URL filters');
  else fail(`called URL = ${JSON.stringify(calledUrl)}`);
  if (calledOpts?.redirect === 'error') pass('leverx.fetch() refuses redirects');
  else fail(`fetch opts = ${JSON.stringify(calledOpts)}`);
  if (jobs.length === 1 && jobs[0].title === 'Mobile Engineer') pass('leverx.fetch() parses the SSR response');
  else fail(`fetched jobs = ${JSON.stringify(jobs)}`);

  let requested = false;
  try {
    await leverx.fetch({ careers_url: 'https://evil.test/vacancies' }, { fetchText: async () => { requested = true; return ''; } });
  } catch {}
  if (!requested) pass('leverx.fetch() validates the host before requesting');
  else fail('leverx.fetch() requested an untrusted host');
} catch (error) {
  fail(`leverx provider tests crashed: ${error.message}`);
}
