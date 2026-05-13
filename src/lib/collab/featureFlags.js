// src/lib/collab/featureFlags.js
//
// Phase 31 - cutover-era feature flags.
//
// LEGACY_BULK_UPSERT_ENABLED is retained as a historical/diagnostic flag.
// As of 2026-05-10, normal annotation persistence does NOT use this flag to
// skip Supabase writes: Supabase is durable reload/cross-device truth, and
// Y.Doc mirrors that state for live collaboration.
//
// Pattern reference: src/lib/collab/crdtFeatureFlag.js (Phase 27 Plan 27-04
// kill switch). Three-tier read order (localStorage > env > default) and
// SSR-safe typeof guards mirror that file verbatim.
//
// Source: .planning/phases/31-migration-cutover-seal/31-CONTEXT.md
//   "Files in Scope" bullet 7 (LEGACY_BULK_UPSERT_ENABLED feature flag
//   with localStorage override for emergency rollback).

// localStorage key (per-tab override; matches CONTEXT.md spelling exactly).
const LOCAL_STORAGE_KEY = 'pdf_app_legacy_bulk_upsert';
// Build-time env var (Vite injects via import.meta.env). Optional - ops can
// ship a "legacy on" build for emergency rollback without redeploy of the
// JS bundle.
const ENV_VAR_NAME = 'VITE_LEGACY_BULK_UPSERT_ENABLED';

/**
 * isLegacyBulkUpsertEnabled - reader for the LEGACY_BULK_UPSERT_ENABLED flag.
 *
 * Returns true if the old Phase 31 rollback flag is enabled.
 * Default false. Override via:
 *   - localStorage.setItem('pdf_app_legacy_bulk_upsert', 'true')  [per-tab]
 *   - VITE_LEGACY_BULK_UPSERT_ENABLED='true' at build time         [build-wide]
 *
 * SSR-safe: typeof checks dodge ReferenceError outside the browser.
 * Private-browse safe: localStorage access wrapped in try/catch.
 *
 * @returns {boolean}
 */
export function isLegacyBulkUpsertEnabled() {
  // Tier 1 (highest priority): per-tab localStorage override. Developers /
  // power users / a panicking user can flip this in DevTools without a
  // rebuild. UX: a single line - `localStorage.setItem('pdf_app_legacy_bulk_upsert', 'true')`
  // followed by reload re-engages the legacy path. Reverting is removeItem.
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (window.localStorage.getItem(LOCAL_STORAGE_KEY) === 'true') {
        return true;
      }
    }
  } catch {
    // localStorage may throw in private-browse on some platforms; fall through.
  }

  // Tier 2: build-time env var (Vite). Same shape as crdtFeatureFlag.js.
  // UX: ops can ship a "legacy on" build without a code change.
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.[ENV_VAR_NAME] === 'true') {
      return true;
    }
  } catch {
    // ignore - import.meta may not exist in non-module/non-Vite contexts
  }

  // Tier 3: default OFF. Post-cutover, the CRDT path owns the cloud round-trip.
  return false;
}
