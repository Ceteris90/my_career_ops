// Search stats enriches every tracker row with its report's archetype. Each
// report lookup must not re-read the tracker or re-list reports/, or the page
// grows with the square of the tracker (600 rows took 0.8 s, 1200 took 2.9 s).
//
// Run: npm test -- tests/lib/analytics-report-lookup-once.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "../helpers/web-ts-alias-loader.mjs";

const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const careerOps = skipTs ? {} : await import("@/lib/career-ops");
const analytics = skipTs ? {} : await import("@/lib/analytics-data");

const ROWS = 40;
const report = (archetype) => `# Evaluation\n\n## Machine Summary\n\n\`\`\`yaml\narchetype_primary: ${archetype}\n\`\`\`\n`;

function seed(root) {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  const rows = [];
  for (let n = 1; n <= ROWS; n++) {
    const file = `${String(n).padStart(3, "0")}-northwind-labs-2026-10-01.md`;
    writeFileSync(join(root, "reports", file), report(`Archetype ${n}`));
    const link = n % 2 ? `[${n}](../reports/${file})` : "—";
    rows.push(`| ${n} | 2026-10-01 | Northwind Labs | Engineer ${n} | 4.0/5 | Applied | ❌ | ${link} | remote |`);
  }
  writeFileSync(join(root, "reports", "002-RESERVED.md"), "");
  writeFileSync(join(root, "data", "applications.md"), [
    "# Applications Tracker", "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows, "",
  ].join("\n"));
}

test("Search stats reads the tracker and lists reports/ once for the whole page", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-analytics-lookup-once-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const { readFileSync, readdirSync } = fs;
  const reads = [];
  const listings = [];
  try {
    seed(root);
    process.env.CAREER_OPS_ROOT = root;
    fs.readFileSync = function (p, ...rest) {
      reads.push(String(p));
      return readFileSync.call(this, p, ...rest);
    };
    fs.readdirSync = function (p, ...rest) {
      listings.push(String(p));
      return readdirSync.call(this, p, ...rest);
    };

    const rows = analytics.analyticsApplications(careerOps.readApplications());

    assert.deepEqual(
      rows.map((r) => r.archetype),
      Array.from({ length: ROWS }, (_, i) => `Archetype ${i + 1}`),
      "every row, linked or found by number, gets its own report's archetype",
    );
    assert.equal(reads.filter((p) => p.endsWith("applications.md")).length, 1, "the tracker was read more than once");
    assert.ok(listings.filter((p) => p.endsWith("reports")).length <= 1, "reports/ was listed more than once");
  } finally {
    fs.readFileSync = readFileSync;
    fs.readdirSync = readdirSync;
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});
