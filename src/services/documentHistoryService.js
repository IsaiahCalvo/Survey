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
import { slimHistoryPreviewBefore } from '../utils/historyPreviewAnnotation.js';

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
  // w56: "created a text box", never "created a text".
  if (text === 'textbox' || text === 'text' || text === 'freetext') return 'text box';
  if (text === 'rect' || text === 'square') return 'rectangle';
  if (text === 'circle') return 'circle';
  if (text === 'ellipse') return 'ellipse';
  if (text === 'line') return 'line';
  if (text === 'arrow') return 'arrow';
  if (text === 'polygon') return 'polygon';
  if (text === 'polyline') return 'polyline';
  if (text === 'counter') return 'counter';
  if (text === 'callout') return 'callout';
  if (text.includes('survey')) return 'survey marker';
  if (text === 'fabric') return 'annotation';
  return text || 'annotation';
}

// w55: "an ellipse", "an arrow", "a rectangle" — never "a ellipse".
function withArticle(label) {
  if (label === 'annotation') return 'an annotation';
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
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
  // w55: a History-panel Restore is logged as a restore, not as the
  // create/move the re-save looks like.
  if (event.restoredFromHistory === true) return `${actorName} restored ${count > 1 ? `${count} annotations` : withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'create') return `${actorName} created ${withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'delete') return `${actorName} deleted ${count > 1 ? `${count} annotations` : withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'move') return `${actorName} moved ${withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'resize') return `${actorName} resized ${withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'rotate') return `${actorName} rotated ${withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'text edit') return `${actorName} edited text${pageSuffix}`;
  // RULED 2026-09-28 owner: History option A wording.
  if (action === 'recolor') return `${actorName} changed the color of ${withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'erase') return `${actorName} erased part of ${withArticle(annotationLabel)}${pageSuffix}`;
  // w56: the user lock (right-click Lock / Unlock).
  if (action === 'lock') return `${actorName} locked ${count > 1 ? `${count} annotations` : withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'unlock') return `${actorName} unlocked ${count > 1 ? `${count} annotations` : withArticle(annotationLabel)}${pageSuffix}`;
  if (action === 'callout edit') return `${actorName} edited a callout${pageSuffix}`;

  return `${actorName} edited ${withArticle(annotationLabel)}${pageSuffix}`;
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
    // History option A (2026-09-28): the "Before" ghost of an edit, bounded.
    previewBefore: clampPreviewAnnotation(payload?.previewBefore),
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

// w55: the device copy is a fallback for rows the server has not taken yet,
// not a second archive. It is capped so it can never fill localStorage (which
// other features also write to): at most LOCAL_HISTORY_MAX_ROWS rows for each of
// the LOCAL_HISTORY_MAX_DOCUMENTS most recently used documents, nothing older
// than the server keeps (60 days, the prod prune window).
const LOCAL_HISTORY_MAX_ROWS = 100;
const LOCAL_HISTORY_MAX_DOCUMENTS = 10;
const LOCAL_HISTORY_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

function rowTimeMs(row) {
  return Date.parse(row?.occurred_at || row?.created_at || 0) || 0;
}

// Trash rows (a deleted item's restore data) are capped separately from
// activity, so a burst of ordinary edits never pushes out the only copy of a
// delete row whose upload has not gone through yet.
export function capLocalHistoryStore(store, { now = Date.now() } = {}) {
  const cutoff = now - LOCAL_HISTORY_MAX_AGE_MS;
  const newestFirst = (a, b) => rowTimeMs(b) - rowTimeMs(a);
  const entries = Object.entries(store || {})
    .map(([documentId, rows]) => {
      const fresh = (Array.isArray(rows) ? rows : []).filter((row) => row && rowTimeMs(row) >= cutoff);
      const trash = fresh.filter((row) => isTrashHistoryEvent(row)).sort(newestFirst).slice(0, LOCAL_HISTORY_MAX_ROWS);
      const activity = fresh.filter((row) => !isTrashHistoryEvent(row)).sort(newestFirst).slice(0, LOCAL_HISTORY_MAX_ROWS);
      return [documentId, [...trash, ...activity].sort(newestFirst)];
    })
    .filter(([, rows]) => rows.length > 0)
    .sort((a, b) => rowTimeMs(b[1][0]) - rowTimeMs(a[1][0]))
    .slice(0, LOCAL_HISTORY_MAX_DOCUMENTS);
  return Object.fromEntries(entries);
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
  store[row.document_id] = [
    nextRow,
    ...existing.filter((entry) => entry?.client_event_id !== row.client_event_id),
  ];
  writeLocalHistoryStore(capLocalHistoryStore(store));
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

/**
 * RULED 2026-09-28 owner: History option A — a partial erase (the eraser trims
 * part of a mark and the mark stays) is one History line: "erased part of a
 * pen stroke", with the mark before and after so History can peek at it.
 * The cloud erase lane commits outside the save pipeline, so it had no line.
 * `targets` = the committed erase intent's 'replace' targets ({ before, after,
 * storageKey }); `project` shrinks a mark to its History preview.
 */
export function buildPartialEraseHistoryRow({
  targets,
  documentId,
  user,
  mutationId,
  pageNumber,
  committedAt,
  project = (annotation) => annotation,
} = {}) {
  const trimmed = (Array.isArray(targets) ? targets : [])
    .filter((target) => target?.operation === 'replace' && target.cause !== 'counter-renumber'
      && target.before && target.after);
  if (!documentId || !mutationId || trimmed.length === 0) return null;
  const first = trimmed[0];
  const idOf = (target) => target.after?.data?.id ?? target.after?.id ?? target.after?.annotationId ?? target.storageKey ?? null;
  const ids = [...new Set(trimmed.map(idOf).filter(Boolean).map(String))];
  const annotationType = first.after?.data?.type || first.after?.type || null;
  const page = Number(pageNumber);
  const occurredAt = committedAt || new Date().toISOString();
  const event = {
    type: 'local_annotation_history_added',
    actionType: 'erase',
    rawActionType: 'eraser:partial',
    annotationType,
    annotationId: ids[0] || null,
    annotationIds: ids.length > 1 ? ids : undefined,
    itemCount: ids.length,
    pageNumber: Number.isFinite(page) ? page : null,
    historySource: 'eraser',
    previewAnnotation: project(first.after),
    previewBefore: slimHistoryPreviewBefore(project(first.before)),
  };
  const clientEventId = `annotation-erase:${mutationId}`;
  return {
    id: clientEventId,
    document_id: documentId,
    user_id: user?.id || null,
    client_event_id: clientEventId,
    event_type: 'local_annotation_history_added',
    source: 'eraser',
    page_number: Number.isFinite(page) ? page : null,
    annotation_id: ids[0] || null,
    summary: buildSummary({ actorName: getActorName(user), event }),
    payload: trimPayload(event),
    is_undoable: true,
    is_checkpoint: false,
    occurred_at: occurredAt,
    created_at: occurredAt,
  };
}

export async function recordDocumentHistoryEvent(row) {
  if (!row?.document_id || !row?.client_event_id) return { data: null, error: null };
  cacheLocalHistoryRow(row);
  if (!supabase) return { data: null, error: null };
  // w55: created_at is left to the server (column default NOW()) so it is the
  // time the row ARRIVED; the panel's refresh asks for rows by arrival time,
  // which catches late uploads (offline work, retries, a slow clock) that an
  // occurred_at filter would miss. occurred_at stays the time of the action.
  const { id: _localId, __local: _localOnly, created_at: _clientCreatedAt, ...dbRow } = row;
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

// w55: History rows that hold a deleted item's restore data. These are the
// trash: kept forever on the server (never pruned), and the only rows the
// History panel offers Restore on. Undo/redo rows carry restore-like payloads
// too, so the panel must key off the row type, never the summary text.
export const TRASH_HISTORY_EVENT_TYPES = Object.freeze([
  'annotation_deleted',
  'callout_deleted',
  'region_deleted',
  'annotations_bulk_deleted',
  'space_deleted',
  'survey_marker_deleted',
]);

export function isTrashHistoryEvent(event) {
  return TRASH_HISTORY_EVENT_TYPES.includes(event?.event_type);
}

const HISTORY_EVENT_COLUMNS = 'id, document_id, user_id, client_event_id, event_type, source, page_number, annotation_id, summary, payload, is_undoable, is_checkpoint, occurred_at, created_at';

/**
 * List a document's History rows, newest first.
 *   limit   page size (1..500)
 *   before/beforeId  keyset cursor = the oldest SERVER row shown: only rows
 *           older than it ("Load older" paging; ties on time are ordered by id)
 *   arrivedSince  ISO time: only rows that reached the server at or after
 *           this (created_at, set by the server) — the incremental refresh
 */
export async function listDocumentHistoryEvents(documentId, {
  limit = HISTORY_EVENT_LIMIT,
  before = null,
  beforeId = null,
  arrivedSince = null,
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || HISTORY_EVENT_LIMIT));
  const beforeMs = before ? Date.parse(before) : NaN;
  const arrivedMs = arrivedSince ? Date.parse(arrivedSince) : NaN;
  const localRows = listLocalHistoryRows(documentId).filter((row) => {
    const at = rowTimeMs(row);
    if (Number.isFinite(beforeMs) && !(at <= beforeMs)) return false;
    if (Number.isFinite(arrivedMs) && !(at >= arrivedMs)) return false;
    return true;
  });
  if (!supabase || !documentId) return mergeHistoryRows([], localRows, safeLimit);
  let query = supabase
    .from('document_history_events')
    .select(HISTORY_EVENT_COLUMNS)
    .eq('document_id', documentId);
  if (Number.isFinite(beforeMs)) {
    const at = new Date(beforeMs).toISOString();
    // Keyset paging on (occurred_at, id): rows that share the cut-off time
    // (a bulk delete writes several rows with one timestamp) are never skipped.
    query = beforeId
      ? query.or(`occurred_at.lt."${at}",and(occurred_at.eq."${at}",id.lt.${beforeId})`)
      : query.lte('occurred_at', at);
  }
  if (Number.isFinite(arrivedMs)) query = query.gte('created_at', new Date(arrivedMs).toISOString());
  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (error) {
    if (isMissingHistoryTableError(error)) return mergeHistoryRows([], localRows, safeLimit);
    throw error;
  }
  return mergeHistoryRows(data || [], localRows, safeLimit);
}

/**
 * w55: the newest space_deleted row for a space, looked up on the server when
 * it is not among the rows the panel has loaded (region "Restore both?").
 */
export async function findDeletedSpaceHistoryEvent(documentId, spaceId) {
  if (!supabase || !documentId || !spaceId) return null;
  const { data, error } = await supabase
    .from('document_history_events')
    .select(HISTORY_EVENT_COLUMNS)
    .eq('document_id', documentId)
    .eq('event_type', 'space_deleted')
    .eq('payload->restoreAction->>spaceId', String(spaceId))
    .order('occurred_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
