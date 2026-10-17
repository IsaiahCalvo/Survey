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

import { buildAnnotationDeleteHistoryRowsForAction } from '../src/services/annotationTrashHistory.js';
import { buildHistoryFeed } from '../src/utils/historyFeed.js';
const deletionArgs = { documentId:'doc', deletedAt:'2026-10-17T15:00:00Z', userId:'author' };
const polygon = {type:'polygon',data:{id:'polygon-1'},points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}]};

test('batch and document-batch removals write restore-ready Deleted history', () => {
  for (const action of [
    {type:'fabric:batch',pageNumber:1,deleted:[{id:'polygon-1',annotation:polygon,index:0}]},
    {type:'fabric:document-batch',actions:[{type:'fabric:delete',pageNumber:1,annotationId:'polygon-1',annotation:polygon}]},
  ]) {
    const rows = buildAnnotationDeleteHistoryRowsForAction({...deletionArgs, action});
    assert.equal(rows.length,1);
    assert.equal(rows[0].annotation_id,'polygon-1');
    assert.equal(rows[0].payload.restoreAction.type,'fabric:create');
    assert.equal(buildHistoryFeed(rows,{filter:'deleted'}).groupCount,1);
  }
});

test('moving across pages does not create a false deletion or duplicate a bulk journal', () => {
  const action = {type:'fabric:document-batch',actions:[
    {type:'fabric:delete',pageNumber:1,annotationId:'polygon-1',annotation:polygon},
    {type:'fabric:create',pageNumber:2,annotationId:'polygon-1',annotation:polygon},
  ]};
  assert.deepEqual(buildAnnotationDeleteHistoryRowsForAction({...deletionArgs,action}),[]);
  assert.deepEqual(buildAnnotationDeleteHistoryRowsForAction({...deletionArgs,action:action.actions[0],isAlreadyJournaled:()=>true}),[]);
});

test('a server cursor absent from the local cache still loads unseen same-time local rows once', async () => {
  const rows = Array.from({length:65},(_,i)=>({id:`local-${i}`,client_event_id:`local-${i}`,event_type:'annotation_deleted',document_id:'mixed',__local:true,occurred_at:'2026-10-17T15:00:00Z'}));
  const previous = globalThis.window;
  globalThis.window = {localStorage:{getItem:()=>JSON.stringify({mixed:rows})}};
  try {
    const result = await listDocumentHistoryEvents('mixed',{limit:50,before:'2026-10-17T15:00:00Z',beforeClientEventId:'remote-cursor',loadedClientEventIds:rows.slice(0,50).map(row=>row.client_event_id)});
    assert.equal(result.length,15);
    assert.equal(result[0].client_event_id,'local-50');
  } finally {globalThis.window=previous;}
});
