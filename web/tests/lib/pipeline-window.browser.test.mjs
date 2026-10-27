// A long tracker must not mount every row. Set PIPELINE_WINDOW_TEST_URL and
// PIPELINE_WINDOW_TEST_ROOT, or run node tests/browser-suites.mjs pipeline-window.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.PIPELINE_WINDOW_TEST_URL;
const root = process.env.PIPELINE_WINDOW_TEST_ROOT;

test("the pipeline table mounts a window of a long tracker", { skip: liveServerSkip("PIPELINE_WINDOW_TEST_URL", "PIPELINE_WINDOW_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".tracker-window-fixture"), "utf8").trim(), "fictional-only");

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${origin.origin}/pipeline?tab=ALL&sort=tracker&dir=1`);
  await page.getByRole("link", { name: "#1", exact: true }).waitFor();
  const mounted = () => page.locator("[data-application-key]").count();
  const firstPaint = await mounted();
  assert.ok(firstPaint < 40, `first paint mounted ${firstPaint} rows`);
  assert.ok(firstPaint > 5, `first paint mounted ${firstPaint} rows`);
  await page.getByText("120 tracked").waitFor();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("link", { name: "#120", exact: true }).waitFor();
  const scrolled = await mounted();
  assert.ok(scrolled < 40, `scrolled paint mounted ${scrolled} rows`);
  assert.equal(await page.getByRole("link", { name: "#1", exact: true }).count(), 0);
  await page.getByPlaceholder("Search company or role…").fill("Zulu");
  await page.getByRole("link", { name: "Fixture Zulu", exact: true }).waitFor();
  assert.equal(await mounted(), 1);
  assert.deepEqual(errors, []);
});
