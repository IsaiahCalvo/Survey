// src/services/excelExportRegistration.js
//
// What an Excel export does about the survey's live workbook registration (the
// workbook_id + sync_token in _SurveyMetadata B5/B6, minted by kal307_register_workbook).
//
// The server keeps ONE live workbook per survey + template: a new registration by the
// owner retires the old one, and an editor can't replace a live one at all. That rule
// is right for a workbook that will be linked, but two export paths used to trip it:
//
//   1. A plain download (web, phone): the file is never linked and nothing on those
//      platforms can bring it back in, yet it registered — so an owner downloading a copy
//      to email retired the real shared workbook, which then refused every sync with
//      "no longer linked, re-export".
//   2. An editor pushing to the linked workbook: the server (rightly) refused a new
//      registration, the export went ahead without one, and the push wrote a file with
//      blank B5/B6 over the live workbook — silently dropping its sync link.
//
// So: a plain download never registers; a push that can't get a fresh registration
// keeps the one the linked file already carries; and if the linked file has a link we
// can't read back, the push is stopped rather than allowed to wipe it.

export const EXPORT_REGISTRATION = Object.freeze({
  NONE: 'none',   // no registration in this file (copy / local-only doc / nothing to keep)
  NEW: 'new',     // freshly minted by the server
  KEPT: 'kept',   // the linked workbook's existing registration, written back unchanged
  BLOCK: 'block', // don't write: the push would drop the linked workbook's sync link
});

const looksRegistered = (reg) => Boolean(
  reg
  && typeof reg.workbookId === 'string' && reg.workbookId.startsWith('wb_')
  && typeof reg.syncToken === 'string' && reg.syncToken.startsWith('st_')
);

/**
 * @param {object} args
 * @param {boolean} args.isDesktop      true in the desktop app (an export there links the file)
 * @param {boolean} args.isLinkedPush   true when writing over the already-linked workbook
 * @param {boolean} args.canRegister    the doc is cloud-backed and has a template id
 * @param {() => Promise<{workbookId:string, syncToken:string}>} args.register
 * @param {() => Promise<{workbookId:string|null, syncToken:string|null}|null>} [args.readLinkedRegistration]
 *        reads B5/B6 from the linked workbook as it is now; throws when the file can't be read
 * @returns {Promise<{kind:string, workbookId?:string, syncToken?:string, reason?:string}>}
 */
export const resolveExportRegistration = async ({
  isDesktop,
  isLinkedPush,
  canRegister,
  register,
  readLinkedRegistration = null,
}) => {
  if (!canRegister) return { kind: EXPORT_REGISTRATION.NONE, reason: 'not-cloud-backed' };
  if (!isDesktop) return { kind: EXPORT_REGISTRATION.NONE, reason: 'download-copy' };

  let registerError = null;
  try {
    const fresh = await register();
    if (looksRegistered(fresh)) {
      return { kind: EXPORT_REGISTRATION.NEW, workbookId: fresh.workbookId, syncToken: fresh.syncToken };
    }
    registerError = new Error('unexpected registration shape');
  } catch (err) {
    registerError = err;
  }

  // A brand-new export the server won't register (an editor while a live workbook
  // exists) is a plain copy, as before.
  if (!isLinkedPush || typeof readLinkedRegistration !== 'function') {
    return { kind: EXPORT_REGISTRATION.NONE, reason: 'register-refused', error: registerError };
  }

  let existing;
  try {
    existing = await readLinkedRegistration();
  } catch (err) {
    return { kind: EXPORT_REGISTRATION.BLOCK, reason: 'linked-unreadable', error: err };
  }
  if (looksRegistered(existing)) {
    return { kind: EXPORT_REGISTRATION.KEPT, workbookId: existing.workbookId, syncToken: existing.syncToken };
  }
  // The linked file carries no link to lose: push it as before.
  return { kind: EXPORT_REGISTRATION.NONE, reason: 'linked-unregistered', error: registerError };
};
