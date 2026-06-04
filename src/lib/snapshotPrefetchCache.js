// src/lib/snapshotPrefetchCache.js
// LEVER A (fast open) — overlap the ~1.2s per-page snapshot download with the
// ~1.5s viewer init.
//
// Today the row-sourced snapshot read (readByPageSnapshot) does not fire until
// the cloud-sync hook mounts and its hydrate effect runs — ~1.7s after the user
// clicks a document — so the download is serialized AFTER the viewer init. This
// module lets the dashboard kick that single read off at document-SELECT time
// (the click, before the viewer mounts) so the network round-trip runs IN
// PARALLEL with viewer init. The hydrate effect then consumes the already-warm
// promise instead of starting a fresh read.
//
// Design invariants:
//   - ONE-SHOT per documentId. prefetchSnapshot is idempotent (a second call for
//     an in-flight docId returns the same promise, it does not re-issue).
//   - Consumed EXACTLY ONCE. consumePrefetch removes the entry, so the cache can
//     never serve a stale snapshot on a later open or a deliberate refetch — those
//     paths fall through to a fresh network read (the refetch-bypass-caches
//     invariant is preserved: this cache only ever short-circuits the FIRST
//     hydrate read immediately following the select that warmed it).
//   - FAIL-OPEN. If nothing was prefetched (or the prefetch is mid-flight when the
//     hydrate read needs it), the caller reads fresh; a rejected prefetch promise
//     is swallowed here so the consumer can fall back without an unhandled
//     rejection.

const pending = new Map(); // documentId -> Promise<snapshot|null>

/**
 * Kick off the per-document snapshot read at select time and stash the promise.
 * Idempotent: a repeat call for an in-flight documentId returns the existing
 * promise rather than issuing a second read.
 *
 * @param {string} documentId
 * @param {(documentId: string) => Promise<any>} readFn  the real network read
 *        (readByPageSnapshot bound to a supabase client) — injected so this module
 *        stays dependency-free and testable.
 * @returns {Promise<any>|null} the prefetch promise, or null when inputs are missing.
 */
export function prefetchSnapshot(documentId, readFn) {
  if (!documentId || typeof readFn !== 'function') return null;
  if (pending.has(documentId)) return pending.get(documentId);
  let p;
  try {
    p = Promise.resolve(readFn(documentId));
  } catch (err) {
    // Synchronous throw from readFn — fail open, do not cache.
    return null;
  }
  // Swallow rejection so a failed prefetch never surfaces as an unhandled
  // rejection; the consumer falls back to a fresh read on null.
  const guarded = p.catch(() => null);
  pending.set(documentId, guarded);
  return guarded;
}

/**
 * Consume (and remove) the prefetched promise for a document. Returns the promise
 * if one was warmed for this documentId, else null. Removing on read guarantees
 * the prefetch is used at most once.
 *
 * @param {string} documentId
 * @returns {Promise<any>|null}
 */
export function consumePrefetch(documentId) {
  if (!documentId || !pending.has(documentId)) return null;
  const p = pending.get(documentId);
  pending.delete(documentId);
  return p;
}

/** Test/teardown helper — drop all warmed prefetches. */
export function __clearSnapshotPrefetchCache() {
  pending.clear();
}
