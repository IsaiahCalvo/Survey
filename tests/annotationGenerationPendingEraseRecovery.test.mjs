import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import {
  materializeAnnotationGenerationState,
  materializeAnnotationGenerationStateForOpen,
} from '../src/services/annotationGenerationState.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { initializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import {
  drainEraseOutbox,
  isValidEraseOutboxEntry,
} from '../src/utils/annotationEraseTransaction.js';

const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1);
const actorB = id(2);
const documentId = id(3);
const generationId = id(4);
const ownerId = id(5);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;

function pendingEntry(overrides = {}) {
  const mutationId = overrides.mutationId || 'erase-one';
  const effects = overrides.effects || [{
    type: 'trash',
    targetKey: 'marker-one',
    payload: { before: { annotationId: 'marker-one', pageNumber: 1 } },
    idempotencyKey: `${mutationId}:trash:marker-one`,
  }];
  return {
    mutationId,
    actorUserId: actorA,
    status: 'pending',
    committedAt: '2026-09-10T12:00:00.000Z',
    effects,
    acknowledgedEffectKeys: [],
    ...overrides,
  };
}

function pendingDoc(entry = pendingEntry()) {
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: {}, spaces: [] });
  doc.getMap('eraseOutbox').set(entry.mutationId || 'erase-one', entry);
  return doc;
}

test('recovery materialization accepts a valid partial pending entry while capture stays quiescent', () => {
  const entry = pendingEntry({
    effects: [
      { type: 'trash', targetKey: 'marker-one', payload: { before: { annotationId: 'marker-one', pageNumber: 1 } },
        idempotencyKey: 'erase-one:trash:marker-one' },
      { type: 'history', targetKey: 'marker-one', payload: { before: { annotationId: 'marker-one', pageNumber: 1 } },
        idempotencyKey: 'erase-one:history:marker-one' },
    ],
    acknowledgedEffectKeys: ['erase-one:trash:marker-one'],
  });
  const doc = pendingDoc(entry);
  assert.equal(isValidEraseOutboxEntry(entry, 'erase-one', { allowPending: true }), true);
  assert.equal(isValidEraseOutboxEntry(entry, 'erase-one'), false);
  assert.equal(materializeAnnotationGenerationStateForOpen(doc, 2).contentModelVersion, 2);
  assert.throws(() => materializeAnnotationGenerationState(doc, 2), {
    code: 'ANNOTATION_GENERATION_STATE_INVALID',
  });
  assert.deepEqual(doc.getMap('eraseOutbox').get('erase-one'), entry);
  doc.destroy();
});

test('another actor may recover shared state but cannot execute the initiating actor effects', async () => {
  const doc = pendingDoc();
  let calls = 0;
  const foreign = await drainEraseOutbox({
    doc,
    actorUserId: actorB,
    executeEffect: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(foreign.pending, 0);
  assert.equal(doc.getMap('eraseOutbox').get('erase-one').status, 'pending');

  const owner = await drainEraseOutbox({
    doc,
    actorUserId: actorA,
    executeEffect: async () => { calls += 1; },
  });
  assert.equal(calls, 1);
  assert.equal(owner.acknowledged, 1);
  assert.equal(doc.getMap('eraseOutbox').get('erase-one').status, 'acknowledged');
  assert.doesNotThrow(() => materializeAnnotationGenerationState(doc, 2));
  doc.destroy();
});

test('pending recovery rejects malformed identity, effects, payloads and acknowledgement sets', () => {
  const base = pendingEntry();
  const inherited = Object.create({
    type: 'trash', targetKey: 'marker-one', payload: { before: { annotationId: 'marker-one', pageNumber: 1 } },
    idempotencyKey: 'erase-one:trash:marker-one',
  });
  const cases = [
    { ...base, mutationId: 'other' },
    { ...base, actorUserId: '' },
    { ...base, committedAt: '' },
    { ...base, effects: [] },
    { ...base, effects: [{ ...base.effects[0], type: 'unknown' }] },
    { ...base, effects: [{ ...base.effects[0], payload: [] }] },
    { ...base, effects: [{ ...base.effects[0], payload: 1 }] },
    { ...base, effects: [{ ...base.effects[0], payload: {} }] },
    { ...base, effects: [{ ...base.effects[0], payload: { before: { annotationId: 'other', pageNumber: 1 } } }] },
    { ...base, effects: [{ ...base.effects[0], payload: { before: { annotationId: 'marker-one', pageNumber: 0 } } }] },
    { ...base, effects: [{ ...base.effects[0], type: 'history', payload: {} }] },
    { ...base, effects: [inherited] },
    { ...base, effects: [base.effects[0], { ...base.effects[0] }] },
    { ...base, acknowledgedEffectKeys: ['missing:key'] },
    { ...base, acknowledgedEffectKeys: [base.effects[0].idempotencyKey, base.effects[0].idempotencyKey] },
    { ...base, acknowledgedEffectKeys: [base.effects[0].idempotencyKey] },
  ];
  for (const [index, entry] of cases.entries()) {
    assert.equal(isValidEraseOutboxEntry(entry, 'erase-one', { allowPending: true }), false, `case ${index}`);
  }

  const malformedHistory = pendingEntry({ effects: [{
    type: 'annotation-delete-history', targetKey: 'batch', payload: { mutations: [{}] },
    idempotencyKey: 'erase-one:annotation-delete-history:batch',
  }] });
  assert.equal(isValidEraseOutboxEntry(malformedHistory, 'erase-one', { allowPending: true }), false);
  const malformedExcel = pendingEntry({ effects: [{
    type: 'excel-delete', targetKey: 'marker-one', payload: { excelProjection: {} },
    idempotencyKey: 'erase-one:excel-delete:marker-one',
  }] });
  assert.equal(isValidEraseOutboxEntry(malformedExcel, 'erase-one', { allowPending: true }), false);
  const legacyTargetOnly = pendingEntry({ effects: [{
    type: 'legacy-marker-delete', targetKey: 'marker-one', payload: {},
    idempotencyKey: 'erase-one:legacy-marker-delete:marker-one',
  }] });
  assert.equal(isValidEraseOutboxEntry(legacyTargetOnly, 'erase-one', { allowPending: true }), true,
    'legacy dispatch needs only its bound targetKey');

  for (const entry of [...cases, malformedHistory, malformedExcel]) {
    const doc = pendingDoc(entry);
    assert.throws(() => materializeAnnotationGenerationStateForOpen(doc, 2), {
      code: 'ANNOTATION_GENERATION_STATE_INVALID',
    });
    doc.destroy();
  }
});

test('checked model2 reader accepts another actor pending entry without consuming it', async () => {
  const source = pendingDoc();
  const snapshot = Y.encodeStateAsUpdate(source);
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 49]);
  const path = `${ownerId}/_generations/${documentId}/${generationId}.pdf`;
  const response = includeSnapshot => ({
    version: 4,
    actor_user_id: actorB,
    document_id: documentId,
    generation_id: generationId,
    content_model_version: 2,
    document: { id: documentId, user_id: ownerId, project_id: null, name: 'Shared', file_path: path,
      file_size: String(pdf.length) },
    publication: { operation_id: id(6), generation_id: generationId,
      published_at: '2026-09-10T12:00:00.000Z', wal_head: '0' },
    pdf: { bucket_id: 'documents', path, id: id(7), version: id(8), byte_length: String(pdf.length),
      content_sha256: sha256(pdf) },
    annotations: { version: 3, document_id: documentId, generation_id: generationId,
      content_model_version: 2, wal_head: '0', snapshot_sha256: includeSnapshot ? sha256(snapshot) : null,
      snapshot: includeSnapshot ? { at_seq: '0', snapshot: hex(snapshot), encoding_version: 1,
        writer_id: null, writer_epoch: '0' } : null },
    legacy_sidecar_migration: null,
  });
  const calls = [];
  const reader = createDocumentGenerationReader({
    getActorUserId: () => actorB,
    request: async (name, params, context) => {
      calls.push({ name, params, actorUserId: context.actorUserId });
      assert.equal(name, 'read_document_generation_open_v4');
      return { data: response(params.p_include_snapshot) };
    },
    download: async (_descriptor, context) => {
      assert.equal(context.actorUserId, actorB);
      return new Blob([pdf], { type: 'application/pdf' });
    },
  });
  const result = await reader.open({ documentId, actorUserId: actorB, pdfGenerationId: generationId,
    contentModelVersion: 2 });
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, result.annotationUpdate);
  assert.equal(recovered.getMap('eraseOutbox').get('erase-one').actorUserId, actorA);
  assert.equal(recovered.getMap('eraseOutbox').get('erase-one').status, 'pending');
  assert.deepEqual(calls.map(call => [call.name, call.actorUserId, call.params.p_include_snapshot]), [
    ['read_document_generation_open_v4', actorB, true],
    ['read_document_generation_open_v4', actorB, false],
  ]);
  recovered.destroy();
  source.destroy();
});
