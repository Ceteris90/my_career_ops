#!/usr/bin/env node
// @ts-check

import { config as loadEnv } from 'dotenv';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

loadEnv();

const args = process.argv.slice(2);
const json = args.includes('--json');
const quiet = args.includes('--quiet');

function print(message) {
  if (!quiet) console.log(message);
}

function fail(result) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (!quiet) {
    console.error(`gmail-auth: ${result.summary}`);
    for (const line of result.details || []) console.error(`- ${line}`);
  }
  process.exit(1);
}

function ok(result) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else print(`gmail-auth: ${result.summary}`);
  process.exit(0);
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const missing = [
    !clientId && 'GMAIL_CLIENT_ID',
    !clientSecret && 'GMAIL_CLIENT_SECRET',
    !refreshToken && 'GMAIL_REFRESH_TOKEN',
  ].filter(Boolean);

  if (missing.length) {
    fail({
      ok: false,
      code: 'missing-env',
      summary: `missing ${missing.join(', ')}`,
      details: ['Add the missing Gmail OAuth values to .env before running Gmail ingest.'],
    });
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenText = await tokenRes.text();
  const tokenData = parseJsonSafe(tokenText);

  if (!tokenRes.ok || !tokenData?.access_token) {
    const oauthError = tokenData?.error || 'token-refresh-failed';
    const oauthDescription = tokenData?.error_description || tokenText.slice(0, 200);
    if (oauthError === 'invalid_grant') {
      fail({
        ok: false,
        code: 'invalid-grant',
        summary: 'refresh token is no longer valid',
        details: [
          `Google returned invalid_grant: ${oauthDescription}`,
          'Most likely causes: the token was revoked, the OAuth app is still in Testing mode (7-day refresh tokens), or Google invalidated the token after a security/account change.',
          'How to mint a new refresh token now:',
          '1. Open Google Cloud Console: https://console.cloud.google.com/',
          '2. Create or select the project you use for career-ops Gmail access.',
          '3. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com',
          '4. Open Credentials: https://console.cloud.google.com/apis/credentials',
          '5. Create an OAuth client ID of type "Desktop app" and copy the client id + client secret.',
          '6. Open OAuth Playground: https://developers.google.com/oauthplayground/',
          '7. Click the gear icon, enable "Use your own OAuth credentials", then paste that client id + client secret.',
          '8. In Step 1 add the scope https://www.googleapis.com/auth/gmail.readonly and click "Authorize APIs".',
          '9. After Google consent, click "Exchange authorization code for tokens".',
          '10. Copy the returned refresh_token and update .env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.',
          '11. Re-run: node gmail-auth-doctor.mjs --json',
          '12. If the check passes, ingest Gmail leads with: node plugins.mjs run gmail',
          'If you keep the app in Testing, expect to repeat this occasionally. The main pipeline will keep working; only Gmail ingest will need re-auth.',
          'Operational guardrail: run this check before scheduled ingest and alert on failure so portal scan can continue while Gmail is re-authorized.',
        ],
      });
    }
    fail({
      ok: false,
      code: oauthError,
      summary: 'token refresh failed',
      details: [`Google OAuth error: ${oauthDescription}`],
    });
  }

  const accessToken = tokenData.access_token;
  const profileRes = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profileText = await profileRes.text();
  const profileData = parseJsonSafe(profileText);

  if (!profileRes.ok || !profileData?.emailAddress) {
    fail({
      ok: false,
      code: 'gmail-profile-check-failed',
      summary: 'token refresh worked, but Gmail profile check failed',
      details: [profileText.slice(0, 300) || `HTTP ${profileRes.status}`],
    });
  }

  ok({
    ok: true,
    code: 'ok',
    summary: `authorized for ${profileData.emailAddress}`,
    email: profileData.emailAddress,
    messagesTotal: profileData.messagesTotal ?? null,
  });
}

main().catch((err) => {
  fail({
    ok: false,
    code: 'unexpected-error',
    summary: err instanceof Error ? err.message : String(err),
    details: [],
  });
});
