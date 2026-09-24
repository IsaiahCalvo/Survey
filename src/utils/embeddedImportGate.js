/**
 * embeddedImportGate.js — when to import a PDF's OWN embedded annotations
 * into the annotation store, and which ones (per-field sync, 2026-09-24).
 *
 * The store moved to a new map (`marks`, store v3). Documents first opened by
 * an older build already imported their PDF's built-in markup — into the old
 * `annotations` map, which this build no longer reads — and stamped the
 * server-side `documents.embedded_import_completed_at` column. That column
 * therefore cannot gate the import any more: the owner accepted losing their
 * own old markup, not the markup that ships inside the PDF file.
 *
 * The gate is a marker INSIDE the document's Y.Doc meta map, written only by
 * this store version (EMBEDDED_IMPORT_MARKER_KEY). The first editor open of a
 * document on this build imports the PDF's embedded annotations into `marks`
 * once, then writes the marker; every later open (anyone, any device) skips.
 *
 * Rules:
 *   * Only a confirmed writable role (owner / editor) imports; viewers and a
 *     not-yet-resolved role never write (the PDF's own layer still shows).
 *   * Ids are deterministic (the PDF annotation's own id, else its page +
 *     position in the file), so two editors importing at the same moment
 *     write the same keys with the same content — no duplicates.
 *   * An embedded annotation someone deleted (a deletion tombstone, shared by
 *     every build) is never brought back.
 *   * The marker is written only after every imported mark is in the store,
 *     so a tab closed mid-import retries on the next open.
 *
 * Pure JS — the Node test runner imports this directly.
 */

export const EMBEDDED_IMPORT_MARKER_KEY = 'embeddedImportedIntoMarks';

export function isWritableDocumentRole(role) {
  return role === 'owner' || role === 'editor';
}

/**
 * 'wait' (role not known yet), 'skip' (viewer, or already imported into
 * this store), or 'import'.
 */
export function embeddedImportDecision({ role, marker }) {
  if (marker) return 'skip';
  if (role == null) return 'wait';
  if (!isWritableDocumentRole(role)) return 'skip';
  return 'import';
}

function tombstoneKey(pageNumber, pdfAnnotationId) {
  return `${Number(pageNumber || 1)}\u0000${String(pdfAnnotationId)}`;
}

/** The deterministic storage id an imported object is saved under. */
export function embeddedImportStableId(object, pageNumber, index) {
  const id = object?.id || object?.data?.id || object?.pdfAnnotationId;
  return id != null && String(id) !== '' ? String(id) : `pdf-embedded-${pageNumber}-${index}`;
}

/**
 * The objects to add on one page: stamped with their stable id, minus any
 * already in the store / on screen (`existingIds`) and any whose PDF
 * annotation was deleted (`deletedPdfAnnotations` tombstones).
 */
export function selectEmbeddedImportObjects(objects, pageNumber, {
  existingIds = new Set(),
  deletedPdfAnnotations = [],
} = {}) {
  const deleted = new Set(
    (deletedPdfAnnotations || [])
      .filter((entry) => entry?.pdfAnnotationId != null)
      .map((entry) => tombstoneKey(entry.pageNumber, entry.pdfAnnotationId)),
  );
  return (objects || [])
    .map((object, index) => {
      const stableId = embeddedImportStableId(object, pageNumber, index);
      return { ...object, id: stableId, data: { ...(object?.data || {}), id: stableId } };
    })
    .filter((object) => !existingIds.has(object.id))
    .filter((object) => !(
      object.pdfAnnotationId != null
      && deleted.has(tombstoneKey(pageNumber, object.pdfAnnotationId))
    ));
}
