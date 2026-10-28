import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import gmail from '../plugins/gmail/index.mjs';

const JOB_ID = '4242424242';

function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

test('a LinkedIn alert in Gmail becomes a canonical jobs/view url', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-linkedin-'));
  const tracking = `https://www.linkedin.com/comm/jobs/view/${JOB_ID}?trackingId=abc&trk=eml-job_alert`;
  const sender = ['jobs-noreply', 'linkedin.example'].join('@');
  const body = `From: ${sender}\n\n${tracking}\n`;
  try {
    const jobs = await gmail.ingest({
      env: {
        GMAIL_CLIENT_ID: 'client.example',
        GMAIL_CLIENT_SECRET: 'secret.example',
        GMAIL_REFRESH_TOKEN: 'refresh.example',
      },
      settings: { label: 'Job Leads', days_back: 7 },
      dataRoot,
      dryRun: true,
      log() {},
      fetch: async (url) => {
        const target = String(url);
        if (new URL(target).hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'token.example' });
        if (target.includes('/messages?')) return jsonResponse({ messages: [{ id: 'm1' }] });
        if (target.includes('/messages/m1')) {
          return jsonResponse({
            payload: {
              headers: [
                { name: 'Subject', value: 'Jobs for you' },
                { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=linkedin.example' },
              ],
              mimeType: 'text/plain',
              body: { data: b64url(body) },
            },
          });
        }
        throw new Error(`unexpected url ${target}`);
      },
    });
    assert.ok(
      jobs.some((job) => job.url === `https://www.linkedin.com/jobs/view/${JOB_ID}`),
      `expected canonical job, got ${JSON.stringify(jobs)}`,
    );
    assert.equal(jobs.filter((job) => String(job.url).includes('/comm/jobs/view/')).length, 0);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('a LinkedIn link with no query string is not added twice', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'gmail-linkedin-'));
  const tracking = `https://www.linkedin.com/comm/jobs/view/${JOB_ID}`;
  const sender = ['jobs-noreply', 'linkedin.example'].join('@');
  const body = `From: ${sender}\n\n${tracking}\n`;
  try {
    const jobs = await gmail.ingest({
      env: {
        GMAIL_CLIENT_ID: 'client.example',
        GMAIL_CLIENT_SECRET: 'secret.example',
        GMAIL_REFRESH_TOKEN: 'refresh.example',
      },
      settings: { label: 'Job Leads', days_back: 7 },
      dataRoot,
      dryRun: true,
      log() {},
      fetch: async (url) => {
        const target = String(url);
        if (new URL(target).hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'token.example' });
        if (target.includes('/messages?')) return jsonResponse({ messages: [{ id: 'm1' }] });
        if (target.includes('/messages/m1')) {
          return jsonResponse({
            payload: {
              headers: [
                { name: 'Subject', value: 'Jobs for you' },
                { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=linkedin.example' },
              ],
              mimeType: 'text/plain',
              body: { data: b64url(body) },
            },
          });
        }
        throw new Error(`unexpected url ${target}`);
      },
    });
    assert.deepEqual(jobs.map((job) => job.url), [`https://www.linkedin.com/jobs/view/${JOB_ID}`]);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
