// src/services/legacyCutoverSeal.js
//
// documents.cutover_completed_at says "this document's legacy
// document_annotations rows are covered by its Y.Doc; read the Y.Doc, not the
// per-device local cache". The old collab layer's crdtBackfill used to write
// it. With legacy-collab-retired on, that backfill no longer runs, so this
// seals from the annotationDocSync doc instead.
//
// Safe rule: seal only when EVERY legacy non-survey row's annotation_id is
// already a key in the doc (`marks`, or the older `annotations` map still
// waiting for its carry-over). Nothing is imported here: if any row is
// missing, the document stays unsealed, which is exactly how it behaves today,
// and no mark can be lost or resurrected by a guess at its shape.
//
// Pure module (deps injected): runs in Node tests.

import { LEGACY_ANNOTATIONS_MAP, MARKS_MAP } from './annotationMarkStore.js';

export function docHasAnnotationKey(doc, key) {
  if (!doc || !key) return false;
  return doc.getMap(MARKS_MAP).has(key) || doc.getMap(LEGACY_ANNOTATIONS_MAP).has(key);
}

/** Legacy row ids that the doc does not hold yet. */
export function legacyIdsMissingFromDoc(doc, rows) {
  const missing = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.annotation_id;
    if (!id) continue;
    if (!docHasAnnotationKey(doc, id)) missing.push(id);
  }
  return missing;
}

/**
 * Seal the document when the doc covers every legacy row.
 * @returns {Promise<{status: 'already-sealed'|'read-failed'|'legacy-marks-missing'|'write-failed'|'sealed', missing?: string[]}>}
 */
export async function sealCutoverIfCovered({
  supabase,
  documentId,
  doc,
  resolveMetadata,
  loadLegacyRows,
  invalidateMetadata,
  now = () => new Date().toISOString(),
}) {
  if (!supabase || !documentId || !doc) return { status: 'read-failed' };
  let meta;
  try {
    meta = await resolveMetadata(documentId, { supabase });
  } catch {
    return { status: 'read-failed' };
  }
  if (meta?.cutoverCompletedAt) return { status: 'already-sealed' };

  let result;
  try {
    result = await loadLegacyRows(documentId);
  } catch {
    return { status: 'read-failed' };
  }
  if (!result || result.error || !Array.isArray(result.rawRows)) return { status: 'read-failed' };

  const missing = legacyIdsMissingFromDoc(doc, result.rawRows);
  if (missing.length > 0) return { status: 'legacy-marks-missing', missing };

  try {
    const { error } = await supabase
      .from('documents')
      .update({ cutover_completed_at: now() })
      .eq('id', documentId)
      .is('cutover_completed_at', null);
    if (error) return { status: 'write-failed' };
  } catch {
    return { status: 'write-failed' };
  }
  invalidateMetadata?.(documentId);
  return { status: 'sealed' };
}
