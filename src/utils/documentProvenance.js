// src/utils/documentProvenance.js
//
// Captures provenance metadata at the moment a document is FIRST uploaded /
// opened. The user requested 2026-04-30 that the document row carry:
//   - first_opened_device       — mac / windows / linux / web / dev / mobile
//   - first_opened_user_tier    — free / pro / enterprise (snapshot at upload)
//   - first_opened_app_version  — e.g. "0.1.43" (read from package.json via Vite)
//
// The "who" (user_id) and "when" (created_at) are already columns on the
// documents table — this module fills the three NEW columns added by the
// 20260430000001_add_document_provenance migration.
//
// Detection is best-effort: missing values fall back to 'unknown' rather
// than null so analytics queries can grep cleanly.

const APP_VERSION = (() => {
  try {
    return (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) || 'unknown';
  } catch (_) {
    return 'unknown';
  }
})();

/**
 * Detect the device the user is currently on.
 * Returns one of: 'mac' | 'windows' | 'linux' | 'web' | 'dev' | 'mobile' | 'unknown'.
 *
 * Priority:
 *  1. Vite dev server (import.meta.env.DEV) → 'dev' so dev-time uploads are
 *     distinguishable from real production opens.
 *  2. Electron desktop (window.electronAPI exists) → mac / windows / linux
 *     based on navigator.platform.
 *  3. Mobile user-agent → 'mobile'.
 *  4. Fallback → 'web'.
 */
export function detectDevice() {
  if (typeof window === 'undefined') return 'unknown';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      return 'dev';
    }
    const isElectron =
      !!window.electronAPI ||
      (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || ''));
    if (isElectron) {
      const platform = (navigator?.platform || '').toLowerCase();
      if (platform.includes('mac')) return 'mac';
      if (platform.includes('win')) return 'windows';
      if (platform.includes('linux')) return 'linux';
      return 'unknown';
    }
    const ua = navigator?.userAgent || '';
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'mobile';
    return 'web';
  } catch (_) {
    return 'unknown';
  }
}

/**
 * Read the app version. Vite injects __APP_VERSION__ at build time via
 * vite.config.js define. Falls back to 'unknown' when the define is missing
 * (e.g. node --test).
 */
export function detectAppVersion() {
  return APP_VERSION;
}

/**
 * Snapshot a normalized tier label from whatever the auth context exposes.
 * The user_subscriptions table uses 'free' / 'pro' / 'enterprise' / 'developer'.
 * We normalize to lowercase and fall back to 'free'.
 */
export function detectUserTier(subscriptionTier) {
  if (!subscriptionTier || typeof subscriptionTier !== 'string') return 'free';
  return subscriptionTier.toLowerCase();
}

/**
 * Build the provenance payload to merge into a documents-table insert.
 *
 *   await supabase.from('documents').insert({
 *     ...documentData,
 *     ...buildDocumentProvenance({ subscriptionTier }),
 *   })
 *
 * Returns the three new columns. Caller still owns user_id + created_at.
 */
export function buildDocumentProvenance({ subscriptionTier } = {}) {
  return {
    first_opened_device: detectDevice(),
    first_opened_user_tier: detectUserTier(subscriptionTier),
    first_opened_app_version: detectAppVersion(),
  };
}
