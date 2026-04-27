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
