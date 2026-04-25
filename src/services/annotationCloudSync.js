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
 * Echo filter — UX rule: when the local user writes a row, Supabase realtime
 * echoes that same row back to this client. If we re-applied it we'd race
 * the user's in-progress drawing (counter pins duplicating, pen flicker).
 * Pass `currentUserId` so we can drop events where last_modified_by matches
 * the local user. Mirrors the existing pattern in App.jsx for highlights:
 *   if (annotation.lastModifiedBy === user.id) return;
 *
 * The subscriber filters out highlight rows so the existing highlight
 * subscription in documentAnnotationService.js continues to own them
 * without conflict.
 */
export function subscribeToAllNonHighlightAnnotations(documentId, callbacks = {}, options = {}) {
  if (!supabase) return () => {};

  const { currentUserId = null } = options;
  const {
    onFabricInsert,
    onFabricUpdate,
    onFabricDelete,
    onCalloutInsert,
    onCalloutUpdate,
    onCalloutDelete,
    onError
  } = callbacks;

  console.log('[CloudSync][realtime] subscribing ' + JSON.stringify({
    documentId,
    currentUserId,
    hasFabricInsert: !!onFabricInsert,
    hasFabricUpdate: !!onFabricUpdate,
    hasFabricDelete: !!onFabricDelete,
    hasCalloutInsert: !!onCalloutInsert,
    hasCalloutUpdate: !!onCalloutUpdate,
    hasCalloutDelete: !!onCalloutDelete
  }));

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
      (payload) => routeRow('insert', payload.new, callbacks, currentUserId)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'document_annotations',
        filter: `document_id=eq.${documentId}`
      },
      (payload) => routeRow('update', payload.new, callbacks, currentUserId)
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
        const oldRow = payload.old;
        if (!oldRow) return;
        if (oldRow.annotation_type === 'highlight') return; // legacy module owns it
        // Echo filter — see header comment. Drop deletes initiated by this
        // client so we don't re-process our own removal and flicker state.
        if (currentUserId && oldRow.last_modified_by === currentUserId) {
          console.log('[CloudSync][realtime] echo-filtered DELETE ' + JSON.stringify({
            highlightId: oldRow.highlight_id,
            annotationType: oldRow.annotation_type,
            lastModifiedBy: oldRow.last_modified_by,
            currentUserId
          }));
          return;
        }
        console.log('[CloudSync][realtime] applying DELETE ' + JSON.stringify({
          highlightId: oldRow.highlight_id,
          annotationType: oldRow.annotation_type,
          lastModifiedBy: oldRow.last_modified_by
        }));
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
    });

  return () => {
    console.log('[CloudSync][realtime] unsubscribing ' + JSON.stringify({ documentId }));
    if (supabase?.removeChannel) {
      supabase.removeChannel(channel);
    }
  };
}

function routeRow(event, row, callbacks, currentUserId) {
  if (!row) return;
  const type = row.annotation_type;
  if (type === 'highlight') return; // legacy module owns it

  // Echo filter — UX rule: a Supabase realtime echo of the user's own write
  // would race the user's in-progress UI (e.g. counter doubling, pen flicker).
  // Drop events whose last_modified_by matches this client's userId so we
  // only react to writes from other devices/users.
  if (currentUserId && row.last_modified_by === currentUserId) {
    console.log(`[CloudSync][realtime] echo-filtered ${event.toUpperCase()} ` + JSON.stringify({
      highlightId: row.highlight_id,
      annotationType: type,
      lastModifiedBy: row.last_modified_by,
      currentUserId
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
