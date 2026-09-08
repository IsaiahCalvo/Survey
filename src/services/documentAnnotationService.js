/**
 * Document Annotation Sync Service
 * Handles real-time sync of annotations to/from Supabase
 * Uses document-based architecture (not template-based)
 */

import { supabase } from '../supabaseClient';
import { collectKeysetRows } from './annotationReadPagination.js';
import { diffDeletedSurveyMarkerIds } from './surveyMarkerSyncDiff.js';
import { surveyMarkerSyncDiag } from './surveyMarkerSyncDiag.js';
import { chunkRowsForAnnotationUpsert } from '../utils/annotationBatching.js';
import {
  buildSurveyMarkerRow,
  mapSurveyMarkerRowToLocalAnnotation,
} from './documentSurveyMarkerMapper.js';
import {
  isSurveyMarkerType,
  SURVEY_MARKER_TYPE_VALUES,
} from '../utils/surveyMarkerType.js';

const SUPABASE_PAGE_SIZE = 1000;

// KAL-285 — small helper to run batch upserts with bounded concurrency
// instead of one-at-a-time. Keeps the existing "stop on first error" and
// in-order `data` accumulation semantics: results are collected per-batch,
// and once any batch errors, no further batches are started (batches already
// in flight are allowed to settle).
const BATCH_UPSERT_CONCURRENCY = 4;

async function runWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let failed = false;

  async function runNext() {
    while (!failed) {
      const i = nextIndex++;
      if (i >= items.length) return;
      const result = await worker(items[i], i);
      results[i] = result;
      if (result?.error) {
        failed = true;
        return;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

const isLegacyFabricSurveyMarkerRow = (row) =>
  isSurveyMarkerType(row?.annotation_type) && !!row.annotation_data?.fabricObject;

const classifyAnnotationSyncError = (error) => {
  const message = error?.message || '';
  const code = error?.code || null;
  const status = Number(error?.status) || null;
  const normalizedMessage = typeof message === 'string' ? message.toLowerCase() : '';
  const isRLSError = code === '42501' || normalizedMessage.includes('row-level security');
  const isMissingTable = code === '42P01';
  const isNotFound = status === 404 || normalizedMessage.includes('404') || normalizedMessage.includes('not found');

  if (isRLSError) {
    return {
      errorClass: 'RLS',
      nonRetryable: true,
      isRLSError: true
    };
  }

  if (isMissingTable) {
    return {
      errorClass: 'SCHEMA_MISSING',
      nonRetryable: true,
      isRLSError: false
    };
  }

  if (isNotFound) {
    return {
      errorClass: 'NOT_FOUND',
      nonRetryable: true,
      isRLSError: false
    };
  }

  return {
    errorClass: code || 'UNKNOWN',
    nonRetryable: false,
    isRLSError: false
  };
};

// ============================================
// ANNOTATION CRUD OPERATIONS
// ============================================

/**
 * Get all HIGHLIGHT annotations for a document.
 *
 * 2026-04-27 — ROOT CAUSE FIX. This function used to return EVERY row in
 * `document_annotations` regardless of `annotation_type`, which caused the
 * cross-device data-loss bug: when a device loaded a document that had an
 * ink stroke (annotation_type='ink') in the cloud, the row got pulled into
 * the legacy `surveyMarkers` state map with empty/null survey marker
 * fields. The legacy sync useEffect then immediately re-pushed the same
 * row with `annotation_type: 'survey-marker'` and `bounds: {}`, OVERWRITING
 * the ink stroke's annotation_data via the (document_id, annotation_id)
 * upsert conflict resolution. The new cloud-sync hook on every device
 * filters its hydrate query by NON_HIGHLIGHT_TYPES, so the now-corrupted
 * row was excluded and devices showed empty pages on next refresh.
 *
 * Filtering this loader by annotation_type='survey-marker' keeps the legacy
 * surveyMarker pipeline strictly surveyMarker-only, so ink/shape/text/callout
 * rows owned by the new cloud-sync hook are never round-tripped through
 * surveyMarker format.
 */
export async function getDocumentAnnotations(documentId) {
  if (!documentId) return { data: [], error: null };

  // KAL-282 — keyset (seek) pagination on the primary key, matching the
  // non-survey read path (annotationCloudSync.loadPagedAnnotationRows) and
  // backed by the same KAL-241 (document_id, id) index.
  //
  // This loop used to page with OFFSET (`.range(from, from + 999)`) ordered by
  // `page_number`. That was wrong on TWO counts:
  //
  //   1. CORRECTNESS. `page_number` is not unique — a document has thousands of
  //      markers spread over a few dozen pages, so ties are ordered arbitrarily
  //      and the order is not stable between the statements that fetch each
  //      window. A row can therefore land on both sides of a window boundary
  //      (returned twice) or neither (skipped entirely). Seeking by `id >
  //      cursor` on the unique, non-null primary key makes skips and duplicates
  //      impossible.
  //   2. COST. OFFSET makes Postgres read, RLS-check and then discard every row
  //      before the window on each deeper page — the quadratic pattern KAL-241
  //      already removed from the non-survey path.
  //
  // agent-cli mirrors this reader (`survey-read` in agent-cli/index.mjs and
  // agent-cli/survey-roundtrip.mjs). Per the standing rule, those mirrors were
  // updated to keyset in the same commit so the headless harness keeps
  // reporting the same row set the app sees.
  const { rows, error } = await collectKeysetRows({
    pageSize: SUPABASE_PAGE_SIZE,
    fetchPage: async (cursorId) => {
      let query = supabase
        .from('document_annotations')
        .select('*')
        .eq('document_id', documentId)
        .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
        .order('id', { ascending: true })
        .limit(SUPABASE_PAGE_SIZE);
      if (cursorId !== null) query = query.gt('id', cursorId);
      const { data, error: pageError } = await query;
      return { data, error: pageError };
    },
  });

  if (error) {
    console.error('[AnnotationSync] Error fetching annotations:', error);
    return { data: [], error };
  }

  const filteredRows = rows.filter((row) => !isLegacyFabricSurveyMarkerRow(row));
  // Bug 1/2 diag — count what the legacy hydrate kept versus dropped. If a
  // survey marker ever shows up DARKER on the second device, this log + the SVG
  // layer's surveyMarkerSkip log answer "did the same row come through
  // both legacy and new paths" in a single paste.
  surveyMarkerSyncDiag('load.legacy', {
    documentId,
    totalRows: rows.length,
    fabricCarryingDropped: rows.length - filteredRows.length,
    keptCount: filteredRows.length,
    keptIds: filteredRows.map((r) => r.annotation_id),
  });
  return { data: filteredRows, error: null };
}


/**
 * Upsert multiple annotations in batch
 */
export async function upsertAnnotations(annotations) {
  if (!annotations || annotations.length === 0) {
    return {
      data: [],
      error: null,
      errorClass: null,
      nonRetryable: false,
      isRLSError: false
    };
  }

  const data = [];
  let error = null;
  const batches = chunkRowsForAnnotationUpsert(annotations);
  // KAL-285 — up to BATCH_UPSERT_CONCURRENCY batches in flight at once
  // instead of strictly sequential. Order of `data` accumulation below no
  // longer matches batch order under concurrency, which is fine: callers only
  // use the combined array's length/contents, never per-batch ordering.
  const results = await runWithConcurrency(
    batches,
    (batch) => supabase
      .from('document_annotations')
      .upsert(batch, {
        onConflict: 'document_id,annotation_id',
        ignoreDuplicates: false
      })
      .select(),
    BATCH_UPSERT_CONCURRENCY
  );
  for (const result of results) {
    if (!result) continue; // batch never started (short-circuited after an earlier error)
    if (result.error) {
      error = result.error;
      continue;
    }
    data.push(...(result.data || []));
  }

  if (error) {
    const classification = classifyAnnotationSyncError(error);
    if (!classification.nonRetryable && !classification.isRLSError) {
      console.error('[AnnotationSync] Error upserting annotations:', error);
    }
    return {
      data: [],
      error,
      errorClass: classification.errorClass,
      nonRetryable: classification.nonRetryable,
      isRLSError: classification.isRLSError
    };
  }

  return {
    data,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}

/**
 * KAL-44 — Count cross-document survey markers that reference a given
 * checklist item id. Used by the Survey Hub templates editor to decide
 * whether deleting a checklist item should hard-delete (count === 0) or
 * trigger the archive confirmation flow (count > 0).
 *
 * Checks a JSON key under `annotation_data->'checklistResponses'`.
 * We only count rows where
 * the key is actually present — markers that never recorded a response
 * for that item won't show up.
 *
 * THE MISSING `document_id` FILTER IS DELIBERATE — do not "fix" it (KAL-282,
 * re-confirmed 2026-08-19). A checklist item belongs to a TEMPLATE, and a
 * template is used by many documents. The only caller is the Survey Hub
 * templates editor (Dashboard.hubGetChecklistItemUsageCount), which runs when
 * NO document is open, so there is no document id to filter by and none would
 * be correct: the question being answered is "does ANY Survey Marker anywhere
 * still reference this item?" Scoping the query to one document would
 * under-count and let the editor permanently delete an item that Survey
 * Markers in other documents still point at. Cross-user leakage is not a
 * concern — RLS already restricts these rows to documents the caller can
 * access. This is a count of visible cloud rows, not a proof about managed-
 * local files, unsaved drafts, or documents outside the caller's access.
 *
 * Rejects on failure: an unknown count must never authorize hard deletion.
 *
 * @param {string} itemId
 * @returns {Promise<number>}
 */
export async function countSurveyMarkersReferencingChecklistItem(itemId) {
  // IDs become a PostgREST JSON path, not a value parameter. Reject unknown
  // legacy formats instead of letting punctuation change that path.
  if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(itemId) || /^-?\d+$/.test(itemId)) {
    throw new TypeError('Checklist item id cannot be checked safely');
  }
  const { count, error } = await supabase
    .from('document_annotations')
    .select('annotation_id', { count: 'exact', head: true })
    .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
    // JSON -> preserves explicit JSON null (unlike ->>), so null, scalar,
    // and object responses all count; only a missing key is SQL NULL.
    .not(`annotation_data->checklistResponses->${itemId}`, 'is', null);
  if (error) throw error;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Checklist usage count is unavailable');
  return count;
}


/**
 * Delete multiple annotations by annotation_ids
 */
export async function deleteAnnotations(documentId, annotationIds) {
  if (!annotationIds || annotationIds.length === 0) {
    return { success: true, error: null };
  }

  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .in('annotation_id', annotationIds);

  if (error) {
    console.error('[AnnotationSync] Error deleting annotations:', error);
    return { success: false, error };
  }

  return { success: true, error: null };
}

// ============================================
// SYNC OPERATIONS
// ============================================

// Re-export the pure diff helper so existing callers that import it from
// this module keep working. Implementation lives in `surveyMarkerSyncDiff.js`
// to keep the helper Supabase-free for unit tests under `node --test`.
export { diffDeletedSurveyMarkerIds };

/**
 * Sync all local annotations to Supabase
 * Compares local state with remote and reconciles
 *
 * @param {string} documentId
 * @param {string} userId
 * @param {object} surveyMarkers  Current surveyMarkers dict
 * @param {object} [options]
 * @param {object|null} [options.priorSurveyMarkers]  Last-synced state.
 *   When provided, the function diffs prior vs current to find deleted IDs and
 *   calls `deleteAnnotations()` for them BEFORE the upsert. Without this, the
 *   legacy path leaks cloud rows on every erase and peers keep drawing stale
 *   survey markers (Bug 2 fix, 2026-04-30).
 */
export async function syncAnnotationsToSupabase(documentId, userId, surveyMarkers, options = {}) {
  if (!documentId || !userId) {
    return { success: false, error: 'Missing documentId or userId' };
  }

  // Bug 2 fix: detect erases / removals against the prior synced state and
  // push deletes to the cloud BEFORE the upsert so peers stop rendering
  // erased survey markers. Best-effort — a failed delete logs a warning but does
  // not abort the upsert (the upsert remains the more critical write path).
  const priorSurveyMarkers = options?.priorSurveyMarkers;
  if (priorSurveyMarkers) {
    const deletedIds = diffDeletedSurveyMarkerIds(priorSurveyMarkers, surveyMarkers);
    if (deletedIds.length > 0) {
      const { success: deleteSuccess, error: deleteError } = await deleteAnnotations(documentId, deletedIds);
      // Bug 2 diag — log every delete-diff push so the user can confirm that
      // erases on this device generate cloud DELETE events. If a peer never
      // gets the DELETE, this log is the smoking gun (this device WAS told
      // about it; sync upstream is at fault).
      surveyMarkerSyncDiag('push.delete-diff', {
        documentId,
        userId,
        deletedIds,
        deletedCount: deletedIds.length,
        priorCount: Object.keys(priorSurveyMarkers).length,
        currentCount: Object.keys(surveyMarkers || {}).length,
        cloudResult: deleteSuccess ? 'OK' : 'FAILED',
        cloudError: deleteSuccess ? null : (deleteError?.message || String(deleteError)),
      });
      if (!deleteSuccess) {
        console.warn('[AnnotationSync] delete-diff failed (continuing with upsert):', deleteError, deletedIds);
      }
    }
  }

  const annotations = Object.entries(surveyMarkers || {}).map(([annotationId, annotation]) =>
    buildSurveyMarkerRow({
      documentId,
      userId,
      annotationId,
      annotation,
    })
  );

  if (annotations.length === 0) {
    return { success: true, synced: 0 };
  }

  const { data, error, errorClass, nonRetryable, isRLSError } = await upsertAnnotations(annotations);

  if (error) {
    return {
      success: false,
      error,
      errorClass: errorClass || null,
      nonRetryable: !!nonRetryable,
      isRLSError: !!isRLSError
    };
  }

  return {
    success: true,
    synced: data.length,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}


// ============================================
// REAL-TIME SUBSCRIPTIONS
// ============================================

/**
 * Subscribe to real-time annotation changes for a document
 * @returns cleanup function to unsubscribe
 */
export function subscribeToDocumentAnnotations(documentId, callbacks = {}) {
  const { onInsert, onUpdate, onDelete, onError } = callbacks;

  const channel = supabase
    .channel(`document-annotations:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        // 2026-04-27 — Skip non-surveyMarker rows. The new cloud-sync hook
        // owns ink/shape/text/callout/etc. via its own subscription;
        // routing those rows through this legacy callback corrupts them
        // (see getDocumentAnnotations comment for the data-loss chain).
        if (!isSurveyMarkerType(payload.new?.annotation_type)) return;
        if (isLegacyFabricSurveyMarkerRow(payload.new)) return;
        if (onInsert) {
          onInsert(convertToLocalFormat(payload.new));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        if (!isSurveyMarkerType(payload.new?.annotation_type)) return;
        if (isLegacyFabricSurveyMarkerRow(payload.new)) return;
        if (onUpdate) {
          onUpdate(convertToLocalFormat(payload.new), convertToLocalFormat(payload.old));
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        // DELETE payloads can carry the old row when REPLICA IDENTITY FULL
        // is set. Only forward to the legacy handler if the deleted row
        // was actually a surveyMarker; otherwise the new cloud-sync hook
        // handles it.
        if (payload.old?.annotation_type && !isSurveyMarkerType(payload.old.annotation_type)) return;
        if (isLegacyFabricSurveyMarkerRow(payload.old)) return;
        if (onDelete) {
          onDelete(payload.old.annotation_id, convertToLocalFormat(payload.old));
        }
      }
    )
    .subscribe((status, err) => {
      if (err) {
        console.error('[AnnotationSync] Subscription error:', err);
        if (onError) onError(err);
      }
    });

  // Return cleanup function
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Convert Supabase record to local annotation format
 */
function convertToLocalFormat(record) {
  if (!record) return null;
  return mapSurveyMarkerRowToLocalAnnotation(record);
}

// ============================================
// PRESENCE OPERATIONS
// ============================================

/**
 * Update user presence for a document
 */
export async function updateDocumentPresence(documentId, userId, presenceData = {}) {
  if (!documentId || !userId) return { success: false };

  const { error } = await supabase
    .from('document_presence')
    .upsert({
      document_id: documentId,
      user_id: userId,
      client_type: presenceData.clientType || 'app',
      display_name: presenceData.displayName || null,
      current_page: presenceData.currentPage || null,
      cursor_position: presenceData.cursorPosition || null,
      selected_annotation_id: presenceData.selectedAnnotationId || null,
      last_seen: new Date().toISOString()
    }, {
      onConflict: 'document_id,user_id,client_type'
    });

  if (error) {
    const classification = classifyAnnotationSyncError(error);
    // Avoid console noise for non-retryable structural errors and RLS failures.
    if (!classification.nonRetryable && !classification.isRLSError) {
      console.error('[AnnotationSync] Error updating presence:', error);
    }
    return {
      success: false,
      error,
      errorClass: classification.errorClass,
      nonRetryable: classification.nonRetryable,
      isRLSError: classification.isRLSError
    };
  }

  return {
    success: true,
    error: null,
    errorClass: null,
    nonRetryable: false,
    isRLSError: false
  };
}

/**
 * Get active users for a document
 */
export async function getDocumentPresence(documentId) {
  if (!documentId) return { data: [], error: null };

  // Get presence records from last 2 minutes
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('document_presence')
    .select('*')
    .eq('document_id', documentId)
    .gte('last_seen', cutoff);

  if (error) {
    console.error('[AnnotationSync] Error fetching presence:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Remove user presence (on disconnect)
 */
export async function removeDocumentPresence(documentId, userId, clientType = 'app') {
  if (!documentId || !userId) return { success: false };

  const { error } = await supabase
    .from('document_presence')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .eq('client_type', clientType);

  if (error) {
    console.error('[AnnotationSync] Error removing presence:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Subscribe to presence changes for a document.
 *
 * Forwards each WAL event as a delta — { type, row, prevRow } — instead of
 * re-SELECTing the whole roster on every event (that re-fetch was audit #4's
 * presence chatter). The caller applies deltas incrementally (see
 * presenceRoster.js) and seeds the initial roster via getDocumentPresence in the
 * onSubscribed callback, which also fires on every reconnect.
 */
export function subscribeToDocumentPresence(documentId, onPresenceEvent, { onSubscribed } = {}) {
  const channel = supabase
    .channel(`document-presence:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'document_presence',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => {
        const newRow = payload?.new && Object.keys(payload.new).length ? payload.new : null;
        const oldRow = payload?.old && Object.keys(payload.old).length ? payload.old : null;
        onPresenceEvent?.({ type: payload?.eventType, row: newRow, prevRow: oldRow });
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onSubscribed?.();
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// ============================================
// COLLABORATOR OPERATIONS
// ============================================

/**
 * Get collaborators for a document
 */
export async function getDocumentCollaborators(documentId) {
  if (!documentId) return { data: [], error: null };

  const { data, error } = await supabase
    .from('document_collaborators')
    // `email` is stored on the public collaborator row. Client PostgREST
    // cannot join the private auth.users schema, and that invalid join made
    // Manage Access silently render zero active members.
    .select('*')
    .eq('document_id', documentId)
    .eq('status', 'active');

  if (error) {
    console.error('[AnnotationSync] Error fetching collaborators:', error);
    return { data: [], error };
  }

  return { data: data || [], error: null };
}

/**
 * Remove a collaborator from a document
 */
export async function removeDocumentCollaborator(documentId, userId) {
  const { error } = await supabase
    .from('document_collaborators')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error removing collaborator:', error);
    return { success: false, error };
  }

  return { success: true };
}

/**
 * Update collaborator role
 * @param {string} documentId - The document the collaborator belongs to
 * @param {string} userId - The collaborator's user ID
 * @param {string} newRole - Role: 'viewer' | 'editor' | 'owner' (KAL-31: `commenter` removed from the active role set).
 */
export async function updateCollaboratorRole(documentId, userId, newRole) {
  const { error } = await supabase
    .from('document_collaborators')
    .update({ role: newRole })
    .eq('document_id', documentId)
    .eq('user_id', userId);

  if (error) {
    console.error('[AnnotationSync] Error updating collaborator role:', error);
    return { success: false, error };
  }

  return { success: true };
}
