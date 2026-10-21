// Universal links / Android App Links: a tapped https://surveytool.app/invite/<token>
// link opens the installed app, which gets an `appUrlOpen` event instead of a
// page load. The app routes by pathname at boot (see main.jsx), so load the
// same path inside the web view. The web and Electron builds are untouched.

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

export function installNativeDeepLinks(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.Capacitor?.isNativePlatform?.()) return false;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appUrlOpen', ({ url }) => {
      const route = deepLinkRoute(url);
      if (route) win.location.assign(route);
    });
  }).catch((err) => console.warn('[nativeDeepLinks] not started', err));
  return true;
}
