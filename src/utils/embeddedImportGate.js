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
 *   * w27: a page pdf.js could not read at all is skipped by the importer
 *     (the rest imports). A marker written then would leave that page's
 *     markup out for good, so while such a page carries markup (or the file's
 *     raw index could not tell) the marker waits and the next open tries
 *     again (marks already present are skipped by id; deleted ones are
 *     tombstoned). The retry is bounded: after EMBEDDED_IMPORT_MAX_ATTEMPTS
 *     attempts (one per time a screen opens the document) that still cannot
 *     read it, the marker is written with `incompletePages` and that page's
 *     markup is not imported (it is recorded there and logged, not shown to
 *     the user), so a page that always fails costs a full re-parse at most
 *     that many times. Without the raw bytes every unreadable page counts as
 *     carrying markup. A single annotation the converter cannot read is NOT
 *     retried (the converter would fail the same way again); it is only
 *     logged.
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

// Meta key holding { attempts, pages, at } while an import is incomplete.
export const EMBEDDED_IMPORT_INCOMPLETE_KEY = 'embeddedImportIncomplete';
export const EMBEDDED_IMPORT_MAX_ATTEMPTS = 3;

/**
 * Pages the importer could not read at all (its per-page native-layer policy
 * says 'page-import-failed') that carry markup: the raw index lists visible
 * annotations there, or the raw index was not available to say.
 */
export function embeddedImportFailedPages(nativeLayerPolicyByPage) {
  return Object.entries(nativeLayerPolicyByPage || {})
    .filter(([, policy]) => (
      policy?.reason === 'page-import-failed'
      && (policy.rawAnnotationCount == null || Number(policy.rawAnnotationCount) > 0)
    ))
    .map(([pageKey, policy]) => Number(policy?.pageNumber ?? pageKey))
    .sort((a, b) => a - b);
}

/**
 * Whether the once-only marker may be written after an import pass.
 *   failedPages  embeddedImportFailedPages(...)
 *   previous     the EMBEDDED_IMPORT_INCOMPLETE_KEY meta value, if any
 * Returns { write: true } | { write: true, incompletePages, attempts }
 *       | { write: false, pages, attempts } (record attempts, retry next open).
 */
export function embeddedImportMarkerDecision({ failedPages = [], previous = null } = {}) {
  if (!failedPages.length) return { write: true };
  const attempts = Math.max(0, Number(previous?.attempts) || 0) + 1;
  if (attempts >= EMBEDDED_IMPORT_MAX_ATTEMPTS) {
    return { write: true, incompletePages: failedPages, attempts };
  }
  return { write: false, pages: failedPages, attempts };
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
