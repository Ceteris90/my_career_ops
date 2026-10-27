// Optional browser regression: use the disposable fixture created by
// node tests/fixtures/report-print.mjs as CAREER_OPS_ROOT for a local server.
// Set REPORT_PRINT_TEST_URL and REPORT_PRINT_TEST_ROOT to run this suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.REPORT_PRINT_TEST_URL;
const root = process.env.REPORT_PRINT_TEST_ROOT;

function luminance(color) {
  const match = color.match(/^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
  assert.ok(match, `body text color is an rgb() value: ${color}`);
  const [r, g, b] = match.slice(1, 4).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("A printed report shows its content without app chrome in either theme", { skip: liveServerSkip("REPORT_PRINT_TEST_URL", "REPORT_PRINT_TEST_ROOT"), timeout: 120_000 }, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const relative = path.relative(os.tmpdir(), fs.realpathSync(root));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".inline-status-fixture"), "utf8").trim(), "fictional-only");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 816, height: 1056 } });
    await context.addInitScript((value) => localStorage.setItem("career-ops:theme", value), theme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin.origin}/pipeline/21`);
    await page.getByRole("heading", { name: "Fixture Print Co", level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark", `${theme} theme applied`);
    await page.emulateMedia({ media: "print" });

    const asides = page.locator("aside");
    for (let i = 0; i < await asides.count(); i++) {
      assert.equal(await asides.nth(i).isVisible(), false, `${theme}: sidebar does not print`);
    }

    const controls = page.locator("main button, main select");
    const shown = [];
    for (let i = 0; i < await controls.count(); i++) {
      if (await controls.nth(i).isVisible()) shown.push((await controls.nth(i).innerText()).trim() || "(unlabeled)");
    }
    assert.deepEqual(shown, [], `${theme}: no buttons or selects print`);

    const backLinks = page.locator("main a[href^='/pipeline']", { hasText: "Pipeline" });
    assert.ok(await backLinks.count() > 0, `${theme}: Pipeline back link is rendered`);
    assert.equal(await backLinks.first().isVisible(), false, `${theme}: Pipeline back link does not print`);

    const sections = await page.locator("main details").evaluateAll((all) =>
      all
        .filter((d) => d.getClientRects().length > 0)
        .map((d) => ({
          summary: d.querySelector("summary")?.innerText.trim() ?? "",
          details: d.clientHeight,
          own: d.querySelector("summary")?.offsetHeight ?? 0,
        })),
    );
    assert.ok(sections.length >= 4, `${theme}: at least four collapsible sections print (saw ${sections.length})`);
    for (const s of sections) {
      assert.ok(s.details > s.own + 1, `${theme}: "${s.summary}" prints its content, not only its summary`);
    }

    const clipped = await page.locator("main .report-prose table").evaluateAll((tables) =>
      tables.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().width > el.parentElement.clientWidth + 1).length,
    );
    assert.equal(clipped, 0, `${theme}: no report table is cut off on paper`);

    const color = await page.locator("main .report-prose p").first().evaluate((el) => getComputedStyle(el).color);
    assert.ok(luminance(color) < 0.3, `${theme}: body text prints dark on white paper (color ${color})`);

    if (theme === "dark") {
      const pdf = await page.pdf({ format: "Letter" });
      assert.ok(pdf.length > 1000, "the report renders to a PDF");
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});
