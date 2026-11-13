// Restrict editing (Nightly flag 'restrict-editing'; Drawboard Projects
// parity EX-09). Drawboard's export option of that name makes an encrypted
// PDF that anyone can open, read and print, while changing it or adding
// notes needs a password, which its toast shows. Survey does the same with
// AES-256 (PDF 2.0 / Acrobat X handler): no open password, an owner password
// made here, and permissions for printing, copying and screen readers only.
//
// pdf-lib can't encrypt, so this loads @cantoo/pdf-lib (an MIT fork with an
// encryption handler) on demand: it stays out of every other bundle.

import { showToast } from './toast.js';

// No 0/O, 1/l/I: the password is read off a toast and typed by hand.
const READABLE_LETTERS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** "Ab3d-Ef7h-Jk9m": 12 random letters in groups of four (about 70 bits). */
export function makeEditPassword(random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const letters = [];
  // Rejection sampling keeps every letter equally likely.
  const limit = 256 - (256 % READABLE_LETTERS.length);
  while (letters.length < 12) {
    for (const byte of random(16)) {
      if (byte < limit && letters.length < 12) letters.push(READABLE_LETTERS[byte % READABLE_LETTERS.length]);
    }
  }
  return [letters.slice(0, 4), letters.slice(4, 8), letters.slice(8)].map((g) => g.join('')).join('-');
}

/** What a reader may do without the password: read, print, copy, screen readers. */
export const RESTRICTED_PERMISSIONS = Object.freeze({
  printing: 'highResolution',
  copying: true,
  contentAccessibility: true,
  modifying: false,
  annotating: false,
  fillingForms: false,
  documentAssembly: false,
});

/**
 * The same PDF, encrypted so it opens without a password but needs
 * `password` to change. -> { bytes, password }
 */
export async function restrictPdfEditing(bytes, { password = makeEditPassword(), loadLib = () => import('@cantoo/pdf-lib') } = {}) {
  const { PDFDocument } = await loadLib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.encrypt({
    algorithm: 'AES-256',
    userPassword: '',
    ownerPassword: password,
    permissions: { ...RESTRICTED_PERMISSIONS },
  });
  // Default save (object streams on): without them this fork wrote the
  // document's title and author so no reader could decode them (pdfinfo).
  const out = await doc.save();
  return { bytes: out, password };
}

/** The toast after a restricted export; the password follows it on one line. */
export function restrictedExportText(fileName) {
  return `${fileName ? `Exported ${fileName}. ` : ''}Editing is locked. Password to unlock:`;
}

/** Long enough to read and copy the password; hovering pauses it too. */
export const RESTRICTED_TOAST_MS = 30_000;

/** The toast with the password and a Copy button (Drawboard shows it in its toast). */
export function showRestrictedExportToast(fileName, password) {
  return showToast(restrictedExportText(fileName), 'success', {
    keep: password,
    duration: RESTRICTED_TOAST_MS,
    action: {
      label: 'Copy password',
      onClick: () => {
        Promise.resolve(globalThis.navigator?.clipboard?.writeText?.(password))
          .then(() => showToast('Password copied.', 'success'))
          .catch(() => showToast(`Couldn't copy. The password is ${password}`, 'warn'));
      },
    },
  });
}
