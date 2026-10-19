import test from 'node:test';
import assert from 'node:assert';
import { extractVacancyCards } from '../scan-zone3000.mjs';

// Build a minimal fake `document` for extractVacancyCards. The scanner runs the
// extractor via page.evaluate against the real DOM; here we stub just the pieces
// it touches: querySelectorAll('a[href^="/vacancies/"]') and per-anchor
// querySelector('div.vacancy__container') + createTreeWalker over text nodes.
function textNode(text) {
  return {
    textContent: text,
    nodeType: 3,
  };
}

function card({ slug, texts }) {
  const children = texts.map(textNode);
  const container = {
    ownerDocument: {
      createTreeWalker() {
        let i = 0;
        return { nextNode: () => children[i++] ?? null };
      },
    },
  };
  return {
    getAttribute: () => `/vacancies/${slug}`,
    querySelector: (sel) => (sel === 'div.vacancy__container' ? container : null),
  };
}

function fakeDocument(cards) {
  return {
    querySelectorAll: () => cards,
  };
}

// Real observed shape: each card's text nodes are ordered [title, location,
// optionalTagOrPartner] (e.g. "Customer Support Specialist", "Remote", "ZONE3000"
// or ".Node.js"). Slug like "SD77".
test('ZONE3000 vacancy card extraction', async (t) => {
  await t.test('extracts title, url and location from cards', () => {
    const doc = fakeDocument([
      card({ slug: 'SD77', texts: ['Middle .NET Developer in Pre-Production Team (#1243)', 'Remote', '.NET'] }),
      card({ slug: 'CS2', texts: ['Customer Support Specialist', 'Remote', 'ZONE3000'] }),
    ]);
    const jobs = extractVacancyCards(doc);
    assert.strictEqual(jobs.length, 2);
    assert.strictEqual(jobs[0].title, 'Middle .NET Developer in Pre-Production Team (#1243)');
    assert.strictEqual(jobs[0].url, 'https://zone3000.net/vacancies/SD77');
    assert.strictEqual(jobs[0].location, 'Remote');
    assert.strictEqual(jobs[1].title, 'Customer Support Specialist');
  });

  await t.test('ignores anchors without a vacancy__container', () => {
    const doc = {
      querySelectorAll: () => [
        card({ slug: 'SD77', texts: ['Real (#1)', 'Remote'] }),
        { getAttribute: () => '/vacancies/XXX', querySelector: () => null },
      ],
    };
    const jobs = extractVacancyCards(doc);
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].url, 'https://zone3000.net/vacancies/SD77');
  });

  await t.test('drops cards with no title text', () => {
    const doc = fakeDocument([
      card({ slug: 'SD77', texts: [] }),
      card({ slug: 'SD78', texts: ['Has title (#2)', 'Remote'] }),
    ]);
    const jobs = extractVacancyCards(doc);
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].title, 'Has title (#2)');
  });

  await t.test('dedupes the same slug appearing twice', () => {
    const doc = fakeDocument([
      card({ slug: 'SD77', texts: ['Dupe (#3)', 'Remote'] }),
      card({ slug: 'SD77', texts: ['Dupe (#3)', 'Remote'] }),
    ]);
    const jobs = extractVacancyCards(doc);
    assert.strictEqual(jobs.length, 1);
  });

  await t.test('handles a card with no location text', () => {
    const doc = fakeDocument([card({ slug: 'INF59', texts: ['On-site (#4)'] })]);
    const jobs = extractVacancyCards(doc);
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].location, '');
  });
});