import test from 'node:test';
import assert, { equal, match, deepEqual } from 'node:assert/strict';

import {
  buildHistoryEventRowFromDebugEvent,
  createDocumentHistoryService,
  notifyDocumentHistoryEventRecorded,
  recordAndNotifyDocumentHistoryEvent,
} from '../src/services/documentHistoryService.js';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createDocumentHistoryStore } from '../src/services/documentHistoryStore.js';

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
  const restore = () => {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  };
  try {
    const result = fn(events);
    if (result && typeof result.finally === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
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
    const service = createDocumentHistoryService({ cloud: null, localStore: {
      admitPending: async () => ({ token: {}, row, created: true }),
    }, legacyStorage: null });
    await service.recordAndNotifyDocumentHistoryEvent(row, { actorUserId: 'user-notify' });
    equal(events.length, 1, 'exactly one live-update event dispatched');
    equal(events[0].type, 'document-history:event-recorded');
    equal(events[0].detail.documentId, 'doc-notify-1');
    deepEqual(events[0].detail.row, row);
  });
});

test('recordAndNotify does not announce an event that failed local admission', async () => {
  await withStubWindow(async events => {
    const service = createDocumentHistoryService({ cloud: null, localStore: {
      admitPending: async () => { throw Object.assign(new Error('full'),
        { code: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' }); },
    }, legacyStorage: null });
    const result = await service.recordAndNotifyDocumentHistoryEvent({ document_id: 'doc-failed',
      client_event_id: 'failed', user_id: 'actor-a' });
    equal(result.local.state, 'unavailable');
    equal(events.length, 0);
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

test('atomic eraser checkpoint can stay in Cmd+Z history without duplicating durable effect rows', () => {
  const row = buildHistoryEventRowFromDebugEvent({
    type: 'checkpoint_added',
    checkpointId: 9,
    reason: 'eraser:gesture',
    pageNumber: 1,
    suppressHistoryRow: true,
  }, { documentId: 'doc-1', user });
  equal(row, null);
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

const historyRow = (id = 'event-1', changes = {}) => ({ document_id: 'doc-cloud', user_id: 'actor-a',
  client_event_id: id, event_type: 'edit', source: 'local', page_number: 1,
  annotation_id: id, summary: id, payload: {}, is_undoable: true, is_checkpoint: false,
  occurred_at: '2026-09-14T12:00:00.000Z', ...changes });
const makeStore = options => createDocumentHistoryStore({ indexedDB: new IDBFactory(),
  IDBKeyRange, dbName: `history-service-${Math.random()}`, BroadcastChannel: null, ...options });
function cloudAdapter({ write = { data: [], error: null }, read = { data: [], error: null }, onUpsert } = {}) {
  const calls = [];
  const cloud = { from(table) {
    calls.push(['from', table]);
    return {
      upsert(value, options) {
        calls.push(['upsert', value, options]); onUpsert?.(value);
        return { select: async fields => { calls.push(['upsert.select', fields]); return write; } };
      },
      select(fields) {
        calls.push(['select', fields]);
        const chain = { eq(...args) { calls.push(['eq', ...args]); return chain; },
          order(...args) { calls.push(['order', ...args]); return chain; },
          limit(...args) { calls.push(['limit', ...args]); return Promise.resolve(read); } };
        return chain;
      },
    };
  } };
  return { cloud, calls };
}

test('record admits locally before cloud and only exact returned content confirms it', async () => {
  const localStore = makeStore();
  const row = historyRow();
  let admitted = false;
  const localPort = { ...localStore, async admitPending(...args) {
    const result = await localStore.admitPending(...args); admitted = true; return result;
  } };
  const adapter = cloudAdapter({ write: { data: [{ ...row, id: 'server-id',
    created_at: '2026-09-14T12:00:00+00:00', occurred_at: '2026-09-14T12:00:00+00:00' }], error: null },
  onUpsert: () => equal(admitted, true) });
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore: localPort });
  try {
    const result = await service.recordDocumentHistoryEvent(row);
    equal(result.local.state, 'confirmed');
    equal((await localStore.list('account:actor-a', row.document_id))[0].__syncState, 'confirmed');
  } finally { localStore.close(); }
});

test('duplicate cloud success without an exact returned row stays pending', async () => {
  const localStore = makeStore();
  const service = createDocumentHistoryService({ cloud: cloudAdapter().cloud, localStore });
  try {
    const result = await service.recordDocumentHistoryEvent(historyRow());
    equal(result.local.state, 'pending');
    equal((await localStore.list('account:actor-a', 'doc-cloud'))[0].__syncState, 'pending');
  } finally { localStore.close(); }
});

test('same-id cloud conflict cannot replace the first local restore payload', async () => {
  const localStore = makeStore();
  const original = historyRow('immutable', { summary: 'local first',
    payload: { restoreAction: { annotationId: 'local-annotation' } } });
  const cloudConflict = historyRow('immutable', { summary: 'cloud differs', user_id: 'collaborator',
    payload: { restoreAction: { annotationId: 'wrong-cloud-annotation' } } });
  await localStore.admitPending('account:viewer', original);
  const adapter = cloudAdapter({ read: { data: [cloudConflict], error: null } });
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore });
  try {
    const listed = await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer' });
    equal(listed[0].summary, 'local first');
    equal(listed[0].payload.restoreAction.annotationId, 'local-annotation');
    equal(listed[0].__syncState, 'pending');
  } finally { localStore.close(); }
});

test('same-id local conflict is reported and never reaches cloud', async () => {
  const localStore = makeStore();
  const adapter = cloudAdapter();
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore });
  try {
    await service.recordDocumentHistoryEvent(historyRow('immutable-write', { summary: 'first' }));
    const callsAfterFirst = adapter.calls.length;
    const conflict = await service.recordDocumentHistoryEvent(historyRow('immutable-write', { summary: 'second' }));
    equal(conflict.error.code, 'DOCUMENT_HISTORY_EVENT_CONFLICT');
    equal(conflict.local.state, 'unavailable');
    equal(adapter.calls.length, callsAfterFirst);
    equal((await localStore.list('account:actor-a', 'doc-cloud'))[0].summary, 'first');
  } finally { localStore.close(); }
});

test('guest history is device-scoped and never invokes cloud', async () => {
  const localStore = makeStore(), adapter = cloudAdapter();
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore });
  try {
    equal((await service.recordDocumentHistoryEvent(historyRow('guest', { user_id: null }),
      { guestScopeId: 'device-local' })).local.state, 'pending');
    const rows = await service.listDocumentHistoryEvents('doc-cloud', { guestScopeId: 'device-local' });
    equal(rows[0].client_event_id, 'guest'); deepEqual(adapter.calls, []);
    equal((await service.recordDocumentHistoryEvent(historyRow('none', { user_id: null }))).local.code,
      'DOCUMENT_HISTORY_SCOPE_REQUIRED');
    equal((await service.recordDocumentHistoryEvent(historyRow('none-2', { user_id: null }))).error.code,
      'DOCUMENT_HISTORY_SCOPE_REQUIRED');
  } finally { localStore.close(); }
});

test('cloud list keeps collaborator authors visible under only the viewer account scope', async () => {
  const localStore = makeStore();
  const collaborator = historyRow('collab', { user_id: 'other-author' });
  const adapter = cloudAdapter({ read: { data: [collaborator], error: null } });
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore });
  try {
    const rows = await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer-a' });
    equal(rows[0].user_id, 'other-author');
    equal((await localStore.list('account:viewer-a', 'doc-cloud')).length, 1);
    equal((await localStore.list('account:other-author', 'doc-cloud')).length, 0);
    const cloudOnly = await service.listDocumentHistoryEvents('doc-cloud');
    equal(cloudOnly[0].client_event_id, 'collab');
  } finally { localStore.close(); }
});

test('only 42P01 falls back; permission and unknown table-name errors stay visible', async () => {
  for (const error of [
    { code: '42501', message: 'permission denied for table document_history_events' },
    { code: '403', message: 'document_history_events' },
    { code: 'unknown', message: 'document_history_events' },
    { code: '', name: 'TypeError', message: 'TypeError: Failed to fetch', status: 403 },
  ]) {
    const localStore = makeStore(), service = createDocumentHistoryService({
      cloud: cloudAdapter({ read: { data: null, error, status: error.status } }).cloud, localStore });
    try { await assert.rejects(service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer' }), error); }
    finally { localStore.close(); }
  }
  const localStore = makeStore();
  await localStore.admitPending('account:viewer', historyRow('offline'));
  const service = createDocumentHistoryService({ cloud: cloudAdapter({ read: { data: null,
    error: { code: '42P01', message: 'missing' } } }).cloud, localStore });
  try { equal((await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer' }))[0].client_event_id, 'offline'); }
  finally { localStore.close(); }
});

test('transport-only read failures expose the scoped sole copy without weakening auth errors', async () => {
  for (const transport of [
    { mode: 'returned', error: { message: 'Failed to fetch' } },
    { mode: 'supabase', error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 },
    { mode: 'rejected', error: new TypeError('fetch failed') },
  ]) {
    const localStore = makeStore();
    await localStore.admitPending('account:viewer', historyRow(`local-${transport.mode}`));
    const cloud = transport.mode !== 'rejected'
      ? cloudAdapter({ read: { data: null, error: transport.error, status: transport.status } }).cloud
      : { from() { return { select() { const chain = { eq() { return chain; }, order() { return chain; },
        limit() { return Promise.reject(transport.error); } }; return chain; } }; } };
    const service = createDocumentHistoryService({ cloud, localStore });
    try {
      equal((await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer' }))[0]
        .client_event_id, `local-${transport.mode}`);
    } finally { localStore.close(); }
  }
});

test('rejected cloud writes return an error while the local row remains pending', async () => {
  const localStore = makeStore();
  const networkError = new TypeError('fetch failed');
  const cloud = { from() { return { upsert() { return { select: () => Promise.reject(networkError) }; } }; } };
  const service = createDocumentHistoryService({ cloud, localStore });
  try {
    const result = await service.recordDocumentHistoryEvent(historyRow('write-offline'));
    equal(result.error, networkError);
    equal(result.local.state, 'pending');
    equal((await localStore.list('account:actor-a', 'doc-cloud'))[0].client_event_id, 'write-offline');
  } finally { localStore.close(); }
});

test('local admission failure blocks cloud and legacy v1 is status-only quarantine', async () => {
  const adapter = cloudAdapter();
  const localStore = { admitPending: async () => { throw Object.assign(new Error('quota'),
    { code: 'DOCUMENT_HISTORY_LOCAL_ADMISSION_FAILED' }); }, status: async () => ({ available: false,
    pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0, errorCode: 'quota' }),
  subscribe: () => () => {} };
  let reads = 0;
  const legacyStorage = { getItem(key) { reads++; return key === 'survey_document_history_events_v1'
    ? JSON.stringify({ 'doc-cloud': [{ payload: { secret: 'kept-raw' } }] }) : null; },
  setItem() { throw new Error('legacy data must stay read-only'); },
  removeItem() { throw new Error('legacy data must stay present'); } };
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore, legacyStorage });
  const result = await service.recordDocumentHistoryEvent(historyRow());
  equal(result.error.code, 'DOCUMENT_HISTORY_LOCAL_ADMISSION_FAILED'); deepEqual(adapter.calls, []);
  const status = await service.getDocumentHistoryStorageStatus({ actorUserId: 'actor-a' });
  equal(status.legacyUnscopedAvailable, true); equal(reads, 1);
});

test('cloud list caches one batch and cache-only changes cannot start a refresh loop', async () => {
  const rows = [historyRow('bulk-a', { summary: 'a'.repeat(300) }),
    historyRow('bulk-b', { summary: 'b'.repeat(300) })];
  const localStore = makeStore({ confirmedBudgetBytes: 1500 });
  const adapter = cloudAdapter({ read: { data: rows, error: null } });
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore });
  let notices = 0;
  const off = service.subscribeDocumentHistoryStorage({ actorUserId: 'viewer-a' }, () => { notices++; });
  try {
    await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer-a' });
    await service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer-a' });
    equal(notices, 0);
    equal(adapter.calls.filter(call => call[0] === 'limit').length, 2);
  } finally { off(); localStore.close(); }
});

test('a late cloud acknowledgement stays bound to the account captured by its record call', async () => {
  const localStore = makeStore();
  const rowA = historyRow('late-a', { user_id: 'actor-a' });
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const cloud = { from() { return { upsert() { return { select: () => delayed }; } }; } };
  const service = createDocumentHistoryService({ cloud, localStore });
  try {
    const late = service.recordDocumentHistoryEvent(rowA, { actorUserId: 'viewer-a' });
    await service.recordDocumentHistoryEvent(historyRow('guest-now', { user_id: null }),
      { guestScopeId: 'device-local' });
    release({ data: [{ ...rowA, id: 'server-a', occurred_at: '2026-09-14T12:00:00+00:00' }], error: null });
    equal((await late).local.state, 'confirmed');
    equal((await localStore.list('account:viewer-a', 'doc-cloud'))[0].client_event_id, 'late-a');
    equal((await localStore.list('guest:device-local', 'doc-cloud'))[0].client_event_id, 'guest-now');
  } finally { localStore.close(); }
});

test('status and subscription remain safe when the local storage port fails', async () => {
  const service = createDocumentHistoryService({ cloud: null, localStore: {
    status: async () => { throw new Error('closed'); },
    subscribe: () => { throw new Error('closed'); },
  }, legacyStorage: null });
  const status = await service.getDocumentHistoryStorageStatus({ actorUserId: 'viewer' });
  equal(status.available, false);
  equal(status.errorCode, 'DOCUMENT_HISTORY_LOCAL_UNAVAILABLE');
  const off = service.subscribeDocumentHistoryStorage({ actorUserId: 'viewer' }, () => {});
  equal(typeof off, 'function'); off();
});

test('guest scoped-list failure is explicit and marks that scope unavailable', async () => {
  const adapter = cloudAdapter();
  const localStore = {
    list: async () => { throw new Error('missing time index'); },
    status: async () => ({ available: true, pendingCount: 2, protectedBytes: 200,
      globalProtectedBytes: 200, protectedLimitBytes: 1000, protectedFull: false,
      confirmedCacheBytes: 0, errorCode: null }),
  };
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore, legacyStorage: null });
  await assert.rejects(service.listDocumentHistoryEvents('doc-cloud', { guestScopeId: 'device-local' }),
    { code: 'DOCUMENT_HISTORY_LOCAL_READ_FAILED' });
  deepEqual(adapter.calls, []);
  const status = await service.getDocumentHistoryStorageStatus({ guestScopeId: 'device-local' });
  equal(status.available, false);
  equal(status.errorCode, 'DOCUMENT_HISTORY_LOCAL_READ_FAILED');
});

test('signed scoped-list failure cannot become a cloud-backed empty success', async () => {
  const adapter = cloudAdapter({ read: { data: [historyRow('cloud-row')], error: null } });
  const service = createDocumentHistoryService({ cloud: adapter.cloud, localStore: {
    list: async () => { throw new Error('local read failed'); },
    status: async () => ({ available: true, pendingCount: 1, protectedBytes: 100,
      confirmedCacheBytes: 0, errorCode: null }),
  }, legacyStorage: null });
  await assert.rejects(service.listDocumentHistoryEvents('doc-cloud', { actorUserId: 'viewer' }),
    { code: 'DOCUMENT_HISTORY_LOCAL_READ_FAILED' });
  deepEqual(adapter.calls, []);
  const status = await service.getDocumentHistoryStorageStatus({ actorUserId: 'viewer' });
  equal(status.available, false);
  equal(status.errorCode, 'DOCUMENT_HISTORY_LOCAL_READ_FAILED');
});
