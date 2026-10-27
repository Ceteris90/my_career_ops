// node tests/fixtures/tracker-window.mjs prints a fresh disposable data root
// with a long fictional tracker, for pipeline-window.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tracker-window-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".tracker-window-fixture"), "fictional-only\n");

const lines = [
  "# Fictional browser fixture",
  "",
  "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
  "|---|------|---------|------|-------|--------|-----|--------|-------|",
];
for (let n = 1; n <= 120; n++) {
  const company = n === 120 ? "Fixture Zulu" : `Fixture Co ${String(n).padStart(3, "0")}`;
  lines.push(`| ${n} | 2026-04-01 | ${company} | Platform Engineer | 4.0/5 | Evaluated | — | — | Fictional fixture only |`);
}
fs.writeFileSync(path.join(root, "data/applications.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
