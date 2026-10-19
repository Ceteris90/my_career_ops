import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTheProtocolResponse, resolveSearches } from '../scan-theprotocol.mjs';

test('normalizes The Protocol offers and strips listing tracking', () => {
  const parsed = normalizeTheProtocolResponse({
    page: { number: 1, count: 2 },
    offers: [{
      title: 'Senior React Native Developer',
      offerUrlName: 'senior-react-native,oferta,abc-123',
      employer: 'Acme',
      workplace: [{ location: 'Warszawa' }],
      workModes: ['zdalna'],
      publicationDateUtc: '2026-09-01T10:00:00Z',
    }],
  });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pages, 2);
  assert.deepEqual(parsed.jobs[0], {
    title: 'Senior React Native Developer',
    url: 'https://theprotocol.it/szczegoly/praca/senior-react-native,oferta,abc-123',
    company: 'Acme',
    location: 'Warszawa, zdalna',
    source: 'theprotocol-browser',
    postedAt: Date.parse('2026-09-01T10:00:00Z'),
  });
});

test('drops malformed offers', () => {
  const parsed = normalizeTheProtocolResponse({ page: {}, offers: [
    { title: '', offerUrlName: 'x' },
    { title: 'Bad slug', offerUrlName: '../../evil' },
  ] });
  assert.equal(parsed.jobs.length, 0);
});

test('resolves only enabled configured searches', () => {
  assert.deepEqual(resolveSearches({ theprotocol_searches: [
    { name: 'A', url: 'https://theprotocol.it/filtry/a' },
    { name: 'B', url: 'https://theprotocol.it/filtry/b', enabled: false },
    { name: 'No URL' },
  ] }).map((entry) => entry.name), ['A']);
});

test('main scan wires the browser companion without contaminating JSON stdout', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../scan.mjs', import.meta.url), 'utf8');
  assert.match(source, /scan-theprotocol\.mjs/);
  assert.match(source, /browserSourceReceipt/);
  assert.match(source, /source\.script/);
  assert.match(source, /'--json'/);
  assert.match(source, /if \(dryRun\) childArgs\.push\('--dry-run'\)/);
});
