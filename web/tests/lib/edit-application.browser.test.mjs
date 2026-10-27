// Uses the fictional pipeline-status fixture through tests/browser-suites.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { liveServerSkip } from '../helpers/live-server.mjs';

test('edit company and role from application details (disposable data only)', {
  skip: liveServerSkip('EDIT_APPLICATION_TEST_URL', 'EDIT_APPLICATION_TEST_ROOT'), timeout: 120_000,
}, async (t) => {
  const origin = new URL(process.env.EDIT_APPLICATION_TEST_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname));
  const root = fs.realpathSync(process.env.EDIT_APPLICATION_TEST_ROOT);
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, '.inline-status-fixture'), 'utf8').trim(), 'fictional-only');
  const tracker = path.join(root, 'data/applications.md');
  const report = path.join(root, 'reports/011-fixture-alpha.md');
  const initial = fs.readFileSync(tracker, 'utf8');
  const archivedReport = fs.readFileSync(report, 'utf8');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const edit = () => page.getByRole('button', { name: 'Edit company / role', exact: true });
  const company = () => page.getByLabel('Company', { exact: true });
  const role = () => page.getByLabel('Role', { exact: true });
  const save = () => page.getByRole('button', { name: 'Save changes', exact: true });
  let posts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/tracker/edit') && request.method() === 'POST') posts++; });
  async function confirmHeading(name) {
    await page.getByRole('heading', { name, exact: true }).waitFor();
  }
  await page.goto(`${origin.origin}/pipeline/11?tab=ALL`);
  await edit().click();
  assert.equal(await company().inputValue(), 'Fixture Alpha');
  assert.equal(await role().inputValue(), 'Engineer');
  await company().fill('Discard this draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await company().count(), 0);
  assert.equal(posts, 0);
  assert.equal(fs.readFileSync(tracker, 'utf8'), initial);
  await edit().click();
  await role().press('Escape');
  assert.equal(await company().count(), 0);
  assert.equal(await edit().evaluate(element => element === document.activeElement), true);

  // A failed POST leaves the draft available and can be retried.
  await edit().click();
  await company().fill('Fixture Updated');
  await page.route('**/api/tracker/edit', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture tracker busy' }) }));
  await save().click();
  await page.locator('form').getByRole('alert').waitFor();
  assert.match(await page.locator('form').getByRole('alert').innerText(), /Fixture tracker busy/);
  assert.equal(await company().inputValue(), 'Fixture Updated');
  assert.equal(fs.readFileSync(tracker, 'utf8'), initial);
  await page.unroute('**/api/tracker/edit');
  await save().click();
  await confirmHeading('Fixture Updated');
  assert.equal(fs.readFileSync(tracker, 'utf8'), initial.replace('| Fixture Alpha | Engineer |', '| Fixture Updated | Engineer |'));

  // A role-only edit also persists, including in the Pipeline list after reload.
  await edit().click();
  await role().fill('AI Engineer');
  await save().click();
  await page.getByText('AI Engineer', { exact: true }).waitFor();
  await page.goto(`${origin.origin}/pipeline?tab=ALL`);
  await page.getByRole('link', { name: 'Fixture Updated', exact: true }).waitFor();
  await page.getByRole('link', { name: 'AI Engineer', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('link', { name: 'Fixture Updated', exact: true }).click();
  await edit().click();
  assert.equal(await role().inputValue(), 'AI Engineer');

  // Invalid and stale requests cannot corrupt the markdown or overwrite a later edit.
  const request = { n: '11', company: 'Overwrite', role: 'Old role', expectedCompany: 'Fixture Alpha', expectedRole: 'Engineer' };
  assert.equal((await page.request.post(`${origin.origin}/api/tracker/edit`, { data: request })).status(), 409);
  assert.equal((await page.request.post(`${origin.origin}/api/tracker/edit`, { data: { ...request, company: 'bad|cell' } })).status(), 400);
  assert.equal((await page.request.post(`${origin.origin}/api/tracker/edit`, { data: { ...request, n: ['11'] } })).status(), 400);
  assert.equal(fs.readFileSync(tracker, 'utf8'), initial.replace('| Fixture Alpha | Engineer |', '| Fixture Updated | AI Engineer |'));
  assert.equal(fs.readFileSync(report, 'utf8'), archivedReport);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await company().isVisible(), true);
  assert.equal(await save().isVisible(), true);
  assert.deepEqual(errors, []);
});
