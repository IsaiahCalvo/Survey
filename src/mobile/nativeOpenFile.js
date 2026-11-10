// "Open in Survey" (Drawboard gap, Nightly flag 'open-in-survey'): a PDF opened
// from Files, Mail, Teams or Outlook on a phone starts the app with a file:// url
// (iOS copies it into Documents/Inbox) or a content:// url (Android). The url
// arrives as an `appUrlOpen` event (src/mobile/nativeDeepLinks.js); the bytes
// are read here and parked until the home screen is ready to upload them
// through the same path as a dropped PDF, which then opens the document.

export const OPEN_FILE_EVENT = 'survey:native-open-file';
export const FALLBACK_NAME = 'Shared PDF.pdf';

const queue = [];
// Launch url and appUrlOpen can both carry one open; the same url later is a
// new open (iOS reuses Documents/Inbox/<name>.pdf once the copy is gone).
const SAME_OPEN_MS = 5000;
const seen = new Map();

/** True for a url the app should read as an opened file. */
export function isOpenedFileUrl(url) {
  return typeof url === 'string' && /^(file|content):\/\//i.test(url);
}

/** A readable file name from the url's last part, or the fallback. */
export function openedFileName(url) {
  let last = '';
  try {
    const path = new URL(url).pathname;
    last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  } catch {
    last = '';
  }
  // Android document ids look like "document/1234" or "primary:Download/x.pdf".
  last = last.split(/[:/\\]/).pop().replace(/[\u0000-\u001f]/g, '').trim();
  if (!/\.pdf$/i.test(last)) return FALLBACK_NAME;
  return last.length > 200 ? `${last.slice(0, 196)}.pdf` : last;
}

/** Base64 text from Filesystem.readFile -> bytes. */
export function base64ToBytes(data) {
  const text = atob(String(data || ''));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** True when the bytes start with the PDF header (some apps send a wrong type). */
export function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  // The header may sit after a little junk; the spec allows it in the first 1 KB.
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 1024)));
  return head.includes('%PDF-');
}

/** Parks one opened file and tells the home screen. */
export function queueOpenedFile(entry, win = typeof window !== 'undefined' ? window : null) {
  queue.push(entry);
  win?.dispatchEvent?.(new CustomEvent(OPEN_FILE_EVENT));
}

/** Hands over every parked file, oldest first. */
export function takeOpenedFiles() {
  return queue.splice(0, queue.length);
}

/**
 * Reads the url and parks the result: { file } for a PDF, { error } otherwise.
 * The same url is read once even when both the launch url and the event carry it.
 */
export async function receiveOpenedFile(url, { Filesystem, win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!isOpenedFileUrl(url)) return false;
  const now = Date.now();
  if (now - (seen.get(url) ?? -Infinity) < SAME_OPEN_MS) return false;
  seen.set(url, now);
  const name = openedFileName(url);
  try {
    const { data } = await Filesystem.readFile({ path: url });
    const bytes = typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(await data.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      queueOpenedFile({ error: `${name === FALLBACK_NAME ? 'That file' : name} is not a PDF.` }, win);
    } else {
      queueOpenedFile({ file: new File([bytes], name, { type: 'application/pdf' }) }, win);
    }
  } catch (err) {
    console.warn('[nativeOpenFile] could not read', err);
    queueOpenedFile({ error: 'Survey could not read that file. Try again from Upload.' }, win);
  }
  // iOS keeps a copy of every opened file in Documents/Inbox; the upload has
  // the bytes now, so drop it. Android content:// urls belong to the sender.
  if (/^file:\/\//i.test(url) && /\/Inbox\//.test(url)) {
    Filesystem.deleteFile({ path: url }).catch(() => {});
  }
  return true;
}

/** Test hook: forget parked files and urls. */
export function resetOpenedFilesForTest() {
  queue.length = 0;
  seen.clear();
}
