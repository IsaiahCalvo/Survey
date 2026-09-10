import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationCollaborationSession } from '../src/lib/collab/generationCollaborationSession.js';
import { annotationOutboxRecordKey, createMemoryAnnotationOutbox }
  from '../src/services/annotationDocOutbox.js';
import { bindAnnotationGenerationOutbox } from '../src/services/annotationGenerationOutbox.js';

const id = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorUserId = id(1), documentId = id(2), pdfGenerationId = id(3);
const bundle = model => ({ actorUserId, documentId, pdfGenerationId, contentModelVersion: model,
  pdf: { bucket_id: 'documents', path: `${actorUserId}/_generations/a.pdf`, id: id(4), version: id(5),
    byte_length: '3', content_sha256: 'a'.repeat(64) },
  publication: { operation_id: id(6), generation_id: pdfGenerationId,
    published_at: '2026-09-09T00:00:00Z', wal_head: '0' } });
const handle = model => ({ documentId, actorUserId, pdfGenerationId, contentModelVersion: model,
  getGenerationStatus: () => ({ pdfGenerationId, blocked: false }), getSyncStatus: () => ({ healthy: true }),
  onSyncStatus: () => () => {} });

test('generation session rejects a handle from another content model before I/O', () => {
  let calls = 0;
  const client = { rpc() { calls++; }, auth: { getSession() { calls++; } } };
  assert.throws(() => createGenerationCollaborationSession({ checkedBundle: bundle(2),
    generationSession: handle(1), client, getCurrentActorUserId: () => actorUserId }));
  assert.equal(calls, 0);
});

function record(model, seq = 1) {
  const value = { documentId, actorUserId, pdfGenerationId, writerId: 'writer', clientSeq: seq,
    ordinal: seq, incarnation: 0, status: 'pending', update: new Uint8Array([seq]),
    ...(model === 2 ? { contentModelVersion: 2 } : {}) };
  return { ...value, key: annotationOutboxRecordKey(value) };
}

test('model 2 outbox scope cannot hide, acknowledge, or retire saved legacy rows', async () => {
  const store = createMemoryAnnotationOutbox();
  const legacy = bindAnnotationGenerationOutbox(store, { documentId, actorUserId, pdfGenerationId,
    contentModelVersion: 1 });
  const modern = bindAnnotationGenerationOutbox(store, { documentId, actorUserId, pdfGenerationId,
    contentModelVersion: 2 });
  const pending = record(1);
  await legacy.put(pending);
  for (const operation of [
    () => modern.list(documentId, actorUserId),
    () => modern.settleAccepted(record(2)),
    () => modern.retireScope(documentId, actorUserId, 0, {
      replacementGenerationId: id(9), reason: 'cloud-generation-replaced',
    }),
  ]) await assert.rejects(operation, { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual((await legacy.list(documentId, actorUserId)).map(row => row.key), [pending.key]);
});

test('model 2 records use a distinct strict namespace while legacy records stay byte compatible', async () => {
  const store = createMemoryAnnotationOutbox();
  const modern = bindAnnotationGenerationOutbox(store, { documentId, actorUserId, pdfGenerationId,
    contentModelVersion: 2 });
  const pending = record(2);
  assert.match(pending.key, /\u0000content-model\u00002\u0000writer\u00001$/);
  await modern.put(pending);
  assert.deepEqual((await modern.list(documentId, actorUserId)).map(row => row.contentModelVersion), [2]);
  await assert.rejects(() => store.put({ ...pending, contentModelVersion: undefined }),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  const legacy = bindAnnotationGenerationOutbox(store, { documentId, actorUserId, pdfGenerationId,
    contentModelVersion: 1 });
  await assert.rejects(() => legacy.list(documentId, actorUserId),
    { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
  assert.deepEqual((await modern.list(documentId, actorUserId)).map(row => row.key), [pending.key]);
});
