/**
 * documentHistoryService.js — document activity-history recording/reading service.
 *
 * Maps debug/checkpoint events into human-readable summaries and persists them
 * to the Supabase `document_history_events` table with a localStorage fallback
 * (LOCAL_HISTORY_STORAGE_KEY) when the table is missing/offline. Exports
 * buildHistoryEventRowFromDebugEvent, recordDocumentHistoryEvent,
 * recordDocumentHistoryDebugEvent, and listDocumentHistoryEvents; classifies
 * callout/space/survey-marker actions for the activity feed.
 */
import { supabase } from '../supabaseClient.js';

const HISTORY_EVENT_LIMIT = 200;
const MAX_PAYLOAD_CHARS = 12000;
const LOCAL_HISTORY_STORAGE_KEY = 'survey_document_history_events_v1';
let warnedMissingTable = false;

function isMissingHistoryTableError(error) {
  return error?.code === '42P01' || String(error?.message || '').includes('document_history_events');
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
    const { polygons: _polygons, paperCenterline: _paperCenterline, ...withPath } = previewAnnotation;
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

function getLocalHistoryStore() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function writeLocalHistoryStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_HISTORY_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (_err) {
    // Local fallback is best-effort; Supabase remains the durable store.
  }
}

function cacheLocalHistoryRow(row) {
  if (!row?.document_id || !row?.client_event_id) return;
  const store = getLocalHistoryStore();
  const existing = Array.isArray(store[row.document_id]) ? store[row.document_id] : [];
  const nextRow = {
    ...row,
    id: row.id || row.client_event_id,
    occurred_at: row.occurred_at || row.created_at || new Date().toISOString(),
    created_at: row.created_at || row.occurred_at || new Date().toISOString(),
    __local: true,
  };
  const deduped = [
    nextRow,
    ...existing.filter((entry) => entry?.client_event_id !== row.client_event_id),
  ]
    .sort((a, b) => (Date.parse(b.occurred_at || b.created_at || 0) || 0) - (Date.parse(a.occurred_at || a.created_at || 0) || 0))
    .slice(0, 500);
  store[row.document_id] = deduped;
  writeLocalHistoryStore(store);
}

function listLocalHistoryRows(documentId) {
  if (!documentId) return [];
  const store = getLocalHistoryStore();
  return Array.isArray(store[documentId]) ? store[documentId] : [];
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

export async function recordDocumentHistoryEvent(row) {
  if (!row?.document_id || !row?.client_event_id) return { data: null, error: null };
  cacheLocalHistoryRow(row);
  if (!supabase) return { data: null, error: null };
  const { id: _localId, __local: _localOnly, ...dbRow } = row;
  const { error } = await supabase
    .from('document_history_events')
    .upsert(dbRow, { onConflict: 'document_id,client_event_id', ignoreDuplicates: true });
  if (error) {
    if (isMissingHistoryTableError(error)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn('[DocumentHistory] document_history_events table is not available yet; activity history disabled until migrations run.');
      }
      return { data: null, error: null };
    }
    console.error('[DocumentHistory] record failed:', error);
  }
  return { data: null, error };
}

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

export async function recordAndNotifyDocumentHistoryEvent(row) {
  if (!row?.document_id || !row?.client_event_id) return { data: null, error: null };
  notifyDocumentHistoryEventRecorded(row);
  return recordDocumentHistoryEvent(row);
}

export async function listDocumentHistoryEvents(documentId, { limit = HISTORY_EVENT_LIMIT } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || HISTORY_EVENT_LIMIT));
  const localRows = listLocalHistoryRows(documentId);
  if (!supabase || !documentId) return mergeHistoryRows([], localRows, safeLimit);
  const { data, error } = await supabase
    .from('document_history_events')
    .select('id, document_id, user_id, client_event_id, event_type, source, page_number, annotation_id, summary, payload, is_undoable, is_checkpoint, occurred_at, created_at')
    .eq('document_id', documentId)
    .order('occurred_at', { ascending: false })
    .limit(safeLimit);
  if (error) {
    if (isMissingHistoryTableError(error)) return mergeHistoryRows([], localRows, safeLimit);
    throw error;
  }
  return mergeHistoryRows(data || [], localRows, safeLimit);
}
