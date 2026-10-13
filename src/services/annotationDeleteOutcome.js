// src/services/annotationDeleteOutcome.js
//
// KAL-440: a delete the database refuses must never read as a success.
//
// Row-level security on document_annotations does not RAISE when it refuses a
// DELETE — the refused rows are simply not matched, and Postgres answers
// "0 rows deleted, no error". The old delete helpers only treated a transport
// error as failure, so a refused delete was logged as a successful one while
// the row stayed in the table.
//
// This helper asks the server which rows it actually deleted
// (`DELETE ... RETURNING annotation_id`), and for every requested id that did
// not come back it reads whether the row is still there:
//   * still there  -> REFUSED (permission, or the document is locked)
//   * not there    -> already gone (a repeat delete, or never synced) — fine
// Any refused id makes the outcome `success: false` with
// `error.code === ANNOTATION_DELETE_REFUSED` and the ids in `refusedIds`.
//
// Pure: the caller passes its Supabase client.

export const ANNOTATION_DELETE_REFUSED = 'ANNOTATION_DELETE_REFUSED';
const DEFAULT_CHUNK_SIZE = 200;

const idsOf = (rows) => new Set((Array.isArray(rows) ? rows : [])
  .map((row) => row?.annotation_id)
  .filter((id) => id != null)
  .map(String));

/**
 * Delete document_annotations rows by annotation_id and report what really
 * happened.
 *
 * @param {{ supabase: object, documentId: string, annotationIds: Array<string>, chunkSize?: number }} args
 * @returns {Promise<{
 *   success: boolean,
 *   error: any,
 *   requestedIds: string[],
 *   deletedIds: string[],
 *   alreadyGoneIds: string[],
 *   refusedIds: string[],
 * }>}
 */
export async function deleteAnnotationRowsVerified({
  supabase,
  documentId,
  annotationIds,
  chunkSize = DEFAULT_CHUNK_SIZE,
}) {
  const requestedIds = [...new Set((Array.isArray(annotationIds) ? annotationIds : [])
    .filter((id) => id != null && id !== '')
    .map(String))];
  const outcome = {
    success: true,
    error: null,
    requestedIds,
    deletedIds: [],
    alreadyGoneIds: [],
    refusedIds: [],
  };
  if (requestedIds.length === 0) return outcome;
  if (!supabase) return { ...outcome, success: false, error: new Error('Supabase unavailable') };

  for (let start = 0; start < requestedIds.length; start += chunkSize) {
    const chunk = requestedIds.slice(start, start + chunkSize);
    const { data, error } = await supabase
      .from('document_annotations')
      .delete()
      .eq('document_id', documentId)
      .in('annotation_id', chunk)
      .select('annotation_id');
    if (error) return { ...outcome, success: false, error, failedChunkStart: start };

    const deleted = idsOf(data);
    outcome.deletedIds.push(...chunk.filter((id) => deleted.has(id)));
    const unmatched = chunk.filter((id) => !deleted.has(id));
    if (unmatched.length === 0) continue;

    const { data: remaining, error: readError } = await supabase
      .from('document_annotations')
      .select('annotation_id')
      .eq('document_id', documentId)
      .in('annotation_id', unmatched);
    if (readError) {
      // Cannot prove the unmatched rows are gone: never call that a success.
      return { ...outcome, success: false, error: readError, unverifiedIds: unmatched };
    }
    const stillThere = idsOf(remaining);
    for (const id of unmatched) {
      if (stillThere.has(id)) outcome.refusedIds.push(id);
      else outcome.alreadyGoneIds.push(id);
    }
  }

  if (outcome.refusedIds.length > 0) {
    const error = new Error(
      `The server refused to delete ${outcome.refusedIds.length} of ${requestedIds.length} saved mark(s).`,
    );
    error.code = ANNOTATION_DELETE_REFUSED;
    error.refusedIds = [...outcome.refusedIds];
    outcome.success = false;
    outcome.error = error;
  }
  return outcome;
}

/** True when a delete outcome failed ONLY because the server refused rows. */
export function isRefusedAnnotationDelete(outcome) {
  return Boolean(
    outcome
    && outcome.success === false
    && outcome.error?.code === ANNOTATION_DELETE_REFUSED
    && Array.isArray(outcome.refusedIds)
    && outcome.refusedIds.length > 0,
  );
}

/**
 * The words the person sees when the server kept rows they asked to delete.
 * The marks are already gone from the document everyone sees (that store lets
 * any editor delete); what stayed is the older saved copy, which today only
 * the mark's author or the document owner may remove.
 */
export function describeRefusedAnnotationDelete(outcome) {
  if (!isRefusedAnnotationDelete(outcome)) return null;
  const count = outcome.refusedIds.length;
  return count === 1
    ? 'Deleted, but the server kept a saved copy of 1 mark made by someone else. Only its author or the document owner can remove that copy.'
    : `Deleted, but the server kept a saved copy of ${count} marks made by others. Only their authors or the document owner can remove those copies.`;
}

// Documents (onceKey) that already showed the refusal message this session:
// under open editing an editor can hit it on every delete of a teammate's
// mark, so the person is told once and every later refusal is still logged.
const toastedOnceKeys = new Set();

/** Test seam: forget which documents already showed the message. */
export function resetAnnotationDeleteNotices() {
  toastedOnceKeys.clear();
}

/**
 * Log + show one message for a delete outcome. Returns true when a refusal was
 * reported. Never throws. With `onceKey` (the document id) the message shows
 * once per document per session; the console error is written every time.
 */
export function reportAnnotationDeleteOutcome(outcome, { showToast = null, source = 'annotation-delete', onceKey = null } = {}) {
  try {
    if (!outcome || outcome.success !== false) return false;
    if (isRefusedAnnotationDelete(outcome)) {
      // eslint-disable-next-line no-console
      console.error(`[AnnotationDelete] ${source}: server kept rows it refused to delete`, {
        refusedIds: outcome.refusedIds,
        deletedCount: outcome.deletedIds?.length ?? 0,
      });
      const message = describeRefusedAnnotationDelete(outcome);
      const alreadyShown = onceKey != null && toastedOnceKeys.has(String(onceKey));
      if (message && typeof showToast === 'function' && !alreadyShown) {
        if (onceKey != null) toastedOnceKeys.add(String(onceKey));
        showToast(message, 'warn');
      }
      return true;
    }
    // eslint-disable-next-line no-console
    console.error(`[AnnotationDelete] ${source}: delete failed`, outcome.error);
    return false;
  } catch {
    return false;
  }
}
