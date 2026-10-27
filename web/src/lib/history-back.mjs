/**
 * Whether following `href` from `currentHref` would land exactly on the
 * previous history entry, so going back restores it (scroll, router cache)
 * instead of pushing a fresh copy.
 * @param {string} href
 * @param {string} currentHref
 * @param {string | null | undefined} previousHref
 * @returns {boolean}
 */
export function returnsToPrevious(href, currentHref, previousHref) {
  if (!previousHref) return false;
  const current = new URL(currentHref);
  const target = new URL(href, current);
  const previous = new URL(previousHref);
  if (previous.origin !== current.origin || target.origin !== current.origin) return false;
  if (previous.pathname !== target.pathname) return false;
  target.searchParams.sort();
  previous.searchParams.sort();
  return target.searchParams.toString() === previous.searchParams.toString();
}
