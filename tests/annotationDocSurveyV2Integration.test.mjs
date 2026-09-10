import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { annotationOutboxRecordKey, createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { createDetachedYDoc, purgeYDocsByPrefix } from '../src/lib/collab/ydocRegistry.js';
import { initializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';

const id = n => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), generation = id(2), hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hexHash = value => hash(Buffer.from(value.slice(2), 'hex'));

async function fixture(t) {
  const documentId = crypto.randomUUID(), authoritative = createDetachedYDoc();
  initializeSurveyCrdtV2(authoritative, { surveyMarkers: {}, spaces: [] });
  let head = 0n, offline = false;
  const rows = [], calls = [], stores = [], handles = [], docs = [];
  let snapshot = { at_seq: '0', snapshot: hex(Y.encodeStateAsUpdate(authoritative)), encoding_version: 1,
    writer_id: null, writer_epoch: '0' };
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);
  const pdf = { bucket_id: 'documents', path: `${actor}/_generations/test.pdf`, id: id(4), version: id(5),
    byte_length: String(pdfBytes.length), content_sha256: hash(pdfBytes) };
  const publication = { operation_id: id(6), generation_id: generation,
    published_at: '2026-09-09T00:00:00Z', wal_head: '0' };
  const rpc = async (name, params) => {
    calls.push({ name, params: structuredClone(params) });
    assert.equal(params.p_document_id, documentId);
    assert.equal(params.p_generation_id, generation);
    assert.equal(params.p_content_model_version, 2);
    if (offline && ['append_annotation_update_v3', 'store_annotation_snapshot_v3'].includes(name)) {
      throw new Error('offline fixture');
    }
    const base = { version: 3, document_id: documentId, generation_id: generation, content_model_version: 2 };
    if (name === 'read_document_generation_open_v3') return { data: { ...base, actor_user_id: actor,
      document: { id: documentId, user_id: actor, project_id: null, name: 'v2', file_path: pdf.path,
        file_size: String(pdfBytes.length) }, pdf, publication,
      annotations: { ...base, wal_head: String(head), snapshot: params.p_include_snapshot ? snapshot : null,
        snapshot_sha256: params.p_include_snapshot ? hexHash(snapshot.snapshot) : null } } };
    if (name === 'read_annotation_updates_v3') {
      const eligible = rows.filter(row => BigInt(row.seq) > BigInt(params.p_after_seq)
        && BigInt(row.seq) <= BigInt(params.p_through_seq ?? head));
      return { data: { ...base, rows: eligible, through_seq: params.p_through_seq ?? String(head), has_more: false } };
    }
    if (name === 'read_annotation_writer_sequence_v3') return { data: { ...base,
      client_id: params.p_client_id, client_seq: String(rows.filter(row => row.client_id === params.p_client_id).length) } };
    if (name === 'append_annotation_update_v3') {
      let row = rows.find(item => item.client_id === params.p_client_id && item.client_seq === params.p_client_seq);
      if (!row) { row = { seq: String(++head), client_id: params.p_client_id, client_seq: params.p_client_seq,
        actor_user_id: actor, data: params.p_data }; rows.push(row);
        Y.applyUpdate(authoritative, Buffer.from(row.data.slice(2), 'hex')); }
      return { data: { ...base, ...row, accepted: true, data_sha256: hexHash(row.data),
        current_generation_id: generation, is_current: true } };
    }
    if (name === 'read_annotation_snapshot_v3') return { data: { ...base, snapshot, wal_head: String(head) } };
    if (name === 'store_annotation_snapshot_v3') return { data: { ...base, stored: false,
      at_seq: params.p_at_seq, writer_id: params.p_writer_id, writer_epoch: params.p_writer_epoch } };
    throw new Error(`unexpected RPC ${name}`);
  };
  const client = { rpc, from() { throw new Error('no table reads'); }, channel() { throw new Error('no realtime'); } };
  const reader = createDocumentGenerationReader({ request: rpc, getActorUserId: () => actor,
    download: async () => new Blob([pdfBytes], { type: 'application/pdf' }) });
  const indexedDb = new IDBFactory();
  const open = async (bundle, writerId, { device = indexedDb } = {}) => {
    const store = await createAnnotationOutbox({ indexedDb: device }); stores.push(store);
    const doc = createDetachedYDoc(); docs.push(doc);
    const handle = await openAnnotationDoc({ documentId, actorUserId: actor, pdfGenerationId: generation,
      checkedBundle: bundle, supabase: client, outboxStore: store, enableLocal: false,
      enableRealtime: false, writerId, snapshotRetryDelayMs: 0, doc });
    handles.push(handle); return handle;
  };
  const read = () => reader.open({ documentId, actorUserId: actor, pdfGenerationId: generation,
    contentModelVersion: 2 });
  t.after(async () => { for (const handle of handles) await handle.destroy();
    for (const store of stores) await store.close(); authoritative.destroy();
    for (const doc of docs) if (!doc.isDestroyed) doc.destroy();
    purgeYDocsByPrefix(`annoflat:${documentId}:`); });
  return { read, open, rows, calls, setOffline(value) { offline = value; }, async seedLegacyPending() {
    const store = await createAnnotationOutbox({ indexedDb }); stores.push(store);
    const record = { documentId, actorUserId: actor, pdfGenerationId: generation, writerId: 'old',
      clientSeq: 1, ordinal: 1, incarnation: 0, status: 'pending', update: new Uint8Array([0]) };
    record.key = annotationOutboxRecordKey(record); await store.put(record); return { store, record };
  }, useLegacyBody() {
    const legacy = createDetachedYDoc(); legacy.getMap('surveyMarkers').set('old', { annotationId: 'old' });
    snapshot = { ...snapshot, snapshot: hex(Y.encodeStateAsUpdate(legacy)) }; legacy.destroy();
  } };
}

test('model 2 handle writes, journals, reaches WAL, and cold reopens exact survey state', async t => {
  const f = await fixture(t), first = await f.open(await f.read(), 'writer-a');
  let calls = 0;
  const updated = first.updateSurveyMarkers(markers => { calls++; return { ...markers,
    markerA: { annotationId: 'markerA', entityId: 'entityA', pageNumber: 1,
      bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {} } }; });
  assert.equal(calls, 1); assert.equal(updated.changed, true);
  await first.drain();
  const receipt = await first.flushLocalDurability();
  assert.equal(receipt.contentModelVersion, 2);
  assert.ok(f.rows.length > 0);
  const second = await f.open(await f.read(), 'writer-b', { device: new IDBFactory() });
  first.updateSurveyMarkers(markers => ({ ...markers, markerA: { ...markers.markerA,
    checklistResponses: { ...markers.markerA.checklistResponses, deviceA: { selection: 'Y' } } } }));
  second.updateSurveyMarkers(markers => ({ ...markers, markerA: { ...markers.markerA,
    checklistResponses: { ...markers.markerA.checklistResponses, deviceB: { selection: 'N' } } } }));
  await first.drain();
  await second.drain();
  second.updateSurveyMarkers(markers => ({ ...markers, markerB: { annotationId: 'markerB',
    entityId: 'entityB', pageNumber: 2, bounds: { x: 5, y: 6, width: 7, height: 8 },
    checklistResponses: {} } }));
  await second.drain();
  assert.equal(first.getSurveyState().surveyMarkers.markerB, undefined,
    'detached device state changes only through checked transport');
  await first.destroy();
  await second.destroy();
  let staleCalls = 0;
  assert.throws(() => second.updateSurveyMarkers(markers => { staleCalls++; return markers; }));
  assert.equal(staleCalls, 0);
  const reopened = await f.open(await f.read(), 'writer-c');
  assert.equal(reopened.contentModelVersion, 2);
  assert.equal(reopened.getSurveyState().surveyMarkers.markerA.entityId, 'entityA');
  assert.deepEqual(reopened.getSurveyState().surveyMarkers.markerA.checklistResponses,
    { deviceA: { selection: 'Y' }, deviceB: { selection: 'N' } });
  assert.equal(reopened.getSurveyState().surveyMarkers.markerB.entityId, 'entityB');
  let legacyCalls = 0;
  assert.throws(() => reopened.applySurveyMarkers(() => { legacyCalls++; }),
    { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
  assert.equal(legacyCalls, 0);
  assert.throws(() => reopened.setMeta('spaces', []), { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
});

test('model 2 envelope cannot issue a bundle for legacy survey roots', async t => {
  const f = await fixture(t); f.useLegacyBody();
  await assert.rejects(f.read(), { code: 'DOCUMENT_OPEN_STATE' });
  assert.equal(f.calls.some(call => call.name === 'append_annotation_update_v3'), false);
});

test('model mismatch keeps the prior pending row and fails recovery closed', async t => {
  const f = await fixture(t), { store, record } = await f.seedLegacyPending();
  await assert.rejects(f.open(await f.read(), 'writer-v2'),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual((await store.list(record.documentId, actor, { pdfGenerationId: generation }))
    .map(row => row.key), [record.key]);
});

test('disconnected durable pending model 2 edit replays on a fresh detached reopen', async t => {
  const f = await fixture(t), first = await f.open(await f.read(), 'offline-writer');
  f.setOffline(true);
  first.updateSurveyMarkers(() => ({ offlineMark: { annotationId: 'offlineMark', pageNumber: 1,
    bounds: { x: 1, y: 1, width: 2, height: 2 }, checklistResponses: {} } }));
  await first.drain();
  const receipt = await first.flushLocalDurability();
  assert.equal(receipt.contentModelVersion, 2);
  assert.equal(f.rows.length, 0);
  await first.destroy();
  f.setOffline(false);
  const reopened = await f.open(await f.read(), 'reopen-writer');
  await reopened.drain();
  assert.ok(reopened.getSurveyState().surveyMarkers.offlineMark);
  assert.ok(f.rows.some(row => row.client_id === 'offline-writer'));
});
