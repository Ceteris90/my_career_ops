import assert from "node:assert/strict";
import { test } from "node:test";
import { trackerEmptyState } from "../../src/lib/tracker-empty-state.mjs";

test("a status tab with no search and no score filter is simply empty", () => {
  assert.deepEqual(trackerEmptyState({ tabLabel: "Assessment", query: "", minScore: null, matchesInAll: 420 }), { kind: "empty-tab" });
  assert.deepEqual(trackerEmptyState({ tabLabel: null, query: "", minScore: null, matchesInAll: 0 }), { kind: "empty-tab" });
});

test("a search with matches under All points there with the count", () => {
  assert.deepEqual(trackerEmptyState({ tabLabel: "Offer", query: "northwind", minScore: null, matchesInAll: 21 }), { kind: "elsewhere", count: 21 });
  assert.deepEqual(trackerEmptyState({ tabLabel: "Offer", query: "northwind", minScore: 4, matchesInAll: 3 }), { kind: "elsewhere", count: 3 });
});

test("a search that matches nothing anywhere says so", () => {
  assert.deepEqual(trackerEmptyState({ tabLabel: "Offer", query: "zzz", minScore: null, matchesInAll: 0 }), { kind: "no-match" });
  assert.deepEqual(trackerEmptyState({ tabLabel: null, query: "zzz", minScore: null, matchesInAll: 0 }), { kind: "no-match" });
  assert.deepEqual(trackerEmptyState({ tabLabel: "Offer", query: "zzz", minScore: 4.5, matchesInAll: 0 }), { kind: "no-match" });
});

test("a score filter that empties the tab without a search names the filter", () => {
  assert.deepEqual(trackerEmptyState({ tabLabel: null, query: "", minScore: 4.9, matchesInAll: 0 }), { kind: "below-min" });
  assert.deepEqual(trackerEmptyState({ tabLabel: "Applied", query: "", minScore: 4, matchesInAll: 2 }), { kind: "below-min" });
});
