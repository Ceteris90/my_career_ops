/**
 * portal-length-warning.test.mjs — warn-only length check for the CV headline
 * and the output PDF filename (#5629). Fixtures are synthetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const { warnLongPortalFields, normalizeTextForATS } = await import(
  pathToFileURL(join(ROOT, 'generate-pdf.mjs')).href
);

const page = (inner, attrs = 'class="header-title"') => `<html><body><div ${attrs}>${inner}</div></body></html>`;

// Run the check with console.warn captured; returns { result, printed }.
function check(html, out = '/tmp/cv.pdf') {
  const original = console.warn;
  const printed = [];
  console.warn = (m) => { printed.push(String(m)); };
  try {
    return { result: warnLongPortalFields(html, out), printed };
  } finally {
    console.warn = original;
  }
}

test('a headline of exactly 64 characters does not warn', () => {
  const { result, printed } = check(page('a'.repeat(64)));
  assert.deepEqual(result, []);
  assert.deepEqual(printed, []);
});

test('a headline over 64 characters warns, naming its length', () => {
  const { result, printed } = check(page('b'.repeat(65)));
  assert.equal(result.length, 1);
  assert.match(result[0], /headline is 65 characters/);
  assert.equal(printed.length, 1);
});

test('an output filename over 64 characters warns', () => {
  const { result } = check(page('Short Title'), `/tmp/${'c'.repeat(70)}.pdf`);
  assert.equal(result.length, 1);
  assert.match(result[0], /filename is 74 characters/);
});

test('a missing headline does not warn', () => {
  assert.deepEqual(check('<html><body><p>none</p></body></html>').result, []);
});

test('class need not be the first attribute', () => {
  const { result } = check(page('d'.repeat(65), 'id="headline" class="x header-title"'));
  assert.equal(result.length, 1);
});

test('sub-header-title is not the headline', () => {
  const html = `<div class="sub-header-title">${'e'.repeat(90)}</div>${page('Short')}`;
  assert.deepEqual(check(html).result, []);
  assert.deepEqual(check(`<div class="sub-header-title">${'e'.repeat(90)}</div>`).result, []);
});

test('entities are decoded before counting code points', () => {
  assert.deepEqual(check(page('&#x1F600;'.repeat(8))).result, []);
  assert.deepEqual(check(page('&amp;'.repeat(64))).result, []);
  assert.equal(check(page('&#128512;'.repeat(65))).result.length, 1);
});

test('nested tags inside the headline are not counted', () => {
  assert.deepEqual(check(page(`<span>${'f'.repeat(64)}</span>`)).result, []);
});

test('the length is measured after ATS normalization', () => {
  const html = page(`${'g'.repeat(62)}…`);
  assert.deepEqual(check(html).result, [], 'unnormalized: 63 characters');
  const normalized = normalizeTextForATS(html).html;
  const { result } = check(normalized);
  assert.equal(result.length, 1, 'normalized: the ellipsis prints as three dots');
  assert.match(result[0], /65 characters/);
});

test('the check never throws', () => {
  assert.doesNotThrow(() => check('', ''));
  assert.doesNotThrow(() => check(page('x'), undefined));
});
