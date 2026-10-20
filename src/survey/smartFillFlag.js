// src/survey/smartFillFlag.js
// Owner 2026-10-20: Smart fill ships as a BETA, off by default.
//
// Read order (same shape as src/lib/collab/crdtFeatureFlag.js):
//   1. localStorage 'SMART_FILL_BETA' === '1' -> on   ('0' -> off) per browser
//   2. import.meta.env.VITE_ENABLE_SMART_FILL === '1' -> on (build-wide)
//   3. default -> off
//
// UX: while off, the Survey Marker group shows only Rectangle and Freehand,
// exactly as before. Turn it on for a tester with
// localStorage.setItem('SMART_FILL_BETA', '1') and reload.

export const SMART_FILL_BETA_STORAGE_KEY = 'SMART_FILL_BETA';

export function isSmartFillBetaEnabled() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const local = window.localStorage.getItem(SMART_FILL_BETA_STORAGE_KEY);
      if (local === '1') return true;
      if (local === '0') return false;
    }
  } catch {
    // Private browsing can throw; fall through.
  }
  try {
    return import.meta.env?.VITE_ENABLE_SMART_FILL === '1';
  } catch {
    return false;
  }
}
