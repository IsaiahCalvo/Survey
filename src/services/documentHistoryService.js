/**
 * documentHistoryService.js — document activity-history recording/reading service.
 *
 * Maps debug/checkpoint events into human-readable summaries and persists them
 * to the Supabase `document_history_events` table after a scoped IndexedDB
 * admission. The old localStorage key remains a read-only legacy notice. Exports
 * buildHistoryEventRowFromDebugEvent, recordDocumentHistoryEvent,
 * recordDocumentHistoryDebugEvent, and listDocumentHistoryEvents; classifies
 * callout/space/survey-marker actions for the activity feed.
 */
import { supabase } from '../supabaseClient.js';
import { getDocumentHistoryStore } from './documentHistoryStore.js';

const HISTORY_EVENT_LIMIT = 200;
const MAX_PAYLOAD_CHARS = 12000;
const LOCAL_HISTORY_STORAGE_KEY = 'survey_document_history_events_v1';
let warnedMissingTable = false;

function isMissingHistoryTableError(error) {
  return error?.code === '42P01';
}

function isTransportError(error, response) {
  if (error?.code && error.code !== 'NETWORK_ERROR') return false;
  if (Number(response?.status) > 0) return false;
  if (response?.status === 0) return true;
  if (error instanceof TypeError || error?.name === 'NetworkError') return true;
  return (error?.code == null || error.code === '')
    && /^(?:TypeError: )?(?:Failed to fetch|Network request failed|Load failed)$/i.test(String(error?.message || ''));
}

function safeLegacyStorage() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

function getActorName(user) {
  return user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ')
    || user?.email
    || 'Someone';
}

function normalizeActionType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('path') || text.includes('ink')) return 'ink';
  if (text.includes('create')) return 'create';
  if (text.includes('delete')) return 'delete';
  if (text.includes('redo')) return 'redo';
  if (text.includes('undo')) return 'undo';
  if (text.includes('rotate')) return 'rotate';
  if (text.includes('resize')) return 'resize';
  if (text.includes('move') || text.includes('modified')) return 'move';
  if (text.includes('text')) return 'text edit';
  if (text.includes('callout')) return 'callout edit';
  if (text.includes('space')) return 'space edit';
  if (text.includes('highlight') || text.includes('survey-marker')) return 'survey marker edit';
  return value || 'edit';
}

function labelAnnotationType(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'path' || text === 'ink') return 'pen stroke';
  if (text === 'textbox' || text === 'text' || text === 'freetext') return 'text';
  if (text === 'rect' || text === 'square') return 'rectangle';
  if (text === 'circle') return 'circle';
  if (text === 'line') return 'line';
  if (text === 'callout') return 'callout';
  if (text.includes('survey')) return 'survey marker';
  if (text === 'fabric') return 'annotation';
  return text || 'annotation';
}

function buildSummary({ actorName, event }) {
  const action = normalizeActionType(event.actionType || event.rawActionType || event.reason);
  const annotationLabel = labelAnnotationType(event.annotationType);
  const pageSuffix = event.pageNumber ? ` on page ${event.pageNumber}` : '';
  const count = Number(event.itemCount || event.annotationIds?.length || 0);

  if (event.type === 'checkpoint_added' || event.type === 'checkpoint_added_annotation_fast') {
    const reason = String(event.reason || event.rawActionType || '').toLowerCase();
    if (reason.startsWith('callouts:create')) return `${actorName} created a callout${pageSuffix}`;
    if (reason.startsWith('callouts:delete')) return `${actorName} deleted ${count > 1 ? `${count} callouts` : 'a callout'}${pageSuffix}`;
    if (reason.startsWith('callouts:')) return `${actorName} edited a callout${pageSuffix}`;
    if (reason.startsWith('space:create')) return `${actorName} created a space`;
    if (reason.startsWith('space:delete')) return `${actorName} deleted a space`;
    if (reason.startsWith('space:')) return `${actorName} edited a space`;
    if (reason.startsWith('highlight:create')) return `${actorName} created a survey marker${pageSuffix}`;
    if (reason.startsWith('highlight:delete')) return `${actorName} deleted a survey marker${pageSuffix}`;
    if (reason.startsWith('survey-marker:')) return `${actorName} edited a survey marker${pageSuffix}`;
    if (reason.startsWith('excel:')) return `${actorName} synced survey data to Excel`;
    if (reason.startsWith('delete:batch')) return `${actorName} deleted selected annotations${pageSuffix}`;
    return `${actorName} made an edit${pageSuffix}`;
  }

  if (event.type?.endsWith?.('_undo_applied')) return `${actorName} undid an edit${pageSuffix}`;
  if (event.type?.endsWith?.('_redo_applied')) return `${actorName} redid an edit${pageSuffix}`;

  if (action === 'ink' || (action === 'create' && annotationLabel === 'pen stroke')) {
    return `${actorName} drew a pen stroke${pageSuffix}`;
  }
  if (action === 'create') return `${actorName} created ${annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
  if (action === 'delete') return `${actorName} deleted ${count > 1 ? `${count} annotations` : annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
  if (action === 'move') return `${actorName} moved ${annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
  if (action === 'resize') return `${actorName} resized ${annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
  if (action === 'rotate') return `${actorName} rotated ${annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
  if (action === 'text edit') return `${actorName} edited text${pageSuffix}`;
  if (action === 'callout edit') return `${actorName} edited a callout${pageSuffix}`;

  return `${actorName} edited ${annotationLabel === 'annotation' ? 'an annotation' : `a ${annotationLabel}`}${pageSuffix}`;
}

// History-audit P3: previewAnnotation drives the History panel's spotlight
// highlight. It is a single annotation object, but ink paths can be large —
// cap its serialized size defensively rather than letting it defeat the trim.
const MAX_PREVIEW_ANNOTATION_CHARS = 4000;

function clampPreviewAnnotation(previewAnnotation) {
  if (!previewAnnotation || typeof previewAnnotation !== 'object') return null;
  try {
    const serialized = JSON.stringify(previewAnnotation);
    if (serialized.length <= MAX_PREVIEW_ANNOTATION_CHARS) return previewAnnotation;
    // Too big: outline ink (capsule eraser) carries polygons + paperCenterline
    // copies of its path — drop the duplicates first so the spotlight keeps a
    // path-shaped glow whenever the path itself fits.
    const {
      polygons: _polygons,
      paperCenterline: _paperCenterline,
      paperCenterlineRuns: _paperCenterlineRuns,
      ...withPath
    } = previewAnnotation;
    if (JSON.stringify(withPath).length <= MAX_PREVIEW_ANNOTATION_CHARS) return withPath;
    // Still too big (path-heavy ink): keep the geometry envelope, drop the path —
    // the spotlight falls back to a bounding rect instead of vanishing.
    const { path: _path, points: _points, ...rest } = withPath;
    const slim = rest && typeof rest === 'object' ? rest : null;
    if (!slim) return null;
    return JSON.stringify(slim).length <= MAX_PREVIEW_ANNOTATION_CHARS ? slim : null;
  } catch (_err) {
    return null;
  }
}

function trimPayload(payload) {
  let serialized = '{}';
  try {
    serialized = JSON.stringify(payload || {});
  } catch (_err) {
    return {
      truncated: true,
      unserializable: true,
      event: payload?.type || payload?.event || null,
      actionType: payload?.actionType || null,
      rawActionType: payload?.rawActionType || null,
      annotationType: payload?.annotationType || null,
      annotationId: payload?.annotationId || null,
      pageNumber: payload?.pageNumber ?? null,
      // Restore data must survive trimming or a deleted item becomes
      // unrecoverable from History. A single-marker restoreAction is small.
      restoreAction: payload?.restoreAction || null,
      // Decision 10 (KAL-90): the context stamp drives click-to-restore.
      uiContext: payload?.uiContext || null,
    };
  }
  if (serialized.length <= MAX_PAYLOAD_CHARS) return payload || {};
  return {
    truncated: true,
    originalBytes: serialized.length,
    event: payload?.event || null,
    actionType: payload?.actionType || null,
    rawActionType: payload?.rawActionType || null,
    annotationType: payload?.annotationType || null,
    annotationId: payload?.annotationId || null,
    annotationIds: payload?.annotationIds || null,
    pageNumber: payload?.pageNumber ?? null,
    lane: payload?.lane || null,
    reason: payload?.reason || null,
    // Preserve restore data even when the rest of the payload is trimmed.
    restoreAction: payload?.restoreAction || null,
    // History-audit P3: preserve the spotlight preview (bounded) so the
    // History highlight still works for large (path-heavy) events.
    previewAnnotation: clampPreviewAnnotation(payload?.previewAnnotation),
    // Decision 10 (KAL-90): the context stamp is tiny and drives click-to-restore.
    uiContext: payload?.uiContext || null,
  };
}

function legacyUnscopedAvailable(storage = safeLegacyStorage()) {
  try { return storage?.getItem?.(LOCAL_HISTORY_STORAGE_KEY) != null; } catch { return false; }
}

function mergeHistoryRows(primaryRows = [], fallbackRows = [], limit = HISTORY_EVENT_LIMIT) {
  const byClientId = new Map();
  [...fallbackRows, ...primaryRows].forEach((row) => {
    if (!row) return;
    if (!shouldExposeHistoryRow(row)) return;
    const key = row.client_event_id || row.id;
    if (!key) return;
    byClientId.set(key, row);
  });
  // An unconfirmed local row is the first committed value for its immutable
  // client id. A differing cloud duplicate must not hide its restore payload.
  fallbackRows.filter(row => row?.__syncState === 'pending').forEach(row => {
    const key = row.client_event_id || row.id;
    if (key && shouldExposeHistoryRow(row)) byClientId.set(key, row);
  });
  return Array.from(byClientId.values())
    .sort((a, b) => (Date.parse(b.occurred_at || b.created_at || 0) || 0) - (Date.parse(a.occurred_at || a.created_at || 0) || 0))
    .slice(0, limit);
}

function shouldExposeHistoryRow(row) {
  const eventType = row?.event_type || row?.type;
  return eventType !== 'yjs_history_added' && eventType !== 'yjs_history_popped';
}

// KAL-313 / history F2 (2026-06-11): ONE restorable History row per delete.
// Checkpoint debug events with these reasons are activity TWINS of dedicated
// trash rows (callout_deleted / space_deleted / annotations_bulk_deleted /
// survey-marker delete rows) — the trash row is the single visible, restorable,
// trigger-protected record, so the checkpoint twin is not persisted.
// 'highlight:delete' is a prefix match: it also covers 'highlight:delete-pending',
// which fires before a deletion that may never commit.
function isDeleteCheckpointTwin(event) {
  if (event.type !== 'checkpoint_added' && event.type !== 'checkpoint_added_annotation_fast') {
    return false;
  }
  const reason = String(event.reason || '');
  return reason === 'callouts:delete'
    || reason === 'space:delete'
    || reason === 'delete:batch'
    || reason.startsWith('highlight:delete');
}

export function buildHistoryEventRowFromDebugEvent(event, { documentId, user } = {}) {
  if (!documentId || !event || typeof event !== 'object') return null;
  // KAL-313 / history F2: the emitter can mark an event as covered by a
  // dedicated trash row (e.g. fabric:delete — annotation_deleted is the one
  // visible, restorable record). Suppressed here so the debug timeline keeps
  // the event but the History panel shows a single row per delete.
  if (event.suppressHistoryRow === true) return null;
  if (isDeleteCheckpointTwin(event)) return null;
  const trackable = new Set([
    'local_annotation_history_added',
    'checkpoint_added',
    'checkpoint_added_annotation_fast',
    'local_annotation_undo_applied',
    'local_annotation_redo_applied',
    'legacy_annotation_undo_applied',
    'legacy_annotation_redo_applied',
  ]);
  if (!trackable.has(event.type)) return null;

  const actorName = getActorName(user);
  const pageNumber = Number(event.pageNumber ?? event.context?.pageNumber);
  const compactPayload = trimPayload(event);
  const order = event.order ?? event.checkpointId ?? event.seq ?? Date.now();
  const source = event.historySource || event.lane || event.chosenSource || null;
  const occurredAt = event.timestamp || event.at || new Date().toISOString();
  const clientEventId = [
    'history',
    event.type,
    order,
    event.annotationId || event.context?.annotationId || 'document',
    Number.isFinite(pageNumber) ? pageNumber : 'no-page',
    // KAL-90 follow-up (2026-07-07): checkpoint counters restart at 1 every
    // session, so ids built only from (type, order, annotation, page) COLLIDE
    // with rows from earlier sessions — and the ignoreDuplicates upsert then
    // silently drops every new event that reuses a counter value. Suffix the
    // event's timestamp so ids are unique across sessions while staying stable
    // for the same event object (dispatch + record share one row).
    Date.parse(occurredAt) || occurredAt,
  ].join(':');

  return {
    id: clientEventId,
    document_id: documentId,
    user_id: user?.id || null,
    client_event_id: clientEventId,
    event_type: event.type,
    source,
    page_number: Number.isFinite(pageNumber) ? pageNumber : null,
    annotation_id: event.annotationId || event.context?.annotationId || event.context?.calloutId || null,
    summary: buildSummary({ actorName, event }),
    payload: compactPayload,
    is_undoable: event.type !== 'yjs_history_popped',
    is_checkpoint: event.type === 'checkpoint_added' || event.type === 'checkpoint_added_annotation_fast',
    occurred_at: occurredAt,
    created_at: occurredAt,
  };
}

const CLOUD_FIELDS = 'id, document_id, user_id, client_event_id, event_type, source, page_number, annotation_id, summary, payload, is_undoable, is_checkpoint, occurred_at, created_at';
const scopeFor = (row, options = {}) => {
  if (options.guestScopeId != null) return options.guestScopeId === 'device-local' ? 'guest:device-local' : null;
  const actorUserId = options.actorUserId ?? row?.user_id;
  return typeof actorUserId === 'string' && actorUserId.length > 0 ? `account:${actorUserId}` : null;
};
const safeError = error => Object.assign(new Error('Document history could not be saved locally.'),
  { code: error?.code || 'DOCUMENT_HISTORY_LOCAL_ADMISSION_FAILED' });
let defaultStore;
const localDefault = () => {
  if (defaultStore !== undefined) return defaultStore;
  try { defaultStore = getDocumentHistoryStore(); } catch { defaultStore = null; }
  return defaultStore;
};

export function createDocumentHistoryService({ cloud = supabase, localStore = localDefault(),
  legacyStorage = safeLegacyStorage() } = {}) {
  const localReadErrors = new Map();
  const localReadFailed = error => Object.assign(new Error('Document history could not be read from local storage.'),
    { code: 'DOCUMENT_HISTORY_LOCAL_READ_FAILED', cause: error });
  const unavailable = code => ({ data: null,
    error: Object.assign(new Error('Document history local storage is unavailable.'), { code }),
    local: { state: 'unavailable', code } });
  async function record(row, options = {}, onAdmitted = null) {
    if (!row?.document_id || !row?.client_event_id) return { data: null, error: null };
    const scopeKey = scopeFor(row, options);
    if (!scopeKey) return unavailable('DOCUMENT_HISTORY_SCOPE_REQUIRED');
    if (!localStore) return unavailable('DOCUMENT_HISTORY_LOCAL_UNAVAILABLE');
    let admission;
    try { admission = await localStore.admitPending(scopeKey, row); }
    catch (error) {
      const safe = safeError(error);
      return { data: null, error: safe, local: { state: 'unavailable', code: safe.code } };
    }
    try { onAdmitted?.(); } catch { /* persistence succeeded; live UI owns callback errors */ }
    const pending = { data: null, error: null, local: { state: 'pending' } };
    if (scopeKey.startsWith('guest:') || !cloud) return pending;
    const { id: _localId, __local: _localOnly, __syncState: _syncState, ...dbRow } = row;
    let query = cloud.from('document_history_events')
      .upsert(dbRow, { onConflict: 'document_id,client_event_id', ignoreDuplicates: true });
    if (typeof query?.select === 'function') query = query.select(CLOUD_FIELDS);
    let response;
    try { response = await query; }
    catch (error) {
      console.error('[DocumentHistory] record failed:', error);
      return { data: null, error, local: { state: 'pending' } };
    }
    const { data, error } = response;
    if (error) {
      if (isMissingHistoryTableError(error)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn('[DocumentHistory] document_history_events table is not available yet; local activity history remains pending.');
        }
        return pending;
      }
      console.error('[DocumentHistory] record failed:', error);
      return { data: null, error, local: { state: 'pending' } };
    }
    const returned = Array.isArray(data) ? data[0] : data;
    const confirmed = returned ? await localStore.confirm(admission.token, returned) : false;
    return { data: null, error: null, local: { state: confirmed ? 'confirmed' : 'pending' } };
  }
  async function list(documentId, { limit = HISTORY_EVENT_LIMIT, actorUserId, guestScopeId } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || HISTORY_EVENT_LIMIT));
    const scopeKey = scopeFor(null, { actorUserId, guestScopeId });
    let localRows = [];
    if (scopeKey) {
      if (!localStore) {
        const error = localReadFailed(new Error('Local history storage is unavailable.'));
        localReadErrors.set(scopeKey, error.code);
        throw error;
      }
      try {
        localRows = await localStore.list(scopeKey, documentId, safeLimit);
        localReadErrors.delete(scopeKey);
      } catch (cause) {
        const error = localReadFailed(cause);
        localReadErrors.set(scopeKey, error.code);
        throw error;
      }
    }
    if (!documentId || scopeKey?.startsWith('guest:') || !cloud) return mergeHistoryRows([], localRows, safeLimit);
    let response;
    try {
      response = await cloud.from('document_history_events').select(CLOUD_FIELDS)
        .eq('document_id', documentId).order('occurred_at', { ascending: false }).limit(safeLimit);
    } catch (error) {
      if (isTransportError(error)) return mergeHistoryRows([], localRows, safeLimit);
      throw error;
    }
    const { data, error } = response;
    if (error) {
      if (isMissingHistoryTableError(error) || isTransportError(error, response)) return mergeHistoryRows([], localRows, safeLimit);
      throw error;
    }
    if (scopeKey && localStore) {
      try {
        if (typeof localStore.cacheConfirmedBatch === 'function') {
          await localStore.cacheConfirmedBatch(scopeKey, data || []);
        } else {
          for (const row of data || []) await localStore.cacheConfirmed(scopeKey, row);
        }
      } catch { /* cloud is durable */ }
      try {
        localRows = await localStore.list(scopeKey, documentId, safeLimit);
        localReadErrors.delete(scopeKey);
      } catch (cause) {
        const error = localReadFailed(cause);
        localReadErrors.set(scopeKey, error.code);
        throw error;
      }
    }
    return mergeHistoryRows(data || [], localRows, safeLimit);
  }
  const status = async options => {
    const scopeKey = scopeFor(null, options);
    let base = { available: false, pendingCount: 0, protectedBytes: 0, globalProtectedBytes: 0,
      protectedLimitBytes: null, protectedFull: false, confirmedCacheBytes: 0,
      errorCode: 'DOCUMENT_HISTORY_LOCAL_UNAVAILABLE' };
    try { if (localStore) base = await localStore.status(scopeKey); } catch { /* status remains safe */ }
    const localReadError = localReadErrors.get(scopeKey);
    if (localReadError) base = { ...base, available: false, errorCode: localReadError };
    return { ...base, legacyUnscopedAvailable: legacyUnscopedAvailable(legacyStorage) };
  };
  const subscribe = (options, listener) => {
    const scopeKey = scopeFor(null, options);
    try { return localStore?.subscribe(scopeKey, listener) || (() => {}); }
    catch { return () => {}; }
  };
  const recordAndNotify = (row, options) => record(row, options,
    () => notifyDocumentHistoryEventRecorded(row));
  return Object.freeze({ recordDocumentHistoryEvent: record, listDocumentHistoryEvents: list,
    getDocumentHistoryStorageStatus: status, subscribeDocumentHistoryStorage: subscribe,
    recordAndNotifyDocumentHistoryEvent: recordAndNotify });
}

const defaultHistoryService = createDocumentHistoryService();
export const recordDocumentHistoryEvent = (...args) => defaultHistoryService.recordDocumentHistoryEvent(...args);

// History-audit P2 (2026-06-11): unified write path for DIRECT history rows
// (space/region/callout/single-annotation/bulk deletes). Records the row AND
// dispatches the document-history:event-recorded window event so the History
// panel live-updates instead of waiting for the 10s poll. The debug-pipeline
// path (pushHistoryDebugEvent in PDFViewer) keeps its own dispatch and must
// NOT call this — dedupe here guards against accidental double-dispatch of
// the same client_event_id within a short window.
const recentlyNotifiedEventIds = new Map(); // client_event_id -> timestamp ms
const NOTIFY_DEDUPE_WINDOW_MS = 5000;

export function notifyDocumentHistoryEventRecorded(row) {
  if (typeof window === 'undefined' || !row?.document_id || !row?.client_event_id) return;
  const now = Date.now();
  const lastAt = recentlyNotifiedEventIds.get(row.client_event_id);
  if (lastAt != null && now - lastAt < NOTIFY_DEDUPE_WINDOW_MS) return; // already announced
  recentlyNotifiedEventIds.set(row.client_event_id, now);
  // Bounded memory: drop stale entries opportunistically.
  if (recentlyNotifiedEventIds.size > 200) {
    for (const [key, at] of recentlyNotifiedEventIds) {
      if (now - at >= NOTIFY_DEDUPE_WINDOW_MS) recentlyNotifiedEventIds.delete(key);
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('document-history:event-recorded', {
      detail: { documentId: row.document_id, row },
    }));
  } catch (_err) {
    // Live-update signal is best-effort; persistence is handled separately.
  }
}

export async function recordAndNotifyDocumentHistoryEvent(row, options) {
  if (!row?.document_id || !row?.client_event_id) return { data: null, error: null };
  return defaultHistoryService.recordAndNotifyDocumentHistoryEvent(row, options);
}

export const listDocumentHistoryEvents = (...args) => defaultHistoryService.listDocumentHistoryEvents(...args);
export const getDocumentHistoryStorageStatus = (...args) => defaultHistoryService.getDocumentHistoryStorageStatus(...args);
export const subscribeDocumentHistoryStorage = (...args) => defaultHistoryService.subscribeDocumentHistoryStorage(...args);
