// The one-time code that finishes a Google or Microsoft sign-in for the live
// sheet (supabase/functions/_shared/sheetSync/service.js, claimSignIn). The
// server links the sign-in only when the Survey account that pressed Connect
// sends this code back, so a consent link someone forwards links nothing.
//
// It reaches the app three ways, all without typing:
//   * web: the consent tab's last page (public/google-connected.html) is on the
//     same site and leaves the code in localStorage;
//   * desktop: the consent window is the app's own, and the main process reads
//     the code off its last page (src/electron/sheetSyncConsent.cjs);
//   * phone: the last page's "Open Survey" button opens the app through its
//     link scheme (src/mobile/nativeDeepLinks.js).
// Each one leaves the code here; the connect loop in SheetSyncButton picks it up.

export const CLAIM_KEY = 'survey-sheet-sync-claim';
const CLAIM_FRESH_MS = 10 * 60 * 1000;
const CODE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/;

export function rememberClaim(provider, code, storage = globalThis.localStorage) {
  const p = provider === 'msgraph' ? 'msgraph' : provider === 'google' ? 'google' : null;
  const c = String(code || '').toUpperCase();
  if (!p || !CODE.test(c)) return false;
  try {
    storage.setItem(CLAIM_KEY, JSON.stringify({ provider: p, code: c, at: Date.now() }));
    return true;
  } catch { return false; }
}

export function readClaim(provider, since, storage = globalThis.localStorage) {
  try {
    const c = JSON.parse(storage.getItem(CLAIM_KEY) || 'null');
    if (c && c.provider === provider && typeof c.code === 'string' && c.at >= since - 1000 && Date.now() - c.at < CLAIM_FRESH_MS) return c.code;
  } catch { /* storage off: the code box still works */ }
  return null;
}

export function forgetClaim(storage = globalThis.localStorage) {
  try { storage.removeItem(CLAIM_KEY); } catch { /* nothing to forget */ }
}
