// The Explore page used to ship every inbox posting and every tracker column.
// This is that payload, on purpose, until the page sends only what matching needs.

export function exploreSnapshot(inbox, applications) {
  return { inboxUrls: inbox, evaluated: applications };
}
