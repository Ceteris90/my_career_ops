// tests/privacy-filter.test.mjs — opt-in contact redaction (utils/privacy-filter.mjs)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pass, fail, ROOT } from './helpers.mjs';
import {
  PLACEHOLDERS, isRedactionEnabled, redactCandidatePII, restoreCandidatePII,
  redactIfEnabled, restoreIfEnabled, anonymizeContext,
} from '../utils/privacy-filter.mjs';

console.log('\nprivacy-filter.mjs unit tests');

function check(cond, okMsg, failMsg) {
  if (cond) pass(okMsg); else fail(failMsg || okMsg);
}

const PROFILE_ON = `
candidate:
  full_name: "Jane Doe"
  email: "jane.doe@example.org"
  phone: "+91 98765 43210"
  linkedin: "https://www.linkedin.com/in/janedoe"
  github: "github.com/janedoe"
privacy:
  redact_contact_info: true
`;
const PROFILE_OFF = PROFILE_ON.replace('true', 'false');
const PROFILE_UNSET = PROFILE_ON.replace(/privacy:[\s\S]*$/, '');

const CV = `# Jane Doe
Email: Jane.Doe@Example.org | Phone: 98765-43210 | Alt: +91 (98765) 43210
LinkedIn: linkedin.com/in/janedoe | GitHub: https://github.com/janedoe
Contact Jane Doe at jane.doe@example.org. Worked with Janet Doerr and JANE DOE.
`;

try {
  // ── Toggle: nothing runs unless the profile turns it on ──────────────────
  check(isRedactionEnabled(PROFILE_ON), 'enabled when privacy.redact_contact_info is true');
  check(!isRedactionEnabled(PROFILE_OFF), 'disabled when the flag is false');
  check(!isRedactionEnabled(PROFILE_UNSET), 'disabled when the privacy block is absent');
  check(!isRedactionEnabled(''), 'disabled for empty profile');
  check(!isRedactionEnabled('candidate: [unclosed'), 'disabled for malformed YAML');
  check(!isRedactionEnabled(PROFILE_ON.replace('true', '"true"')), 'string "true" does not enable it');

  check(redactIfEnabled(CV, PROFILE_OFF) === CV, 'redactIfEnabled is a no-op when off');
  check(redactIfEnabled(CV, PROFILE_UNSET) === CV, 'redactIfEnabled is a no-op when unset');
  const ctxOff = { cv: CV, profile: PROFILE_OFF, profileMode: 'Jane Doe' };
  const anonOff = anonymizeContext(ctxOff);
  check(anonOff.cv === CV && anonOff.profileMode === 'Jane Doe', 'anonymizeContext is a no-op when off');

  // ── Redaction ────────────────────────────────────────────────────────────
  const red = redactIfEnabled(CV, PROFILE_ON);
  check(!/jane\s+doe/i.test(red), 'name removed (any case)');
  check(!/jane\.doe@example\.org/i.test(red), 'email removed (any case)');
  check(!/98765/.test(red) && !/43210/.test(red), 'phone removed across formats, with or without country code');
  check(!/janedoe/i.test(red), 'LinkedIn and GitHub handles removed, URL prefix forms included');
  check(red.includes(PLACEHOLDERS.name) && red.includes(PLACEHOLDERS.email), 'placeholders inserted');
  check(red.includes('Janet Doerr'), 'a different person with a similar name is left alone');

  // ── Round trip: the tailored CV gets the real details back ───────────────
  const model = `<h1>${PLACEHOLDERS.name}</h1><p>${PLACEHOLDERS.email} | ${PLACEHOLDERS.phone} | ` +
    `https://www.${PLACEHOLDERS.linkedin} | ${PLACEHOLDERS.github}</p>`;
  const back = restoreIfEnabled(model, PROFILE_ON);
  check(back.includes('<h1>Jane Doe</h1>'), 'restore puts the real name back');
  check(back.includes('jane.doe@example.org') && back.includes('+91 98765 43210'), 'restore puts email and phone back');
  check(back.includes('https://www.linkedin.com/in/janedoe') && !back.includes('https://www.https'), 'restore does not double the URL prefix');
  check(!back.includes('Candidate Name') && !back.includes('example.com') && !back.includes('/candidate'), 'no placeholder survives restore');
  check(restoreIfEnabled(model, PROFILE_OFF) === model, 'restoreIfEnabled is a no-op when off');
  check(restoreCandidatePII('Cost: $& $1', PROFILE_ON) === 'Cost: $& $1', 'restore leaves unrelated text untouched');

  // ── anonymizeContext ─────────────────────────────────────────────────────
  const ctx = { cv: CV, profile: PROFILE_ON, profileMode: 'Built by Jane Doe (jane.doe@example.org)', shared: 'Jane Doe' };
  const anon = anonymizeContext(ctx);
  check(!/\bjane\b/i.test(anon.cv) && !/\bjane\b/i.test(anon.profile) && !/\bjane\b/i.test(anon.profileMode), 'anonymizeContext redacts cv, profile and profileMode');
  check(anon.shared === 'Jane Doe', 'anonymizeContext leaves shared mode text alone');
  check(ctx.cv === CV, 'anonymizeContext does not mutate its input');
  check(isRedactionEnabled(anon.profile), 'redacted profile still parses and keeps the privacy flag');

  // ── Edge cases ───────────────────────────────────────────────────────────
  check(redactCandidatePII(null, PROFILE_ON) === null, 'null text passes through');
  check(redactCandidatePII('Text', '') === 'Text', 'empty profile passes text through');
  check(redactCandidatePII('Jane Doe', 'candidate:\n  full_name: "Al"') === 'Jane Doe', 'too-short values are ignored');
  check(redactCandidatePII('a.b+c@x.io', 'candidate:\n  email: "a.b+c@x.io"') === PLACEHOLDERS.email, 'regex metacharacters in values are escaped');
} catch (err) {
  fail(`privacy-filter test crashed: ${err.stack || err.message}`);
}

// ── Wiring: each script reads the toggle through the filter, none hard-codes it ──
const read = (f) => readFileSync(join(ROOT, f), 'utf-8');
check(/redactIfEnabled/.test(read('gemini-eval.mjs')), 'gemini-eval.mjs applies the opt-in filter');
check(/anonymizeContext\(/.test(read('openrouter-runner.mjs')), 'openrouter-runner.mjs applies the opt-in filter');
const tailor = read('openai-tailor.mjs');
check(/redactIfEnabled/.test(tailor) && /restoreIfEnabled/.test(tailor), 'openai-tailor.mjs redacts and restores');
check(tailor.indexOf('restoreIfEnabled(tailoredHtml') < tailor.indexOf('validateLockedSections(tailoredHtml'),
  'openai-tailor.mjs restores before locked-section validation');
