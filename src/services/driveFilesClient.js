// The app's side of OneDrive and Google Drive files that save back (Nightly
// flag 'drive-sync-back'; supabase/functions/_shared/driveFiles/service.js,
// served by the sheet-sync function). The server holds the Microsoft or Google
// sign-in; the app only ever gets one-file download and upload links (for
// Google, a short-lived drive.file token that reaches only files the person
// picked with Survey), and moves the PDF bytes itself (so a 200 MB drawing set
// never passes through an edge function).
import { sheetSyncCall } from './sheetSyncClient.js';
import { forgetClaim, readClaim } from './sheetSyncClaim.js';
import { isNativeApp } from '../utils/proLock.js';
import { isElectronApp } from '../utils/layoutMode.js';

export const DRIVE_LINK_CHANGED_EVENT = 'survey:drive-link-changed';
// Graph takes up to 60 MiB in one request; bigger files go in pieces that are
// a multiple of 320 KiB (and of Google's 256 KiB).
const ONE_PIECE_MAX = 60 * 1024 * 1024;
const PIECE = 32 * 320 * 1024;

/** One drive action; resolves to the server's answer, or { error, code? }. */
export function driveCall(action, body = {}, client) {
  return sheetSyncCall(action, body, client);
}

export const drivePlaceName = (provider) => (provider === 'google' ? 'Google Drive' : 'OneDrive');

/** The PDF behind a short-lived download link (Graph's, or Google's with its token), as a File. */
export async function downloadDriveFile({ downloadUrl, name, accessToken = null, provider = 'msgraph' }, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(downloadUrl, accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined);
  if (!response.ok) throw new Error(`${drivePlaceName(provider)} did not send the file (${response.status}).`);
  const bytes = await response.arrayBuffer();
  return new File([bytes], name || `${drivePlaceName(provider)} file.pdf`, { type: 'application/pdf' });
}

/**
 * Send `bytes` to a one-file upload link (whole, or in pieces). Graph answers
 * a piece with 202, Google with 308; the last piece with the item.
 */
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
    const morePlease = response.status === 202 || response.status === 308;
    if (!response.ok && !morePlease) {
      const err = new Error(`The drive did not take the file (${response.status}).`);
      err.status = response.status;
      throw err;
    }
    last = morePlease ? null : await response.json().catch(() => null);
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
 * Microsoft or Google sign-in, the same one live Excel / Sheets sync uses:
 * opens the consent page (the desktop app's own window, the system browser on
 * phones), claims the code it hands back, and resolves { ok } once the server
 * has the sign-in.
 */
export async function connectForDrive(provider = 'msgraph', { open = (url) => window.open(url, '_blank', 'noopener') } = {}) {
  const company = provider === 'google' ? 'Google' : 'Microsoft';
  const res = await sheetSyncCall('connect', { appOrigin: window.location.origin, provider, client: clientKind() });
  if (res?.error || !res?.url) return { ok: false, error: res?.error || `Could not start ${company} sign-in.` };
  const started = Date.now();
  open(res.url);
  let refused = null;
  const stopListening = window.electronAPI?.onSheetSyncConsent?.((finish) => {
    if (finish?.provider === provider && finish.result && finish.result !== 'finish' && finish.result !== 'connected') refused = finish.result;
  });
  try {
    while (Date.now() < started + CONNECT_FOR_MS) {
      await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
      if (refused) return { ok: false, error: refused === 'cancelled' ? `${company} was not connected: you stopped before saying yes.` : `${company} did not finish connecting. Try again.` };
      const code = readClaim(provider, started);
      if (code) {
        forgetClaim();
        const claimed = await sheetSyncCall('claim', { provider, code });
        if (claimed?.error) return { ok: false, error: claimed.error };
      }
      const status = await sheetSyncCall('status', {});
      if ((provider === 'google' ? status?.google : status?.microsoft)?.connected) return { ok: true };
    }
    return { ok: false, error: `${company} sign-in did not finish. Try again.` };
  } finally {
    stopListening?.();
  }
}

export const connectMicrosoftForDrive = (opts) => connectForDrive('msgraph', opts);

/**
 * A picked OneDrive PDF as a File, plus what linking it needs: the eTag of the
 * very bytes downloaded (a change at the source after this is a conflict).
 */
export async function fetchDrivePdf({ driveId, itemId, provider = 'msgraph' }, { call = driveCall, fetchImpl = globalThis.fetch } = {}) {
  const opened = await call('driveOpen', { driveId, itemId, ...(provider === 'google' ? { provider } : {}) });
  if (!opened || opened.error) return { error: opened?.error || `Could not open that ${drivePlaceName(provider)} file.`, code: opened?.code || null };
  const file = await downloadDriveFile({ ...opened, provider }, fetchImpl);
  return { file, provider, eTag: opened.eTag || null, driveId: opened.driveId || driveId, itemId: opened.itemId || itemId };
}

// ---- Google's Picker ------------------------------------------------------------
// drive.file reaches only files the person picks with Survey, so Google Drive
// files are chosen in Google's own Picker (an iframe from docs.google.com),
// shown with a short-lived token of the server's Google sign-in. The Picker
// needs a browser API key (VITE_GOOGLE_PICKER_API_KEY); without one the Google
// Drive entry stays hidden.

export const googlePickerApiKey = () => {
  try { return String(import.meta.env?.VITE_GOOGLE_PICKER_API_KEY || ''); } catch { return ''; }
};

let pickerLoad = null;
function loadPickerScript() {
  if (window.google?.picker) return Promise.resolve();
  if (pickerLoad) return pickerLoad;
  pickerLoad = new Promise((resolve, reject) => {
    const done = () => window.gapi.load('picker', { callback: resolve, onerror: reject });
    if (window.gapi?.load) { done(); return; }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = done;
    script.onerror = () => reject(new Error('Google’s picker did not load.'));
    document.head.appendChild(script);
  }).catch((err) => { pickerLoad = null; throw err; });
  return pickerLoad;
}

/**
 * Show Google's Picker for one PDF. Resolves { itemId, name }, or null when
 * the person closes it. `accessToken` and `appId` come from drivePickerToken.
 */
export async function pickFromGoogleDrive({ accessToken, appId, developerKey = googlePickerApiKey() }) {
  await loadPickerScript();
  const { picker } = window.google;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes('application/pdf').setIncludeFolders(true).setSelectFolderEnabled(false);
    let builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setTitle('Open a PDF from Google Drive')
      .setCallback((data) => {
        const action = data?.[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          const doc = data[picker.Response.DOCUMENTS]?.[0];
          resolve(doc ? { itemId: String(doc[picker.Document.ID]), name: String(doc[picker.Document.NAME] || '') } : null);
        } else if (action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (developerKey) builder = builder.setDeveloperKey(developerKey);
    if (appId) builder = builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}

/**
 * Pick a PDF in Google Drive, connecting Google first when needed.
 * Resolves { itemId, name, provider: 'google' }, null (closed), or { error }.
 */
export async function chooseGoogleDrivePdf({ call = driveCall, connect = connectForDrive, pick = pickFromGoogleDrive } = {}) {
  let token = await call('drivePickerToken', { provider: 'google' });
  if (token?.code === 'not_connected' || token?.code === 'reconnect') {
    const connected = await connect('google');
    if (!connected?.ok) return { error: connected?.error || 'Google was not connected.' };
    token = await call('drivePickerToken', { provider: 'google' });
  }
  if (!token || token.error || !token.accessToken) return { error: token?.error || 'Could not reach Google Drive.' };
  try {
    const picked = await pick({ accessToken: token.accessToken, appId: token.appId || null });
    return picked ? { ...picked, provider: 'google' } : null;
  } catch (err) {
    return { error: err?.message || 'Google’s picker did not open.' };
  }
}

export function announceDriveLinkChanged(documentId) {
  try { window.dispatchEvent(new CustomEvent(DRIVE_LINK_CHANGED_EVENT, { detail: { documentId } })); } catch { /* no window */ }
}
