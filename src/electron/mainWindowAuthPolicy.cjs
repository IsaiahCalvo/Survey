// src/electron/mainWindowAuthPolicy.cjs
//
// Sign-in rules for the desktop MAIN window (KAL-369, "use an isolated desktop
// login window with exact trusted login and callback destinations").
//
// Google sign-in in the desktop app runs in the main window: Supabase sends the
// window to Google, Google sends it back to Supabase, and Supabase sends it to
// the app with the session in the URL hash. Two rules used to be loose:
//
//   * Trusted sign-in host. Any `*.supabase.co` page could load in the main
//     window, which means any Supabase project, including one a stranger owns.
//     Now only Survey's own Supabase project is trusted. The main process works
//     that out itself (below); nothing the renderer says can widen it.
//   * Callback. Any navigation whose hash merely CONTAINED the text "code",
//     "access_token" or "error" was treated as a sign-in callback and its raw
//     hash pushed into the app. Now a callback must land on the app's own
//     address (the packaged index.html, the dev server, or surveytool.app,
//     which is Supabase's Site URL fallback), must come while the window is on
//     a sign-in page, and must carry real OAuth parameters. Only those
//     parameters are passed on, re-encoded.
//
// The Microsoft popup has its own allowlist in oauthWindowPolicy.cjs (KAL-289).
// Pure and dependency-free so it can be unit tested outside Electron (see
// tests/mainWindowAuthPolicy.test.mjs).

const path = require('path');

// Survey's Supabase project (Pro plan, the suite's sign-in server). The web
// bundle reads the same value from VITE_SUPABASE_URL at build time.
const PRODUCTION_SUPABASE_ORIGIN = 'https://cvamwtpsuvxvjdnotbeg.supabase.co';

// Identity providers that may show in the main window during sign-in. Exact
// hosts only. Microsoft work accounts use tenant hosts under
// microsoftonline.com, which Microsoft alone controls.
const PROVIDER_HOSTS = Object.freeze([
  'login.microsoftonline.com',
  'login.live.com',
  'login.microsoft.com',
  'accounts.google.com',
]);

// Where Supabase may land the window after sign-in when it can't use the
// desktop file:// address: its Site URL.
const WEB_CALLBACK_ORIGINS = Object.freeze([
  'https://surveytool.app',
  'https://www.surveytool.app',
]);

// Keys that may be passed from a callback into the app. Anything else in the
// hash is dropped.
const CALLBACK_KEYS = Object.freeze([
  'access_token',
  'refresh_token',
  'expires_in',
  'expires_at',
  'token_type',
  'provider_token',
  'provider_refresh_token',
  'type',
  'code',
  'state',
  'error',
  'error_code',
  'error_description',
]);

const parseUrl = (value) => {
  if (value && typeof value === 'object' && typeof value.href === 'string') return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value);
  } catch (_e) {
    return null;
  }
};

/**
 * Work out the one Supabase origin the main window may show. A configured
 * value is used only when it is a plain https origin on supabase.co, so a bad
 * or hostile env value can't widen the list; otherwise production.
 */
function resolveTrustedSupabaseOrigin(env = {}) {
  const configured = env.SURVEY_SUPABASE_URL || env.VITE_SUPABASE_URL || '';
  const parsed = parseUrl(configured);
  if (parsed
      && parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)) {
    return parsed.origin;
  }
  return PRODUCTION_SUPABASE_ORIGIN;
}

/** Is this host allowed to show in the main window while signing in? */
function isTrustedSignInHost(host, { supabaseOrigin = PRODUCTION_SUPABASE_ORIGIN } = {}) {
  const value = String(host || '').toLowerCase();
  if (!value) return false;
  if (PROVIDER_HOSTS.includes(value)) return true;
  if (value.endsWith('.microsoftonline.com')) return true;
  const supabase = parseUrl(supabaseOrigin);
  return Boolean(supabase) && value === supabase.hostname;
}

/** Is this URL an https sign-in page the main window may show? */
function isTrustedSignInUrl(url, options) {
  const parsed = parseUrl(url);
  return Boolean(parsed) && parsed.protocol === 'https:' && isTrustedSignInHost(parsed.hostname, options);
}

/**
 * Is this URL the app's own address, where a sign-in callback may land?
 * Origin and path are compared exactly; the query and hash are ignored.
 */
function isAppCallbackTarget(url, { development = false, devPort = '5173', appPath = '' } = {}) {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (parsed.protocol === 'file:') {
    if (!appPath) return false;
    const expected = path.resolve(appPath, 'dist', 'index.html');
    let actual;
    try {
      actual = decodeURIComponent(parsed.pathname);
    } catch (_e) {
      return false;
    }
    // Windows file URLs look like /C:/Users/...; drop the leading slash.
    if (/^\/[A-Za-z]:\//.test(actual)) actual = actual.slice(1);
    const norm = (p) => path.normalize(p).replace(/\\/g, '/').toLowerCase();
    return norm(actual) === norm(expected);
  }
  if (development
      && parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && parsed.port === String(devPort)) {
    return true;
  }
  return WEB_CALLBACK_ORIGINS.includes(parsed.origin)
    && (parsed.pathname === '/' || parsed.pathname === '');
}

/**
 * Read real OAuth parameters from a callback URL's hash. Returns a clean hash
 * string ("#access_token=...") holding only known keys, or null when the URL is
 * not a sign-in callback (a session pair, a code, or an error).
 */
function readOAuthCallbackHash(url) {
  const parsed = parseUrl(url);
  if (!parsed || !parsed.hash || parsed.hash.length < 2) return null;
  const params = new URLSearchParams(parsed.hash.slice(1));
  const hasSession = Boolean(params.get('access_token')) && Boolean(params.get('refresh_token'));
  const hasCode = Boolean(params.get('code'));
  const hasError = Boolean(params.get('error')) || Boolean(params.get('error_code'));
  if (!hasSession && !hasCode && !hasError) return null;
  const clean = new URLSearchParams();
  for (const key of CALLBACK_KEYS) {
    const value = params.get(key);
    if (value !== null) clean.set(key, value);
  }
  return `#${clean.toString()}`;
}

/**
 * Decide whether a main-window navigation is a sign-in callback to hand to the
 * app. `fromUrl` is the page the window is on now; a callback only counts while
 * the window is on a trusted sign-in page, so the app (or a stray link) can't
 * push a made-up session into itself.
 *
 * @returns {{hash: string} | null}
 */
function matchMainWindowCallback({ fromUrl, toUrl, supabaseOrigin, development, devPort, appPath } = {}) {
  if (!isTrustedSignInUrl(fromUrl, { supabaseOrigin })) return null;
  if (!isAppCallbackTarget(toUrl, { development, devPort, appPath })) return null;
  const hash = readOAuthCallbackHash(toUrl);
  return hash ? { hash } : null;
}

module.exports = {
  PRODUCTION_SUPABASE_ORIGIN,
  PROVIDER_HOSTS,
  WEB_CALLBACK_ORIGINS,
  resolveTrustedSupabaseOrigin,
  isTrustedSignInHost,
  isTrustedSignInUrl,
  isAppCallbackTarget,
  readOAuthCallbackHash,
  matchMainWindowCallback,
};
