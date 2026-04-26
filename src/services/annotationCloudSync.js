/**
 * All-types annotation cloud sync — Phase 21.
 *
 * Sits next to documentAnnotationService.js and operates on the same
 * document_annotations table. The existing highlight-only flow in
 * documentAnnotationService.js is unchanged and still owns highlight rows.
 * This module owns the rest: ink, freetext, square, circle, line, polyline,
 * polygon, stamp, sticky_note, callout, counter, eraser.
 *
 * The two modules co-exist by row category. Highlights and non-highlight
 * rows share the table but never collide because each row's
 * annotation_type is the source of truth for which module owns it.
 */

import { supabase } from '../supabaseClient.js';
import {
  serializeFabricObjectToRow,
  deserializeRowToFabricObject,
  serializeAnnotationsByPage,
  deserializeRowsToAnnotationsByPage,
  serializeCalloutToRow,
  deserializeRowToCallout,
  deserializeRowsToCallouts
} from './annotationTypeSerializers.js';

const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser'
];

/**
 * Push a single Fabric object up to the cloud. Inserts or updates by
 * (document_id, highlight_id).
 */
export async function upsertFabricAnnotation(fabricObj, opts = {}) {
  if (!supabase) return { data: null, error: new Error('Supabase unavailable') };
  const row = serializeFabricObjectToRow(fabricObj, opts);
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(row, { onConflict: 'document_id,highlight_id', ignoreDuplicates: false })
    .select()
    .single();
  if (error) {
    console.error('[CloudSync] upsertFabricAnnotation failed:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

/**
 * Push every Fabric object across every page up to the cloud in one batch.
 * Used by the one-time local-to-cloud migration and by debounced bulk save.
 */
export async function upsertAnnotationsByPage(annotationsByPage, opts = {}) {
  if (!supabase) return { data: [], error: new Error('Supabase unavailable') };
  const rows = serializeAnnotationsByPage(annotationsByPage, opts);
  if (rows.length === 0) {
    console.log('[CloudSync][push] upsertAnnotationsByPage: nothing to push (0 rows)');
    return { data: [], error: null };
  }
  const byType = rows.reduce((acc, r) => {
    acc[r.annotation_type] = (acc[r.annotation_type] || 0) + 1;
    return acc;
  }, {});
  const t0 = Date.now();
  // JSON.stringify so values survive Windows DevTools "Save as..." export,
  // which collapses live object refs to the literal string "Object".
  console.log('[CloudSync][push] upsertAnnotationsByPage start ' + JSON.stringify({
    documentId: opts.documentId,
    userId: opts.userId,
    totalRows: rows.length,
    rowsByType: byType,
    pages: Object.keys(annotationsByPage || {}).length
  }));
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(rows, { onConflict: 'document_id,highlight_id', ignoreDuplicates: false })
    .select();
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][push] upsertAnnotationsByPage failed ' + JSON.stringify({
      elapsedMs,
      error: error?.message || String(error)
    }));
    return { data: [], error };
  }
  console.log('[CloudSync][push] upsertAnnotationsByPage ok ' + JSON.stringify({
    elapsedMs,
    rowsReturned: data?.length || 0
  }));
  return { data: data || [], error: null };
}

/**
 * Push every callout up to the cloud.
 */
export async function upsertCallouts(callouts, opts = {}) {
  if (!supabase) return { data: [], error: new Error('Supabase unavailable') };
  if (!Array.isArray(callouts) || callouts.length === 0) {
    console.log('[CloudSync][push] upsertCallouts: nothing to push (empty list)');
    return { data: [], error: null };
  }
  const rows = callouts.map((c) => serializeCalloutToRow(c, opts));
  const t0 = Date.now();
  console.log('[CloudSync][push] upsertCallouts start ' + JSON.stringify({
    documentId: opts.documentId,
    userId: opts.userId,
    count: rows.length
  }));
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(rows, { onConflict: 'document_id,highlight_id', ignoreDuplicates: false })
    .select();
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][push] upsertCallouts failed ' + JSON.stringify({
      elapsedMs,
      error: error?.message || String(error)
    }));
    return { data: [], error };
  }
  console.log('[CloudSync][push] upsertCallouts ok ' + JSON.stringify({
    elapsedMs,
    rowsReturned: data?.length || 0
  }));
  return { data: data || [], error: null };
}

/**
 * Delete a single annotation row by client-side highlight_id.
 */
export async function deleteAnnotation(documentId, highlightId) {
  if (!supabase) return { success: false, error: new Error('Supabase unavailable') };
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .eq('highlight_id', highlightId);
  if (error) {
    console.error('[CloudSync] deleteAnnotation failed:', error);
    return { success: false, error };
  }
  return { success: true, error: null };
}

/**
 * Delete many annotation rows by client-side highlight_ids.
 */
export async function deleteAnnotations(documentId, highlightIds) {
  if (!supabase) return { success: false, error: new Error('Supabase unavailable') };
  if (!Array.isArray(highlightIds) || highlightIds.length === 0) {
    return { success: true, error: null };
  }
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .in('highlight_id', highlightIds);
  if (error) {
    console.error('[CloudSync] deleteAnnotations failed:', error);
    return { success: false, error };
  }
  return { success: true, error: null };
}

/**
 * Load every non-highlight annotation for a document and return it split
 * into the in-app shape slices: { annotationsByPage, callouts }.
 *
 * Highlights are intentionally skipped — they have their own loader in
 * documentAnnotationService.js and own their own state slice in App.jsx.
 */
export async function loadAllNonHighlightAnnotations(documentId) {
  if (!supabase) {
    return { annotationsByPage: {}, callouts: [], error: new Error('Supabase unavailable') };
  }
  if (!documentId) {
    return { annotationsByPage: {}, callouts: [], error: null };
  }
  const t0 = Date.now();
  console.log('[CloudSync][hydrate] loadAllNonHighlightAnnotations start ' + JSON.stringify({ documentId }));
  const { data, error } = await supabase
    .from('document_annotations')
    .select('*')
    .eq('document_id', documentId)
    .in('annotation_type', NON_HIGHLIGHT_TYPES)
    .order('page_number', { ascending: true });
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][hydrate] loadAllNonHighlightAnnotations failed ' + JSON.stringify({
      elapsedMs,
      error: error?.message || String(error)
    }));
    return { annotationsByPage: {}, callouts: [], error };
  }
  const rows = data || [];
  const byType = rows.reduce((acc, r) => {
    acc[r.annotation_type] = (acc[r.annotation_type] || 0) + 1;
    return acc;
  }, {});
  const annotationsByPage = deserializeRowsToAnnotationsByPage(rows);
  const callouts = deserializeRowsToCallouts(rows);
  console.log('[CloudSync][hydrate] loadAllNonHighlightAnnotations ok ' + JSON.stringify({
    elapsedMs,
    totalRows: rows.length,
    rowsByType: byType,
    pagesWithObjects: Object.keys(annotationsByPage).length,
    calloutCount: callouts.length
  }));
  return {
    annotationsByPage,
    callouts,
    rawRows: rows,
    error: null
  };
}

/**
 * Subscribe to real-time changes for non-highlight annotations on a document.
 *
 * Routes incoming rows to type-aware callbacks:
 *   - onFabricInsert(fabricObject, pageNumber, highlightId) — for ink, shapes,
 *     text, stamps, sticky notes, counters, eraser
 *   - onFabricUpdate(fabricObject, pageNumber, highlightId)
 *   - onFabricDelete(highlightId)
 *   - onCalloutInsert(callout)
 *   - onCalloutUpdate(callout)
 *   - onCalloutDelete(highlightId)
 *   - onError(error)
 *
 * Echo filter — UX rule: when this CLIENT writes a row, Supabase realtime
 * echoes the same row back to this client. If we re-applied it we'd race
 * the user's in-progress drawing (counter pins duplicating, pen flicker).
 * The filter compares `clientSessionId` (a per-tab/per-Electron-process
 * UUID embedded in annotation_data) so the user's OWN device drops its
 * own writes while the SAME user's OTHER device (different session) still
 * gets the live update. Filtering on `last_modified_by === userId` would
 * also drop cross-device updates for the same account, breaking the
 * primary use case for cloud sync.
 *
 * `currentUserId` is kept as a fallback for legacy rows written before the
 * sessionId field existed.
 *
 * The subscriber filters out highlight rows so the existing highlight
 * subscription in documentAnnotationService.js continues to own them
 * without conflict.
 */
export function subscribeToAllNonHighlightAnnotations(documentId, callbacks = {}, options = {}) {
  if (!supabase) return () => {};

  const { currentUserId = null, currentSessionId = null } = options;
  const {
    onFabricInsert,
    onFabricUpdate,
    onFabricDelete,
    onCalloutInsert,
    onCalloutUpdate,
    onCalloutDelete,
    onDeleteFallback,
    onError
  } = callbacks;

  console.log('[CloudSync][realtime] subscribing ' + JSON.stringify({
    documentId,
    currentUserId,
    currentSessionId,
    hasFabricInsert: !!onFabricInsert,
    hasFabricUpdate: !!onFabricUpdate,
    hasFabricDelete: !!onFabricDelete,
    hasCalloutInsert: !!onCalloutInsert,
    hasCalloutUpdate: !!onCalloutUpdate,
    hasCalloutDelete: !!onCalloutDelete
  }));

  const { onSubscribed } = callbacks;

  const channel = supabase
    .channel(`all-annotations:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => routeRow('insert', payload.new, callbacks, currentUserId, currentSessionId)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => routeRow('update', payload.new, callbacks, currentUserId, currentSessionId)
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
        const oldRow = payload.old || {};
        if (oldRow.annotation_type === 'highlight') return; // legacy module owns it
        // 2026-04-25 — DO NOT echo-filter DELETEs by user-id. Postgres
        // DELETE payloads only carry the primary key, so we can't
        // recover the originating sessionId. Applying our own DELETE
        // echo is harmless: removing a highlight_id that's already
        // absent from local state is a no-op.
        console.log('[CloudSync][realtime] applying DELETE ' + JSON.stringify({
          highlightId: oldRow.highlight_id,
          annotationType: oldRow.annotation_type,
          lastModifiedBy: oldRow.last_modified_by,
          payloadKeys: Object.keys(oldRow)
        }));
        // 2026-04-26 — Per-id apply path requires the row payload to
        // include `highlight_id` AND `annotation_type`. That requires
        // the table to be configured with REPLICA IDENTITY FULL — but
        // even with that set, Supabase realtime sometimes serves
        // empty `payload.old` for a window after the schema change.
        // FALLBACK: when the payload is empty (no highlight_id), do
        // a full cloud refetch and reconcile. This always converges
        // to the correct state regardless of payload completeness,
        // at the cost of one extra fetch per DELETE event.
        if (!oldRow.highlight_id || !oldRow.annotation_type) {
          if (onDeleteFallback) {
            try {
              onDeleteFallback();
            } catch (err) {
              console.warn('[CloudSync][realtime] delete fallback threw: ' + (err?.message || err));
            }
          }
          return;
        }
        if (oldRow.annotation_type === 'callout') {
          if (onCalloutDelete) onCalloutDelete(oldRow.highlight_id);
        } else if (NON_HIGHLIGHT_TYPES.includes(oldRow.annotation_type)) {
          if (onFabricDelete) onFabricDelete(oldRow.highlight_id);
        }
      }
    )
    .subscribe((status, err) => {
      console.log('[CloudSync][realtime] subscribe status ' + JSON.stringify({
        status,
        error: err?.message || null
      }));
      if (err) {
        console.error('[CloudSync] subscribe error: ' + (err?.message || String(err)));
        if (onError) onError(err);
      }
      // 2026-04-25 — onSubscribed lets the hook trigger a "catch-up"
      // re-hydrate the moment realtime is live. Closes the race where
      // rows pushed by another device between the initial hydrate query
      // and the subscription becoming active would otherwise be lost
      // until the next document open / refresh.
      if (status === 'SUBSCRIBED' && typeof onSubscribed === 'function') {
        try { onSubscribed(); } catch (cbErr) {
          console.warn('[CloudSync] onSubscribed callback threw: ' + (cbErr?.message || String(cbErr)));
        }
      }
    });

  return () => {
    console.log('[CloudSync][realtime] unsubscribing ' + JSON.stringify({ documentId }));
    if (supabase?.removeChannel) {
      supabase.removeChannel(channel);
    }
  };
}

function routeRow(event, row, callbacks, currentUserId, currentSessionId) {
  if (!row) return;
  const type = row.annotation_type;
  if (type === 'highlight') return; // legacy module owns it

  // Echo filter — UX rule: a Supabase realtime echo of THIS SESSION's own
  // write would race the user's in-progress UI (counter doubling, pen
  // flicker). We drop only events whose annotation_data.clientSessionId
  // matches the local session, so the SAME user's OTHER device (a
  // different session id) still gets the live update.
  const rowSessionId = row.annotation_data?.clientSessionId || null;
  if (currentSessionId && rowSessionId && rowSessionId === currentSessionId) {
    console.log(`[CloudSync][realtime] echo-filtered ${event.toUpperCase()} ` + JSON.stringify({
      highlightId: row.highlight_id,
      annotationType: type,
      lastModifiedBy: row.last_modified_by,
      rowSessionId,
      currentSessionId,
      reason: 'same-session'
    }));
    return;
  }
  // Legacy fallback for rows written before the sessionId field existed:
  // if there's no rowSessionId on the incoming row but last_modified_by
  // matches the current user, treat as a same-user echo.
  if (!rowSessionId && currentUserId && row.last_modified_by === currentUserId) {
    console.log(`[CloudSync][realtime] echo-filtered ${event.toUpperCase()} ` + JSON.stringify({
      highlightId: row.highlight_id,
      annotationType: type,
      lastModifiedBy: row.last_modified_by,
      currentUserId,
      reason: 'legacy-no-session-id'
    }));
    return;
  }

  if (type === 'callout') {
    try {
      const callout = deserializeRowToCallout(row);
      console.log(`[CloudSync][realtime] applying ${event.toUpperCase()} callout ` + JSON.stringify({
        highlightId: row.highlight_id,
        pageNumber: row.page_number,
        lastModifiedBy: row.last_modified_by
      }));
      if (event === 'insert' && callbacks.onCalloutInsert) callbacks.onCalloutInsert(callout);
      else if (event === 'update' && callbacks.onCalloutUpdate) callbacks.onCalloutUpdate(callout);
    } catch (err) {
      console.warn('[CloudSync] failed to deserialize callout row: ' + (err?.message || String(err)));
    }
    return;
  }
  if (NON_HIGHLIGHT_TYPES.includes(type)) {
    try {
      const { fabricObject, pageNumber, highlightId } = deserializeRowToFabricObject(row);
      console.log(`[CloudSync][realtime] applying ${event.toUpperCase()} fabric ` + JSON.stringify({
        highlightId,
        annotationType: type,
        pageNumber,
        lastModifiedBy: row.last_modified_by
      }));
      if (event === 'insert' && callbacks.onFabricInsert) {
        callbacks.onFabricInsert(fabricObject, pageNumber, highlightId);
      } else if (event === 'update' && callbacks.onFabricUpdate) {
        callbacks.onFabricUpdate(fabricObject, pageNumber, highlightId);
      }
    } catch (err) {
      console.warn('[CloudSync] failed to deserialize fabric row: ' + (err?.message || String(err)));
    }
  }
}
