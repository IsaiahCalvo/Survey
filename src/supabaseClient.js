/**
 * supabaseClient.js — singleton Supabase client plus auth-session helpers.
 *
 * Exports `supabase` (null when VITE_SUPABASE_* env is absent → offline mode),
 * isSupabaseAvailable, refresh-token recovery (recoverSupabaseAuthSession,
 * clearSupabaseAuthStorage), getSupabaseSession/getAuthSnapshot, and the
 * connected-services availability flag. Used app-wide for cloud sync + auth.
 */
import { createClient } from '@supabase/supabase-js';
import { navigatorLock } from '@supabase/auth-js';
import { createSafeNavigatorLock } from './utils/safeNavigatorLock.js';
import {
  checkpointBodyFetch,
  enableCheckpointBodySubstitution,
} from './services/checkpointBodyFetch.js';

const env = import.meta.env || {};

// 2026-06-04 — Auth-token lock acquire-timeout clamp.
// supabase-js v2.104.0 calls the auth client's `lock` as
// `lock(name, lockAcquireTimeout, fn)` with lockAcquireTimeout defaulting to
// 5000ms. That `lockAcquireTimeout` option is NOT plumbed through
// createClient({ auth }) in this version (_initSupabaseAuthClient only forwards
// `lock`, not `lockAcquireTimeout`), so the only supported override is a custom
// `lock`. During cold document-open a stalled/orphaned navigator.locks
// "lock:sb-<ref>-auth-token" lock serializes every authed DB request behind it
// for the full 5s before auth-js's built-in steal-on-timeout recovery fires.
// We wrap the built-in navigatorLock and clamp the acquire timeout to 2500ms so
// recovery (lock stealing) kicks in sooner. This preserves cross-tab/window auth
// sync (still navigator.locks + steal recovery) — it is pure timeout tuning, not
// a no-op lock. Falls back to the original callback if navigatorLock is missing.
// Plain-HTTP mobile development hosts are not secure contexts, so Safari and
// WKWebView omit navigator.locks. Fall back to auth-js's inline behavior there;
// otherwise retain the timeout clamp and cross-tab locking used on desktop.
const clampedAuthLock = createSafeNavigatorLock(navigatorLock);
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
const supabaseProjectRef = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null;
  } catch {
    return null;
  }
})();
const SUPABASE_AUTH_STORAGE_KEY = supabaseProjectRef
  ? `sb-${supabaseProjectRef}-auth-token`
  : null;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Running in offline mode.');
}

// 2026-10-06: `global.fetch` is the plain fetch, except that a multi-MB
// annotation checkpoint's request body is assembled from bytes the checkpoint
// worker prepared instead of from one huge string on the main thread (same
// bytes on the wire; see services/checkpointBodyFetch.js).
export const supabase = supabaseUrl && supabaseAnonKey
  ? enableCheckpointBodySubstitution(createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        lock: clampedAuthLock,
        ...(SUPABASE_AUTH_STORAGE_KEY ? { storageKey: SUPABASE_AUTH_STORAGE_KEY } : {}),
      },
      global: { fetch: checkpointBodyFetch },
    }))
  : null;

// The dev-only fixture route intentionally exercises the full local editor
// without a cloud session. Keep its mock viewer identity out of Supabase
// consumers even when this checkout has valid public Supabase credentials.
const isDevTestPdfRoute = () => (
  import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('testPdf')
);

// Helper to check if Supabase is available
export const isSupabaseAvailable = () => supabase !== null && !isDevTestPdfRoute();

export const isAuthRefreshTokenError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return code.includes('refresh')
    || message.includes('invalid refresh token')
    || message.includes('refresh token not found')
    || message.includes('refresh_token_not_found');
};

export const clearSupabaseAuthStorage = () => {
  if (typeof window === 'undefined') return;
  try {
    if (SUPABASE_AUTH_STORAGE_KEY) {
      window.localStorage?.removeItem(SUPABASE_AUTH_STORAGE_KEY);
      window.sessionStorage?.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    }
    const localKeys = [];
    for (let i = 0; i < (window.localStorage?.length || 0); i += 1) {
      const key = window.localStorage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) localKeys.push(key);
    }
    localKeys.forEach((key) => window.localStorage.removeItem(key));
    const sessionKeys = [];
    for (let i = 0; i < (window.sessionStorage?.length || 0); i += 1) {
      const key = window.sessionStorage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) sessionKeys.push(key);
    }
    sessionKeys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (err) {
    console.warn('[SupabaseAuth] failed to clear local auth storage', err?.message || String(err));
  }
};

export async function recoverSupabaseAuthSession(error, context = 'auth') {
  if (!isAuthRefreshTokenError(error)) return false;
  console.warn('[SupabaseAuth] clearing corrupted refresh token ' + JSON.stringify({
    context,
    message: error?.message || String(error),
  }));
  clearSupabaseAuthStorage();
  try {
    await supabase?.auth?.signOut?.({ scope: 'local' });
  } catch {
    // Storage was already cleared above; local sign-out is best-effort.
  }
  return true;
}

export async function getSupabaseSession(context = 'auth') {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session || null;
  } catch (err) {
    if (await recoverSupabaseAuthSession(err, context)) return null;
    throw err;
  }
}

// 2026-04-26 — Snapshot of the current Supabase auth session, used by the
// cloud-sync hook to diagnose whether an empty cloud read came back from a
// fully-authenticated request or from one that was racing the auth handshake
// (which under RLS would silently return zero rows). Cheap, async, safe to
// call before any DB query whose emptiness would be load-bearing.
export async function getAuthSnapshot() {
  if (!supabase) return { hasSupabase: false };
  try {
    const session = await getSupabaseSession('getAuthSnapshot');
    if (!session) return { hasSupabase: true, hasSession: false };
    const expiresAt = session.expires_at || null;
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      hasSupabase: true,
      hasSession: true,
      sessionUserId: session.user?.id || null,
      sessionEmail: session.user?.email || null,
      tokenExpiresAt: expiresAt,
      tokenSecondsRemaining: expiresAt ? expiresAt - nowSec : null,
      tokenLooksValid: expiresAt ? expiresAt > nowSec : false
    };
  } catch (err) {
    if (await recoverSupabaseAuthSession(err, 'getAuthSnapshot')) {
      return { hasSupabase: true, hasSession: false, authRecovered: true };
    }
    return { hasSupabase: true, authQueryError: err?.message || String(err) };
  }
}

// Helper to check if an error is a schema cache error (406)
// These errors should be silently ignored as the table will become available
export const isSchemaError = (error) => {
  if (!error) return false;
  return error.status === 406 || error.code === '406' || error.message?.includes('406');
};

// Flag to track if connected_services table is available
// This prevents repeated failed requests
let connectedServicesAvailable = null;

export const isConnectedServicesAvailable = () => connectedServicesAvailable;
export const setConnectedServicesAvailable = (available) => {
  connectedServicesAvailable = available;
};
