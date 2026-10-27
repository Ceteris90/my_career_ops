// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/pipeline-report-states.mjs as CAREER_OPS_ROOT for a local
// server. Set PIPELINE_REPORT_STATES_TEST_URL and PIPELINE_REPORT_STATES_TEST_ROOT
// to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_REPORT_STATES_TEST_URL;
const root = process.env.PIPELINE_REPORT_STATES_TEST_ROOT;

test("Unreadable and missing reports keep the app shell and a way back", { skip: liveServerSkip("PIPELINE_REPORT_STATES_TEST_URL", "PIPELINE_REPORT_STATES_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sidebar = () => page.getByRole("complementary").getByRole("navigation");
  const main = () => page.getByRole("main");
  const back = () => main().getByRole("link", { name: /pipeline/i });

  await page.goto(`${origin.origin}/pipeline/12`);
  await main().getByRole("heading", { name: /#12\b/ }).waitFor({ timeout: 15_000 });
  assert.ok(await sidebar().isVisible(), "sidebar navigation stays on an unreadable report");
  assert.ok(await main().getByRole("button", { name: "Try again" }).isVisible(), "unreadable report offers Try again");
  assert.equal(await back().getAttribute("href"), "/pipeline", "unreadable report links back to the pipeline");
  await back().click();
  await main().getByRole("heading", { name: "Pipeline", level: 1 }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/pipeline", "back link reaches the pipeline list");

  await page.goto(`${origin.origin}/pipeline/999`);
  await main().getByRole("heading", { name: /#999\b/ }).waitFor({ timeout: 15_000 });
  assert.ok(await sidebar().isVisible(), "sidebar navigation stays on a missing report");
  assert.equal(await back().getAttribute("href"), "/pipeline", "missing report links back to the pipeline");

  await page.goto(`${origin.origin}/pipeline/11`);
  await main().getByRole("heading", { name: "Fixture States Co", exact: true }).waitFor({ timeout: 15_000 });
  assert.equal(await main().getByRole("button", { name: "Try again" }).count(), 0, "a readable report renders normally");
  assert.deepEqual(errors, []);
});
