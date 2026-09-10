import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationGenerationTransport } from '../src/services/annotationGenerationTransport.js';

const id = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(1), pdfGenerationId = id(2), actorUserId = id(3);

function harness(contentModelVersion, responseModel = contentModelVersion) {
  const calls = [];
  const transport = createAnnotationGenerationTransport({ documentId, pdfGenerationId, actorUserId,
    contentModelVersion, request: async (name, params) => {
      calls.push({ name, params });
      return { data: { version: 3, document_id: documentId, generation_id: pdfGenerationId,
        content_model_version: responseModel, wal_head: '0', snapshot: null } };
    } });
  return { calls, transport };
}

test('explicit checked content model uses only v3 and binds every request', async () => {
  for (const model of [1, 2]) {
    const { calls, transport } = harness(model);
    assert.deepEqual(await transport.snapshot(), { snapshot: null, walHead: 0 });
    assert.equal(calls[0].name, 'read_annotation_snapshot_v3');
    assert.equal(calls[0].params.p_content_model_version, model);
  }
});

test('v3 rejects missing, unknown, or mismatched model without a v2 retry', async () => {
  for (const model of [undefined, 0, 3, null]) {
    assert.throws(() => createAnnotationGenerationTransport({ documentId, pdfGenerationId,
      actorUserId, contentModelVersion: model, request: async () => null }),
    { code: 'ANNOTATION_GENERATION_INPUT' });
  }
  for (const echoed of [null, 1, 3]) {
    const { calls, transport } = harness(2, echoed);
    await assert.rejects(transport.snapshot(), { code: 'ANNOTATION_GENERATION_PROTOCOL' });
    assert.deepEqual(calls.map(call => call.name), ['read_annotation_snapshot_v3']);
  }
});

test('all v3 RPCs require and verify the same model echo', async () => {
  const calls = [], digest = Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new Uint8Array([1]))), byte => byte.toString(16).padStart(2, '0')).join('');
  const request = async (name, params) => {
    calls.push({ name, params });
    const base = { version: 3, document_id: documentId, generation_id: pdfGenerationId,
      content_model_version: 2 };
    if (name === 'read_annotation_snapshot_v3') return { data: { ...base, wal_head: '0', snapshot: null } };
    if (name === 'read_annotation_updates_v3') return { data: { ...base, through_seq: '0', rows: [], has_more: false } };
    if (name === 'read_annotation_writer_sequence_v3') return { data: { ...base, client_id: 'writer', client_seq: '0' } };
    if (name === 'append_annotation_update_v3') return { data: { ...base, accepted: true,
      actor_user_id: actorUserId, client_id: 'writer', client_seq: '1', seq: '1', data_sha256: digest,
      current_generation_id: pdfGenerationId, is_current: true } };
    return { data: { ...base, stored: true, at_seq: '1', writer_id: 'writer', writer_epoch: '1',
      snapshot_sha256: digest, encoding_version: 1 } };
  };
  const transport = createAnnotationGenerationTransport({ documentId, pdfGenerationId, actorUserId,
    contentModelVersion: 2, request });
  await transport.snapshot();
  await transport.updates({ afterSeq: 0, throughSeq: 0, limit: 10 });
  await transport.writerSequence('writer');
  await transport.append({ writerId: 'writer', clientSeq: 1, data: '\\x01' });
  await transport.storeSnapshot({ atSeq: 1, snapshot: '\\x01', encodingVersion: 1,
    writerId: 'writer', writerEpoch: 1, expectedAtSeq: null, expectedWriterId: null,
    expectedWriterEpoch: 0 });
  assert.deepEqual(calls.map(call => call.name), [
    'read_annotation_snapshot_v3', 'read_annotation_updates_v3',
    'read_annotation_writer_sequence_v3', 'append_annotation_update_v3',
    'store_annotation_snapshot_v3',
  ]);
  assert.ok(calls.every(call => call.params.p_content_model_version === 2));
});
