// tests/pipeline-hygiene-nul-bytes.test.mjs — no control bytes may reach
// pipeline.md, and the ranker must survive them if they do.
//
// Regression: the Gmail ingest decoded quoted-printable escapes such as `=00`
// into raw control bytes and wrote them into pipeline URLs. A NUL anywhere in a
// rank-pipeline batch prompt makes execFileSync throw synchronously on argv
// (invalid argument) with no status and empty stderr, so every batch failed with
// "CLI call failed" at 0.0s for both opencode and claude, while each binary
// worked standalone — a data-integrity bug disguised as a broken CLI.
import { pass, fail } from './helpers.mjs';
import { extractUrls } from '../plugins/gmail/_helpers.mjs';
import { sanitizePromptArg } from '../rank-pipeline.mjs';

console.log('\npipeline hygiene — control bytes never reach pipeline.md / argv');

const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// --- extractUrls strips control bytes from decoded email bodies ---
{
  const body = 'see https://pl.indeed.com/rc/clk/dl?jk\u000086cfe&from=ja and https://a.b/c\u0001d\u0002e end';
  const urls = extractUrls(body);
  const clean = urls.every((u) => !CONTROLS.test(u));
  if (clean) pass('extractUrls drops NUL/SOH/STX from URLs');
  else fail(`extractUrls still emits control bytes: ${JSON.stringify(urls)}`);

  const expected = 'https://pl.indeed.com/rc/clk/dl?jk86cfe&from=ja';
  if (urls.includes(expected)) pass('control byte removed, surrounding URL kept intact');
  else fail(`expected ${expected}, got ${JSON.stringify(urls)}`);
}

// A quoted-printable `=00` in the raw text is just text to extractUrls; the
// control byte appears only after decodeQuotedPrintable. Pin the decode path value:
{
  const { decodeQuotedPrintable } = await import('../plugins/gmail/_helpers.mjs');
  const decoded = decodeQuotedPrintable('a=00b=01c');
  const stillHasControls = CONTROLS.test(decoded);
  // decodeQuotedPrintable itself may legitimately produce the bytes; extractUrls
  // must be the boundary that strips them. Assert the pairing holds.
  if (stillHasControls) pass('decodeQuotedPrintable can emit raw controls (as expected) — sanitization is extractUrls\' job');
  else fail('decodeQuotedPrintable unexpectedly stripped controls; test assumption stale');

  const urls = extractUrls(`x https://h/p?q=${decoded} z`);
  if (urls.every((u) => !CONTROLS.test(u))) pass('extractUrls sanitizes a decoded-control URL');
  else fail(`decoded-control URL still carries controls: ${JSON.stringify(urls)}`);
}

// --- sanitizePromptArg keeps tabs/newlines, drops everything else in C0 ---
{
  const raw = 'batch\u0000one\u0001two\ttab\nline';
  const out = sanitizePromptArg(raw);
  if (out === 'batchonetwo\ttab\nline') pass('sanitizePromptArg strips NUL/SOH but keeps tab and newline');
  else fail(`sanitizePromptArg produced ${JSON.stringify(out)}`);

  if (!out.includes('\u0000')) pass('sanitizePromptArg output is argv-safe (no NUL)');
  else fail('sanitizePromptArg left a NUL byte');

  if (sanitizePromptArg(undefined) === '' && sanitizePromptArg(null) === '') pass('sanitizePromptArg tolerates null/undefined');
  else fail('sanitizePromptArg mishandled null/undefined');
}
