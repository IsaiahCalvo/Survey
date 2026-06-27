// src/lib/calloutSharedStoreFlag.js
// Callout-unification keystone (Phase 5) kill switch — DEFAULT OFF.
//
// When ON, callouts live in the shared `annotationsByPage` store as Fabric objects
// tagged `data.type === 'callout'` (like counter), routed through the shared
// render/serialize/sync/delete paths. When OFF, the legacy `callouts[]` store is
// used unchanged. Mirrors snapshotFeatureFlag.js's three-tier read order so the
// keystone ships dark and is enabled per-tab (or per-build) only once proven via
// agent-cli/callout-e2e.mjs.
//   1. localStorage.getItem('CALLOUTS_SHARED_STORE') === '1' -> ON  (per-tab opt-in)
//   2. import.meta.env.VITE_CALLOUTS_SHARED_STORE === '1'    -> ON  (build-time opt-in)
//   3. default                                                -> OFF

const LOCAL_STORAGE_KEY = 'CALLOUTS_SHARED_STORE';
const ENV_VAR_NAME = 'VITE_CALLOUTS_SHARED_STORE';

/**
 * Returns true if callouts should flow through the shared annotationsByPage store.
 * @returns {boolean}
 */
export function calloutsInSharedStore() {
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
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.[ENV_VAR_NAME] === '1') {
      return true;
    }
  } catch {
    // ignore — import.meta may not exist in non-module/non-vite contexts
  }

  // Tier 3: default OFF until the keystone is proven end-to-end.
  return false;
}
