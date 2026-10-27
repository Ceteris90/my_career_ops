// Explore matches an offer to the inbox by URL and to the tracker by company
// and role. The page was sending the rest of both records, including tracker
// notes, on every visit.
//
// Run: npm test -- tests/lib/explore-snapshot.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exploreSnapshot } from "../../src/lib/explore-snapshot.mjs";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/app/explore/page.tsx"), "utf8");

test("the explore page builds its snapshot with exploreSnapshot()", () => {
  assert.match(page, /exploreSnapshot\s*\(/);
  assert.doesNotMatch(page, /inboxSnapshot=\{readInbox\(\)/);
});

test("the snapshot keeps match fields and drops tracker notes and inbox pay", () => {
  const snap = exploreSnapshot(
    [{ url: "https://jobs.example/a", company: "Acme", role: "Engineer", done: false, location: "Remote", compensation: "secret-pay" }],
    [{ n: "1", company: "Acme", role: "Engineer", notes: "secret-note-token", score: "4.2/5", status: "Applied" }],
  );
  assert.deepEqual(snap.inboxUrls, ["https://jobs.example/a"]);
  assert.deepEqual(snap.evaluated, [{ n: "1", company: "Acme", role: "Engineer" }]);
  assert.doesNotMatch(JSON.stringify(snap), /secret-note-token|secret-pay/);
});
