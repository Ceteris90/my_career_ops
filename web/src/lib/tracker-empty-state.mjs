/**
 * What an empty tracker table should tell the user, from the filters that
 * emptied it. Plain .mjs so `node:test` can assert it without the view.
 *
 * @typedef {{ kind: "empty-tab" } | { kind: "elsewhere", count: number } | { kind: "no-match" } | { kind: "below-min" }} TrackerEmptyState
 */

/**
 * @param {{ tabLabel: string | null, query: string, minScore: number | null, matchesInAll: number }} facts
 *   `tabLabel` is null on All. `matchesInAll` counts rows passing the same
 *   search and score filter with no tab restriction.
 * @returns {TrackerEmptyState}
 */
export function trackerEmptyState({ tabLabel, query, minScore, matchesInAll }) {
  if (query) {
    return tabLabel != null && matchesInAll > 0 ? { kind: "elsewhere", count: matchesInAll } : { kind: "no-match" };
  }
  return minScore != null ? { kind: "below-min" } : { kind: "empty-tab" };
}
