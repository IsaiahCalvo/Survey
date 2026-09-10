import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createDetachedYDoc, purgeYDocsByPrefix } from '../src/lib/collab/ydocRegistry.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc, purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { materializeAnnotationGenerationState } from '../src/services/annotationGenerationState.js';
import { SURVEY_V2_ROOTS, updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });
const bytes = value => new Uint8Array(Buffer.from(String(value).slice(2), 'hex'));
const hex = value => `\\x${Buffer.from(value).toString('hex')}`;
const until = async (check, message) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await check(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve }; };

const peerOrders = [
  { name: 'note before, name after', beforeField: 'note', beforeValue: 'peer note',
    afterField: 'entityName', afterValue: 'Peer name' },
  { name: 'name before, note after', beforeField: 'entityName', beforeValue: 'Peer name',
    afterField: 'note', afterValue: 'peer note' },
];
for (const order of peerOrders) test(`capacity recovery and Undo preserve peers: ${order.name}`, async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() }); t.after(() => backend.destroy());
  const indexedDb = new IDBFactory(), stores = [], handles = [], docs = [];
  const open = async (bundle, writerId, { consumer = async () => {}, realtime = false } = {}) => {
    const outbox = await createAnnotationOutbox({ indexedDb }); stores.push(outbox);
    const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
      actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
      checkedBundle: bundle, supabase: backend.client, outboxStore: outbox,
      enableLocal: false, enableRealtime: realtime, writerId, snapshotRetryDelayMs: 0,
      eraseEffectConsumer: consumer });
    handles.push(handle); return { handle, outbox };
  };
  t.after(async () => { for (const handle of handles) { try { await handle.destroy(); } catch {} }
    for (const store of stores) { try { await store.close(); } catch {} }
    for (const doc of docs) if (!doc.isDestroyed) doc.destroy();
    purgeYDocsByPrefix(`annoflat:${backend.ids.documentId}:`); });

  const eraseIntent = (id, expectedMarker) => buildEraseIntent({ mutationId: `erase-${id}`,
    pageNumber: expectedMarker.pageNumber, renderer: 'svg',
    gesture: { points: [{ x: expectedMarker.bounds.x + 1,
      y: expectedMarker.bounds.y + 1 }], radius: 3, mode: 'whole' },
    surveyMarkerTargets: [{ markerId: id, expectedMarker }], sideEffects: [
      { type: 'trash', targetKey: id, payload: { before: structuredClone(expectedMarker) } },
      { type: 'history', targetKey: id, payload: { before: structuredClone(expectedMarker) } },
    ] });
  const commit = (handle, intent) => handle.commitEraseIntent(intent, {
    permissionContext: { mode: 'registered', viewerId: backend.ids.actorUserId,
      documentOwnerId: backend.ids.actorUserId }, validateSurveyTarget: () => true });
  const drainEffects = async handle => {
    await handle.drain();
    let result;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      result = await handle.drainEraseOutbox();
      if (result.pending === 0) break;
      await new Promise(resolve => setImmediate(resolve));
      await handle.drain();
    }
    assert.equal(result?.pending, 0, `erase effects did not settle: ${JSON.stringify({ result, backend: backend.inspect() })}`);
    await handle.drain();
    return result;
  };

  const firstBundle = await backend.read(), first = await open(firstBundle, 'w1');
  const expectedMarker = first.handle.getSurveyState().surveyMarkers['fixture-marker-left'];
  const intent = eraseIntent('fixture-marker-left', expectedMarker);
  backend.setCapacityFault('append');
  const erased = await commit(first.handle, intent);
  assert.equal(erased.status, 'committed');
  await assert.rejects(first.handle.drain(), { code: 'ANNOTATION_GENERATION_CAPACITY' });
  assert.equal(first.handle.getSyncStatus().errorCode, 'ANNOTATION_GENERATION_CAPACITY');
  assert.ok((await first.outbox.list(backend.ids.documentId, backend.ids.actorUserId,
    { pdfGenerationId: backend.ids.generationId, contentModelVersion: 2 })).length > 0);
  await first.handle.destroy(); await first.outbox.close();

  const blockedReopen = await open(await backend.read(), 'w2');
  await assert.rejects(blockedReopen.handle.drain(), { code: 'ANNOTATION_GENERATION_CAPACITY' });
  await blockedReopen.handle.destroy(); await blockedReopen.outbox.close();
  backend.setCapacityFault(null);
  const peerSeed = await backend.read(), peerDoc = createDetachedYDoc(`rebase-peer-before-${order.beforeField}`); docs.push(peerDoc);
  Y.applyUpdate(peerDoc, peerSeed.annotationUpdate);
  const peerVector = Y.encodeStateVector(peerDoc);
  updateSurveyMarkersV2(peerDoc, markers => ({ ...markers,
    'fixture-marker-right': { ...markers['fixture-marker-right'],
      [order.beforeField]: order.beforeValue } }),
  { origin: 'peer' });
  await backend.client.rpc('append_annotation_update_v3', { p_document_id: backend.ids.documentId,
    p_generation_id: backend.ids.generationId, p_content_model_version: 2,
    p_client_id: 'd2000000-0000-4000-8000-000000000099', p_client_seq: '1',
    p_data: hex(Y.encodeStateAsUpdate(peerDoc, peerVector)) });
  const consumerEntered = deferred(), releaseConsumer = deferred();
  const recovered = await open(await backend.read(), 'w3', { realtime: true,
    consumer: async () => { consumerEntered.resolve(); await releaseConsumer.promise; } });
  await recovered.handle.drain(); await consumerEntered.promise;
  assert.equal(recovered.handle.getSurveyState().surveyMarkers['fixture-marker-left'], undefined);
  assert.equal(recovered.handle.getSurveyState().surveyMarkers['fixture-marker-right'][order.beforeField],
    order.beforeValue);
  const afterSeed = await backend.read(), afterDoc = createDetachedYDoc(`rebase-peer-after-${order.afterField}`); docs.push(afterDoc);
  Y.applyUpdate(afterDoc, afterSeed.annotationUpdate);
  const afterVector = Y.encodeStateVector(afterDoc);
  updateSurveyMarkersV2(afterDoc, markers => ({ ...markers,
    'fixture-marker-right': { ...markers['fixture-marker-right'],
      [order.afterField]: order.afterValue } }),
  { origin: 'peer' });
  await backend.client.rpc('append_annotation_update_v3', { p_document_id: backend.ids.documentId,
    p_generation_id: backend.ids.generationId, p_content_model_version: 2,
    p_client_id: 'd2000000-0000-4000-8000-000000000098', p_client_seq: '1',
    p_data: hex(Y.encodeStateAsUpdate(afterDoc, afterVector)) });
  backend.client.getChannels().at(-1).emitStatus('SUBSCRIBED');
  await until(() => recovered.handle.getSurveyState().surveyMarkers['fixture-marker-right']?.[order.afterField]
    === order.afterValue, 'peer update after recovery projection was not applied');
  releaseConsumer.resolve();
  const acknowledgement = await drainEffects(recovered.handle);
  const acknowledgedHead = await until(() => BigInt(backend.inspect().walHead) >= 2n
    && backend.inspect().walHead, `erase acknowledgement did not reach WAL: ${JSON.stringify({ acknowledgement, backend: backend.inspect() })}`);
  await recovered.handle.flushSnapshot();

  const snapshotReply = await backend.client.rpc('read_annotation_snapshot_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2 });
  const snapshot = snapshotReply.data.snapshot;
  assert.equal(snapshot.at_seq, snapshotReply.data.wal_head, 'checkpoint CAS must cover its accepted frontier');
  assert.equal(snapshot.at_seq, acknowledgedHead, 'checkpoint must cover the settled acknowledgement frontier');
  const fresh = createDetachedYDoc('standalone-server-checkpoint'); docs.push(fresh);
  const storedBytes = bytes(snapshot.snapshot);
  const decodedSnapshot = snapshot.encoding_version === 2
    ? new Uint8Array(await new Response(new Blob([storedBytes]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    : storedBytes;
  assert.ok([1, 2].includes(snapshot.encoding_version));
  Y.applyUpdate(fresh, decodedSnapshot);
  assert.equal(fresh.store.pendingStructs, null); assert.equal(fresh.store.pendingDs, null);
  materializeAnnotationGenerationState(fresh, 2);
  const tailReply = await backend.client.rpc('read_annotation_updates_v3', {
    p_document_id: backend.ids.documentId, p_generation_id: backend.ids.generationId,
    p_content_model_version: 2, p_after_seq: snapshot.at_seq,
    p_through_seq: snapshotReply.data.wal_head, p_limit: 1000 });
  let cursor = BigInt(snapshot.at_seq);
  for (const row of tailReply.data.rows) {
    assert.equal(BigInt(row.seq), cursor + 1n, `bad tail row seq=${row.seq} client=${row.client_id}/${row.client_seq}`);
    Y.applyUpdate(fresh, bytes(row.data));
    assert.equal(fresh.store.pendingStructs, null, `pending structs at seq=${row.seq} client=${row.client_id}/${row.client_seq}`);
    assert.equal(fresh.store.pendingDs, null, `pending deletes at seq=${row.seq} client=${row.client_id}/${row.client_seq}`);
    cursor = BigInt(row.seq);
  }
  assert.equal(materializeAnnotationGenerationState(fresh, 2).surveyMarkers['fixture-marker-left'], undefined);

  const expectedRight = recovered.handle.getSurveyState().surveyMarkers['fixture-marker-right'];
  assert.equal(expectedRight[order.beforeField], order.beforeValue);
  assert.equal(expectedRight[order.afterField], order.afterValue);
  const erasedRight = await commit(recovered.handle, eraseIntent('fixture-marker-right', expectedRight));
  assert.equal(erasedRight.status, 'committed');
  await drainEffects(recovered.handle);
  assert.equal(recovered.handle.applyEraseHistoryTransition(erasedRight.historyTransition, 'undo').status, 'applied');
  await drainEffects(recovered.handle);
  assert.deepEqual(recovered.handle.getSurveyState().surveyMarkers['fixture-marker-right'], expectedRight);
  const checked = await backend.read({ conditionalAnnotationCheckpoint: true });
  assert.ok(checked.annotationUpdate.length > 0);
  assert.equal((await recovered.handle.flushLocalDurability()).contentModelVersion, 2);
  await recovered.handle.destroy(); await recovered.outbox.close();
  const cachedReopen = await open(checked, 'w4');
  assert.deepEqual(cachedReopen.handle.getSurveyState().surveyMarkers['fixture-marker-right'], expectedRight);
  await cachedReopen.handle.destroy(); await cachedReopen.outbox.close();
  const freshOutbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() }); stores.push(freshOutbox);
  const freshDoc = createDetachedYDoc('undo-checkpoint-fresh-device'); docs.push(freshDoc);
  const freshHandle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read({ conditionalAnnotationCheckpoint: true }),
    supabase: backend.client, outboxStore: freshOutbox, doc: freshDoc,
    enableLocal: false, enableRealtime: false, writerId: 'w5', snapshotRetryDelayMs: 0 });
  handles.push(freshHandle);
  assert.deepEqual(freshHandle.getSurveyState().surveyMarkers['fixture-marker-right'], expectedRight);
});

test('a pure offline model 2 marker field edit survives a cold local recovery', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const indexedDb = new IDBFactory(), stores = [], handles = [], docs = [];
  t.after(async () => { for (const handle of handles) { try { await handle.destroy(); } catch {} }
    for (const store of stores) { try { await store.close(); } catch {} }
    for (const doc of docs) if (!doc.isDestroyed) doc.destroy(); backend.destroy(); });
  const open = async (bundle, writerId) => {
    const outbox = await createAnnotationOutbox({ indexedDb }); stores.push(outbox);
    const doc = createDetachedYDoc(`pure-field-${writerId}`); docs.push(doc);
    const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
      actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
      contentModelVersion: 2, checkedBundle: bundle, supabase: backend.client,
      outboxStore: outbox, doc, enableLocal: false, enableRealtime: false,
      writerId, snapshotRetryDelayMs: 0 });
    handles.push(handle); return { handle, outbox };
  };
  const bundle = await backend.read(), first = await open(bundle, 'pure-field-w1');
  const before = first.handle.getSurveyState().surveyMarkers['fixture-marker-left'];
  backend.setOffline(true);
  first.handle.updateSurveyMarkers(markers => ({ ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], note: 'offline note' } }));
  await first.handle.drain();
  const receipt = await first.handle.flushLocalDurability();
  assert.equal(receipt.contentModelVersion, 2);
  assert.equal(first.handle.getSurveyState().surveyMarkers['fixture-marker-left'].note, 'offline note');
  await first.handle.destroy(); await first.outbox.close();

  backend.setOffline(false);
  const reopened = await open(await backend.read(), 'pure-field-w2');
  assert.deepEqual(reopened.handle.getSurveyState().surveyMarkers['fixture-marker-left'],
    { ...before, note: 'offline note' });
  await reopened.handle.drain();
  assert.equal(backend.inspect().markerCount, 2);
});

test('active document purge clears every model 2 survey registry root', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: backend.client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'purge-w1' });
  t.after(async () => { try { await handle.destroy(); } catch {} try { await outbox.close(); } catch {}
    backend.destroy(); });
  assert.ok(Object.values(SURVEY_V2_ROOTS).some(name => handle.doc.getMap(name).size > 0));
  await handle.drain(); await handle.flushSnapshot();
  const beforePurge = backend.inspect();
  await purgeAnnotationDoc(backend.ids.documentId);
  await new Promise(resolve => setImmediate(resolve));
  const afterPurge = backend.inspect();
  assert.equal(afterPurge.walHead, beforePurge.walHead, 'purge must not append cloud WAL');
  assert.equal(afterPurge.snapshotWrites, beforePurge.snapshotWrites,
    'purge must not retry or publish a cloud checkpoint');
  for (const name of Object.values(SURVEY_V2_ROOTS)) {
    assert.equal(handle.doc.getMap(name).size, 0, `${name} survives active model 2 purge`);
  }
});

test('Undo while a real erase effect consumer is held settles without losing model 2 state', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const entered = deferred(), release = deferred();
  const handle = await openAnnotationDoc({ documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId, pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(), supabase: backend.client, outboxStore: outbox,
    enableLocal: false, enableRealtime: false, writerId: 'held-consumer',
    snapshotRetryDelayMs: 0, eraseEffectConsumer: async () => {
      entered.resolve(); await release.promise;
    } });
  t.after(async () => { release.resolve(); try { await handle.destroy(); } catch {}
    try { await outbox.close(); } catch {} backend.destroy(); });
  const expected = handle.getSurveyState().surveyMarkers['fixture-marker-right'];
  const intent = buildEraseIntent({ mutationId: 'held-consumer-right', pageNumber: expected.pageNumber,
    renderer: 'svg', gesture: { points: [{ x: expected.bounds.x + 1,
      y: expected.bounds.y + 1 }], radius: 3, mode: 'whole' },
    surveyMarkerTargets: [{ markerId: 'fixture-marker-right', expectedMarker: expected }],
    sideEffects: [
      { type: 'trash', targetKey: 'fixture-marker-right', payload: { before: structuredClone(expected) } },
      { type: 'history', targetKey: 'fixture-marker-right', payload: { before: structuredClone(expected) } },
    ] });
  const erased = await handle.commitEraseIntent(intent, { permissionContext: {
    mode: 'registered', viewerId: backend.ids.actorUserId, documentOwnerId: backend.ids.actorUserId },
  validateSurveyTarget: () => true });
  await handle.drain(); await entered.promise;
  assert.equal(handle.applyEraseHistoryTransition(erased.historyTransition, 'undo').status, 'applied');
  await handle.drain(); release.resolve();
  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await handle.drainEraseOutbox();
    await new Promise(resolve => setImmediate(resolve)); await handle.drain();
    if (result.pending === 0) break;
  }
  assert.equal(result?.pending, 0);
  assert.deepEqual(handle.getSurveyState().surveyMarkers['fixture-marker-right'], expected);
  assert.equal((await handle.flushLocalDurability()).contentModelVersion, 2);
  assert.ok((await backend.read({ conditionalAnnotationCheckpoint: true })).annotationUpdate.length > 0);
});
