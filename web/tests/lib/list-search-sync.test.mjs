// Typed list search stays on the page, so a reload or the browser Back button
// used to drop it. The list URL has to catch up, and an older in-flight write
// must not replace a newer query or a Back navigation.
//
// Run: node --test tests/lib/list-search-sync.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSearchWrite, queryWithLiveSearch } from "../../src/lib/list-search-sync.mjs";

test("a typed search is written, and a landed write does not clobber newer typing", () => {
  assert.deepEqual(
    nextSearchWrite({ local: "Quill", url: "", pending: null, urlChanged: false }),
    { adopt: false, clearPending: false, write: "Quill" },
  );
  assert.deepEqual(
    nextSearchWrite({ local: "Quill", url: "Quill", pending: "Quill", urlChanged: true }),
    { adopt: false, clearPending: true, write: null },
  );
  assert.deepEqual(
    nextSearchWrite({ local: "Quillfeather", url: "Quill", pending: "Quill", urlChanged: true }),
    { adopt: false, clearPending: true, write: "Quillfeather" },
  );
  assert.deepEqual(
    nextSearchWrite({ local: "Quillfeather", url: "Quill", pending: "Quillfeather", urlChanged: true }),
    { adopt: false, clearPending: false, write: null },
  );
});

test("browser Back to a URL without the search replaces the local query", () => {
  assert.deepEqual(
    nextSearchWrite({ local: "Quill", url: "", pending: null, urlChanged: true }),
    { adopt: true, clearPending: true, write: null },
  );
});

test("a later render still writes a search that never reached the URL", () => {
  assert.deepEqual(
    nextSearchWrite({ local: "Quill", url: "", pending: null, urlChanged: false }),
    { adopt: false, clearPending: false, write: "Quill" },
  );
  assert.deepEqual(
    nextSearchWrite({ local: "Quill", url: "", pending: "Quill", urlChanged: false }),
    { adopt: false, clearPending: false, write: null },
  );
});

test("tab changes keep the search the reader has typed", () => {
  assert.equal(queryWithLiveSearch("tab=ALL", { tab: "SKIP" }, "Quill"), "tab=SKIP&q=Quill");
  assert.equal(queryWithLiveSearch("tab=ALL&q=Quill", { sort: "company" }, ""), "tab=ALL&sort=company");
  assert.equal(queryWithLiveSearch("tab=ALL&q=Quill", { q: "Other" }, "Quill"), "tab=ALL&q=Other");
});
