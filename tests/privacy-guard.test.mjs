// tests/privacy-guard.test.mjs — the outbound LLM privacy guard.
//
// The guard's whole value is that it refuses a request that was about to leave
// the machine. These tests pin the twelve behaviours the design rests on, and
// every fixture value is FICTIONAL. No network call is made: the interceptor
// tests install the wrapper over a mock fetch, so a blocked request is proven
// blocked by the mock never being reached.
//
// Run:  node --test tests/privacy-guard.test.mjs
//
// HERMETIC: tmpdir fixtures only; no real user data, no real API keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PrivacyGuard,
  PrivacyGuardError,
  PrivacyConfigError,
  PiiGuardError,
  normalizeValue,
  flattenScalars,
  readPrivacyConfig,
  loadPrivacyGuard,
  bypassRequested,
} from '../lib/privacy-guard.mjs';
import {
  assertGoogleRequestAllowed,
  assertLlmRequestAllowed,
  checkLlmRequest,
  isLlmRequestUrl,
} from '../lib/llm-outbound.mjs';
import {
  wrapFetch,
  redactModeEnabled,
} from '../lib/pii-interceptor.mjs';

// Fictional values only. None of these belong to a real person.
const FAKE = Object.freeze({
  name: 'Jordan A. Placeholder',
  email: 'jordan.placeholder@example.com',
  phone: '+1 555 010 0199',
  linkedin: 'https://linkedin.com/in/jordan-placeholder',
  salary: 145000,
});

/** A guard whose configured values are the fictional set above. */
function fakeGuard(extra = {}) {
  return new PrivacyGuard({
    values: [FAKE.name, FAKE.email, FAKE.phone, FAKE.linkedin, FAKE.salary],
    ...extra,
  });
}

function withConfigFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-'));
  const path = join(dir, 'privacy.yml');
  try {
    writeFileSync(path, contents);
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. A request carrying a configured value is BLOCKED, not redacted.
// ---------------------------------------------------------------------------
test('1. a configured value in a request is blocked, and the request is not rewritten', () => {
  const guard = fakeGuard();
  const body = JSON.stringify({
    model: 'some-model',
    messages: [{ role: 'system', content: `My name is ${FAKE.name}.` }],
  });

  assert.throws(() => guard.assertSafe(body), PrivacyGuardError);

  // There is no "sanitize" path on the blocking guard: the caller gets an error
  // and the original body it built is untouched, so a caller cannot end up
  // sending a silently-altered prompt.
  assert.ok(body.includes(FAKE.name), 'the caller still holds the original body');
});

// ---------------------------------------------------------------------------
// 2. Ordinary professional information is allowed (no false blocks).
// ---------------------------------------------------------------------------
test('2. ordinary professional content passes unchanged', () => {
  const guard = fakeGuard();
  const body = JSON.stringify({
    messages: [
      {
        role: 'user',
        content:
          'JOB DESCRIPTION: Senior Backend Engineer at Acme. 8+ years of Go, ' +
          'Kubernetes and PostgreSQL. Salary band 180000-220000. Posted 2026-10-20. ' +
          'Team of 12 engineers. Requires a degree in Computer Science.',
      },
    ],
  });
  assert.equal(guard.assertSafe(body), true, 'skills, dates and a comp band are not PII');
  assert.equal(guard.inspect(body).length, 0);
});

// ---------------------------------------------------------------------------
// 3. The WHOLE serialized request is inspected, nested fields included.
// ---------------------------------------------------------------------------
test('3. a value nested deep inside the request is still found', () => {
  const guard = fakeGuard();
  const body = {
    model: 'm',
    messages: [
      { role: 'system', content: 'You are an evaluator.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Evaluate this CV.' },
          {
            type: 'tool_result',
            nested: { deeply: { contact: { email: FAKE.email } } },
          },
        ],
      },
    ],
  };
  // Not a top-level string: the guard serializes the object graph.
  assert.throws(() => guard.assertSafe(body), PrivacyGuardError);
});

// ---------------------------------------------------------------------------
// 4. The error names the CATEGORY, never the value.
// ---------------------------------------------------------------------------
test('4. the error message never contains the protected value', () => {
  const guard = fakeGuard();
  let caught;
  try {
    guard.assertSafe(`contact me at ${FAKE.email}`);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PrivacyGuardError);
  assert.ok(!caught.message.includes(FAKE.email), 'the error must not echo the value');
  assert.ok(!caught.message.includes('jordan'), 'nor a fragment of it');
  assert.ok(!caught.message.includes(FAKE.phone));
  // The message names a CATEGORY, never the value. A configured email matches
  // both tiers (configured value + email pattern), so either category name is
  // correct here; what matters is that it is one of the fixed category strings.
  assert.match(caught.message, /configured protected value|email address/);
  assert.equal(caught.safeToSend, false);
  assert.equal(caught.code, 'PRIVACY_GUARD_BLOCKED');

  // The structured part of the error is a category + count, never a value.
  assert.ok(
    caught.category === 'configured protected value' || caught.category === 'email address',
    'category is one of the fixed constants'
  );
  assert.equal(typeof caught.hits, 'number');
  assert.ok(!JSON.stringify(caught.category).includes(FAKE.email), 'the category carries no value');
});

// ---------------------------------------------------------------------------
// 4b. The error points at WHICH configured entry matched, without naming it.
// ---------------------------------------------------------------------------
test('4b. a blocked request names the config entry, never the value', () => {
  // Entry 2 is the phone; the request contains only a longer digit run that
  // matches it as a substring, so the category alone would leave the user with
  // no way to find the offending line in config/privacy.yml.
  const guard = new PrivacyGuard({ values: [FAKE.name, FAKE.phone] });
  let caught;
  try {
    guard.assertSafe('reference 9991555010019999 in the posting');
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PrivacyGuardError);
  assert.match(caught.message, /entry 2/, 'names the config entry that matched');
  assert.ok(!caught.message.includes('555'), 'still no value, not even digits');
  assert.ok(!caught.message.includes(FAKE.phone), 'and not the full configured value');
  assert.ok(!caught.message.includes(FAKE.name));
});

// ---------------------------------------------------------------------------
// 5. A missing config file is a documented SAFE state, not a failure.
// ---------------------------------------------------------------------------
test('5. an absent config is not an error — the guard keeps pattern detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-absent-'));
  const missing = join(dir, 'does-not-exist.yml');
  try {
    const config = readPrivacyConfig(missing);
    assert.equal(config.present, false);
    assert.equal(config.source, 'absent');
    assert.deepEqual(config.values, []);

    // It loads into a working guard that still auto-detects patterns.
    const guard = loadPrivacyGuard({ configPath: missing });
    assert.equal(guard.enabled, true);
    assert.throws(() => guard.assertSafe('mail me at someone@example.org'), PrivacyGuardError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 6. A config that is present but BROKEN fails closed.
// ---------------------------------------------------------------------------
test('6. a malformed config raises instead of silently disabling protection', () => {
  withConfigFile('protected: [unclosed\n  - : : :\n', (path) => {
    assert.throws(() => readPrivacyConfig(path), PrivacyConfigError);
  });

  // A top-level list is not the documented mapping shape: also an error.
  withConfigFile('- just\n- a list\n', (path) => {
    assert.throws(() => readPrivacyConfig(path), PrivacyConfigError);
  });

  // A comment-only file is the documented "nothing configured" state, NOT an
  // error, and is reported distinctly from "absent".
  withConfigFile('# only a comment\n', (path) => {
    const config = readPrivacyConfig(path);
    assert.equal(config.source, 'empty');
    assert.equal(config.present, true);
  });
});

// ---------------------------------------------------------------------------
// 7. Normalization: case, digits-only numbers, and the length floors.
// ---------------------------------------------------------------------------
test('7. normalization matches spelling variants but drops unguardable values', () => {
  // Case-insensitive text.
  const guard = new PrivacyGuard({ values: [FAKE.name] });
  assert.throws(() => guard.assertSafe('MY NAME IS jordan a. placeholder'), PrivacyGuardError);

  // Digits-only numeric comparison: country code and separators do not matter.
  const phoneGuard = new PrivacyGuard({ values: [FAKE.phone] });
  assert.throws(() => phoneGuard.assertSafe('call 15550100199'), PrivacyGuardError, 'national form');
  assert.throws(() => phoneGuard.assertSafe('call (555) 010-0199'), PrivacyGuardError, 'punctuated form');

  // The floors: too-short values are dropped rather than guarded, so ordinary
  // prose is never blocked by a 2-character "value".
  assert.equal(normalizeValue('ab'), null, 'below MIN_TEXT_LEN');
  assert.equal(normalizeValue('INR'), null, 'a short currency code is not a value');
  assert.ok(normalizeValue(FAKE.name), 'a real name is guardable');
  assert.equal(normalizeValue(42), null, 'a bare 2-digit number is below MIN_DIGITS_RUN');

  const tinyGuard = new PrivacyGuard({ values: ['ai', 'go', 'on'] });
  assert.equal(tinyGuard.configuredCount, 0, 'nothing guardable was configured');
  assert.equal(tinyGuard.assertSafe('We go on about AI.'), true, 'no false block');
});

// ---------------------------------------------------------------------------
// 7b. A profile URL guards its bare handle in BOTH the scheme'd and bare forms.
// ---------------------------------------------------------------------------
test('7b. a profile URL derived handle is guarded however the URL was written', () => {
  // With the scheme.
  const withScheme = new PrivacyGuard({ values: ['https://linkedin.com/in/jordan-placeholder'] });
  assert.throws(() => withScheme.assertSafe('see jordan-placeholder on the site'), PrivacyGuardError);

  // WITHOUT the scheme — this is the case the old URL-shaped gate skipped, so
  // the handle went unguarded even though the docs promised otherwise.
  const bare = new PrivacyGuard({ values: ['linkedin.com/in/jordan-placeholder'] });
  assert.throws(() => bare.assertSafe('see jordan-placeholder on the site'), PrivacyGuardError);

  // A non-URL value derives nothing extra and does not throw.
  const plain = new PrivacyGuard({ values: [FAKE.name] });
  assert.equal(plain.assertSafe('ordinary professional text'), true);
});

// ---------------------------------------------------------------------------
// 8. Auto-detection: emails and phones, with per-kind switches.
// ---------------------------------------------------------------------------
test('8. auto-detection is pattern-based and each kind can be switched off', () => {
  const on = new PrivacyGuard({ values: [], autoDetect: { email: true, phone: true } });
  assert.throws(() => on.assertSafe('reach the recruiter at hr@example.com'), PrivacyGuardError);
  assert.throws(() => on.assertSafe('call the team on +44 20 7946 0958'), PrivacyGuardError);

  // Switching email off must let an email through but keep the phone pattern.
  const emailOff = new PrivacyGuard({ values: [], autoDetect: { email: false, phone: true } });
  assert.equal(emailOff.assertSafe('reach the recruiter at hr@example.com'), true);
  assert.throws(() => emailOff.assertSafe('call +44 20 7946 0958'), PrivacyGuardError);

  // A profile URL is off by default.
  const defaults = new PrivacyGuard({ values: [] });
  assert.equal(defaults.assertSafe(`see ${FAKE.linkedin}`), true, 'profile_url defaults off');

  // ...and is detected when explicitly enabled.
  const profileOn = new PrivacyGuard({ values: [], autoDetect: { profile_url: true } });
  assert.throws(() => profileOn.assertSafe(`see ${FAKE.linkedin}`), PrivacyGuardError);
});

// ---------------------------------------------------------------------------
// 9. Fail-closed on an unreadable payload.
// ---------------------------------------------------------------------------
test('9. a payload that cannot be inspected is refused, not allowed', () => {
  const guard = fakeGuard();
  const cyclic = {};
  cyclic.self = cyclic;

  assert.throws(() => assertLlmRequestAllowed('https://openrouter.ai/api/v1/chat/completions', cyclic), PrivacyGuardError);

  // checkLlmRequest has the same fail-closed property in its non-throwing form.
  const decision = checkLlmRequest('https://openrouter.ai/api/v1/chat/completions', cyclic);
  assert.equal(decision.allowed, false);

  // Absent/empty bodies are genuinely nothing to leak, and are allowed.
  assert.deepEqual(checkLlmRequest('https://openrouter.ai/x', undefined).allowed, true);
  assert.deepEqual(checkLlmRequest('https://openrouter.ai/x', '').allowed, true);
});

// ---------------------------------------------------------------------------
// 10. The bypass needs TWO factors and cannot be triggered by one.
// ---------------------------------------------------------------------------
test('10. disabling the guard requires both an explicit flag and a token', () => {
  const saved = { ...process.env };

  try {
    // A single variable is not enough.
    process.env.PRIVACY_GUARD = 'off';
    delete process.env.PRIVACY_BYPASS_TOKEN;
    assert.equal(bypassRequested(), false, 'flag alone must not disable the guard');
    assert.equal(loadPrivacyGuard({ configPath: join(tmpdir(), 'nope.yml') }).enabled, true);

    // An unrelated truthy value is not the flag.
    process.env.PRIVACY_GUARD = 'true';
    process.env.PRIVACY_BYPASS_TOKEN = 'anything';
    assert.equal(bypassRequested(), false, 'only off/disabled/0 counts as the flag');

    // Both factors together: now, and only now, is the guard off.
    process.env.PRIVACY_GUARD = 'off';
    process.env.PRIVACY_BYPASS_TOKEN = 'i-understand-the-risk';
    assert.equal(bypassRequested(), true);
    const bypassed = loadPrivacyGuard({ configPath: join(tmpdir(), 'nope.yml') });
    assert.equal(bypassed.enabled, false);
    assert.equal(bypassed.assertSafe(`send ${FAKE.email}`), true, 'a bypassed guard allows');
  } finally {
    process.env = saved;
  }
});

// ---------------------------------------------------------------------------
// 11. The ambient fetch layer blocks before the network and leaves non-LLM
//     traffic (job boards, ATS APIs) completely alone.
// ---------------------------------------------------------------------------
test('11. the fetch wrapper blocks LLM requests and passes non-LLM ones through', async () => {
  const sent = [];
  const mockFetch = async (input, init) => {
    sent.push({ url: String(input?.url ?? input), init });
    return { ok: true, text: async () => '{}', json: async () => ({}) };
  };

  const guard = fakeGuard();

  // ── An LLM request carrying a protected value throws, and never reaches the
  //    mock fetch: this is the "blocked before network" property.
  const blocked = wrapFetch(mockFetch, { guard, redact: false });
  await assert.rejects(
    () => blocked('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ q: FAKE.email }) }),
    PrivacyGuardError
  );
  assert.equal(sent.length, 0, 'nothing was sent');

  // ── A clean LLM request goes through.
  await blocked('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ q: 'a normal prompt' }) });
  assert.equal(sent.length, 1, 'the clean request was sent');

  // ── A non-LLM host is not inspected at all, even with a protected value.
  await blocked('https://boards-api.greenhouse.io/v1/boards/acme/jobs', { body: JSON.stringify({ q: FAKE.email }) });
  assert.equal(sent.length, 2, 'a job board request passes untouched');
});

test('11b. host matching recognises LLM providers and not lookalikes', () => {
  assert.equal(isLlmRequestUrl('https://openrouter.ai/api/v1/chat/completions'), true);
  assert.equal(isLlmRequestUrl('https://generativelanguage.googleapis.com/v1/models:generateContent'), true);
  assert.equal(isLlmRequestUrl('http://localhost:11434/api/chat'), true, 'local Ollama is still a payload leaving the process');
  assert.equal(isLlmRequestUrl('https://boards-api.greenhouse.io/v1/boards/acme/jobs'), false);
  assert.equal(isLlmRequestUrl('https://evil-openrouter.ai.example.com/x'), false, 'suffix match is on label boundaries');
  assert.equal(isLlmRequestUrl('not a url'), false);
});

// ---------------------------------------------------------------------------
// 11c. The Google helper inspects the same parts the SDK receives, in both the
// systemInstruction and each turn — so gate and call cannot drift apart.
// ---------------------------------------------------------------------------
test('11c. assertGoogleRequestAllowed inspects systemInstruction and every turn', () => {
  const guard = fakeGuard();

  // Clean request passes.
  assert.doesNotThrow(() =>
    assertGoogleRequestAllowed({ systemInstruction: 'You are a helpful evaluator.', turns: ['A job posting.'] }, { guard })
  );

  // A value in the user turn is blocked.
  assert.throws(
    () => assertGoogleRequestAllowed({ turns: [`Contact me at ${FAKE.email}`] }, { guard }),
    PrivacyGuardError
  );

  // A value in the systemInstruction is blocked too, not just the turns.
  assert.throws(
    () => assertGoogleRequestAllowed({ systemInstruction: `Candidate: ${FAKE.name}`, turns: ['ok'] }, { guard }),
    PrivacyGuardError
  );

  // A value in the SECOND turn of a multi-turn request is found as well.
  assert.throws(
    () => assertGoogleRequestAllowed({ turns: ['first', `call ${FAKE.phone}`] }, { guard }),
    PrivacyGuardError
  );
});

// ---------------------------------------------------------------------------
// 12. Legacy compatibility surface + redact mode stays opt-in.
// ---------------------------------------------------------------------------
test('12. legacy names resolve to one policy, and redact mode is opt-in', () => {
  // The earlier flow imports PiiGuard / PiiGuardError / defaultGuard. They must
  // resolve to the same class and error so the two generations cannot diverge.
  assert.equal(PiiGuardError, PrivacyGuardError);

  // Redact mode is OFF unless the exact opt-in value is present.
  assert.equal(redactModeEnabled({}), false);
  assert.equal(redactModeEnabled({ PRIVACY_REDACT: '0' }), false);
  assert.equal(redactModeEnabled({ PRIVACY_REDACT: 'yes' }), false, 'only 1/true count');
  assert.equal(redactModeEnabled({ PRIVACY_REDACT: '1' }), true);
  assert.equal(redactModeEnabled({ PRIVACY_REDACT: 'true' }), true);
});

test('12b. redact mode tokenizes instead of blocking, and only when opted in', async () => {
  const guard = fakeGuard();
  let sentBody = null;
  const mockFetch = async (input, init) => {
    sentBody = init?.body;
    return { ok: true, text: async () => '{}', json: async () => ({}) };
  };

  const redacting = wrapFetch(mockFetch, { guard, redact: true });
  await redacting('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ q: FAKE.email }),
  });
  assert.ok(sentBody, 'in redact mode the request IS sent');
  assert.ok(!sentBody.includes(FAKE.email), 'the real value was scrubbed out');
  assert.match(sentBody, /PRIVACY_REDACTED_/, 'a placeholder took its place');
});

// ---------------------------------------------------------------------------
// Config loading: the shape the user actually writes.
// ---------------------------------------------------------------------------
test('a real config file loads its values and switches, nested keys included', () => {
  withConfigFile(
    [
      'enabled: true',
      'auto_detect:',
      '  email: true',
      '  phone: false',
      '  profile_url: true',
      'protected:',
      `  full_name: "${FAKE.name}"`,
      `  email: "${FAKE.email}"`,
      '  salary:',
      '    current_base: 145000',
      '    target_floor: 165000',
      '  custom:',
      '    - "Project Nightingale"',
      '',
    ].join('\n'),
    (path) => {
      const config = readPrivacyConfig(path);
      assert.equal(config.present, true);
      assert.equal(config.enabled, true);
      assert.equal(config.autoDetect.phone, false);

      const guard = loadPrivacyGuard({ configPath: path });
      assert.ok(guard.configuredCount >= 4, 'name, email and two salary figures');
      assert.throws(() => guard.assertSafe(`I am ${FAKE.name}`), PrivacyGuardError);
      assert.throws(() => guard.assertSafe('engagement: Project Nightingale'), PrivacyGuardError);
      // The nested salary figure is guarded; the disabled phone pattern is not.
      assert.throws(() => guard.assertSafe('expecting 145000 base'), PrivacyGuardError);
      assert.equal(guard.assertSafe('call +44 20 7946 0958'), true, 'phone detection is off here');
    }
  );
});

test('flattenScalars walks arrays and maps; normalizeValue then drops the noise', () => {
  const scalars = flattenScalars({ a: 1, b: ['x', { c: 'y' }], d: { e: false, f: null } });
  // flattenScalars collects every non-null leaf, including booleans...
  assert.deepEqual([...scalars].sort(), [1, false, 'x', 'y'].sort());
  assert.ok(!scalars.includes(null), 'nulls are skipped');
  // ...and normalizeValue is what refuses to guard the values that would be
  // meaningless or false-positive-prone. These two layers are meant to be read
  // together: a boolean can never become a protected value.
  assert.equal(normalizeValue(false), null);
  assert.equal(normalizeValue(true), null);
  assert.ok(normalizeValue('Project Nightingale'), 'a real string value survives');
});

test('an explicitly disabled config makes the guard a documented no-op', () => {
  withConfigFile('enabled: false\nprotected:\n  email: "someone@example.com"\n', (path) => {
    const guard = loadPrivacyGuard({ configPath: path });
    assert.equal(guard.enabled, false);
    assert.equal(guard.assertSafe('email someone@example.com'), true);
  });
});

// ---------------------------------------------------------------------------
// A boolean under `protected:` must not consume an entry number, or the
// `entry N` label in a block error points at the wrong line of the file.
// ---------------------------------------------------------------------------
test('booleans under protected do not shift the entry N labels', () => {
  withConfigFile(
    [
      'protected:',
      '  active: true',                     // entry that must NOT count
      `  full_name: "${FAKE.name}"`,        // entry 1
      '  salary:',                          // entry 2 (nested)
      '    target: 145000',
      '',
    ].join('\n'),
    (path) => {
      const config = readPrivacyConfig(path);
      assert.ok(!config.values.includes(true), 'the boolean is not a protected value');

      const guard = loadPrivacyGuard({ configPath: path });
      let caught;
      try {
        guard.assertSafe(`my name is ${FAKE.name}`);
      } catch (err) {
        caught = err;
      }
      // full_name is the FIRST guarded value, so it must read "entry 1" — not
      // "entry 2", which is where it would land if the boolean had counted.
      assert.match(caught.message, /entry 1/);
    }
  );
});

// ---------------------------------------------------------------------------
// The shipped sample is committed, so it must stay fictional and parseable.
// ---------------------------------------------------------------------------
test('config/privacy.example.yml parses and contains no real-looking secret', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const text = readFileSync(join(root, 'config', 'privacy.example.yml'), 'utf-8');

  // It must be the shipped sample, parsed through the guard's own reader, and
  // its example email must sit on the reserved example.com domain.
  withConfigFile(text, (path) => {
    const config = readPrivacyConfig(path);
    assert.equal(config.present, true);
    assert.ok(config.values.length > 0, 'the sample configures example values');
  });
  assert.match(text, /example\.com/, 'placeholders use the reserved example domain');
  assert.doesNotMatch(text, /555-01-0199[\s\S]*real/i, 'no claim of real data');
});
