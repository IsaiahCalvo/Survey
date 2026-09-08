// src/lib/collab/ydocRegistry.js
// Phase 27 — Y.Doc registry. THIS IS THE ONE ALLOWED LOCATION FOR `new Y.Doc(`.
// The applyUpdateOnlyInvariant.test.mjs grep-asserts no other file constructs a Y.Doc.
// Defends Pitfalls 5 (verify-wipe), 20 (Y.Doc-per-session leak), 21 (destroy mid-tx).
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Pattern 1 + § Code Examples
import * as Y from 'yjs';

// HMR safety: Vite replays modules. Stash on globalThis so live Y.Doc instances survive HMR replay.
// Same pattern Tiptap and Liveblocks use for long-lived singletons.
// UX: prevents annotation work in flight from being silently dropped on hot reload during dev.
const REGISTRY = (globalThis.__ydocRegistry__ ??= new Map());

/**
 * Create a short-lived, caller-owned Y.Doc for isolated computation such as an
 * accepted-state shadow. It is deliberately not registered and must be
 * destroyed by the caller.
 */
export function createDetachedYDoc(guid) {
  return new Y.Doc({ guid, autoLoad: false });
}

/** Startup presence check only: no creation, ref acquisition or Yjs encoding. */
export function summarizeRegisteredYDoc(documentId) {
  if (typeof documentId !== 'string' || !documentId.trim()) throw new Error('documentId required');
  const entry = REGISTRY.get(documentId);
  if (!entry) return { state: 'absent', documentId };
  const doc = entry.doc;
  return {
    state: 'present', documentId,
    metadata: {
      guid: doc.guid, clientId: doc.clientID, createdAt: entry.createdAt,
      refCount: entry.refCount, rootCount: doc.share.size,
      hasPendingStructs: Boolean(doc.store.pendingStructs),
      hasPendingDeleteSet: Boolean(doc.store.pendingDs),
    },
  };
}

/** Read the exact old registry key without creating a doc or acquiring a ref. */
export function snapshotRegisteredYDoc(documentId) {
  if (!documentId || typeof documentId !== 'string') throw new Error('documentId required');
  const entry = REGISTRY.get(documentId);
  if (!entry) return { state: 'absent', documentId };
  const doc = entry.doc;
  // Yjs full-state encoding includes pending structs and pending delete sets.
  // Keep their raw v2 form too: recovery must not drop unresolved evidence.
  return {
    state: 'present', documentId, encoding: 'yjs-update-v1',
    update: new Uint8Array(Y.encodeStateAsUpdate(doc)),
    metadata: { guid: doc.guid, clientId: doc.clientID, createdAt: entry.createdAt,
      refCount: entry.refCount, rootNames: [...doc.share.keys()] },
    pending: {
      encoding: 'yjs-update-v2',
      structs: doc.store.pendingStructs ? new Uint8Array(doc.store.pendingStructs.update) : null,
      missing: doc.store.pendingStructs ? [...doc.store.pendingStructs.missing.entries()] : [],
      deleteSet: doc.store.pendingDs ? new Uint8Array(doc.store.pendingDs) : null,
    },
  };
}

/** Capture without acquiring a ref. The private baseline cannot be changed by
 * a caller editing the returned snapshot. A replacement doc never inherits it. */
export function captureRegisteredYDoc(documentId) {
  const entry = REGISTRY.get(documentId);
  const doc = entry?.doc;
  const snapshot = snapshotRegisteredYDoc(documentId);
  const baseline = snapshotRegisteredYDoc(documentId);
  const bytesEqual = (a, b) => a === null || b === null ? a === b
    : a.length === b.length && a.every((value, index) => value === b[index]);
  return Object.freeze({ snapshot, isCurrent: () => {
    try {
      if (REGISTRY.get(documentId) !== entry || entry?.doc !== doc || doc?.isDestroyed) return false;
      if (!entry) return true;
      const live = snapshotRegisteredYDoc(documentId);
      return live.metadata.guid === baseline.metadata.guid
        && live.metadata.clientId === baseline.metadata.clientId
        && live.metadata.createdAt === baseline.metadata.createdAt
        && JSON.stringify(live.metadata.rootNames) === JSON.stringify(baseline.metadata.rootNames)
        && bytesEqual(live.update, baseline.update)
        && bytesEqual(live.pending.structs, baseline.pending.structs)
        && bytesEqual(live.pending.deleteSet, baseline.pending.deleteSet)
        && JSON.stringify(live.pending.missing) === JSON.stringify(baseline.pending.missing);
    } catch { return false; }
  } });
}

/**
 * Get or create the Y.Doc for a given documentId.
 * Returns the SAME instance on subsequent calls — Y.Doc is long-lived, never destroyed on PDF switch.
 * @param {string} documentId
 * @returns {Y.Doc}
 */
export function getOrCreateYDoc(documentId) {
  if (!documentId || typeof documentId !== 'string') {
    throw new Error('[ydocRegistry] documentId required (string, non-empty)');
  }
  let entry = REGISTRY.get(documentId);
  if (!entry) {
    // applyUpdate-only invariant: this is the ONLY place `new Y.Doc(` may appear.
    // The applyUpdateOnlyInvariant.test.mjs grep-checks this.
    // autoLoad: false — we apply persisted state explicitly via Y.applyUpdate, never replace wholesale (Pitfall 5).
    const doc = new Y.Doc({ guid: documentId, autoLoad: false });
    entry = { doc, refCount: 0, createdAt: Date.now() };
    REGISTRY.set(documentId, entry);
  }
  entry.refCount += 1;
  return entry.doc;
}

/**
 * Decrement refCount. Does NOT destroy the Y.Doc (Pitfall 21 — destroy is permanent).
 * Destroy only happens on app close via a separate path that's not part of this plan.
 * UX: keeping the doc alive after release means re-opening a PDF mid-session preserves
 * undo history, observers, and any unsynced edits — no work is dropped on PDF switch.
 * @param {string} documentId
 */
export function releaseYDoc(documentId) {
  if (!documentId) return;
  const entry = REGISTRY.get(documentId);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  // Deliberately do NOT call entry.doc.destroy(). Destroy is permanent and only happens on app close.
}

/**
 * Hard-delete every registry entry whose key starts with `prefix`.
 * This is intentionally destructive and is only used after the backing
 * document has been deleted.
 */
export function purgeYDocsByPrefix(prefix) {
  if (!prefix || typeof prefix !== 'string') return 0;
  let removed = 0;
  for (const [key, entry] of REGISTRY) {
    if (!key.startsWith(prefix)) continue;
    clearRegisteredDoc(entry.doc);
    try { entry.doc.destroy(); } catch { /* already destroyed */ }
    REGISTRY.delete(key);
    removed += 1;
  }
  return removed;
}

function clearRegisteredDoc(doc) {
  try {
    doc.transact(() => {
      for (const type of doc.share.values()) {
        if (type instanceof Y.Map) {
          for (const key of [...type.keys()]) type.delete(key);
        } else if (type instanceof Y.Array || type instanceof Y.Text) {
          if (type.length > 0) type.delete(0, type.length);
        }
      }
    }, 'hard-delete');
  } catch { /* best effort before permanent invalidation */ }
}

/** Hard-delete one exact registry key without matching prefix siblings. */
export function purgeYDoc(key) {
  if (!key || typeof key !== 'string') return false;
  const entry = REGISTRY.get(key);
  if (!entry) return false;
  clearRegisteredDoc(entry.doc);
  try { entry.doc.destroy(); } catch { /* already destroyed */ }
  REGISTRY.delete(key);
  return true;
}

/**
 * TEST-ONLY: remove an entry from the registry without destroying the doc.
 * Used by tests/phase27/ydocRegistry.test.mjs to isolate test state.
 * Never call from production code.
 * @param {string} documentId
 */
export function _evictForTest(documentId) {
  REGISTRY.delete(documentId);
}

/**
 * TEST-ONLY: read refCount for a documentId without mutating the registry.
 * Used by tests/phase27/ydocRegistry.test.mjs to verify refCount tracking.
 * @param {string} documentId
 * @returns {number}
 */
export function _getRefCountForTest(documentId) {
  return REGISTRY.get(documentId)?.refCount ?? 0;
}
