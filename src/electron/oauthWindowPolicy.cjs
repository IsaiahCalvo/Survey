// src/electron/oauthWindowPolicy.cjs
//
// Origin allowlist for the LEGACY embedded Microsoft OAuth window
// (the `oauth:openWindow` IPC handler in src/electron-main.js).
//
// Why this exists (KAL-289). The handler used to take `authUrl` and
// `redirectUri` straight from the renderer with no host checking, and decided
// the OAuth flow was finished with a bare `url.startsWith(redirectUri)`. A
// `redirectUri` of `"https://"` therefore matched the very first navigation,
// and the handler returned the full callback URL — authorization code included
// — back to the caller. `authUrl` fared little better: only the scheme was
// checked, so the window could be pointed at any https site. Both are only
// reachable once the renderer is already compromised, but they turn a script
// injection foothold into a full Microsoft account takeover, which is cheap to
// close.
//
// Rules, deliberately strict:
//   * both URLs are parsed with `new URL()`; anything unparseable is refused;
//   * origins are compared for EXACT equality against the frozen lists below —
//     never `startsWith`, never a substring test, never a regex. Substring
//     matching on URLs is the exact bug being fixed here, and it is what lets
//     `https://login.microsoftonline.com.evil.com` sail through a naive check;
//   * the completion check compares origin AND path, not a string prefix;
//   * anything unrecognised fails closed — no window, no navigation, no code.
//
// This module is intentionally dependency-free and pure so it can be unit
// tested outside Electron (see tests/oauthWindowPolicy.test.mjs).

// The Microsoft identity platform authorize endpoint. This is the only auth URL
// the renderer ever builds — see `login()` in src/contexts/MSGraphContext.jsx,
// which constructs `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`,
// and the AUTHORITY constant in src/electron/msalAuthMain.js.
//
// Only the INITIAL URL loaded into the window is gated. Microsoft legitimately
// navigates the window onwards during sign-in (login.live.com for personal
// accounts, a federated IdP for work accounts), so intermediate navigation is
// deliberately not restricted — what matters is that we only ever hand the
// callback back to a registered redirect origin.
const ALLOWED_AUTH_ORIGINS = Object.freeze([
  'https://login.microsoftonline.com',
]);

// Redirect origins registered for this app in Azure. Mirrors
// REGISTERED_REDIRECT_ORIGINS in src/utils/microsoftOAuthRouting.js, which is
// what the renderer derives `redirectUri` from. `http://localhost:5173` is the
// Vite dev server used by `npm run dev:electron`; the packaged app runs from
// file:// and falls back to the production origin.
const ALLOWED_REDIRECT_ORIGINS = Object.freeze([
  'https://surveytool.app',
  'https://www.surveytool.app',
  'http://localhost:5173',
]);

/** Parse a URL string, returning null instead of throwing. */
const parseUrl = (value) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return new URL(value);
  } catch (_e) {
    return null;
  }
};

/**
 * Normalise a pathname for comparison: a single trailing slash is insignificant
 * ('/mobile' and '/mobile/' are the same page), the root stays '/'.
 */
const normalizePath = (pathname) => {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
};

/** Exact origin equality against a frozen allowlist. Never a prefix test. */
const isOriginAllowed = (url, allowedOrigins) =>
  Boolean(url) && allowedOrigins.indexOf(url.origin) !== -1;

/**
 * Validate an `oauth:openWindow` request.
 *
 * @returns {{ok: true, authUrl: string, redirect: {origin: string, pathname: string}}}
 *          on success, or {{ok: false, error: string, origin?: string}} on refusal.
 */
function validateOAuthWindowRequest({ authUrl, redirectUri } = {}) {
  const parsedAuth = parseUrl(authUrl);
  if (!parsedAuth) {
    return { ok: false, error: 'invalid-auth-url' };
  }
  if (parsedAuth.protocol !== 'https:') {
    return { ok: false, error: 'invalid-auth-url-protocol' };
  }
  if (!isOriginAllowed(parsedAuth, ALLOWED_AUTH_ORIGINS)) {
    return { ok: false, error: 'auth-url-origin-not-allowed', origin: parsedAuth.origin };
  }

  const parsedRedirect = parseUrl(redirectUri);
  if (!parsedRedirect) {
    return { ok: false, error: 'invalid-redirect-uri' };
  }
  if (!isOriginAllowed(parsedRedirect, ALLOWED_REDIRECT_ORIGINS)) {
    return { ok: false, error: 'redirect-uri-origin-not-allowed', origin: parsedRedirect.origin };
  }

  return {
    ok: true,
    authUrl: parsedAuth.toString(),
    redirect: { origin: parsedRedirect.origin, pathname: normalizePath(parsedRedirect.pathname) },
  };
}

/**
 * Has the auth window landed on the registered redirect URI?
 * Replaces the old `url.startsWith(redirectUri)` prefix match with an
 * origin + path comparison.
 *
 * @param {string} url the URL the auth window navigated to
 * @param {{origin: string, pathname: string}} redirect from validateOAuthWindowRequest
 */
function isRedirectCallback(url, redirect) {
  const parsed = parseUrl(url);
  if (!parsed || !redirect) return false;
  return parsed.origin === redirect.origin && normalizePath(parsed.pathname) === redirect.pathname;
}

module.exports = {
  ALLOWED_AUTH_ORIGINS,
  ALLOWED_REDIRECT_ORIGINS,
  validateOAuthWindowRequest,
  isRedirectCallback,
};
