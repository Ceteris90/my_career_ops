import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { gmailRefreshAdvice, upsertEnvAssignment, gmailAuthRequest } from '../lib/gmail-auth.mjs';
import { importMailDrop } from '../lib/linkedin-mail-drop.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const JOB_ID = '5151515151';

test('invalid_grant tells you about the 7 day Testing expiry and the auth command', () => {
  const advice = gmailRefreshAdvice(400, JSON.stringify({
    error: 'invalid_grant',
    error_description: 'Token has been expired or revoked.',
  }));
  assert.equal(advice.ok, false);
  assert.match(advice.label, /invalid_grant/);
  assert.match(advice.fix, /7 days/);
  assert.match(advice.fix, /Testing/);
  assert.match(advice.fix, /Production/);
  assert.match(advice.fix, /node plugins\.mjs auth gmail/);
});

test('the auth url is a desktop loopback request with offline access', () => {
  const url = new URL(gmailAuthRequest({
    clientId: 'client.example',
    redirectUri: 'http://127.0.0.1:9',
    state: 'state.example',
    codeChallenge: 'challenge.example',
  }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:9');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge.example');
  assert.match(url.searchParams.get('scope'), /gmail\.readonly/);
});

test('upsert keeps other env lines and replaces the refresh token', () => {
  const next = upsertEnvAssignment('GMAIL_CLIENT_ID=client.example\nGMAIL_REFRESH_TOKEN=old\n', 'GMAIL_REFRESH_TOKEN', 'new.example');
  assert.match(next, /^GMAIL_CLIENT_ID=client\.example$/m);
  assert.match(next, /^GMAIL_REFRESH_TOKEN=new\.example$/m);
  assert.doesNotMatch(next, /old/);
});

test('a drop folder of eml files becomes canonical pipeline rows once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'linkedin-drop-'));
  const dir = join(root, 'data', 'linkedin-alerts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'data', 'pipeline.md'), '# Pipeline\n\n## Pending\n\n## Processed\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  writeFileSync(join(dir, 'alert.eml'), [
    'From: jobs-noreply@linkedin.example',
    'Subject: Jobs for you',
    '',
    `https://www.linkedin.com/comm/jobs/view/${JOB_ID}?trackingId=abc&trk=eml`,
  ].join('\n'));
  try {
    const first = await importMailDrop({ root, dir });
    assert.equal(first.added, 1);
    const pipeline = readFileSync(join(root, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, new RegExp(`https://www.linkedin.com/jobs/view/${JOB_ID}`));
    assert.doesNotMatch(pipeline, /\/comm\/jobs\/view\//);
    const second = await importMailDrop({ root, dir });
    assert.equal(second.added, 0);
    assert.equal(readFileSync(join(root, 'data', 'pipeline.md'), 'utf8'), pipeline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plugins auth gmail without a client id names the Desktop client step', () => {
  const root = mkdtempSync(join(tmpdir(), 'gmail-auth-missing-'));
  try {
    const result = spawnSync(process.execPath, ['plugins.mjs', 'auth', 'gmail'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, CAREER_OPS_ROOT: root, NO_COLOR: '1' },
    });
    assert.notEqual(result.status, 0);
    const text = `${result.stdout}${result.stderr}`;
    assert.match(text, /Desktop/);
    assert.match(text, /console\.cloud\.google\.com/);
    assert.doesNotMatch(text, /refresh token is/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor explains invalid_grant from the token endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gmail-doctor-'));
  const server = createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"0.0.0"}\n');
    writeFileSync(join(root, '.env'), [
      'GMAIL_CLIENT_ID=client.example',
      'GMAIL_CLIENT_SECRET=secret.example',
      'GMAIL_REFRESH_TOKEN=refresh.example',
      '',
    ].join('\n'));
    const result = spawnSync(process.execPath, ['doctor.mjs', '--target', root], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        CAREER_OPS_ROOT: root,
        CAREER_OPS_GMAIL_TOKEN_URL: `http://127.0.0.1:${port}/token`,
        NO_COLOR: '1',
      },
    });
    const text = `${result.stdout}${result.stderr}`;
    assert.match(text, /invalid_grant/);
    assert.match(text, /7 days/);
    assert.match(text, /Production/);
    assert.match(text, /node plugins\.mjs auth gmail/);
    assert.doesNotMatch(text, /refresh\.example/);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
