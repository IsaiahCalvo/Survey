// Universal links / Android App Links: a tapped https://surveytool.app/invite/<token>
// link opens the installed app, which gets an `appUrlOpen` event instead of a
// page load. The app routes by pathname at boot (see main.jsx), so load the
// same path inside the web view. The web and Electron builds are untouched.
//
// The app's own scheme (com.kalvoe.survey://) carries one thing back: the code
// that finishes a live-sheet sign-in, from the "Open Survey" button on the
// consent page's last screen (public/google-connected.html). It is saved where
// the connect loop looks (src/services/sheetSyncClaim.js), so nobody types it.
import { forgetClaim, rememberClaim } from '../services/sheetSyncClaim.js';

const APP_HOSTS = new Set(['surveytool.app', 'www.surveytool.app']);
const APP_PATH = /^\/invite\/[^/?#]+/;

/** The in-app path for a tapped link, or null when the app does not handle it. */
export function deepLinkRoute(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || !APP_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (!APP_PATH.test(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export const APP_SCHEME = 'com.kalvoe.survey';

/** { provider, code } from com.kalvoe.survey://sheet-connected?..., else null. */
export function sheetSyncClaimFromUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  // Android and iOS put "sheet-connected" in the host; be lenient about a path form.
  const where = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (where !== 'sheet-connected') return null;
  const provider = parsed.searchParams.get('provider');
  const code = (parsed.searchParams.get('code') || '').toUpperCase();
  if ((provider !== 'google' && provider !== 'msgraph') || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return null;
  return { provider, code };
}

// Phones often close the app while the person is in the browser saying yes
// (Android frees memory; iOS after a while). The app then starts fresh on the
// Documents list, and the code waited for a survey's sheet panel to open:
// after 10 minutes the sign-in was lost. Finish it straight away instead; the
// saved code stays for the panel if this try can't reach the server.
export async function finishSignInNow(claim, call = null) {
  try {
    const sheetSyncCall = call || (await import('../services/sheetSyncClient.js')).sheetSyncCall;
    const res = await sheetSyncCall('claim', claim);
    // Done, or refused for good (expired, wrong): either way nothing to keep.
    if (!res?.error || res.code) forgetClaim();
    return res;
  } catch {
    return null;
  }
}

export function installNativeDeepLinks(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.Capacitor?.isNativePlatform?.()) return false;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appUrlOpen', ({ url }) => {
      const claim = sheetSyncClaimFromUrl(url);
      if (claim) {
        rememberClaim(claim.provider, claim.code);
        finishSignInNow(claim);
        return;
      }
      const route = deepLinkRoute(url);
      if (route) win.location.assign(route);
    });
  }).catch((err) => console.warn('[nativeDeepLinks] not started', err));
  return true;
}
