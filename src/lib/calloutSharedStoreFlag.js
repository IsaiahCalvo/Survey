// src/lib/calloutSharedStoreFlag.js
// Callout-unification keystone (Phase 5) feature flag.
//
// FLIPPED ON 2026-06-29 (default ON) after the R2.1 Supabase-sole-writer keystone
// passed the adversarial gate (3 independent passes: correctness + RLS + code review;
// live RLS-enforced cloud-write proof + lossless backfill of all 11 prod rows).
// Callouts now live in the shared `annotationsByPage` store as Fabric objects
// tagged `data.type === 'callout'` (like counter) and persist via the shared push
// (Supabase `.fabricObject` 'callout' rows). The legacy `callouts[]` store is still
// the in-memory working copy (dual-rep) until the post-flip R2.2 derive-model lands.
//
// Read order (explicit overrides win; otherwise default ON):
//   1. localStorage.getItem('CALLOUTS_SHARED_STORE') === '0' -> OFF  (per-tab KILL SWITCH)
//      localStorage.getItem('CALLOUTS_SHARED_STORE') === '1' -> ON   (per-tab force-on)
//   2. import.meta.env.VITE_CALLOUTS_SHARED_STORE === '0'    -> OFF  (build-time kill)
//      import.meta.env.VITE_CALLOUTS_SHARED_STORE === '1'    -> ON   (build-time force-on)
//   3. default                                                -> ON
//
// Node unit tests that assert the pre-flip (flag-OFF) behavior must opt out
// explicitly — stub `window.localStorage.getItem` to return '0', or pass through
// a context where the kill switch is set. There is no implicit node/browser split.

const LOCAL_STORAGE_KEY = 'CALLOUTS_SHARED_STORE';
const ENV_VAR_NAME = 'VITE_CALLOUTS_SHARED_STORE';

/**
 * Returns true if callouts should flow through the shared annotationsByPage store.
 * Default ON (flipped 2026-06-29). Set the override to '0' to kill-switch OFF.
 * @returns {boolean}
 */
export function calloutsInSharedStore() {
  // Tier 1: per-tab override via localStorage. Highest priority. '0' kills, '1' forces.
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const v = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (v === '0') return false;
      if (v === '1') return true;
    }
  } catch {
    // localStorage may throw in private browsing on some platforms; fall through.
  }

  // Tier 2: build-time env var (Vite injects import.meta.env at build time).
  try {
    const env = typeof import.meta !== 'undefined' ? import.meta?.env?.[ENV_VAR_NAME] : undefined;
    if (env === '0') return false;
    if (env === '1') return true;
  } catch {
    // ignore — import.meta may not exist in non-module/non-vite contexts
  }

  // Tier 3: DEFAULT ON (keystone flipped 2026-06-29).
  return true;
}
