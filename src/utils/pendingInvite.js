// A signed-out person who opens /invite/<token> is sent to sign in with
// ?invite=<token>. The token is also kept in localStorage, because a sign-up
// confirmation email brings them back without the query. Once they are signed
// in, the app sends them back to the invite page, which accepts the invite.
import { appReturnPath } from './accountPlatform.js';

export const PENDING_INVITE_KEY = 'kal31_pending_invite_token';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;

export function readPendingInviteToken(location, storage) {
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(location?.search || '').get('invite'); } catch (_e) { /* bad query */ }
  let stored = null;
  try { stored = storage?.getItem(PENDING_INVITE_KEY) || null; } catch (_e) { /* private mode */ }
  const token = fromUrl || stored;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** Where to send a signed-in person who still has an invite to accept, or null. */
export function pendingInviteRedirect(location, storage) {
  // Electron loads the app from file://, where /invite/<token> is not a page.
  if (!/^https?:$/i.test(location?.protocol || '')) return null;
  if (/^\/invite\//.test(location?.pathname || '')) return null;
  const token = readPendingInviteToken(location, storage);
  if (!token) return null;
  // Keep the phone app's flags (/mobile, nativeShell, mobileNav) on the invite
  // URL so the invite page sends the person back into the same shell.
  const returnPath = appReturnPath(location);
  const shellQuery = returnPath.includes('?') ? returnPath.slice(returnPath.indexOf('?')) : '';
  return `/invite/${encodeURIComponent(token)}${shellQuery}`;
}
