import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectLegacyDocumentHistory,
  selectLegacyDocumentHistoryBucket,
} from '../src/services/legacyDocumentHistoryRecovery.js';

const KEY = 'survey_document_history_events_v1';
const authorization = { authorized:true,authorizationToken:'explicit-recovery-consent' };

class MemoryStorage {
  constructor(raw = null) { this.raw = raw; this.gets = 0; this.sets = 0; this.removes = 0; }
  getItem(key) { assert.equal(key, KEY); this.gets += 1; return this.raw; }
  setItem() { this.sets += 1; throw new Error('recovery must stay read-only'); }
  removeItem() { this.removes += 1; throw new Error('recovery must stay read-only'); }
}

const row = (bucketId, overrides = {}) => ({
  id:'annotation-delete:a:2026-01-01',
  document_id:bucketId,
  user_id:'old-actor',
  client_event_id:'annotation-delete:a:2026-01-01',
  event_type:'annotation_deleted',
  source:'annotation-trash',
  page_number:1,
  annotation_id:'a',
  summary:'Someone deleted an annotation on page 1',
  payload:{ actionType:'delete',restoreAction:{ type:'fabric:create',annotationId:'a',pageNumber:1,
    annotation:{ id:'a',type:'path',path:[['M',1,2],['L',3,4]],data:{ id:'a' } } } },
  is_undoable:true,
  is_checkpoint:false,
  occurred_at:'2026-01-01T00:00:00.000Z',
  created_at:'2026-01-01T00:00:00.000Z',
  __local:true,
  ...overrides,
});
const rawStore = buckets => JSON.stringify(buckets);
const inspect = storage => inspectLegacyDocumentHistory({ ...authorization,storage });
const select = (inspection, storage, sourceBucketId = 'old-doc', openLocalDocumentId = 'open-local') =>
  selectLegacyDocumentHistoryBucket(inspection, { ...authorization,storage,sourceBucketId,
    confirmedSourceBucketId:sourceBucketId,openLocalDocumentId,
    confirmedOpenLocalDocumentId:openLocalDocumentId });

test('authorization is required before storage inspection and absence stays read-only', async () => {
  const storage = new MemoryStorage(null);
  await assert.rejects(inspectLegacyDocumentHistory({ authorized:false,authorizationToken:'x',storage }),
    { code:'LEGACY_DOCUMENT_HISTORY_AUTHORIZATION_REQUIRED' });
  assert.equal(storage.gets, 0);
  assert.deepEqual(await inspect(storage), { status:'absent',version:1,buckets:[] });
  assert.equal(storage.gets, 1);
  assert.equal(storage.sets, 0);
  assert.equal(storage.removes, 0);
});

test('the exact historical v1 object-of-row-arrays format yields payload-free bucket counts', async () => {
  const raw = rawStore({
    'old-doc':[row('old-doc')],
    'second-doc':[row('second-doc',{ id:'edit:1',client_event_id:'edit:1',event_type:'checkpoint_added',
      summary:'Someone made an edit',payload:{ reason:'edit' } })],
  });
  const storage = new MemoryStorage(raw);
  const inspection = await inspect(storage);
  assert.equal(inspection.status, 'ready');
  assert.match(inspection.inspectionDigest, /^[0-9a-f]{64}$/);
  assert.match(inspection.authorizationDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(inspection.buckets, [
    { bucketId:'old-doc',rowCount:1,recoverableRowCount:1 },
    { bucketId:'second-doc',rowCount:1,recoverableRowCount:0 },
  ]);
  assert.equal(JSON.stringify(inspection).includes('restoreAction'), false);
  assert.equal(JSON.stringify(inspection).includes('Someone'), false);
  assert.equal(storage.raw, raw);
  assert.equal(storage.sets + storage.removes, 0);
});

test('selection re-reads the digest, binds consent and the open local PDF, and preserves full restore data', async () => {
  const original = row('old-doc');
  const raw = rawStore({ 'old-doc':[original] });
  const storage = new MemoryStorage(raw);
  const inspection = await inspect(storage);
  const selected = await select(inspection, storage);
  assert.equal(storage.gets, 2);
  assert.equal(selected.status, 'selected');
  assert.equal(selected.sourceBucketId, 'old-doc');
  assert.equal(selected.documentId, 'open-local');
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].__legacyRecovery, true);
  assert.equal(selected.rows[0].__canRestore, true);
  assert.deepEqual(selected.rows[0].payload.restoreAction.annotation.path,
    original.payload.restoreAction.annotation.path);
  assert.notEqual(selected.rows[0].payload, original.payload);
  assert.equal(storage.raw, raw);
  assert.equal(storage.sets + storage.removes, 0);
});

test('changed consent, wrong open-file confirmation, missing bucket, and changed raw all fail closed', async () => {
  const storage = new MemoryStorage(rawStore({ 'old-doc':[row('old-doc')] }));
  const inspection = await inspect(storage);
  await assert.rejects(selectLegacyDocumentHistoryBucket(inspection, { authorized:true,
    authorizationToken:'other-consent',storage,sourceBucketId:'old-doc',openLocalDocumentId:'open-local',
    confirmedSourceBucketId:'old-doc',confirmedOpenLocalDocumentId:'open-local' }),
  { code:'LEGACY_DOCUMENT_HISTORY_AUTHORIZATION_CHANGED' });
  await assert.rejects(selectLegacyDocumentHistoryBucket(inspection, { ...authorization,storage,
    sourceBucketId:'old-doc',confirmedSourceBucketId:'old-doc',openLocalDocumentId:'open-local',
    confirmedOpenLocalDocumentId:'other-local' }),
  { code:'LEGACY_DOCUMENT_HISTORY_SELECTION_INVALID' });
  await assert.rejects(selectLegacyDocumentHistoryBucket(inspection, { ...authorization,storage,
    sourceBucketId:'old-doc',confirmedSourceBucketId:'other-bucket',openLocalDocumentId:'open-local',
    confirmedOpenLocalDocumentId:'open-local' }), { code:'LEGACY_DOCUMENT_HISTORY_SELECTION_INVALID' });
  await assert.rejects(select(inspection, storage, 'missing'), { code:'LEGACY_DOCUMENT_HISTORY_BUCKET_INVALID' });
  storage.raw = rawStore({ 'old-doc':[row('old-doc',{ summary:'changed after consent' })] });
  await assert.rejects(select(inspection, storage), { code:'LEGACY_DOCUMENT_HISTORY_INSPECTION_STALE' });
  assert.equal(storage.sets + storage.removes, 0);
});

test('supported delete rows alone get a restore marker while unsupported rows stay review-only', async () => {
  const bucketId = 'old-doc';
  const restoreRows = [
    row(bucketId),
    row(bucketId,{ id:'callout',client_event_id:'callout',event_type:'callout_deleted',summary:'Deleted callout',
      annotation_id:'c',payload:{ restoreAction:{ type:'callout',calloutId:'c',pageNumber:1,
        callout:{ id:'c',pageNumber:1 } } } }),
    row(bucketId,{ id:'marker',client_event_id:'marker',event_type:'survey_marker_deleted',summary:'Deleted marker',
      annotation_id:'m',payload:{ restoreAction:{ type:'surveyMarker',markerId:'m',pageNumber:1,
        surveyMarker:{ id:'m',pageNumber:1 } } } }),
    row(bucketId,{ id:'region',client_event_id:'region',event_type:'region_deleted',summary:'Deleted region',
      annotation_id:'r',payload:{ restoreAction:{ type:'region',regionId:'r',spaceId:'s',pageNumber:1,
        region:{ regionId:'r',pageId:1 } } } }),
    row(bucketId,{ id:'space',client_event_id:'space',event_type:'space_deleted',summary:'Deleted space',
      annotation_id:'s',page_number:null,payload:{ restoreAction:{ type:'space',spaceId:'s',space:{ id:'s' } } } }),
    row(bucketId,{ id:'bulk',client_event_id:'bulk',event_type:'annotations_bulk_deleted',summary:'Deleted two',
      page_number:null,payload:{ objects:[{ restoreAction:{ type:'fabric:create',annotationId:'b',pageNumber:2,
        annotation:{ id:'b' } } }] } }),
    row(bucketId,{ id:'unknown',client_event_id:'unknown',event_type:'plugin_deleted',summary:'Old plugin delete',
      payload:{ restoreAction:{ type:'plugin',data:{ secret:'not callable' } } } }),
  ];
  const storage = new MemoryStorage(rawStore({ [bucketId]:restoreRows }));
  const inspection = await inspect(storage);
  assert.deepEqual(inspection.buckets, [{ bucketId,rowCount:7,recoverableRowCount:6 }]);
  const selected = await select(inspection, storage);
  assert.deepEqual(selected.rows.map(item => item.__canRestore), [true,true,true,true,true,true,false]);
  assert.deepEqual(selected.rows[6].payload.restoreAction, restoreRows[6].payload.restoreAction);
});

test('restore markers fail closed when an embedded object names a different item', async () => {
  const bucketId = 'old-doc';
  const mismatchedRows = [
    row(bucketId,{ id:'fabric-id',client_event_id:'fabric-id',
      payload:{ restoreAction:{ type:'fabric:create',annotationId:'a',pageNumber:1,
        annotation:{ id:'other',data:{ id:'a' } } } } }),
    row(bucketId,{ id:'fabric-data-id',client_event_id:'fabric-data-id',
      payload:{ restoreAction:{ type:'fabric:create',annotationId:'a',pageNumber:1,
        annotation:{ id:'a',data:{ id:'other' } } } } }),
    row(bucketId,{ id:'callout-id',client_event_id:'callout-id',event_type:'callout_deleted',
      payload:{ restoreAction:{ type:'callout',calloutId:'c',callout:{ id:'other' } } } }),
    row(bucketId,{ id:'marker-id',client_event_id:'marker-id',event_type:'survey_marker_deleted',
      payload:{ restoreAction:{ type:'surveyMarker',markerId:'m',surveyMarker:{ id:'other' } } } }),
    row(bucketId,{ id:'region-id',client_event_id:'region-id',event_type:'region_deleted',
      payload:{ restoreAction:{ type:'region',regionId:'r',spaceId:'s',region:{ regionId:'other' } } } }),
    row(bucketId,{ id:'space-id',client_event_id:'space-id',event_type:'space_deleted',
      payload:{ restoreAction:{ type:'space',spaceId:'s',space:{ id:'other' } } } }),
    row(bucketId,{ id:'bulk-id',client_event_id:'bulk-id',event_type:'annotations_bulk_deleted',
      page_number:null,payload:{ objects:[{ restoreAction:{ type:'fabric:create',annotationId:'b',pageNumber:2,
        annotation:{ id:'other' } } }] } }),
  ];
  const storage = new MemoryStorage(rawStore({ [bucketId]:mismatchedRows }));
  const inspection = await inspect(storage);
  assert.deepEqual(inspection.buckets, [{ bucketId,rowCount:7,recoverableRowCount:0 }]);
  const selected = await select(inspection, storage);
  assert.deepEqual(selected.rows.map(item => item.__canRestore), Array(7).fill(false));
  assert.deepEqual(selected.rows[0].payload.restoreAction.annotation,
    mismatchedRows[0].payload.restoreAction.annotation);
});

test('nested restore targets and pages must match the row, payload, action, and embedded object', async () => {
  const bucketId = 'old-doc';
  const base = row(bucketId);
  const action = base.payload.restoreAction;
  const cases = [
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,pageNumber:0 } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,pageNumber:'bad' } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,pageNumber:Number.MAX_SAFE_INTEGER + 1 } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,storageKey:'other' } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,annotation:{ ...action.annotation,
      annotationId:'other' } } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,annotation:{ ...action.annotation,
      pdfAnnotationId:'other' } } } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,annotation:{ ...action.annotation,
      data:{ ...action.annotation.data,annoId:'other' } } } } },
    { ...base,annotation_id:'other' },
    { ...base,payload:{ ...base.payload,annotationId:'other' } },
    { ...base,page_number:2 },
    { ...base,payload:{ ...base.payload,pageNumber:2 } },
    { ...base,payload:{ ...base.payload,restoreAction:{ ...action,annotation:{ ...action.annotation,
      pageNumber:2 } } } },
    { ...base,id:'callout-shape',client_event_id:'callout-shape',event_type:'callout_deleted',annotation_id:'c',
      payload:{ calloutId:'c',pageNumber:1,restoreAction:{ type:'callout',calloutId:'c',pageNumber:1,
        callout:{ id:'c',pageNumber:2 } } } },
    { ...base,id:'region-shape',client_event_id:'region-shape',event_type:'region_deleted',annotation_id:'r',
      payload:{ regionId:'r',pageNumber:1,restoreAction:{ type:'region',regionId:'r',spaceId:'s',pageNumber:1,
        region:{ regionId:'other',pageId:1 } } } },
    { ...base,id:'space-shape',client_event_id:'space-shape',event_type:'space_deleted',annotation_id:'s',page_number:null,
      payload:{ spaceId:'s',restoreAction:{ type:'space',spaceId:'s',space:{ id:'other' } } } },
    { ...base,id:'bulk-page',client_event_id:'bulk-page',event_type:'annotations_bulk_deleted',
      annotation_id:null,page_number:null,payload:{ objects:[{ restoreAction:{ type:'fabric:create',
        annotationId:'b',pageNumber:-1,annotation:{ id:'b' } } }] } },
  ];
  const storage = new MemoryStorage(rawStore({ [bucketId]:cases }));
  const inspection = await inspect(storage);
  assert.deepEqual(inspection.buckets, [{ bucketId,rowCount:cases.length,recoverableRowCount:0 }]);
  const selected = await select(inspection, storage);
  assert.deepEqual(selected.rows.map(item => item.__canRestore), Array(cases.length).fill(false));
});

test('mismatched row ids, malformed payloads, invalid pages, and prototype poison are rejected visibly', async () => {
  const cases = [
    rawStore({ 'old-doc':[row('other-doc')] }),
    rawStore({ 'old-doc':[row('old-doc',{ payload:null })] }),
    rawStore({ 'old-doc':[row('old-doc',{ page_number:0 })] }),
    '{"__proto__":[]}',
    '{"old-doc":[{"document_id":"old-doc","client_event_id":"x","event_type":"x","summary":"x","payload":{"constructor":{}}}]}',
    '[]',
    '{bad json',
  ];
  for (const raw of cases) {
    const storage = new MemoryStorage(raw);
    await assert.rejects(inspect(storage), error => /^LEGACY_DOCUMENT_HISTORY_/.test(error.code));
    assert.equal(storage.raw, raw);
    assert.equal(storage.sets + storage.removes, 0);
  }
});

test('raw, bucket, row, payload, depth, node, string, and array bounds reject without truncation', async () => {
  const cases = [
    ' '.repeat(2_000_001),
    rawStore(Object.fromEntries(Array.from({ length:101 },(_,i) => [`doc-${i}`,[]]))),
    rawStore({ 'old-doc':Array.from({ length:501 },(_,i) => row('old-doc',{
      id:`row-${i}`,client_event_id:`row-${i}` })) }),
    rawStore({ 'old-doc':[row('old-doc',{ payload:{ restoreAction:{ type:'plugin',data:'x'.repeat(384_001) } } })] }),
    rawStore({ 'old-doc':[row('old-doc',{ payload:{ nested:Array.from({ length:10_001 },() => 1) } })] }),
  ];
  let deep = {};
  for (let index=0;index<34;index+=1) deep = { child:deep };
  cases.push(rawStore({ 'old-doc':[row('old-doc',{ payload:deep })] }));
  for (const raw of cases) {
    const storage = new MemoryStorage(raw);
    await assert.rejects(inspect(storage), error => /^LEGACY_DOCUMENT_HISTORY_/.test(error.code));
    assert.equal(storage.raw, raw);
  }
});

test('non-string live values and hostile objects are never traversed or coerced', async () => {
  let touched = false;
  const hostile = new Proxy({}, { get() { touched = true; throw new Error('must not inspect live values'); },
    ownKeys() { touched = true; throw new Error('must not enumerate live values'); } });
  const storage = new MemoryStorage(hostile);
  await assert.rejects(inspect(storage), { code:'LEGACY_DOCUMENT_HISTORY_TOO_LARGE' });
  assert.equal(touched, false);
  assert.equal(storage.sets + storage.removes, 0);
});

test('storage read errors stay visible and no write, store, outbox, or network interface exists', async () => {
  const storage = new MemoryStorage();
  storage.getItem = () => { throw new Error('denied'); };
  await assert.rejects(inspect(storage), { code:'LEGACY_DOCUMENT_HISTORY_READ_FAILED' });
  assert.deepEqual(Object.keys(await import('../src/services/legacyDocumentHistoryRecovery.js')).sort(),
    ['inspectLegacyDocumentHistory','selectLegacyDocumentHistoryBucket']);
  assert.equal(storage.sets + storage.removes, 0);
});
