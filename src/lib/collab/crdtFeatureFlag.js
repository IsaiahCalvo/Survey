// src/lib/collab/crdtFeatureFlag.js
// Phase 27 - CRDT layer kill switch.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Open Q#5 recommendation.
//
// Three-tier read order:
//   1. localStorage.getItem('CRDT_LAYER_DISABLED') === '1' -> CRDT off (per-tab dev/user escape hatch)
//   2. import.meta.env.VITE_CRDT_LAYER_DISABLED === '1'    -> CRDT off (build-time off-switch)
//   3. default                                              -> CRDT on
//
// Phase 33+ may graduate to a Supabase-row remote flag if telemetry warrants.

const LOCAL_STORAGE_KEY = 'CRDT_LAYER_DISABLED';
const ENV_VAR_NAME = 'VITE_CRDT_LAYER_DISABLED';

/**
 * Returns true if the CRDT layer should be active in the current environment.
 * @returns {boolean}
 */
export function isCRDTEnabled() {
  // Tier 1: per-tab override via localStorage. Highest priority.
  // SSR safe: typeof checks avoid ReferenceError outside the browser.
  // UX: developers / power users can toggle off in DevTools without rebuilding —
  // localStorage.setItem('CRDT_LAYER_DISABLED', '1') and reload. Reverting is
  // localStorage.removeItem('CRDT_LAYER_DISABLED').
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (window.localStorage.getItem(LOCAL_STORAGE_KEY) === '1') {
        return false;
      }
    }
  } catch {
    // localStorage may throw in private browsing on some platforms; fall through.
  }

  // Tier 2: build-time env var. Vite injects import.meta.env at build time.
  // Tests may inject via globalThis.__VITE_IMPORT_META_ENV__.
  // UX: ops can ship a "CRDT off" build for emergency rollback without a code change.
  const viteEnv = globalThis.__VITE_IMPORT_META_ENV__ ?? import.meta?.env;
  if (viteEnv?.[ENV_VAR_NAME] === '1') {
    return false;
  }

  // Tier 3: default ON.
  return true;
}
