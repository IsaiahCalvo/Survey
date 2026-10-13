/**
 * pasteCloneIdentity.js — identity minting for pasted annotation clones.
 *
 * A paste must produce a NATIVE object with a brand-new identity, minted
 * BEFORE the save diff runs:
 *
 *  - fresh data.id via crypto.randomUUID (the same contract creation uses —
 *    FabricDrawingCanvas / FabricEditCanvas mint UUIDs into data.id), and the
 *    fresh id mirrored onto any identity aliases the source carried
 *    (top-level id / annotationId) so no field still points at the source;
 *  - NO import provenance. Clones of PDF-imported shapes become native app
 *    objects (convert-at-import architecture — see
 *    docs/research/INK-MODEL-AND-IMPORT-NORMALIZATION-2026-07-17.md): keeping
 *    the source's pdfAnnotationId would make two objects claim the same
 *    native PDF annotation (breaking export preserve/remove and re-import
 *    dedupe), and the old behavior of minting a FAKE `paste-${uuid}`
 *    pdfAnnotationId made even native clones look imported.
 *
 * Why this matters for undo: the local-history differ keys objects by
 * getAnnotationHistoryId (data.id first, pdfAnnotationId last). A clone that
 * kept the source's data.id diffed as an UPDATE ("move") of the SOURCE
 * annotation, so undoing a paste slammed the clone back onto the original
 * instead of deleting the clone. With a fresh data.id the paste diffs as
 * fabric:create of the clone id — undo removes the clone, original untouched.
 *
 * Rendering is safe: imported-path geometry is detected structurally
 * (isImportedPath checks `type === 'path' && left == null`), not via the
 * provenance flags, so stripped clones keep their visual path.
 */

const PASTE_STRIPPED_PROVENANCE_KEYS = [
  'isPdfImported',
  'pdfAnnotationId',
  'pdfAnnotationType',
  'pdfImportedEditState',
  'pdfImportedEditedAt',
  'pdfImportedEditedBy',
  'pdfImportedEditSource',
  'pdfNativeAnnotationIdentity',
  // w30: the mark copied was another screen's in-flight stroke shown as a
  // live preview (annotationDocSync.js LIVE_PREVIEW_FLAG). The paste is this
  // user's own new mark and must be saved like one.
  '__surveyLivePreview',
  // w32: the same for another screen's in-flight edit shown as an overlay
  // (annotationLiveOverlay.js LIVE_EDIT_FLAG).
  '__surveyLiveEdit',
];

function freshUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mutates a deep-cloned clipboard object in place (callers always pass a
 * deepClone, never the live clipboard/source object). Returns the clone.
 */
export function mintPastedCloneIdentity(clone, uuid) {
  if (!clone || typeof clone !== 'object') return clone;
  const freshId = uuid || freshUuid();
  // w52 (2026-09-28): an image stamp's 'Stamp' subtype is WHAT it is, not
  // where it came from — every renderer recognises a stamp by it
  // (isPdfStampProxy). Stripping it with the import provenance made a pasted
  // stamp an unrenderable plain image: it vanished on paste.
  const isStamp = String(clone.type || '').toLowerCase() === 'image'
    && (clone.pdfAnnotationType || clone.data?.pdfAnnotationType) === 'Stamp';
  for (const key of PASTE_STRIPPED_PROVENANCE_KEYS) {
    if (key in clone) delete clone[key];
  }
  if (isStamp) clone.pdfAnnotationType = 'Stamp';
  // Mirror the fresh id onto aliases the source carried; never leave a stale
  // pointer at the source annotation.
  if ('id' in clone) clone.id = freshId;
  if ('annotationId' in clone) clone.annotationId = freshId;
  if (clone.data && typeof clone.data === 'object' && !Array.isArray(clone.data)) {
    for (const key of PASTE_STRIPPED_PROVENANCE_KEYS) {
      if (key in clone.data) delete clone.data[key];
    }
    if ('annoId' in clone.data) delete clone.data.annoId;
    clone.data.id = freshId;
  } else {
    // Every native object carries data.id (creation contract). Imported
    // sources may have had no data at all — without data.id the history
    // differ would skip the clone entirely and paste would record nothing.
    clone.data = { id: freshId };
  }
  return clone;
}
