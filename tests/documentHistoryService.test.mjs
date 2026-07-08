import test from 'node:test';
import { equal, match, deepEqual } from 'node:assert/strict';

import {
  buildHistoryEventRowFromDebugEvent,
  notifyDocumentHistoryEventRecorded,
  recordAndNotifyDocumentHistoryEvent,
} from '../src/services/documentHistoryService.js';

const user = {
  id: 'user-1',
  email: 'isaiah@example.com',
  user_metadata: { full_name: 'Isaiah Calvo' },
};

test('document history describes completed pen strokes as user activity', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 12,
    actionType: 'create',
    rawActionType: 'fabric:create',
    annotationType: 'path',
    annotationId: 'stroke-1',
    pageNumber: 1,
    itemCount: 1,
  }, { documentId: 'doc-1', user });

  equal(row.document_id, 'doc-1');
  equal(row.user_id, 'user-1');
  equal(row.event_type, 'local_annotation_history_added');
  // KAL-90 follow-up: ids carry a trailing timestamp so counter reuse across
  // sessions can't collide (colliding ids were silently dropped by the upsert).
  match(row.client_event_id, /^history:local_annotation_history_added:12:stroke-1:1:\d+$/);
  equal(row.page_number, 1);
  equal(row.annotation_id, 'stroke-1');
  equal(row.summary, 'Isaiah Calvo drew a pen stroke on page 1');
  equal(row.is_undoable, true);
});

test('document history records restore checkpoints separately from activity edits', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'checkpoint_added',
    checkpointId: 4,
    reason: 'callouts:create',
    context: { calloutId: 'callout-1', pageNumber: 3 },
    pageNumber: 3,
  }, { documentId: 'doc-1', user });

  equal(row.is_checkpoint, true);
  equal(row.summary, 'Isaiah Calvo created a callout on page 3');
  match(row.client_event_id, /^history:checkpoint_added:4:/);
});

// History-audit P3 — previewAnnotation must survive payload trimming (it
// drives the spotlight highlight), bounded by a defensive size cap.
test('trimmed payloads keep a small previewAnnotation for the spotlight', () => {
  const previewAnnotation = {
    type: 'rect', left: 10, top: 20, width: 30, height: 40, angle: 0, strokeWidth: 2,
  };
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 99,
    actionType: 'create',
    rawActionType: 'fabric:create',
    annotationType: 'rect',
    annotationId: 'rect-big',
    pageNumber: 2,
    previewAnnotation,
    filler: 'x'.repeat(20000), // force the trim path
  }, { documentId: 'doc-1', user });
  equal(row.payload.truncated, true, 'payload should have been trimmed');
  deepEqual(row.payload.previewAnnotation, previewAnnotation,
    'small previewAnnotation must survive trimming intact');
});

test('oversized previewAnnotation is clamped to its geometry envelope', () => {
  const hugePath = Array.from({ length: 2000 }, (_, i) => ['L', i, i]);
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 100,
    actionType: 'create',
    rawActionType: 'fabric:create',
    annotationType: 'path',
    annotationId: 'ink-huge',
    pageNumber: 2,
    previewAnnotation: {
      type: 'path', left: 5, top: 6, width: 100, height: 100, path: hugePath,
    },
    filler: 'x'.repeat(20000),
  }, { documentId: 'doc-1', user });
  equal(row.payload.truncated, true);
  const preview = row.payload.previewAnnotation;
  equal(preview?.path, undefined, 'path-heavy ink data must be dropped from the preview');
  equal(preview?.left, 5, 'geometry envelope must survive (bounding-rect fallback)');
  equal(preview?.width, 100);
});

// History-audit P2 — unified record+notify wrapper. The service reads
// `window` at CALL time, so a stub window installed per-test is sufficient.
function withStubWindow(fn) {
  const events = [];
  const storage = new Map();
  const prevWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent: (event) => { events.push(event); return true; },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
  };
  try {
    return fn(events);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
}

test('recordAndNotify dispatches document-history:event-recorded with the row', async () => {
  await withStubWindow(async (events) => {
    const row = {
      document_id: 'doc-notify-1',
      client_event_id: 'evt-notify-1',
      event_type: 'region_deleted',
      occurred_at: '2026-06-11T00:00:00.000Z',
    };
    await recordAndNotifyDocumentHistoryEvent(row);
    equal(events.length, 1, 'exactly one live-update event dispatched');
    equal(events[0].type, 'document-history:event-recorded');
    equal(events[0].detail.documentId, 'doc-notify-1');
    deepEqual(events[0].detail.row, row);
  });
});

test('notify is idempotent per client_event_id within the dedupe window', () => {
  withStubWindow((events) => {
    const row = { document_id: 'doc-notify-2', client_event_id: 'evt-dedupe-1' };
    notifyDocumentHistoryEventRecorded(row);
    notifyDocumentHistoryEventRecorded(row); // pipeline-path double-fire simulation
    equal(events.length, 1, 'duplicate dispatch for the same row must be suppressed');
    notifyDocumentHistoryEventRecorded({ document_id: 'doc-notify-2', client_event_id: 'evt-dedupe-2' });
    equal(events.length, 2, 'distinct rows still dispatch');
  });
});

test('notify refuses rows missing identity fields', () => {
  withStubWindow((events) => {
    notifyDocumentHistoryEventRecorded(null);
    notifyDocumentHistoryEventRecorded({ document_id: 'doc-only' });
    notifyDocumentHistoryEventRecorded({ client_event_id: 'evt-only' });
    equal(events.length, 0);
  });
});

test('document history does not expose lower-level Yjs events that duplicate user actions', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'yjs_history_added',
    checkpointId: 13,
    actionType: 'add',
    annotationType: 'fabric',
    annotationId: 'stroke-1',
    pageNumber: 1,
  }, { documentId: 'doc-1', user });

  equal(row, null);
});

test('document history keeps deleted annotation restore payloads when compact enough', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 14,
    actionType: 'delete',
    rawActionType: 'fabric:delete',
    annotationType: 'path',
    annotationId: 'stroke-2',
    pageNumber: 2,
    itemCount: 1,
    visualBounds: { coordinateSpace: 'page-fabric', left: 10, top: 20, width: 50, height: 12 },
    previewAnnotation: { id: 'stroke-2', type: 'path', path: [['M', 10, 20], ['L', 60, 20]], stroke: '#f00' },
    restoreAction: {
      type: 'fabric:create',
      pageNumber: 2,
      annotationId: 'stroke-2',
      annotation: { id: 'stroke-2', type: 'path', path: [['M', 10, 20], ['L', 60, 20]], stroke: '#f00' },
      index: 0,
    },
  }, { documentId: 'doc-1', user });

  equal(row.summary, 'Isaiah Calvo deleted a pen stroke on page 2');
  equal(row.payload.restoreAction.type, 'fabric:create');
  equal(row.payload.restoreAction.annotation.id, 'stroke-2');
  equal(row.payload.visualBounds.left, 10);
});

// ─── KAL-313 / history F2 (2026-06-11): one restorable row per delete ────────

test('suppressHistoryRow events never persist a history row (delete activity twin)', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 21,
    actionType: 'delete',
    rawActionType: 'fabric:delete',
    annotationType: 'rect',
    annotationId: 'rect-1',
    pageNumber: 1,
    suppressHistoryRow: true,
  }, { documentId: 'doc-1', user });
  equal(row, null);
});

test('delete-reason checkpoints are activity twins of trash rows and are not persisted', () => {
  for (const reason of ['callouts:delete', 'space:delete', 'delete:batch', 'highlight:delete', 'highlight:delete-pending']) {
    const row = buildHistoryEventRowFromDebugEvent({
      type: 'checkpoint_added',
      checkpointId: 7,
      reason,
      pageNumber: 1,
    }, { documentId: 'doc-1', user });
    equal(row, null, `checkpoint with reason "${reason}" must not persist (trash row covers it)`);
  }
});

test('non-delete checkpoints still persist (create/edit activity unaffected)', () => {
  for (const reason of ['callouts:create', 'space:create', 'space:update', 'highlight:create', 'annotations:save']) {
    const row = buildHistoryEventRowFromDebugEvent({
      type: 'checkpoint_added',
      checkpointId: 8,
      reason,
      pageNumber: 1,
    }, { documentId: 'doc-1', user });
    equal(Boolean(row), true, `checkpoint with reason "${reason}" must still persist`);
  }
});

test('un-flagged delete events still persist (eraser path keeps its only restorable row)', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'local_annotation_history_added',
    checkpointId: 22,
    actionType: 'delete',
    rawActionType: 'fabric:batch',
    annotationType: 'path',
    pageNumber: 3,
    itemCount: 2,
    restoreAction: { type: 'fabric:batch', pageNumber: 3, created: [] },
  }, { documentId: 'doc-1', user });
  equal(Boolean(row), true, 'pure-delete batch without suppressHistoryRow must persist');
});
