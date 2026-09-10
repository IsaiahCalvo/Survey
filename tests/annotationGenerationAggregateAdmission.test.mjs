import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import {
  initializeSurveyCrdtV2,
  updateSurveyMarkersV2,
} from '../src/services/documentSurveyCrdtV2.js';
import { admitAnnotationGenerationAggregate } from '../supabase/functions/_shared/annotationGenerationAggregateAdmission.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const scope = () => ({
  documentId: randomUUID(),
  generationId: randomUUID(),
  actorUserId: randomUUID(),
  contentModelVersion: 2,
  writerId: 'aggregate-unit-writer',
  clientSeq: '1',
});

test('an exact historical receipt returns before aggregate work and before the new row limit', async () => {
  const identity = scope();
  const update = new Uint8Array(33);
  const calls = [];
  const adapter = {
    async lookupReceipt(input) {
      calls.push('receipt');
      return { ...identity, seq: '9', update: new Uint8Array(update) };
    },
    async readFixedCheckpoint() { calls.push('checkpoint'); throw new Error('must not read'); },
    async readFixedTailPage() { calls.push('tail'); throw new Error('must not read'); },
  };
  const result = await admitAnnotationGenerationAggregate(
    { ...identity, update },
    adapter,
    { maxUpdateBytes: 32 },
  );
  assert.deepEqual(calls, ['receipt']);
  assert.deepEqual(result, {
    kind: 'accepted-retry',
    receipt: {
      seq: '9',
      actorUserId: identity.actorUserId,
      writerId: identity.writerId,
      clientSeq: '1',
      updateSha256: sha256(update),
    },
  });

  const changed = new Uint8Array(update); changed[0] = 1;
  await assert.rejects(
    admitAnnotationGenerationAggregate({ ...identity, update: changed }, adapter, { maxUpdateBytes: 32 }),
    { code: '23505' },
  );
  assert.deepEqual(calls, ['receipt', 'receipt']);
});

async function smallAdmissionFixture() {
  const ids = scope();
  const doc = createDetachedYDoc('aggregate-unit-small');
  initializeSurveyCrdtV2(doc, { surveyMarkers: {}, spaces: [] });
  const snapshot = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  updateSurveyMarkersV2(doc, markers => ({ ...markers, marker: {
    annotationId: 'marker', pageNumber: 1, bounds: { x: 1, y: 1, width: 2, height: 2 },
    moduleId: 'module', categoryId: 'category', entityId: 'entity', entityName: 'Entity',
    entityColor: '#fff', checklistResponses: {}, note: 'owned update',
  } }), { origin: 'unit' });
  const update = Y.encodeStateAsUpdate(doc, vector);
  doc.destroy();
  return { ids, snapshot, update, snapshotSha256: sha256(snapshot) };
}

function smallAdapter(fixture) {
  return {
    async lookupReceipt() { return null; },
    async readFixedCheckpoint() {
      return { documentId: fixture.ids.documentId, generationId: fixture.ids.generationId,
        actorUserId: fixture.ids.actorUserId, contentModelVersion: 2, head: '0', baseSeq: '0',
        checkpoint: { atSeq: '0', writerId: null, writerEpoch: '0', encodingVersion: 1,
          snapshotSha256: fixture.snapshotSha256, snapshot: new Uint8Array(fixture.snapshot) } };
    },
    async readFixedTailPage() { throw new Error('no tail'); },
  };
}

test('a small complete model 2 append returns a CAS-bound plan without a checkpoint', async () => {
  const fixture = await smallAdmissionFixture();
  const result = await admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: fixture.update, checkpointPolicy: 'when-reader-limit' },
    smallAdapter(fixture),
  );
  assert.equal(result.kind, 'admitted');
  assert.equal(result.expectedHead, '0');
  assert.equal(result.nextSeq, '1');
  assert.equal(result.checkpoint, null);
  assert.deepEqual(result.sourceCheckpoint, {
    documentId: fixture.ids.documentId, generationId: fixture.ids.generationId,
    contentModelVersion: 2, atSeq: '0', writerId: null, writerEpoch: '0',
    encodingVersion: 1, snapshotSha256: fixture.snapshotSha256,
  });
  assert.deepEqual(result.update, fixture.update);
  assert.equal(result.finalState.sha256.length, 64);
});

test('work admission and logical capacity use distinct stable errors', async () => {
  const fixture = await smallAdmissionFixture();
  const input = { ...fixture.ids, update: fixture.update, checkpointPolicy: 'when-reader-limit' };
  await assert.rejects(
    admitAnnotationGenerationAggregate(input, smallAdapter(fixture), {
      maxAggregateInputBytes: fixture.snapshot.length + fixture.update.length - 1,
    }),
    error => error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT'
      && error.reason === 'aggregate-input-bytes' && error.maintenanceNeeded === true,
  );
  await assert.rejects(
    admitAnnotationGenerationAggregate(input, smallAdapter(fixture), {
      maxUpdateBytes: fixture.update.length - 1,
    }),
    error => error?.code === 'SG004' && error.reason === 'update-bytes'
      && error.maintenanceNeeded === undefined,
  );
});

test('a peer tail row may differ from the caller but must carry a valid actor id', async () => {
  const fixture = await smallAdmissionFixture();
  const peer = createDetachedYDoc('aggregate-unit-peer');
  Y.applyUpdate(peer, fixture.snapshot);
  const peerVector = Y.encodeStateVector(peer);
  updateSurveyMarkersV2(peer, markers => ({ ...markers, peer: {
    annotationId: 'peer', pageNumber: 1, bounds: { x: 3, y: 3, width: 2, height: 2 },
    moduleId: 'module', categoryId: 'category', entityId: 'peer', entityName: 'Peer',
    entityColor: '#000', checklistResponses: {}, note: 'peer state',
  } }), { origin: 'peer' });
  const peerUpdate = Y.encodeStateAsUpdate(peer, peerVector);
  const localVector = Y.encodeStateVector(peer);
  updateSurveyMarkersV2(peer, markers => ({ ...markers, marker: {
    annotationId: 'marker', pageNumber: 1, bounds: { x: 1, y: 1, width: 2, height: 2 },
    moduleId: 'module', categoryId: 'category', entityId: 'entity', entityName: 'Entity',
    entityColor: '#fff', checklistResponses: {}, note: 'depends on peer',
  } }), { origin: 'local' });
  const localUpdate = Y.encodeStateAsUpdate(peer, localVector);
  peer.destroy();
  const peerActor = randomUUID();
  const adapter = smallAdapter(fixture);
  adapter.readFixedCheckpoint = async () => ({ documentId: fixture.ids.documentId,
    generationId: fixture.ids.generationId, actorUserId: fixture.ids.actorUserId,
    contentModelVersion: 2, head: '1', baseSeq: '0', checkpoint: { atSeq: '0',
      writerId: null, writerEpoch: '0', encodingVersion: 1,
      snapshotSha256: fixture.snapshotSha256, snapshot: new Uint8Array(fixture.snapshot) } });
  adapter.readFixedTailPage = async ({ throughSeq }) => ({ documentId: fixture.ids.documentId,
    generationId: fixture.ids.generationId, actorUserId: fixture.ids.actorUserId,
    contentModelVersion: 2, throughSeq, hasMore: false, rows: [{ seq: '1',
      actorUserId: peerActor, writerId: fixture.ids.writerId,
      clientSeq: fixture.ids.clientSeq, update: peerUpdate }] });
  const result = await admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: localUpdate, checkpointPolicy: 'when-reader-limit' }, adapter,
  );
  assert.equal(result.nextSeq, '2');

  const reusedCallerKey = { ...adapter, readFixedTailPage: async input => {
    const page = await adapter.readFixedTailPage(input);
    return { ...page, rows: [{ ...page.rows[0], actorUserId: fixture.ids.actorUserId }] };
  } };
  await assert.rejects(admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: localUpdate, checkpointPolicy: 'when-reader-limit' }, reusedCallerKey,
  ), { code: 'ANNOTATION_AGGREGATE_STATE' });

  const invalidAdapter = { ...adapter, readFixedTailPage: async input => {
    const page = await adapter.readFixedTailPage(input);
    return { ...page, rows: [{ ...page.rows[0], actorUserId: 'not-a-uuid' }] };
  } };
  await assert.rejects(admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: localUpdate, checkpointPolicy: 'when-reader-limit' }, invalidAdapter,
  ), { code: 'ANNOTATION_AGGREGATE_STATE' });
});

test('a receipt committed after the first probe is rechecked only after the full fixed tail', async () => {
  const fixture = await smallAdmissionFixture();
  const makeAdapter = ({ rowUpdate = fixture.update, receiptUpdate = rowUpdate,
    receiptSeq = '1', duplicate = false, secondMiss = false } = {}) => {
    let lookups = 0;
    const adapter = smallAdapter(fixture);
    adapter.lookupReceipt = async () => {
      lookups += 1;
      if (lookups === 1 || secondMiss) return null;
      return { ...fixture.ids, seq: receiptSeq, update: new Uint8Array(receiptUpdate) };
    };
    adapter.readFixedCheckpoint = async () => ({ documentId: fixture.ids.documentId,
      generationId: fixture.ids.generationId, actorUserId: fixture.ids.actorUserId,
      contentModelVersion: 2, head: duplicate ? '2' : '1', baseSeq: '0', checkpoint: {
        atSeq: '0', writerId: null, writerEpoch: '0', encodingVersion: 1,
        snapshotSha256: fixture.snapshotSha256, snapshot: new Uint8Array(fixture.snapshot),
      } });
    adapter.readFixedTailPage = async ({ throughSeq }) => ({ documentId: fixture.ids.documentId,
      generationId: fixture.ids.generationId, actorUserId: fixture.ids.actorUserId,
      contentModelVersion: 2, throughSeq, hasMore: false, rows: [
        { seq: '1', actorUserId: fixture.ids.actorUserId, writerId: fixture.ids.writerId,
          clientSeq: fixture.ids.clientSeq, update: new Uint8Array(rowUpdate) },
        ...(duplicate ? [{ seq: '2', actorUserId: fixture.ids.actorUserId,
          writerId: fixture.ids.writerId, clientSeq: fixture.ids.clientSeq,
          update: new Uint8Array(rowUpdate) }] : []),
      ] });
    return { adapter, getLookups: () => lookups };
  };

  const exact = makeAdapter();
  const accepted = await admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: fixture.update }, exact.adapter,
  );
  assert.equal(accepted.kind, 'accepted-retry');
  assert.equal(accepted.receipt.seq, '1');
  assert.equal(exact.getLookups(), 2);

  const other = createDetachedYDoc('aggregate-raced-conflict');
  Y.applyUpdate(other, fixture.snapshot);
  const vector = Y.encodeStateVector(other);
  updateSurveyMarkersV2(other, markers => ({ ...markers, other: {
    annotationId: 'other', pageNumber: 1, bounds: { x: 4, y: 4, width: 2, height: 2 },
    moduleId: 'module', categoryId: 'category', entityId: 'other', entityName: 'Other',
    entityColor: '#000', checklistResponses: {}, note: 'other bytes',
  } }), { origin: 'other' });
  const otherUpdate = Y.encodeStateAsUpdate(other, vector);
  other.destroy();
  const conflict = makeAdapter({ rowUpdate: otherUpdate });
  await assert.rejects(admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: fixture.update }, conflict.adapter,
  ), { code: '23505' });
  assert.equal(conflict.getLookups(), 2);

  const missing = makeAdapter({ secondMiss: true });
  await assert.rejects(admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: fixture.update }, missing.adapter,
  ), { code: 'ANNOTATION_AGGREGATE_STATE' });
  assert.equal(missing.getLookups(), 2);

  const duplicate = makeAdapter({ duplicate: true });
  await assert.rejects(admitAnnotationGenerationAggregate(
    { ...fixture.ids, update: fixture.update }, duplicate.adapter,
  ), { code: 'ANNOTATION_AGGREGATE_STATE' });
  assert.equal(duplicate.getLookups(), 1);
});
