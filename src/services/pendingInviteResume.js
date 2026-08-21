/* P2-33 — post-auth resume of /invite/<token> from localStorage.
 *
 * Kept free of supabase / Vite env so node tests can import it directly.
 * documentInviteService and InviteAcceptPage re-export / call these helpers.
 */

export const PENDING_INVITE_TOKEN_KEY = 'kal31_pending_invite_token';
// 32-hex mint is the live shape; keep the reader slightly wider so a
// previously stored url-safe token still resumes.
const PENDING_TOKEN_RE = /^[A-Za-z0-9._~-]{8,256}$/;

export function readPendingInviteToken(storage) {
  const store = storage
    || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store || typeof store.getItem !== 'function') return null;
  try {
    const raw = String(store.getItem(PENDING_INVITE_TOKEN_KEY) || '').trim();
    return PENDING_TOKEN_RE.test(raw) ? raw : null;
  } catch (_e) {
    return null;
  }
}

export function writePendingInviteToken(token, storage) {
  const store = storage
    || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store || typeof store.setItem !== 'function') return false;
  const value = String(token || '').trim();
  if (!PENDING_TOKEN_RE.test(value)) return false;
  try {
    store.setItem(PENDING_INVITE_TOKEN_KEY, value);
    return true;
  } catch (_e) {
    return false;
  }
}

export function clearPendingInviteToken(storage) {
  const store = storage
    || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store || typeof store.removeItem !== 'function') return;
  try { store.removeItem(PENDING_INVITE_TOKEN_KEY); } catch (_e) { /* ignore */ }
}

export function pendingInviteResumePath(token) {
  const value = String(token || '').trim();
  if (!PENDING_TOKEN_RE.test(value)) return null;
  return `/invite/${encodeURIComponent(value)}`;
}

export function shouldResumePendingInvite({ token, pathname, userId } = {}) {
  if (!userId || !token || !PENDING_TOKEN_RE.test(token)) return false;
  const current = typeof pathname === 'string' ? pathname : '';
  const match = current.match(/^\/invite\/([^/?#]+)/);
  if (!match) return true;
  try {
    return decodeURIComponent(match[1]) !== token;
  } catch (_e) {
    return match[1] !== token;
  }
}

/**
 * Post-auth resume: if `kal31_pending_invite_token` is set and the signed-in
 * user is not already on that invite URL, navigate back to `/invite/<token>`.
 * No-ops pre-auth so a `/?signIn=1` bounce can show the login UI.
 */
export function resumePendingInviteAfterAuth({
  user,
  location,
  assign,
  storage,
} = {}) {
  const token = readPendingInviteToken(storage);
  const pathname = location?.pathname
    || (typeof window !== 'undefined' ? window.location.pathname : '');
  if (!shouldResumePendingInvite({ token, pathname, userId: user?.id })) {
    return null;
  }
  const href = pendingInviteResumePath(token);
  if (!href) return null;
  const go = assign
    || (typeof window !== 'undefined' && window.location
      ? window.location.assign.bind(window.location)
      : null);
  if (typeof go === 'function') go(href);
  return href;
}
