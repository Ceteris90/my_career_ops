// tests/browser-extract-unavailable.test.mjs — telling a taken-down posting from
// a page that simply did not render. Both yield an empty cleaned `text`; only the
// first is terminal. Pure logic: no browser is launched.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nbrowser-extract.mjs (unavailable posting vs unrendered page)');

try {
  const { isExplicitlyUnavailablePage, jdFailure, normalizeJd } = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);

  if (isExplicitlyUnavailablePage('Sorry. This job is no longer available.')
    && isExplicitlyUnavailablePage('The page you are looking for doesn\'t exist')
    && !isExplicitlyUnavailablePage('Senior Data Scientist — apply by Friday')
    && !isExplicitlyUnavailablePage(undefined)) {
    pass('isExplicitlyUnavailablePage matches takedown copy and ignores ordinary text');
  } else {
    fail('isExplicitlyUnavailablePage gave a wrong answer');
  }

  const longJd = 'Responsibilities include analysing product data. '.repeat(10);
  // A banner stripped out of the cleaned text but present in the raw body.
  const goneInHeader = jdFailure({ url: 'https://x.example/j/1', text: '', bodyText: 'Acme Careers\nThis job is no longer available.' }, 12000);
  if (goneInHeader?.code === 'unavailable') pass('an empty text whose raw body says "no longer available" is unavailable, not empty_text');
  else fail(`expected unavailable, got ${JSON.stringify(goneInHeader)}`);

  const unrendered = jdFailure({ url: 'https://x.example/j/2', text: '', bodyText: 'Loading…' }, 12000);
  if (unrendered?.code === 'empty_text' && unrendered.body_text === 'Loading…') pass('an empty text with no takedown copy stays empty_text and exposes the raw body');
  else fail(`expected empty_text with body_text, got ${JSON.stringify(unrendered)}`);

  const quoting = jdFailure({ url: 'https://x.example/j/3', text: `${longJd} We are no longer accepting applications from agencies.`, bodyText: '' }, 12000);
  if (quoting === null) pass('a full-length JD that quotes takedown wording is not reclassified');
  else fail(`a real JD was rejected: ${JSON.stringify(quoting)}`);

  const raw = normalizeJd({ title: 'T', text: longJd, bodyText: 'x'.repeat(5000) }, 'https://x.example/j/4');
  if (raw.bodyText.length <= 4001) pass('normalizeJd carries a capped bodyText for the liveness check');
  else fail(`bodyText not capped: ${raw.bodyText.length}`);
} catch (e) {
  fail(`browser-extract unavailable test crashed: ${e.message}`);
}
