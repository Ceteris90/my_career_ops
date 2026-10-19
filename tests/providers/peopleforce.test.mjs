// tests/providers/peopleforce.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — peopleforce');

try {
  const module = await import(pathToFileURL(join(ROOT, 'providers/peopleforce.mjs')).href);
  const peopleforce = module.default;
  const { parsePeopleForceResponse } = module;

  if (peopleforce.id === 'peopleforce') pass('peopleforce.id is "peopleforce"');
  else fail(`peopleforce.id is ${JSON.stringify(peopleforce.id)}`);

  // detect: <tenant>.peopleforce.io → /careers/v.json
  const hit = peopleforce.detect({ name: 'Acme', careers_url: 'https://acme.peopleforce.io/careers' });
  if (hit && hit.url === 'https://acme.peopleforce.io/careers/v.json') {
    pass('peopleforce.detect() resolves <tenant>.peopleforce.io → /careers/v.json');
  } else {
    fail(`peopleforce.detect() returned ${JSON.stringify(hit)}`);
  }

  // detect: preserves recognised filter params from careers_url (department scoping)
  const filtered = peopleforce.detect({ name: 'Acme', careers_url: 'https://acme.peopleforce.io/careers?department_id=113633' });
  if (filtered && filtered.url === 'https://acme.peopleforce.io/careers/v.json?department_id=113633') {
    pass('peopleforce.detect() carries department_id filter through to the API');
  } else {
    fail(`peopleforce.detect() filter case returned ${JSON.stringify(filtered)}`);
  }

  // detect: drops non-filter params (tracking params must not leak through)
  const tracked = peopleforce.detect({ name: 'Acme', careers_url: 'https://acme.peopleforce.io/careers?source=dou&location_id=76731' });
  if (tracked && tracked.url === 'https://acme.peopleforce.io/careers/v.json?location_id=76731') {
    pass('peopleforce.detect() keeps only recognised filter params (drops source=)');
  } else {
    fail(`peopleforce.detect() tracking case returned ${JSON.stringify(tracked)}`);
  }

  // detect: honours explicit api: URL
  const apiHit = peopleforce.detect({ name: 'Acme', api: 'https://acme.peopleforce.io' });
  if (apiHit && apiHit.url === 'https://acme.peopleforce.io/careers/v.json') pass('peopleforce.detect() honours explicit api: URL');
  else fail(`peopleforce.detect() api: returned ${JSON.stringify(apiHit)}`);

  // detect: null for non-peopleforce URLs (and path-spoofed ones)
  if (peopleforce.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('peopleforce.detect() returns null for non-peopleforce URLs');
  } else {
    fail('peopleforce.detect() should return null for non-peopleforce URLs');
  }
  if (peopleforce.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.peopleforce.io/foo' }) === null) {
    pass('peopleforce.detect() rejects path-spoofed URLs');
  } else {
    fail('peopleforce.detect() must reject path-spoofed URLs');
  }

  // detect: null for non-string careers_url
  if (peopleforce.detect({ name: 'X', careers_url: null }) === null && peopleforce.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('peopleforce.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('peopleforce.detect() should treat non-string careers_url as missing');
  }

  // parsePeopleForceResponse — real PeopleForce v.json shape (bare array)
  const sample = [
    {
      id: 242118,
      title: 'Senior Java Backend Developer (Spring / Spring Boot)',
      department: { id: 113633, name: 'Research & Development' },
      division: { id: 49199, name: 'Europe' },
      work_type: { id: 29338, name: 'Full-time' },
      location: { id: 76731, name: 'Remote' },
      vacancy_url: 'https://acme.peopleforce.io/careers/v/242118-senior-java-backend-developer-spring-spring-boot?source=dou',
      apply_url: 'https://acme.peopleforce.io/careers/v/242118-senior-java-backend-developer-spring-spring-boot/a/new?source=dou',
      created_at: 1790791140000,
    },
    { id: 22, title: '', location: { name: 'Warsaw' }, vacancy_url: 'https://acme.peopleforce.io/careers/v/22', created_at: 1790791140000 }, // no title → dropped
    { id: 7, title: 'No URL Role', location: { name: 'Lviv' }, created_at: 1790791140000 }, // no vacancy_url → dropped
    { id: 9, title: 'Blank URL Role', location: { name: 'X' }, vacancy_url: '   ', created_at: 1790791140000 }, // blank vacancy_url → dropped
    { id: 12, title: 'Date-less Role', location: { name: 'Remote' }, vacancy_url: 'https://acme.peopleforce.io/careers/v/12' }, // no created_at → no postedAt
  ];
  const jobs = parsePeopleForceResponse(sample, 'Acme');
  if (jobs.length === 2) pass('parsePeopleForceResponse keeps rows with non-empty title + url, drops the rest');
  else fail(`parsePeopleForceResponse returned ${jobs.length} jobs (expected 2)`);

  if (!jobs.some(j => j.title === 'No URL Role')) pass('parsePeopleForceResponse drops rows with no vacancy_url');
  else fail('parsePeopleForceResponse should drop rows with no vacancy_url');

  if (jobs[0]?.url === 'https://acme.peopleforce.io/careers/v/242118-senior-java-backend-developer-spring-spring-boot' && jobs[0]?.company === 'Acme') {
    pass('parsePeopleForceResponse strips the ?source= tracking param and sets company');
  } else {
    fail(`parsePeopleForceResponse url was ${jobs[0]?.url}`);
  }

  if (jobs[0]?.postedAt === 1790791140000) pass('parsePeopleForceResponse sets postedAt from created_at (epoch ms)');
  else fail(`parsePeopleForceResponse postedAt was ${jobs[0]?.postedAt}`);

  if (jobs[0]?.location === 'Remote') pass('parsePeopleForceResponse reads location from location.name');
  else fail(`parsePeopleForceResponse location was ${JSON.stringify(jobs[0]?.location)}`);

  const dated = jobs.find(j => j.title === 'Date-less Role');
  if (dated && !('postedAt' in dated)) pass('parsePeopleForceResponse omits postedAt when created_at is absent');
  else fail(`parsePeopleForceResponse should omit postedAt when created_at is absent (got ${JSON.stringify(dated)})`);

  // empty / malformed payloads → []
  if (parsePeopleForceResponse([], 'X').length === 0) pass('parsePeopleForceResponse [] → []');
  else fail('parsePeopleForceResponse should return [] for []');
  if (parsePeopleForceResponse({}, 'X').length === 0) pass('parsePeopleForceResponse {} → [] (array guard)');
  else fail('parsePeopleForceResponse should return [] for {}');

  // fetch() — via mock ctx, asserts resolved URL + SSRF redirect pinning + parsing
  let fetchedUrl = '';
  let fetchedOpts;
  const mockCtx = {
    fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return sample; },
  };
  const fetched = await peopleforce.fetch({ name: 'Acme', careers_url: 'https://acme.peopleforce.io/careers?department_id=113633' }, mockCtx);
  if (fetchedUrl === 'https://acme.peopleforce.io/careers/v.json?department_id=113633' && fetchedOpts?.redirect === 'error' && fetched.length === 2) {
    pass('peopleforce.fetch() calls /careers/v.json with redirect:error, keeps the filter, and returns parsed jobs');
  } else {
    fail(`peopleforce.fetch() url=${fetchedUrl} redirect=${JSON.stringify(fetchedOpts)} jobs=${fetched.length}`);
  }

  // SSRF guard — an untrusted host must never reach ctx.fetchJson at all.
  {
    let calls = 0;
    const untrustedCtx = { fetchJson: async () => { calls++; throw new Error('should never be called'); } };
    try {
      await peopleforce.fetch({ name: 'Evil', careers_url: 'https://evil.example/acme.peopleforce.io/foo' }, untrustedCtx);
      fail('peopleforce.fetch() should throw for an untrusted host');
    } catch {
      if (calls === 0) pass('peopleforce.fetch() rejects an untrusted host before any fetchJson call');
      else fail(`peopleforce.fetch() should not call fetchJson for an untrusted host (called ${calls} time(s))`);
    }
  }

  // fetch() — a non-array envelope (API shape change) throws a descriptive error, not []
  {
    const brokenCtx = { fetchJson: async () => ({ jobs: [] }) };
    try {
      await peopleforce.fetch({ name: 'Acme', careers_url: 'https://acme.peopleforce.io/careers' }, brokenCtx);
      fail('peopleforce.fetch() should throw for a non-array envelope');
    } catch (err) {
      if (String(err.message).includes('expected a JSON array')) pass('peopleforce.fetch() throws a descriptive error for a non-array envelope');
      else fail(`peopleforce.fetch() envelope error was: ${err.message}`);
    }
  }

} catch (e) {
  fail(`peopleforce provider tests crashed: ${e.message}`);
}