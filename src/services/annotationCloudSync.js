/**
 * All-types annotation cloud sync — Phase 21.
 *
 * Sits next to documentAnnotationService.js and operates on the same
 * document_annotations table. The existing surveyMarker-only flow in
 * documentAnnotationService.js is unchanged and still owns surveyMarker rows.
 * This module owns the rest: ink, freetext, square, circle, line, polyline,
 * polygon, stamp, sticky_note, callout, counter, eraser.
 *
 * The two modules co-exist by row category. SurveyMarkers and non-surveyMarker
 * rows share the table but never collide because each row's
 * annotation_type is the source of truth for which module owns it.
 */

import { supabase } from '../supabaseClient.js';
import { collectKeysetRows } from './annotationReadPagination.js';
import { resolveDocumentMetadata } from './documentMetadataResolver.js';
import {
  serializeFabricObjectToRow,
  deserializeRowToFabricObject,
  deserializeRowsToAnnotationsByPage,
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
import {
  isSurveyMarkerType,
  SURVEY_MARKER_TYPE_VALUES,
} from '../utils/surveyMarkerType.js';

export const NON_HIGHLIGHT_TYPES = [
  'ink', 'freetext', 'square', 'circle', 'line', 'polyline', 'polygon',
  'stamp', 'sticky_note', 'callout', 'counter', 'eraser', 'form-field'
];

const SUPABASE_PAGE_SIZE = 1000;

// Hydrate read projection (KAL-241). The durable read only needs the columns the
// deserializers + raw-row consumers actually touch:
//   - annotation_data: the JSONB payload every shape/callout is rebuilt from
//   - page_number / annotation_type / annotation_id: routing + identity
//   - user_id / updated_at / created_at: author attribution + last-write-wins
//   - id: the keyset pagination cursor (primary key, stable + unique)
// Projecting away the duplicate `bounds` geometry blob, `checklist_responses`,
// and ~15 unused scalar columns keeps the JSONB heap fetch lean. SELECT('*') was
// pulling all of them on a multi-thousand-row document and helped blow the
// Postgres statement timeout.
const ANNOTATION_READ_COLUMNS =
  'id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at';

function cloudSyncDebug(message) {
  if (typeof window === 'undefined' || window.__CLOUD_SYNC_DEBUG !== true) return;
  try { console.debug(message); } catch { /* ignore debug logging failures */ }
}

function isAllTypesOwnedRow(row) {
  if (!row) return false;
  if (NON_HIGHLIGHT_TYPES.includes(row.annotation_type)) return true;
  return isSurveyMarkerType(row.annotation_type) && !!row.annotation_data?.fabricObject;
}

// Keyset (seek) pagination on the primary key (KAL-241). The previous reader used
// OFFSET pagination (`.range(from, to)` with 4 concurrent windows). OFFSET forces
// Postgres to read + RLS-check + discard every row before the window on each
// deeper page, so the per-statement cost grew with depth and — combined with the
// per-row `user_can_access_document` RLS check and the full JSONB payload — pushed
// the big document past the statement timeout (Postgres 57014). The read failing
// is exactly what keeps the source-of-truth gate on the page-collapsed Y.Doc.
//
// Seeking by `id > cursor` instead lets the `(document_id, id)` index jump
// straight to the next slice: each statement reads only its own rows, RLS runs
// once per returned row (never on discarded rows), and there is no re-scan. The
// loop is sequential because each page depends on the previous page's last id;
// the primary key is unique + non-null, so the cursor can never skip or duplicate
// a row.
async function loadPagedAnnotationRows(documentId, applyFilters, readScope) {
  return collectKeysetRows({
    pageSize: SUPABASE_PAGE_SIZE,
    fetchPage: async (cursorId) => {
      readScope.assertCurrent();
      let query = readScope.client
        .from('document_annotations')
        .select(ANNOTATION_READ_COLUMNS)
        .eq('document_id', documentId)
        .order('id', { ascending: true })
        .limit(SUPABASE_PAGE_SIZE);
      if (cursorId !== null) query = query.gt('id', cursorId);
      query = applyFilters ? applyFilters(query) : query;
      // Pin the request, not the shared client's headers. A later auth switch
      // must not let the SDK dispatch this page with another user's token.
      query = query.setHeader('Authorization', `Bearer ${readScope.accessToken}`)
        .abortSignal(readScope.signal);
      readScope.assertCurrent();
      const { data, error } = await query;
      readScope.assertCurrent();
      return { data, error };
    },
  });
}

// DB-sync audit #2 — the two owned categories (non-surveyMarker types, and
// legacy surveyMarker rows that still carry a fabricObject) are an OR over the
// SAME document_id + keyset cursor, so they fold into ONE keyset sweep instead
// of two sequential ones. PostgREST `.or()` builds the disjunction server-side:
//   annotation_type IN (non-marker types)
//   OR (annotation_type IN (marker types) AND annotation_data->fabricObject IS NOT NULL)
// Client-side routing (isAllTypesOwnedRow) is unchanged — this only collapses
// round-trips; the materialized row set is byte-identical to the two-sweep union.
const ALL_TYPES_OWNED_OR_FILTER = [
  `annotation_type.in.(${NON_HIGHLIGHT_TYPES.join(',')})`,
  `and(annotation_type.in.(${SURVEY_MARKER_TYPE_VALUES.join(',')}),annotation_data->fabricObject.not.is.null)`,
].join(',');

async function loadAllTypesOwnedRowsForDocument(documentId, readScope) {
  const owned = await loadPagedAnnotationRows(
    documentId,
    (query) => query.or(ALL_TYPES_OWNED_OR_FILTER),
    readScope,
  );
  if (owned.error) return owned;

  return {
    rows: owned.rows,
    error: null,
    scanned: {
      owned: owned.rows.length
    }
  };
}

// KAL-241 fast-open watermark (DB-sync audit #1). Returns the freshness signal
// of the SAME owned row set loadAllTypesOwnedRowsForDocument materializes — but
// as two cheap aggregate queries (count + newest updated_at) instead of the
// ~25-trip keyset sweep. The open path compares this to the snapshot's embedded
// watermark; a match proves the durable rows are unchanged so the full re-read
// can be skipped without regressing the wrong-page source-of-truth heal.
//
// DB-sync audit #2 — the watermark covers the SAME owned set as the loader, so
// the two filters fold into one OR-filtered aggregate. A single
// `select('updated_at', { count: 'exact' })` ordered DESC limit 1 returns BOTH
// the combined exact count and the newest updated_at across both branches in one
// round-trip, halving this probe from two trips to one.
export async function loadAllTypesOwnedWatermark(documentId) {
  if (!supabase) return { rowCount: 0, maxUpdatedAt: null, error: new Error('Supabase unavailable') };
  if (!documentId) return { rowCount: 0, maxUpdatedAt: null, error: null };

  const { data, count, error } = await supabase
    .from('document_annotations')
    .select('updated_at', { count: 'exact' })
    .eq('document_id', documentId)
    .or(ALL_TYPES_OWNED_OR_FILTER)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return { rowCount: 0, maxUpdatedAt: null, error };

  return {
    rowCount: count || 0,
    maxUpdatedAt: data?.[0]?.updated_at ?? null,
    error: null,
  };
}

// DB-sync audit #1 (marker fix) — read the denormalized per-document change
// marker `documents.annotations_changed_at` (maintained by a trigger on every
// annotation insert/update/delete). One cheap single-row read (~200ms), so the
// fast-open skip works on ANY doc size and catches deletes — unlike the exact
// COUNT, which scans all rows under RLS and times out on large docs.
//
// Returns the ISO string, or null when absent / errored (e.g. the migration is
// not yet applied) so the caller falls back to the bounded count probe.
export async function loadDocumentAnnotationsChangedAt(documentId) {
  if (!supabase || !documentId) return null;
  try {
    const meta = await resolveDocumentMetadata(documentId);
    return meta.annotationsChangedAt;
  } catch (_e) {
    return null;
  }
}

/**
 * Phase 30 — infer the annotation type from a Fabric object so the dual-write
 * fan-out can apply the surveyMarker carve-out without trusting opts.annotation_type
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
 * (document_id, annotation_id).
 */
export async function upsertFabricAnnotation(fabricObj, opts = {}) {
  if (!supabase) return { data: null, error: new Error('Supabase unavailable') };
  const row = serializeFabricObjectToRow(fabricObj, opts);
  const { data, error } = await supabase
    .from('document_annotations')
    .upsert(row, { onConflict: 'document_id,annotation_id', ignoreDuplicates: false })
    .select('annotation_id, updated_at')
    .single();
  if (error) {
    console.error('[CloudSync] upsertFabricAnnotation failed:', error);
    return { data: null, error };
  }
  return { data, error: null };
}

// upsertAnnotationsByPage was DELETED 2026-07-17 (dead-code pass 2): the
// legacy bulk-upsert path lost its last live caller when the retired
// useAnnotationCloudSync hook was deleted in pass 1; only the phase31
// kill-switch test still referenced it. The LEGACY_BULK_UPSERT_ENABLED
// feature flag (src/lib/collab/featureFlags.js) died with it. Precise
// per-annotation writes flow through upsertFabricAnnotation /
// dualWriteFabricCommit below.

// upsertCallouts was DELETED 2026-07-17: its only callers were the retired
// (unmounted) useAnnotationCloudSync hook and cloudSyncMigration.js, both
// deleted the same day. Callouts persist as shared `.fabricObject` rows via
// the fabric push; the READ half (deserializeRowToCallout, used by
// loadAllNonSurveyMarkerAnnotations for legacy-doc hydrate) stays LIVE.

/**
 * Delete a single annotation row by client-side annotation_id.
 */
export async function deleteAnnotation(documentId, annotationId) {
  if (!supabase) return { success: false, error: new Error('Supabase unavailable') };
  const { error } = await supabase
    .from('document_annotations')
    .delete()
    .eq('document_id', documentId)
    .eq('annotation_id', annotationId);
  if (error) {
    console.error('[CloudSync] deleteAnnotation failed:', error);
    return { success: false, error };
  }
  return { success: true, error: null };
}

/**
 * Delete many annotation rows by client-side annotation_ids.
 */
export async function deleteAnnotations(documentId, annotationIds) {
  if (!supabase) return { success: false, error: new Error('Supabase unavailable') };
  if (!Array.isArray(annotationIds) || annotationIds.length === 0) {
    return { success: true, error: null };
  }
  const uniqueIds = [...new Set(annotationIds.filter(Boolean))];
  const chunkSize = 200;
  for (let start = 0; start < uniqueIds.length; start += chunkSize) {
    const chunk = uniqueIds.slice(start, start + chunkSize);
    const { error } = await supabase
      .from('document_annotations')
      .delete()
      .eq('document_id', documentId)
      .in('annotation_id', chunk);
    if (error) {
      console.error('[CloudSync] deleteAnnotations failed:', {
        error,
        chunkStart: start,
        chunkCount: chunk.length,
        totalCount: uniqueIds.length,
      });
      return { success: false, error };
    }
  }
  cloudSyncDebug('[CloudSync] deleteAnnotations ok ' + JSON.stringify({
    documentId,
    count: uniqueIds.length,
    chunks: Math.ceil(uniqueIds.length / chunkSize),
  }));
  return { success: true, error: null };
}

/**
 * Load every non-survey marker annotation for a document and return it split
 * into the in-app shape slices: { annotationsByPage, callouts }.
 *
 * SurveyMarkers are intentionally skipped — they have their own loader in
 * documentAnnotationService.js and own their own state slice in App.jsx.
 */
// Single-flight (KAL-241): one document open fires this hydrate read from
// multiple effects at once (initial hydrate + realtime catch-up). Each ran a
// full keyset sweep of the SAME rows, so a heavily-annotated document read all
// of its rows TWICE concurrently — the bulk of a ~25s open. Collapse overlapping
// reads for the same document onto a single in-flight promise. Only concurrent
// reads are deduped; a read started after the prior one resolves still runs
// fresh, so post-change refetches stay correct.
const hydrateClientScopes = new WeakMap();

function retiredHydrateError() {
  const error = new Error('Annotation read no longer belongs to the current signed-in session');
  error.code = 'ANNOTATION_READ_RETIRED';
  return error;
}

function waitForHydrateConsumer(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(retiredHydrateError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    // Observe both outcomes even after cancellation. Auth may not be abortable,
    // and another consumer can still own the shared query we stopped awaiting.
    Promise.resolve(promise).then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); },
    );
    if (signal.aborted) onAbort();
  });
}

function hydrateScopeForClient(client) {
  let scope = hydrateClientScopes.get(client);
  if (scope) return scope;
  if (!client.auth?.onAuthStateChange || !client.auth?.getSession) throw retiredHydrateError();
  scope = { generation: 0, actor: undefined, token: undefined, initialSeen: false, reads: new Map() };
  hydrateClientScopes.set(client, scope);
  // One listener for the lifetime of this client, not one per document/read.
  // Auth callbacks must stay synchronous: never acquire the auth session lock.
  try {
    client.auth.onAuthStateChange((event, session) => {
      const actor = session?.user?.id ?? null;
      const matchingInitial = event === 'INITIAL_SESSION' && !scope.initialSeen
        && (scope.actor === undefined || scope.actor === actor);
      // auth-js recovery/focus may announce the same session as SIGNED_IN.
      // Token equality is in-memory only; a genuine new login still retires,
      // and SIGNED_OUT always advances the generation even if the actor returns.
      const repeatedSignIn = event === 'SIGNED_IN' && actor && scope.actor === actor
        && session?.access_token && scope.token === session.access_token;
      if (event === 'INITIAL_SESSION') scope.initialSeen = true;
      if (!matchingInitial && !repeatedSignIn && !(event === 'TOKEN_REFRESHED' && scope.actor === actor)) {
        scope.generation += 1;
        for (const read of scope.reads.values()) read.controller.abort();
        scope.reads.clear();
      }
      scope.actor = actor;
      scope.token = session?.access_token;
    });
  } catch (error) {
    hydrateClientScopes.delete(client);
    throw error;
  }
  return scope;
}

/** Concurrent reads share rows only within one client/actor/auth generation.
 * Callers may retire independently; one caller cannot cancel another's read.
 * Failures (including retirement) keep the existing error-result contract and
 * never expose partially collected rawRows as a successful backfill snapshot.
 */
export async function loadAllNonSurveyMarkerAnnotations(documentId, {
  supabase: client = supabase, actorUserId, isCurrent = () => true, signal,
} = {}) {
  const consumer = { current: () => !signal?.aborted && isCurrent() === true };
  let record;
  let onAbort;
  try {
    if (!client) throw new Error('Supabase unavailable');
    if (!documentId) return { annotationsByPage: {}, callouts: [], error: null };
    if (!consumer.current()) throw retiredHydrateError();
    const scope = hydrateScopeForClient(client);
    const generation = scope.generation;
    const { data, error } = await waitForHydrateConsumer(client.auth.getSession(), signal);
    const session = data?.session;
    const actor = session?.user?.id;
    if (error || !actor || !session.access_token || !consumer.current()
      || scope.generation !== generation || (scope.actor !== undefined && scope.actor !== actor)
      || (actorUserId !== undefined && actorUserId !== actor)) throw retiredHydrateError();
    scope.actor = actor;
    // An older getSession result must not undo a TOKEN_REFRESHED observation.
    if (scope.token === undefined) scope.token = session.access_token;
    const key = JSON.stringify([generation, actor, documentId]);
    record = scope.reads.get(key);
    // A caller with a guard but no AbortSignal can have retired since the last
    // page. Do not join its already obsolete flight.
    if (record && ![...record.consumers].some(item => item.current())) {
      record.controller.abort();
      scope.reads.delete(key);
      record = null;
    }
    if (!record) {
      const controller = new AbortController();
      const created = { controller, consumers: new Set(), promise: null };
      const assertCurrent = () => {
        if (controller.signal.aborted || scope.generation !== generation || scope.actor !== actor
          || ![...created.consumers].some(item => item.current())) {
          controller.abort();
          throw retiredHydrateError();
        }
      };
      created.promise = Promise.resolve().then(() => {
        assertCurrent();
        return loadAllNonSurveyMarkerAnnotationsUncached(documentId, {
          client, accessToken: session.access_token, signal: controller.signal, assertCurrent,
        });
      }).finally(() => {
        if (scope.reads.get(key) === created) scope.reads.delete(key);
      });
      scope.reads.set(key, created);
      record = created;
    }
    record.consumers.add(consumer);
    const joined = record;
    onAbort = () => {
      joined.consumers.delete(consumer);
      if (![...joined.consumers].some(item => item.current())) {
        joined.controller.abort();
        if (scope.reads.get(key) === joined) scope.reads.delete(key);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const result = await waitForHydrateConsumer(record.promise, signal);
    if (!consumer.current() || scope.generation !== generation || scope.actor !== actor) throw retiredHydrateError();
    return result;
  } catch (error) {
    return { annotationsByPage: {}, callouts: [], error };
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    record?.consumers.delete(consumer);
  }
}

async function loadAllNonSurveyMarkerAnnotationsUncached(documentId, readScope) {
  const t0 = Date.now();
  cloudSyncDebug('[CloudSync][hydrate] loadAllNonSurveyMarkerAnnotations start ' + JSON.stringify({ documentId }));
  const { rows: allRows, error, scanned } = await loadAllTypesOwnedRowsForDocument(documentId, readScope);
  readScope.assertCurrent();
  const elapsedMs = Date.now() - t0;
  if (error) {
    console.error('[CloudSync][hydrate] loadAllNonSurveyMarkerAnnotations failed ' + JSON.stringify({
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
  cloudSyncDebug('[CloudSync][hydrate] loadAllNonSurveyMarkerAnnotations ok ' + JSON.stringify({
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
 * Subscribe to real-time changes for non-survey marker annotations on a document.
 *
 * Routes incoming rows to type-aware callbacks:
 *   - onFabricInsert(fabricObject, pageNumber, annotationId) — for ink, shapes,
 *     text, stamps, sticky notes, counters, eraser
 *   - onFabricUpdate(fabricObject, pageNumber, annotationId)
 *   - onFabricDelete(annotationId)
 *   - onCalloutInsert(callout)
 *   - onCalloutUpdate(callout)
 *   - onCalloutDelete(annotationId)
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
 * The subscriber filters out surveyMarker rows so the existing surveyMarker
 * subscription in documentAnnotationService.js continues to own them
 * without conflict.
 */
export function subscribeToAllNonSurveyMarkerAnnotations(documentId, callbacks = {}, options = {}) {
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

  cloudSyncDebug('[CloudSync][realtime] subscribing ' + JSON.stringify({
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
        if (isSurveyMarkerType(oldRow.annotation_type)) return; // legacy module owns it
        // 2026-04-25 — DO NOT echo-filter DELETEs by user-id. Postgres
        // DELETE payloads only carry the primary key, so we can't
        // recover the originating sessionId. Applying our own DELETE
        // echo is harmless: removing a annotation_id that's already
        // absent from local state is a no-op.
        cloudSyncDebug('[CloudSync][realtime] applying DELETE ' + JSON.stringify({
          annotationId: oldRow.annotation_id,
          annotationType: oldRow.annotation_type,
          lastModifiedBy: oldRow.last_modified_by,
          payloadKeys: Object.keys(oldRow)
        }));
        // 2026-04-26 — Per-id apply path requires the row payload to
        // include `annotation_id` AND `annotation_type`. That requires
        // the table to be configured with REPLICA IDENTITY FULL — but
        // even with that set, Supabase realtime sometimes serves
        // empty `payload.old` for a window after the schema change.
        // FALLBACK: when the payload is empty (no annotation_id), do
        // a full cloud refetch and reconcile. This always converges
        // to the correct state regardless of payload completeness,
        // at the cost of one extra fetch per DELETE event.
        if (!oldRow.annotation_id || !oldRow.annotation_type) {
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
          if (onCalloutDelete) onCalloutDelete(oldRow.annotation_id);
        } else if (NON_HIGHLIGHT_TYPES.includes(oldRow.annotation_type)) {
          if (onFabricDelete) onFabricDelete(oldRow.annotation_id);
        }
      }
    )
    .subscribe((status, err) => {
      cloudSyncDebug('[CloudSync][realtime] subscribe status ' + JSON.stringify({
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
    cloudSyncDebug('[CloudSync][realtime] unsubscribing ' + JSON.stringify({ documentId }));
    if (supabase?.removeChannel) {
      supabase.removeChannel(channel);
    }
  };
}

function routeRow(event, row, callbacks, currentUserId, currentSessionId) {
  if (!row) return;
  const type = row.annotation_type;
  if (isSurveyMarkerType(type)) return; // legacy module owns it

  // Echo filter — UX rule: a Supabase realtime echo of THIS SESSION's own
  // write would race the user's in-progress UI (counter doubling, pen
  // flicker). We drop only events whose annotation_data.clientSessionId
  // matches the local session, so the SAME user's OTHER device (a
  // different session id) still gets the live update.
  const rowSessionId = row.annotation_data?.clientSessionId || null;
  if (currentSessionId && rowSessionId && rowSessionId === currentSessionId) {
    cloudSyncDebug(`[CloudSync][realtime] echo-filtered ${event.toUpperCase()} ` + JSON.stringify({
      annotationId: row.annotation_id,
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
    cloudSyncDebug(`[CloudSync][realtime] echo-filtered ${event.toUpperCase()} ` + JSON.stringify({
      annotationId: row.annotation_id,
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
      cloudSyncDebug(`[CloudSync][realtime] applying ${event.toUpperCase()} callout ` + JSON.stringify({
        annotationId: row.annotation_id,
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
      const { fabricObject, pageNumber, annotationId } = deserializeRowToFabricObject(row);
      cloudSyncDebug(`[CloudSync][realtime] applying ${event.toUpperCase()} fabric ` + JSON.stringify({
        annotationId,
        annotationType: type,
        pageNumber,
        lastModifiedBy: row.last_modified_by
      }));
      if (event === 'insert' && callbacks.onFabricInsert) {
        callbacks.onFabricInsert(fabricObject, pageNumber, annotationId);
      } else if (event === 'update' && callbacks.onFabricUpdate) {
        callbacks.onFabricUpdate(fabricObject, pageNumber, annotationId);
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
 *   - If annotation_type === 'surveyMarker' → legacy only (Excel-sync carve-out
 *     locked by CONTEXT.md "SurveyMarkers skipped"; v2.5 owns surveyMarker migration).
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
 * @param {string} [opts.annotation_type] - explicit annotation_type for surveyMarker filter
 * @returns {Promise<{legacy: any, crdt: { ok: boolean } | { error: any } | null}>}
 */
export async function dualWriteFabricCommit(fabricObj, opts = {}) {
  const annotationType = inferAnnotationTypeForDualWrite(fabricObj, opts);
  const isSurveyMarker = isSurveyMarkerType(annotationType);

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

  // Skip CRDT side when kill switch off OR surveyMarker — clean skip, no scary
  // fallback. Returns null for the crdt side so callers can detect the skip.
  if (!isCRDTEnabled() || isSurveyMarker) {
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
 * fires CRDT-side delete via the bridge. SurveyMarker carve-out preserved.
 *
 * @param {string} documentId
 * @param {string} annoId - the stable per-annotation UUID (== annotation_id)
 * @param {object} opts
 * @param {string} opts.userId
 * @param {Y.Doc} [opts.ydoc]
 * @param {Y.Map} [opts.yMapAnnotations]
 * @param {object} [opts.originPayload]
 * @param {string} [opts.annotation_type]
 * @returns {Promise<{legacy: any, crdt: { ok: boolean } | { error: any } | null}>}
 */
export async function dualWriteFabricDelete(documentId, annoId, opts = {}) {
  const isSurveyMarker = isSurveyMarkerType(opts.annotation_type);

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

  if (!isCRDTEnabled() || isSurveyMarker) {
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
