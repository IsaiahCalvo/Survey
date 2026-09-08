function encodeScopePart(name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`[legacyYDocScope] ${name} must be a nonempty string`);
  }
  return encodeURIComponent(value);
}

/** Exact-document boundary for explicit hard deletion across all local actors. */
export function getLegacyYDocDocumentPrefix(documentId) {
  return `legacy-yjs:v1:${encodeScopePart('documentId', documentId)}:`;
}

/** The same exact actor/document key owns registry, persistence and local sync. */
export function getLegacyYDocScopeKey(documentId, actorUserId) {
  return `${getLegacyYDocDocumentPrefix(documentId)}${encodeScopePart('actorUserId', actorUserId)}`;
}
