import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFractalCard, resolveSearches } from '../scan-fractal.mjs';

test('normalizes a FRACTAL card into a scanner Job', () => {
  const job = normalizeFractalCard({
    href: 'https://career.fractal.partners/ua/vacancy/6a2312/',
    titleText: '🔥\n                    Senior Full-Stack Developer\n                ',
    filters: ['Development', 'Ukrainian'],
    locations: ['Remote Ukraine'],
  });
  assert.deepEqual(job, {
    title: 'Senior Full-Stack Developer',
    url: 'https://career.fractal.partners/ua/vacancy/6a2312/',
    company: 'FRACTAL',
    location: 'Remote Ukraine',
    source: 'fractal-browser',
  });
});

test('drops the 🔥 marker from the title', () => {
  const job = normalizeFractalCard({
    href: 'https://career.fractal.partners/ua/vacancy/55111a/',
    titleText: '🔥 Middle System Administrator',
    filters: ['Development', 'Ukrainian'],
    locations: ['Odesa (Ukraine)'],
  });
  assert.equal(job.title, 'Middle System Administrator');
});

test('joins multiple location blocks into one string', () => {
  const job = normalizeFractalCard({
    href: 'https://career.fractal.partners/ua/vacancy/abc123/',
    titleText: 'Middle Android Developer',
    filters: ['Development', 'Ukrainian'],
    locations: ['Remote Ukraine', 'Hybrid'],
  });
  assert.equal(job.location, 'Remote Ukraine, Hybrid');
});

test('drops malformed or title-less cards', () => {
  assert.equal(normalizeFractalCard({ href: 'https://career.fractal.partners/ua/vacancy/6a2312/', titleText: '', filters: [], locations: [] }), null);
  assert.equal(normalizeFractalCard({ href: 'https://career.fractal.partners/ua/vacancy/', titleText: 'Title', filters: [], locations: [] }), null);
  assert.equal(normalizeFractalCard(null), null);
});

test('resolves enabled configured searches, falling back to the default', () => {
  assert.deepEqual(resolveSearches({ fractal_searches: [
    { name: 'A', url: 'https://career.fractal.partners/ua/vacancy/?directions=development' },
    { name: 'B', url: 'https://career.fractal.partners/ua/vacancy/?directions=design', enabled: false },
    { name: 'No URL' },
  ] }).map((entry) => entry.name), ['A']);
  const fallback = resolveSearches({});
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].url, /levels=middle,senior,middle-plus/);
});

test('main scan wires the browser companion without contaminating JSON stdout', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../scan.mjs', import.meta.url), 'utf8');
  assert.match(source, /scan-fractal\.mjs/);
  assert.match(source, /fractal_searches/);
});