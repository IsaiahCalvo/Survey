// What the live sheet says after a sign-in change, each with Undo (owner's
// rule: act at once, then offer Undo, never "are you sure").
//   * Sign out: the server parks the sign-in for 10 minutes and returns a code;
//     Undo takes it back and every workbook syncs again.
//   * A different account signed in: it replaces the old one for every
//     workbook this person linked. Say how many, and Undo puts the old one back.
import { showToast } from '../utils/toast.js';

const WHO = { msgraph: 'Microsoft', google: 'Google' };
const UNDO_MS = 10000;

async function takeBack(provider, code, call, onDone) {
  const sheetSyncCall = call || (await import('./sheetSyncClient.js')).sheetSyncCall;
  const res = await sheetSyncCall('claim', { provider, code });
  if (res?.error) showToast(res.error, 'error');
  try { await onDone?.(res); } catch { /* the panel catches up on its next look */ }
  return res;
}

const workbooks = (n, provider) => {
  const thing = provider === 'msgraph' ? 'workbook' : 'sheet';
  return n === 1 ? `the ${thing} you linked` : `the ${n} ${thing}s you linked`;
};

export function announceSignOut(provider, res, { call = null, onDone = null } = {}) {
  if (!res?.undoCode) return null;
  return showToast(`Signed out of ${WHO[provider] || 'the account'}. Live sync stopped.`, 'info', {
    duration: UNDO_MS,
    action: { label: 'Undo', onClick: () => takeBack(provider, res.undoCode, call, onDone) },
  });
}

export function announceAccountSwitch(provider, res, { call = null, onDone = null } = {}) {
  const was = res?.replaced;
  if (!was?.email) return null;
  const now = res.email ? `Now signed in as ${res.email}` : `Signed in with another ${WHO[provider] || ''} account`;
  const moved = was.workbooks > 0 ? `; ${workbooks(was.workbooks, provider)} with ${was.email} sync with it now.` : ` instead of ${was.email}.`;
  return showToast(`${now}${moved}`, 'info', {
    duration: UNDO_MS,
    ...(was.undoCode ? { action: { label: 'Undo', onClick: () => takeBack(provider, was.undoCode, call, onDone) } } : {}),
  });
}
