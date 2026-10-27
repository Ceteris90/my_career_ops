// List search is typed locally so the table does not wait on a navigation.
// The URL still has to catch up: a reload and the browser Back button read
// the list entry, and that entry never used to contain `q`.

export const LIST_SEARCH_DEBOUNCE_MS = 300;

/**
 * Decide how a local search and the URL `q` stay in step.
 *
 * `pending` is the value this tab already asked the router to write, or null.
 * An outside URL change while nothing is in flight (Back, a shared link)
 * wins. A local edit is written. When that write lands, drop `pending` and
 * write again only if the reader typed something newer. A URL that arrives
 * while a newer write is in flight is ignored so the older one cannot wipe it.
 *
 * @param {{ local: string, url: string, pending: string | null, urlChanged: boolean }} state
 * @returns {{ adopt: boolean, clearPending: boolean, write: string | null }}
 */
export function nextSearchWrite({ local, url, pending, urlChanged }) {
  if (urlChanged && pending != null && url === pending) {
    if (local === url) return { adopt: false, clearPending: true, write: null };
    return { adopt: false, clearPending: true, write: local };
  }
  if (urlChanged && pending != null) {
    return { adopt: false, clearPending: false, write: null };
  }
  if (urlChanged && url !== local) {
    return { adopt: true, clearPending: true, write: null };
  }
  if (local !== url && pending !== local) {
    return { adopt: false, clearPending: false, write: local };
  }
  if (pending != null && url === pending && local === url) {
    return { adopt: false, clearPending: true, write: null };
  }
  return { adopt: false, clearPending: false, write: null };
}

/**
 * Copy of the current query plus `updates`, with the typed search filled in
 * when the caller did not set `q` itself. An empty live search removes `q`.
 *
 * @param {string} current
 * @param {Record<string, string | number | null | undefined>} updates
 * @param {string} live
 * @returns {string}
 */
export function queryWithLiveSearch(current, updates, live) {
  const sp = new URLSearchParams(current);
  const patch = { ...updates };
  if (!Object.prototype.hasOwnProperty.call(updates, "q")) {
    patch.q = live ? live : null;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") sp.delete(key);
    else sp.set(key, String(value));
  }
  return sp.toString();
}
