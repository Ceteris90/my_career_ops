import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GMAIL_DESKTOP_CLIENT_HELP = [
  'Gmail sign-in needs a Desktop OAuth client that you create once.',
  'Open https://console.cloud.google.com/apis/credentials',
  'Create an OAuth client ID of type Desktop app.',
  'Put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env',
  'Run node plugins.mjs auth gmail again.',
  'CareerOps does not ship a shared Gmail client: reading mail is a restricted Google scope, so each person uses a client in their own Google Cloud project.',
].join('\n');

/**
 * @param {{ clientId: string, redirectUri: string, state: string, codeChallenge: string }} input
 * @returns {string}
 */
export function gmailAuthRequest({ clientId, redirectUri, state, codeChallenge }) {
  const url = new URL(GMAIL_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GMAIL_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * @param {string} text
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
export function upsertEnvAssignment(text, key, value) {
  if (/[\r\n]/.test(value)) throw new Error(`${key} cannot contain a newline`);
  const line = `${key}=${value}`;
  const source = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source}${line}\n`;
}

/**
 * @param {number} status
 * @param {string} bodyText
 * @returns {{ ok: boolean, label: string, fix: string }}
 */
export function gmailRefreshAdvice(status, bodyText) {
  let error = '';
  try {
    error = JSON.parse(bodyText)?.error || '';
  } catch {
    error = '';
  }
  if (status >= 200 && status < 300 && error === '') {
    return { ok: true, label: 'Gmail refresh token works.', fix: '' };
  }
  if (error === 'invalid_grant' || String(bodyText).includes('invalid_grant')) {
    return {
      ok: false,
      label: 'Gmail refresh token was rejected (invalid_grant).',
      fix: 'The usual cause is an OAuth consent screen still in Testing: Google expires those refresh tokens after 7 days. Publish the app to Production on the consent screen, then run node plugins.mjs auth gmail. A revoked access or a Google password change gives the same error; the same command signs you in again.',
    };
  }
  // Signing in again fixes neither of these.
  if (error === 'invalid_client' || error === 'unauthorized_client') {
    return {
      ok: false,
      label: `Gmail client credentials were rejected (${error}).`,
      fix: 'Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env against your Desktop OAuth client in Google Cloud.',
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      label: `Google's token service is not answering (${status}).`,
      fix: 'This is on Google\'s side. Run node doctor.mjs again later.',
    };
  }
  return {
    ok: false,
    label: `Gmail refresh token check failed (${error || status}).`,
    fix: 'Run node plugins.mjs auth gmail.',
  };
}

export function gmailPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, state: randomBytes(16).toString('base64url') };
}

export function openLocalBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

/**
 * @param {{ state: string, timeoutMs?: number }} input
 */
export function beginGmailLogin({ state, timeoutMs = 180_000 }) {
  let settle;
  const code = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    // Only Google's redirect carries state. A favicon fetch or any other
    // request to this port must not end the sign-in.
    if (!url.searchParams.has('state')) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>CareerOps</title><p>You can close this tab and return to the terminal.</p>');
    clearTimeout(timer);
    server.close();
    const got = url.searchParams.get('state');
    const err = url.searchParams.get('error');
    const authCode = url.searchParams.get('code');
    if (got !== state) settle.reject(new Error('OAuth state did not match. Run node plugins.mjs auth gmail again.'));
    else if (err) settle.reject(new Error(`Google did not grant access (${err}).`));
    else if (!authCode) settle.reject(new Error('Google did not return a code. Run node plugins.mjs auth gmail again.'));
    else settle.resolve(authCode);
  });
  const timer = setTimeout(() => {
    server.close();
    settle.reject(new Error('Timed out waiting for Google. Run node plugins.mjs auth gmail again.'));
  }, timeoutMs);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        redirectUri: `http://127.0.0.1:${port}`,
        code,
        close: () => {
          clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}

/**
 * @param {{ code: string, clientId: string, clientSecret: string, redirectUri: string, codeVerifier: string, fetchFn?: typeof fetch, tokenUrl?: string }} input
 * @returns {Promise<string>}
 */
export async function exchangeGmailCode({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
  fetchFn = globalThis.fetch,
  tokenUrl = GMAIL_TOKEN_URL,
}) {
  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
    // The login timer is already cleared here, and the body carries the client secret.
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // This is the one-time sign-in code, not a stored refresh token, so the
    // 7-day Testing expiry does not apply. A used or expired code, or a
    // redirect mismatch, all come back as invalid_grant here.
    let error = '';
    try { error = JSON.parse(text)?.error || ''; } catch {}
    throw new Error(`Google rejected the sign-in code (${error || res.status}). Run node plugins.mjs auth gmail again.`);
  }
  const data = JSON.parse(text);
  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token. Run node plugins.mjs auth gmail again.');
  }
  return data.refresh_token;
}

/**
 * @param {{ clientId: string, clientSecret: string, envText: string, fetchFn?: typeof fetch, open?: (url: string) => void, log?: (url: string) => void, tokenUrl?: string, timeoutMs?: number }} input
 */
export async function runGmailAuth({
  clientId,
  clientSecret,
  envText,
  fetchFn = globalThis.fetch,
  open = openLocalBrowser,
  log = () => {},
  tokenUrl = GMAIL_TOKEN_URL,
  timeoutMs = 180_000,
}) {
  const pkce = gmailPkce();
  const login = await beginGmailLogin({ state: pkce.state, timeoutMs });
  const authUrl = gmailAuthRequest({
    clientId,
    redirectUri: login.redirectUri,
    state: pkce.state,
    codeChallenge: pkce.challenge,
  });
  log(authUrl);
  open(authUrl);
  try {
    const code = await login.code;
    const refreshToken = await exchangeGmailCode({
      code,
      clientId,
      clientSecret,
      redirectUri: login.redirectUri,
      codeVerifier: pkce.verifier,
      fetchFn,
      tokenUrl,
    });
    return { envText: upsertEnvAssignment(envText, 'GMAIL_REFRESH_TOKEN', refreshToken) };
  } finally {
    login.close();
  }
}
