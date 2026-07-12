// src/lib/collab/snapshotFeatureFlag.js
// Phase 32 — Y.Doc snapshot fast-open kill switch (additive to the CRDT layer).
//
// Mirrors crdtFeatureFlag.js's three-tier read order, but DEFAULT OFF so the
// snapshot writer/reader ship dark and are enabled per-tab (or per-build) only
// once proven:
//   1. localStorage.getItem('YDOC_SNAPSHOT_ENABLED') === '1' -> ON  (per-tab opt-in)
//   2. import.meta.env.VITE_YDOC_SNAPSHOT_ENABLED === '1'    -> ON  (build-time opt-in)
//   3. default                                                -> OFF
//
// Separate from isCRDTEnabled() on purpose: the snapshot path is additive and
// must be independently toggleable. It is meaningless when CRDT is off (no live
// Y.Doc to encode), so callers gate on BOTH isCRDTEnabled() && isSnapshotEnabled().

const LOCAL_STORAGE_KEY = 'YDOC_SNAPSHOT_ENABLED';
const ENV_VAR_NAME = 'VITE_YDOC_SNAPSHOT_ENABLED';

/**
 * Returns true if the Y.Doc snapshot fast-open path should be active.
 * @returns {boolean}
 */
export function isSnapshotEnabled() {
  // Tier 1: per-tab override via localStorage. Highest priority.
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (window.localStorage.getItem(LOCAL_STORAGE_KEY) === '1') {
        return true;
      }
    }
  } catch {
    // localStorage may throw in private browsing on some platforms; fall through.
  }

  // Tier 2: build-time env var (Vite injects import.meta.env at build time).
  // Tests may inject via globalThis.__VITE_IMPORT_META_ENV__.
  const viteEnv = globalThis.__VITE_IMPORT_META_ENV__ ?? import.meta?.env;
  if (viteEnv?.[ENV_VAR_NAME] === '1') {
    return true;
  }

  // Tier 3: default.
  // TEMP (Phase 32 verification): defaulted ON so a plain reload activates the
  // corrected row-sourced writer + snapshot-first reader without a dev-server
  // restart. REVERT to `return false` before any real release.
  return true;
}
