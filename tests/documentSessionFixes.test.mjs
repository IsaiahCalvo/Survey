import test from 'node:test';
import assert from 'node:assert/strict';
import { flushAnnotationDoc } from '../src/utils/flushAnnotationDoc.js';
import { listDocumentHistoryEvents } from '../src/services/documentHistoryService.js';

test('manual flush rejection leaves Syncing and keeps pending changes visible', async () => {
  for (const stage of ['drain', 'snapshot']) {
    const statuses = [], queues = [];
    const failure = new Error(`${stage} failed`);
    const h = {
      drain: async () => { if (stage === 'drain') throw failure; },
      flushSnapshot: async () => { throw failure; },
      getSyncStatus: () => ({ queueSize: 7 }),
    };
    await assert.rejects(flushAnnotationDoc(h, { onStatus: v => statuses.push(v), onQueueSize: v => queues.push(v) }), failure);
    assert.equal(statuses.at(-1).stage, 'error');
    assert.equal(statuses.at(-1).healthy, false);
    assert.equal(statuses.at(-1).error, failure.message);
    assert.deepEqual(queues, [7]);
  }
});

test('flush finishing after its document closes cannot replace the new document status', async () => {
  const statuses = [];
  await flushAnnotationDoc({ drain: async () => {}, flushSnapshot: async () => true }, { onStatus: s => statuses.push(s), onQueueSize: () => assert.fail(), isCurrent: () => false });
  assert.deepEqual(statuses, [{stage: 'syncing'}]);
});

test('offline history pages advance through bulk rows sharing the same timestamp', async () => {
  const rows = Array.from({length: 105}, (_, i) => ({ id: `bulk-${i}`, client_event_id: `bulk-${i}`, document_id:'paging-test', __local:true, event_type:'annotation_deleted', occurred_at:'2026-10-17T15:00:00Z' }));
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({'paging-test':rows}) } };
  try {
    const first = await listDocumentHistoryEvents('paging-test', {limit:50});
    const second = await listDocumentHistoryEvents('paging-test', {limit:50, before:first.at(-1).occurred_at, beforeClientEventId:first.at(-1).client_event_id});
    const third = await listDocumentHistoryEvents('paging-test', {limit:50, before:second.at(-1).occurred_at, beforeClientEventId:second.at(-1).client_event_id});
    assert.deepEqual([first.length,second.length,third.length], [50,50,5]);
    assert.equal(new Set([...first,...second,...third].map(r => r.client_event_id)).size,105);
  } finally { globalThis.window = previous; }
});
