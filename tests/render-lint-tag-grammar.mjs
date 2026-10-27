// Random start tags for differential testing of the HTML tag tokenizer in cv-templates.mjs
// (scanHtml / tagAttributes) against Chromium's parser. Seeded, so the same seed always
// yields the same inputs. Each input is one tag followed by a marker element, `<i id="z">`,
// so a test can tell whether the tag ended where the parser says it did.
//
// The grammar mixes the shapes that break regex tokenizers: quotes inside unquoted values and
// attribute names, `=` and `<` in names and values, missing values, `>` inside quotes, NBSP and
// the other whitespace, character references with and without semicolons, duplicate attributes,
// unterminated quotes, and `/` in every position.
//
// Not generated: CR and CRLF as separators. Chromium swallows an LF that follows a single space
// and a CR(LF) inside a tag (`<a \r\n"\n-x>` becomes one attribute `"-x`), which the HTML
// Standard does not do, so it is not behaviour to copy. CR still appears inside values.
export const MARKER = '<i id="z"></i>';

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const NAMES = ['x', 'X', 'img', 'IMG', 'a', 'x-y', 'x ', 'x1'];
const SEPARATORS = [' ', ' ', ' ', '\t', '\n', '\f', ' ', '', '/', ' / ', '//'];
const NAME_CHARS = ['a', 'b', 'S', 'r', 'c', '=', '"', "'", '<', '/', '`', ' ', '-', '&', 'ON', '\u0000'];
const VALUE_PIECES = ['a', 'b', 'A1', ' ', '=', '"', "'", '<', '>', '/', '&amp;', '&#58;', '&colon;', '&sol;', '&Tab;', '&NewLine;', '&#0;', '&#x41', '&#65', '&amp', '&lt', '&gt;', '&quot;', '&apos;', '&#1;', '&nbsp;', ' ', '`', '\n', '\t', '--', '!', 'https://e.test/a.png', '\u0000', '&', '&;', '&#;', '&#x;', '&AMP', '&ampx', '&amp=', '&#128;', '&#x9F;', '&#X41;', '&#xD800;', '&#x110000;', '&Amp;', '&amp;amp;', '&ampamp;', '&colon', '&sol', '&#x0;', '&#10;', '&#13;', '\r\n', '\r'];

export function generateTags(count, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const attrName = () => {
    let s = '';
    for (let i = int(0, 4); i > 0; i--) s += pick(NAME_CHARS);
    return s || pick(['src', 'href', 'alt', 'on', 'SRC']);
  };
  const value = (quote) => {
    let s = '';
    for (let i = int(0, 5); i > 0; i--) {
      let p = pick(VALUE_PIECES);
      if (quote === '"' && p === '"' && r() < 0.8) p = 'a';
      if (quote === "'" && p === "'" && r() < 0.8) p = 'b';
      if (!quote && /[\s>]/.test(p) && r() < 0.7) p = 'c';
      s += p;
    }
    return s;
  };
  const out = [];
  const used = [];
  for (let k = 0; k < count; k++) {
    let tag = '<' + pick(NAMES);
    for (let i = int(0, 4); i > 0; i--) {
      tag += pick(SEPARATORS);
      const name = used.length && r() < 0.2 ? pick(used) : attrName();
      used.push(name);
      if (used.length > 6) used.shift();
      tag += name;
      const form = r();
      if (form < 0.25) continue;
      tag += pick(['=', '=', ' =', '= ', ' = ']);
      if (form < 0.45) tag += '"' + value('"') + (r() < 0.9 ? '"' : '');
      else if (form < 0.65) tag += "'" + value("'") + (r() < 0.9 ? "'" : '');
      else if (form < 0.9) tag += value('');
    }
    tag += pick(['>', '>', '>', '/>', ' />', '', ' ']);
    out.push(tag + MARKER);
  }
  return out;
}
