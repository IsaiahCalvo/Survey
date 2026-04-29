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

// Phase 30 — Migration Phase A — Dual-Write Era (narrow waiver per
// 30-CONTEXT.md DO NOT CHANGE list). The two functions added below
// (dualWriteFabricCommit + dualWriteFabricDelete) fan out new-annotation
// saves to BOTH the legacy document_annotations row (existing behavior,
// byte-identical) AND the CRDT path via the Phase 29 bridge.
//
// CONTEXT.md "No 'diff = delete' logic anywhere" architectural lock — these  // NO_DIFF_DELETE_OK: docstring describes the lock the file honors.
// fan-out functions NEVER read both stores and delete the difference. If    // NO_DIFF_DELETE_OK: docstring describes what the lock forbids.
// one side fails, the failed side enqueues for retry; the other side stays
// as-is. Defends Pitfall 5 (the simple-sync killer in CRDT clothing).
//
// NO_DIFF_DELETE_OK: the only `delete` calls in this file are user-initiated
// (deleteAnnotation / deleteAnnotations / dualWriteFabricDelete) and target
// a single annoId. Never compare-then-delete-the-diff.  // NO_DIFF_DELETE_OK: docstring; pattern explicitly banned.
//
// Scanned by scripts/check-no-diff-delete.mjs.  // NO_DIFF_DELETE_OK: docstring references the gate script by name.
import { applyFabricCommit, applyFabricDelete } from '../lib/collab/crdtAnnotationBridge.js';
import { isCRDTEnabled } from '../lib/collab/crdtFeatureFlag.js';
import { enqueue as enqueueDualWrite } from '../lib/collab/crdtDualWriteQueue.js';

export const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser'
];

const SUPABASE_PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 250;

function isAllTypesOwnedRow(row) {
  if (!row) return false;
  if (NON_HIGHLIGHT_TYPES.includes(row.annotation_type)) return true;
  return row.annotation_type === 'highlight' && !!row.annotation_data?.fabricObject;
}

async function loadPagedAnnotationRows(documentId, applyFilters) {
  const rows = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    let query = supabase
      .from('document_annotations')
      .select('*')
      .eq('document_id', documentId)
      .order('page_number', { ascending: true });
    query = applyFilters ? applyFilters(query) : query;
    const { data, error } = await query.range(from, to);
    if (error) return { rows, error };
    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }
  return { rows, error: null };
}

async function loadAllTypesOwnedRowsForDocument(documentId) {
  const nonHighlight = await loadPagedAnnotationRows(
    documentId,
    (query) => query.in('annotation_type', NON_HIGHLIGHT_TYPES)
  );
  if (nonHighlight.error) return nonHighlight;

  const legacyFabricHighlights = await loadPagedAnnotationRows(
    documentId,
    (query) => query
      .eq('annotation_type', 'highlight')
      .not('annotation_data->fabricObject', 'is', null)
  );
  if (legacyFabricHighlights.error) return legacyFabricHighlights;

  return {
    rows: [...nonHighlight.rows, ...legacyFabricHighlights.rows],
    error: null,
    scanned: {
      nonHighlight: nonHighlight.rows.length,
      legacyFabricHighlights: legacyFabricHighlights.rows.length
    }
  };
}

/**
 * Phase 30 — infer the annotation type from a Fabric object so the dual-write
 * fan-out can apply the highlight carve-out without trusting opts.annotation_type
 * to be passed in. Mirrors the existing serializeFabricObjectToRow logic.
 *
 * NOTE: this is a Phase 30 addition; existing call sites do not consume it.
 */
function inferAnnotationTypeForDualWrite(fabricObj, opts) {
  // Prefer explicit opts.annotation_type when caller already knows the type.
  if (opts && typeof opts.annotation_type === 'string' && opts.annotation_type.length > 0) {
    return opts.annotation_type;
  }
  // Fall back to fabric.data.annotationType (set by serializer).
  const fromData = fabricObj?.data?.annotationType;
  if (typeof fromData === 'string' && fromData.length > 0) return fromData;
  // Last resort: fabric type itself (matches existing convention).
  return fabricObj?.type || 'unknown';
}

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

  // Live-path test seam (Plan 30-07 fix 2026-04-29). Lets a tester inject a
  // legacy bulk-upload failure without touching production code paths so the
  // sync_queue_stuck banner UAT can actually run on a clean PDF.
  if (typeof window !== 'undefined' && window.__crdtForceLegacyFail) {
    const err = new Error('test-seam: __crdtForceLegacyFail (live upsertAnnotationsByPage)');
    console.warn('[CloudSync][push] upsertAnnotationsByPage SHORT-CIRCUITED by __crdtForceLegacyFail test seam');
    return { data: [], error: err };
  }

  const rows = serializeAnnotationsByPage(annotationsByPage, opts);
  if (rows.length === 0) {
    console.log('[CloudSync][push] upsertAnnotationsByPage: nothing to push (0 rows) ' + JSON.stringify({
      documentId: opts.documentId, pdfId: opts.pdfId
    }));
    return { data: [], error: null };
  }
  const byType = rows.reduce((acc, r) => {
    acc[r.annotation_type] = (acc[r.annotation_type] || 0) + 1;
    return acc;
  }, {});

  // Split rows into user-drawn vs PDF-imported so noisy bulk pushes don't
  // confuse the user when reading logs. An imported path has no Fabric
  // positioning props (left == null) and a path array — same heuristic
  // SVGAnnotationLayer uses to decide rendering behavior.
  let importedCount = 0;
  let userDrawnCount = 0;
  for (const page of Object.values(annotationsByPage || {})) {
    if (!page || !Array.isArray(page.objects)) continue;
    for (const obj of page.objects) {
      const isImported = obj?.type === 'path' && obj.left == null && Array.isArray(obj.path);
      if (isImported) importedCount++; else userDrawnCount++;
    }
  }

  const t0 = Date.now();
  // JSON.stringify so values survive Windows DevTools "Save as..." export,
  // which collapses live object refs to the literal string "Object".
  console.log('[CloudSync][push] upsertAnnotationsByPage start ' + JSON.stringify({
    documentId: opts.documentId,
    pdfId: opts.pdfId,
    userId: opts.userId,
    totalRows: rows.length,
    userDrawnObjects: userDrawnCount,
    importedObjects: importedCount,
    rowsByType: byType,
    pages: Object.keys(annotationsByPage || {}).length
  }));
  const data = [];
  let error = null;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const result = await supabase
      .from('document_annotations')
      .upsert(batch, { onConflict: 'document_id,highlight_id', ignoreDuplicates: false })
      .select();
    if (result.error) {
      error = result.error;
      break;
    }
    data.push(...(result.data || []));
  }
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][push] upsertAnnotationsByPage failed ' + JSON.stringify({
      elapsedMs,
      pdfId: opts.pdfId,
      documentId: opts.documentId,
      totalRows: rows.length,
      userDrawnObjects: userDrawnCount,
      importedObjects: importedCount,
      error: error?.message || String(error)
    }));
    return { data: [], error };
  }
  console.log('[CloudSync][push] upsertAnnotationsByPage ok ' + JSON.stringify({
    elapsedMs,
    pdfId: opts.pdfId,
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
  const { rows: allRows, error, scanned } = await loadAllTypesOwnedRowsForDocument(documentId);
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][hydrate] loadAllNonHighlightAnnotations failed ' + JSON.stringify({
      elapsedMs,
      error: error?.message || String(error)
    }));
    return { annotationsByPage: {}, callouts: [], error };
  }
  const rows = (allRows || []).filter(isAllTypesOwnedRow);
  const byType = rows.reduce((acc, r) => {
    acc[r.annotation_type] = (acc[r.annotation_type] || 0) + 1;
    return acc;
  }, {});
  const annotationsByPage = deserializeRowsToAnnotationsByPage(rows);
  const callouts = deserializeRowsToCallouts(rows);
  console.log('[CloudSync][hydrate] loadAllNonHighlightAnnotations ok ' + JSON.stringify({
    elapsedMs,
    totalRowsScanned: allRows?.length || 0,
    scanned,
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

/**
 * Phase 30 — Dual-write fan-out for a single Fabric annotation save (create/edit).
 *
 * Behavior:
 *   - ALWAYS fires the legacy upsertFabricAnnotation. v2.3 clients still in the
 *     wild read from this column; the dual-write era keeps them whole.
 *   - If isCRDTEnabled() is false → legacy only (kill switch override; current
 *     behavior unchanged for kill-switch-off deployments).
 *   - If annotation_type === 'highlight' → legacy only (Excel-sync carve-out
 *     locked by CONTEXT.md "Highlights skipped"; v2.5 owns highlight migration).
 *   - Otherwise fires applyFabricCommit through the Phase 29 bridge.
 *   - Each side has its own try/catch. On failure, enqueues to the retry queue
 *     (latest-version-wins per annoId). NEVER deletes from either side to
 *     "match" the other.
 *
 * @param {object} fabricObj - the Fabric annotation to save
 * @param {object} opts
 * @param {string} opts.documentId - document UUID (also threaded into legacy upsert opts)
 * @param {string} opts.userId - the saving user's UUID (used for queue keying + legacy opts)
 * @param {Y.Doc} [opts.ydoc] - per-document Y.Doc (skipped if kill switch off)
 * @param {Y.Map} [opts.yMapAnnotations] - ydoc.getMap('annotations')
 * @param {object} [opts.originPayload] - origin payload from originBuilder.buildOrigin (with source: 'local-fabric' for live edits)
 * @param {object} [opts.ctx] - { userId, deviceId, sessionId, clientID } passed to bridge
 * @param {string} [opts.annotation_type] - explicit annotation_type for highlight filter
 * @returns {Promise<{legacy: any, crdt: { ok: boolean } | { error: any } | null}>}
 */
export async function dualWriteFabricCommit(fabricObj, opts = {}) {
  const annotationType = inferAnnotationTypeForDualWrite(fabricObj, opts);
  const isHighlight = annotationType === 'highlight';

  // Plan 30-07 caller seam: when useAnnotationCloudSync's bulk upsert path
  // already fired the legacy write before this fan-out runs (per-page bulk
  // succeeded), skipping the per-row legacy write here avoids double-writing
  // the same document_annotations row. The CRDT-side fan-out still proceeds.
  // NO_DIFF_DELETE_OK: skipping the legacy write is NOT a delete-to-reconcile
  // — it's avoiding a duplicate upsert of an identical row that just succeeded.
  const skipLegacy = opts && opts.skipLegacy === true;

  // ALWAYS fire legacy (unless caller already did via the bulk path; see
  // skipLegacy above). v2.3 clients still read this column during the
  // dual-write era. Preserves existing behavior byte-identical when kill
  // switch is off.
  let legacyResult = null;
  if (skipLegacy) {
    // Legacy write already occurred upstream — no-op here. Return shape
    // preserves the { legacy: null, crdt: ... } contract so callers can
    // detect the skip if they need to.
  } else {
    try {
      legacyResult = await upsertFabricAnnotation(fabricObj, opts);
      // upsertFabricAnnotation returns { data, error } — treat error truthy as
      // a failed save and enqueue. Mirrors the existing call pattern.
      if (legacyResult && legacyResult.error) {
        const annoId = fabricObj?.data?.id;
        if (opts.userId && annoId) {
          enqueueDualWrite({
            userId: opts.userId,
            annoId,
            side: 'legacy',
            payload: { fabricObj, opts },
          });
        }
      }
    } catch (err) {
      legacyResult = { data: null, error: err };
      const annoId = fabricObj?.data?.id;
      if (opts.userId && annoId) {
        enqueueDualWrite({
          userId: opts.userId,
          annoId,
          side: 'legacy',
          payload: { fabricObj, opts },
        });
      }
    }
  }

  // Skip CRDT side when kill switch off OR highlight — clean skip, no scary
  // fallback. Returns null for the crdt side so callers can detect the skip.
  if (!isCRDTEnabled() || isHighlight) {
    return { legacy: legacyResult, crdt: null };
  }

  // CRDT-side write through the Phase 29 bridge. Synchronous (the bridge
  // wraps ydoc.transact internally; no await needed).
  if (!opts.ydoc || !opts.yMapAnnotations) {
    // Defensive: if the caller didn't thread Yjs context through, treat as
    // a CRDT-side miss and skip without enqueueing. The caller is responsible
    // for threading these inside <YDocProvider>.
    return { legacy: legacyResult, crdt: null };
  }

  try {
    applyFabricCommit(opts.ydoc, opts.yMapAnnotations, fabricObj, opts.originPayload, opts.ctx);
    return { legacy: legacyResult, crdt: { ok: true } };
  } catch (err) {
    const annoId = fabricObj?.data?.id;
    if (opts.userId && annoId) {
      enqueueDualWrite({
        userId: opts.userId,
        annoId,
        side: 'crdt',
        payload: { fabricObj, opts },
      });
    }
    return { legacy: legacyResult, crdt: { error: err } };
  }
}

/**
 * Phase 30 — Dual-write fan-out for a single Fabric annotation delete.
 *
 * Same shape as dualWriteFabricCommit: ALWAYS fires legacy delete; conditionally
 * fires CRDT-side delete via the bridge. Highlight carve-out preserved.
 *
 * @param {string} documentId
 * @param {string} annoId - the stable per-annotation UUID (== highlight_id)
 * @param {object} opts
 * @param {string} opts.userId
 * @param {Y.Doc} [opts.ydoc]
 * @param {Y.Map} [opts.yMapAnnotations]
 * @param {object} [opts.originPayload]
 * @param {string} [opts.annotation_type]
 * @returns {Promise<{legacy: any, crdt: { ok: boolean } | { error: any } | null}>}
 */
export async function dualWriteFabricDelete(documentId, annoId, opts = {}) {
  const isHighlight = opts.annotation_type === 'highlight';

  // Plan 30-07 caller seam: same pattern as dualWriteFabricCommit.
  // useAnnotationCloudSync's bulk delete (deleteAnnotations) already removed
  // the legacy row before this fan-out runs, so skipping the per-row legacy
  // delete here avoids issuing a redundant DELETE on a row that's already gone.
  // The CRDT-side fan-out still proceeds.
  // NO_DIFF_DELETE_OK: this is a caller-coordinated dedup, not a "diff = delete"
  // — we are NOT comparing two stores and deleting the difference; we are
  // skipping a duplicate of a delete that already succeeded upstream.
  const skipLegacy = opts && opts.skipLegacy === true;

  let legacyResult = null;
  if (skipLegacy) {
    // Legacy delete already occurred upstream — no-op here.
  } else {
    try {
      legacyResult = await deleteAnnotation(documentId, annoId);
      if (legacyResult && legacyResult.error) {
        if (opts.userId && annoId) {
          enqueueDualWrite({
            userId: opts.userId,
            annoId,
            side: 'legacy',
            payload: { op: 'delete', documentId, annoId, opts },
          });
        }
      }
    } catch (err) {
      legacyResult = { data: null, error: err };
      if (opts.userId && annoId) {
        enqueueDualWrite({
          userId: opts.userId,
          annoId,
          side: 'legacy',
          payload: { op: 'delete', documentId, annoId, opts },
        });
      }
    }
  }

  if (!isCRDTEnabled() || isHighlight) {
    return { legacy: legacyResult, crdt: null };
  }

  if (!opts.ydoc || !opts.yMapAnnotations) {
    return { legacy: legacyResult, crdt: null };
  }

  try {
    applyFabricDelete(opts.ydoc, opts.yMapAnnotations, annoId, opts.originPayload);
    return { legacy: legacyResult, crdt: { ok: true } };
  } catch (err) {
    if (opts.userId && annoId) {
      enqueueDualWrite({
        userId: opts.userId,
        annoId,
        side: 'crdt',
        payload: { op: 'delete', documentId, annoId, opts },
      });
    }
    return { legacy: legacyResult, crdt: { error: err } };
  }
}
