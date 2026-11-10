// Universal links / Android App Links: a tapped https://surveytool.app/invite/<token>
// link opens the installed app, which gets an `appUrlOpen` event instead of a
// page load. The app routes by pathname at boot (see main.jsx), so load the
// same path inside the web view. The web and Electron builds are untouched.
//
// The app's own scheme (com.kalvoe.survey://) carries one thing back: the code
// that finishes a live-sheet sign-in, from the "Open Survey" button on the
// consent page's last screen (public/google-connected.html). It is saved where
// the connect loop looks (src/services/sheetSyncClaim.js), so nobody types it.
//
// A file:// or content:// url is a PDF opened from another app ("Open in
// Survey"); src/mobile/nativeOpenFile.js reads it for the home screen.
import { forgetClaim, rememberClaim } from '../services/sheetSyncClaim.js';
import { nativeBackAction } from '../utils/backNavigation.js';
import { isFeatureOn } from '../featureFlags.js';

// Kept here (tiny) so a plain link never loads the file reader.
const isOpenedFileUrl = (url) => typeof url === 'string' && /^(file|content):\/\//i.test(url);

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
    if (!res?.error && res?.replaced) (await import('../services/sheetSyncNotices.js')).announceAccountSwitch(claim.provider, res, { call: sheetSyncCall });
    return res;
  } catch {
    return null;
  }
}

export function installNativeDeepLinks(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.Capacitor?.isNativePlatform?.()) return false;
  import('@capacitor/app').then(({ App }) => {
    // A PDF opened from Files, Mail or Teams (src/mobile/nativeOpenFile.js).
    const openFile = (url) => {
      if (!isOpenedFileUrl(url)) return false;
      Promise.all([import('@capacitor/filesystem'), import('./nativeOpenFile.js')])
        .then(([{ Filesystem }, { receiveOpenedFile }]) => receiveOpenedFile(url, { Filesystem, win }))
        .catch((err) => console.warn('[nativeDeepLinks] could not open file', err));
      return true;
    };
    // A cold start may carry the file as the launch url instead of an event.
    App.getLaunchUrl?.().then((launch) => { if (launch?.url) openFile(launch.url); }).catch(() => {});
    App.addListener('appUrlOpen', ({ url }) => {
      if (openFile(url)) return;
      const claim = sheetSyncClaimFromUrl(url);
      if (claim) {
        rememberClaim(claim.provider, claim.code);
        finishSignInNow(claim);
        return;
      }
      const route = deepLinkRoute(url);
      if (route) win.location.assign(route);
    });
    // Android back button: back through the page history (which closes an
    // open sheet, then the document: src/utils/backNavigation.js), and at
    // the bottom minimise with the flag on, else quit as before.
    App.addListener('backButton', ({ canGoBack }) => {
      const action = nativeBackAction({ canGoBack, enabled: isFeatureOn('back-button') });
      if (action === 'back') win.history.back();
      else if (action === 'minimize') App.minimizeApp();
      else App.exitApp();
    });
  }).catch((err) => console.warn('[nativeDeepLinks] not started', err));
  return true;
}
