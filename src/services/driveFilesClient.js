// The app's side of OneDrive files that save back (Nightly flag
// 'drive-sync-back'; supabase/functions/_shared/driveFiles/service.js, served
// by the sheet-sync function). The server holds the Microsoft sign-in; the app
// only ever gets one-file download and upload links, and moves the PDF bytes
// itself (so a 200 MB drawing set never passes through an edge function).
import { sheetSyncCall } from './sheetSyncClient.js';
import { forgetClaim, readClaim } from './sheetSyncClaim.js';
import { isNativeApp } from '../utils/proLock.js';
import { isElectronApp } from '../utils/layoutMode.js';

export const DRIVE_LINK_CHANGED_EVENT = 'survey:drive-link-changed';
// Graph takes up to 60 MiB in one request; bigger files go in pieces that are
// a multiple of 320 KiB.
const ONE_PIECE_MAX = 60 * 1024 * 1024;
const PIECE = 32 * 320 * 1024;

/** One drive action; resolves to the server's answer, or { error, code? }. */
export function driveCall(action, body = {}, client) {
  return sheetSyncCall(action, body, client);
}

/** The PDF behind Graph's short-lived download link, as a File. */
export async function downloadDriveFile({ downloadUrl, name }, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(downloadUrl);
  if (!response.ok) throw new Error(`OneDrive did not send the file (${response.status}).`);
  const bytes = await response.arrayBuffer();
  return new File([bytes], name || 'OneDrive file.pdf', { type: 'application/pdf' });
}

/** Send `bytes` to a Graph upload link (whole, or in pieces). Resolves to Graph's item. */
export async function uploadToDrive(uploadUrl, bytes, fetchImpl = globalThis.fetch) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = data.byteLength;
  const step = total <= ONE_PIECE_MAX ? Math.max(total, 1) : PIECE;
  let last = null;
  for (let start = 0; start < total || (total === 0 && start === 0); start += step) {
    const end = Math.min(total, start + step);
    const response = await fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${Math.max(end - 1, 0)}/${total}` },
      body: data.subarray(start, end),
    });
    if (!response.ok && response.status !== 202) {
      const err = new Error(`OneDrive did not take the file (${response.status}).`);
      err.status = response.status;
      throw err;
    }
    last = response.status === 202 ? null : await response.json().catch(() => null);
    if (total === 0) break;
  }
  return last;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const CONNECT_POLL_MS = 2000;
const CONNECT_FOR_MS = 5 * 60 * 1000;

const clientKind = () => (isElectronApp() ? 'desktop' : isNativeApp() ? 'phone' : 'web');

/**
 * Microsoft sign-in, the same one live Excel sync uses: opens the consent
 * page (the desktop app's own window, the system browser on phones), claims
 * the code it hands back, and resolves { ok } once the server has the sign-in.
 */
export async function connectMicrosoftForDrive({ open = (url) => window.open(url, '_blank', 'noopener') } = {}) {
  const res = await sheetSyncCall('connect', { appOrigin: window.location.origin, provider: 'msgraph', client: clientKind() });
  if (res?.error || !res?.url) return { ok: false, error: res?.error || 'Could not start Microsoft sign-in.' };
  const started = Date.now();
  open(res.url);
  let refused = null;
  const stopListening = window.electronAPI?.onSheetSyncConsent?.((finish) => {
    if (finish?.provider === 'msgraph' && finish.result && finish.result !== 'finish' && finish.result !== 'connected') refused = finish.result;
  });
  try {
    while (Date.now() < started + CONNECT_FOR_MS) {
      await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
      if (refused) return { ok: false, error: refused === 'cancelled' ? 'Microsoft was not connected: you stopped before saying yes.' : 'Microsoft did not finish connecting. Try again.' };
      const code = readClaim('msgraph', started);
      if (code) {
        forgetClaim();
        const claimed = await sheetSyncCall('claim', { provider: 'msgraph', code });
        if (claimed?.error) return { ok: false, error: claimed.error };
      }
      const status = await sheetSyncCall('status', {});
      if (status?.microsoft?.connected) return { ok: true };
    }
    return { ok: false, error: 'Microsoft sign-in did not finish. Try again.' };
  } finally {
    stopListening?.();
  }
}

/**
 * A picked OneDrive PDF as a File, plus what linking it needs: the eTag of the
 * very bytes downloaded (a change at the source after this is a conflict).
 */
export async function fetchDrivePdf({ driveId, itemId }, { call = driveCall, fetchImpl = globalThis.fetch } = {}) {
  const opened = await call('driveOpen', { driveId, itemId });
  if (!opened || opened.error) return { error: opened?.error || 'Could not open that OneDrive file.', code: opened?.code || null };
  const file = await downloadDriveFile(opened, fetchImpl);
  return { file, eTag: opened.eTag || null, driveId: opened.driveId || driveId, itemId: opened.itemId || itemId };
}

export function announceDriveLinkChanged(documentId) {
  try { window.dispatchEvent(new CustomEvent(DRIVE_LINK_CHANGED_EVENT, { detail: { documentId } })); } catch { /* no window */ }
}
