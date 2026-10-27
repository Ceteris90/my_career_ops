/**
 * What Today shows first, once the install is past the empty CV screen.
 * Tracked applications or inbox rows mean the day's work is the page.
 * Setup stays first only when there is nothing to act on yet.
 *
 * @param {boolean} hasWork
 * @returns {"queue" | "setup"}
 */
export function homeLead(hasWork) {
  return hasWork ? "queue" : "setup";
}
