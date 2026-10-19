#!/usr/bin/env node
// @ts-check
//
// Re-auth helper for the career-ops Gmail ingest plugin.
// Runs a local OAuth authorization-code flow against the EXISTING OAuth client
// (works in Google "Testing" mode — it simply mints a fresh refresh token, which
// Testing mode invalidates every ~7 days). Never moves the app to Production.
//
// Usage:
//   node gmail-reauth.mjs
//
// It prints an authorization URL, opens your browser, and on completion writes
// the new refresh token into .env under GMAIL_REFRESH_TOKEN (in place).

import http from 'node:http';
import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import { execSync } from 'node:child_process';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

loadEnv();

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('gmail-reauth: missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
  process.exit(1);
}

const envPath = new URL('.env', import.meta.url).pathname;
const port = 17553;
const redirectUri = `http://127.0.0.1:${port}/`;

const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
});

const authUrl = `${AUTH_URL}?${params.toString()}`;

console.log('\nOpen this URL in your browser and complete the Google consent:\n');
console.log(`  ${authUrl}\n`);
console.log('(If it errors with "redirect_uri_mismatch", the OAuth client is not a\n'
  + 'Desktop-app type. Report that here and we will fall back to OAuth Playground.)\n');

try {
  execSync(`open '${authUrl}'`, { stdio: 'ignore' });
} catch {
  // open is macOS-only; the URL is printed above for other platforms.
}

function exchange(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const req = https.request(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body.toString());
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!code) {
    res.end(`<h3>Authorization failed</h3><p>${error || 'no code returned'}</p><p>Close this tab.</p>`);
    server.close();
    return;
  }
  try {
    const tok = await exchange(code);
    if (!tok.refresh_token) {
      throw new Error(`no refresh_token in response: ${JSON.stringify(tok)}`);
    }
    let env = readFileSync(envPath, 'utf8');
    if (new RegExp('^GMAIL_REFRESH_TOKEN=.*$', 'm').test(env)) {
      env = env.replace(/^GMAIL_REFRESH_TOKEN=.*$/m, `GMAIL_REFRESH_TOKEN=${tok.refresh_token}`);
    } else {
      env += `\nGMAIL_REFRESH_TOKEN=${tok.refresh_token}\n`;
    }
    writeFileSync(envPath, env);
    res.end('<h3>Success</h3><p>Refresh token written to .env. You can close this tab.</p>');
    console.log('\ngmail-reauth: OK — refresh token written to .env.');
    console.log('Verify with: node gmail-auth-doctor.mjs');
    console.log('Then ingest with: node plugins.mjs run gmail\n');
    server.close();
  } catch (e) {
    console.error(`gmail-reauth: exchange failed: ${e.message}`);
    res.end(`<h3>Exchange failed</h3><p>${e.message}</p>`);
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`gmail-reauth: listening on ${redirectUri}. Waiting for the browser callback...\n`);
});