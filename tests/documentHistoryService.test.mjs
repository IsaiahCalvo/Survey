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
  equal(row.client_event_id, 'history:local_annotation_history_added:12:stroke-1:1');
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
