/**
 * Document Annotation Sync Service
 * Handles real-time sync of annotations to/from Supabase
 * Uses document-based architecture (not template-based)
 */

import { supabase } from '../supabaseClient';
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

  const rows = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .order('page_number', { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      console.error('[AnnotationSync] Error fetching annotations:', error);
      return { data: [], error };
    }

    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
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
 * Upsert a single annotation (insert or update)
 */
export async function upsertAnnotation(annotation) {
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(annotation, {
      onConflict: 'document_id,annotation_id',
      ignoreDuplicates: false
    })
    .select()
    .single();

  if (error) {
    console.error('[AnnotationSync] Error upserting annotation:', error);
    return { data: null, error };
  }

  return { data, error: null };
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
  for (const batch of batches) {
    const result = await supabase
      .from('document_annotations')
      .upsert(batch, {
        onConflict: 'document_id,annotation_id',
        ignoreDuplicates: false
      })
      .select();
    if (result.error) {
      error = result.error;
      break;
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
 * Uses the Postgres jsonb `?` (key-exists) operator on the
 * `annotation_data->'checklistResponses'` path. We only count rows where
 * the key is actually present — markers that never recorded a response
 * for that item won't show up.
 *
 * Returns 0 on error (fail-open to hard-delete confirm path keeps the UI
 * usable when Supabase is unreachable). Non-fatal — callers should treat
 * a 0 count as "safe to hard-delete without confirm".
 *
 * @param {string} itemId
 * @returns {Promise<number>}
 */
export async function countSurveyMarkersReferencingChecklistItem(itemId) {
  if (!itemId || typeof itemId !== 'string') return 0;
  try {
    const { count, error } = await supabase
      .from('document_annotations')
      .select('annotation_id', { count: 'exact', head: true })
      .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .not('annotation_data->checklistResponses', 'is', null)
      .filter('annotation_data->checklistResponses', 'cs', JSON.stringify({ [itemId]: {} }));
    if (error) {
      // The `cs` (contains) operator with an empty-object stub may be over-strict
      // against rows where the response has extra fields — fall back to a fetch +
      // count-in-memory pass that's accurate but more bytes over the wire.
      console.warn('[ChecklistArchive] count via cs filter failed, falling back:', error);
      return await countSurveyMarkersReferencingChecklistItemFallback(itemId);
    }
    return typeof count === 'number' ? count : 0;
  } catch (err) {
    console.warn('[ChecklistArchive] count threw, falling back:', err);
    return await countSurveyMarkersReferencingChecklistItemFallback(itemId);
  }
}

async function countSurveyMarkersReferencingChecklistItemFallback(itemId) {
  try {
    const { data, error } = await supabase
      .from('document_annotations')
      .select('annotation_data')
      .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)
      .not('annotation_data', 'is', null)
      .limit(5000);
    if (error || !Array.isArray(data)) return 0;
    let n = 0;
    for (const row of data) {
      const resp = row?.annotation_data?.checklistResponses;
      if (resp && typeof resp === 'object' && Object.prototype.hasOwnProperty.call(resp, itemId)) {
        n += 1;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Delete an annotation by annotation_id
 */
export async function deleteAnnotation(documentId, annotationId) {
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId);

  if (error) {
    console.error('[AnnotationSync] Error deleting annotation:', error);
    return { success: false, error };
  }

  return { success: true, error: null };
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

/**
 * Load annotations from Supabase and convert to local format
 */
export async function loadAnnotationsFromSupabase(documentId) {
  const { data, error } = await getDocumentAnnotations(documentId);

  if (error) {
    return { surveyMarkers: {}, error };
  }

  // Convert to local surveyMarkers format
  const surveyMarkers = {};
  for (const annotation of data) {
    const localAnnotation = mapSurveyMarkerRowToLocalAnnotation(annotation);
    if (!localAnnotation?.annotationId) continue;
    surveyMarkers[localAnnotation.annotationId] = localAnnotation;
  }

  return { surveyMarkers, error: null };
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

const classifyPresenceError = (error) => {
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
    const classification = classifyPresenceError(error);
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
    .select(`
      *,
      user:auth.users(id, email, raw_user_meta_data)
    `)
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
