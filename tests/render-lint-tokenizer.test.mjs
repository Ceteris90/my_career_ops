// tests/render-lint-tokenizer.test.mjs — the HTML tag tokenizer behind renderLint
// (scanHtml / tagAttributes in cv-templates.mjs) against Chromium's own parse.
//
// tests/fixtures/render-lint-tags.json holds, for each tag, what Chromium's parser
// produced with JavaScript off (template.innerHTML): the element name, its attributes in
// order with decoded values, and whether the marker element after the tag was reached.
// `generated` is the first 240 tags of generateTags(240, 7) from
// tests/render-lint-tag-grammar.mjs, which mixes quotes in unquoted values and names, `=`
// and `<` in names, missing values, `>` inside quotes, NBSP and the other whitespace,
// character references, duplicate attributes, unterminated quotes and `/` everywhere.
// `explicit` is hand-picked, led by the case that mis-tokenised before: a quote opens a
// value only right after `=`, so `alt=Jane's` is one unquoted value.
// The test needs no browser. To re-record the fixture, run the grammar through Chromium
// the way the header of this comment describes and compare scanHtml against it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanHtml, tagAttributes } from '../cv-templates.mjs';
import { generateTags } from './render-lint-tag-grammar.mjs';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'render-lint-tags.json'), 'utf8'));

function parsed(html) {
  const { tags } = scanHtml(html);
  const isMarker = (t) => t.name === 'i' && tagAttributes(t.raw).find(([k]) => k === 'id')?.[1] === 'z';
  const first = tags[0] && !isMarker(tags[0]) ? tags[0] : null;
  return {
    name: first ? first.name : null,
    attrs: first ? tagAttributes(first.raw) : [],
    ended: tags.some(isMarker),
  };
}

test('the grammar still produces the recorded inputs for its seed', () => {
  assert.deepEqual(generateTags(fixture.count, fixture.seed), fixture.generated.map((g) => g.html));
});

test('scanHtml reads each generated tag the way Chromium does', () => {
  const wrong = [];
  for (const { html, name, attrs, ended } of fixture.generated) {
    const got = parsed(html);
    if (got.name !== name || got.ended !== ended || JSON.stringify(got.attrs) !== JSON.stringify(attrs)) {
      wrong.push({ html, expected: { name, attrs, ended }, got });
    }
  }
  assert.deepEqual(wrong.slice(0, 3), []);
  assert.equal(wrong.length, 0);
});

for (const { note, html, name, attrs, ended } of fixture.explicit) {
  test(`scanHtml reads: ${note}`, () => {
    const got = parsed(html);
    assert.equal(got.name, name);
    assert.deepEqual(got.attrs, attrs);
    assert.equal(got.ended, ended);
  });
}

test('a start tag the input ends inside is dropped, as the parser drops it', () => {
  assert.deepEqual(scanHtml('<img src="https://example.com/a.png"').tags, []);
  assert.deepEqual(scanHtml('<img src=https://example.com/a.png').tags, []);
  assert.deepEqual(scanHtml('<p>x</p><img alt="a').tags.map((t) => t.name), ['p']);
});

test('tokenizing is linear: long runs of quotes, equals signs and attributes finish at once', () => {
  const started = Date.now();
  for (const html of [
    `<x ${'a="b" '.repeat(100000)}>`,
    `<x ${'="'.repeat(100000)}`,
    `<x a=${"'".repeat(200000)}>`,
    `<x ${'a'.repeat(300000)}=b>`,
    '<x a="b"'.repeat(50000),
    `<x ${'/'.repeat(300000)}>`,
    `${'<x a=\''.repeat(20000)}`,
  ]) scanHtml(html);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});
