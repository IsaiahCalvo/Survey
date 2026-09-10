import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnnotationGenerationAggregateSupabaseAdapter }
  from '../supabase/functions/annotation-generation-aggregate/supabaseAdapter.js';

const actor = 'a2000000-0000-4000-8000-000000000001';
const scope = Object.freeze({
  documentId: 'a2000000-0000-4000-8000-000000000002',
  generationId: 'a2000000-0000-4000-8000-000000000003',
  contentModelVersion: 2,
});

test('the Supabase adapter keeps caller JWT reads separate from service broker writes', async () => {
  const calls = [];
  const rpcClient = kind => ({ rpc: async (name, params) => {
    calls.push({ kind, name, params });
    return { data: { ok: true }, error: null };
  } });
  const adapter = createAnnotationGenerationAggregateSupabaseAdapter({
    caller(token, signal) {
      calls.push({ kind: 'caller-client', token, signal });
      return { ...rpcClient('caller'), auth: { getUser: async supplied => ({
        data: { user: { id: actor, supplied } }, error: null,
      }) } };
    },
    service(signal) { calls.push({ kind: 'service-client', signal }); return rpcClient('service'); },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await adapter.getUser('caller-jwt', signal), { id: actor, supplied: 'caller-jwt' });
  await adapter.readFixedTailPage('caller-jwt', {
    ...scope, afterSeq: '4', throughSeq: '9', limit: 256,
  }, signal);
  const backing = new Uint8Array([99, 1, 2, 3, 88]);
  const update = backing.subarray(1, 4);
  await adapter.probe(actor, { ...scope, writerId: 'writer-a', clientSeq: '5', update }, signal);
  await adapter.probeV2(actor, { ...scope, writerId: 'writer-a', clientSeq: '5', update }, signal);
  await adapter.commitV2(actor, { ...scope, writerId: 'writer-a', clientSeq: '5', update,
    expectedHead: '9', sourceCheckpoint: { atSeq: '4', writerId: null, writerEpoch: '0',
      encodingVersion: 1, snapshotSha256: 'a'.repeat(64) }, checkpoint: null }, signal);

  assert.equal(calls.find(call => call.name === 'read_annotation_updates_v3').kind, 'caller');
  assert.deepEqual(calls.find(call => call.name === 'read_annotation_updates_v3').params, {
    p_document_id: scope.documentId, p_generation_id: scope.generationId,
    p_content_model_version: 2, p_after_seq: '4', p_through_seq: '9', p_limit: 256,
  });
  const probe = calls.find(call => call.name
    === 'probe_annotation_generation_aggregate_receipt_service_v1');
  assert.equal(probe.kind, 'service');
  assert.equal(probe.params.p_actor_user_id, actor);
  assert.equal(probe.params.p_data, '\\x010203');
  assert.equal(calls.find(call => call.name
    === 'probe_annotation_generation_aggregate_receipt_service_v2').kind, 'service');
  const commitV2 = calls.find(call => call.name
    === 'commit_annotation_generation_aggregate_service_v2');
  assert.equal(commitV2.kind, 'service');
  assert.equal(commitV2.params.p_expected_head, '9');
  assert.equal(commitV2.params.p_result_checkpoint, null);
});

test('an auth provider throw stays an unconfirmed outage while explicit rejection is unauthorized', async () => {
  const outage = Object.assign(new Error('network'), { code: 'ECONNRESET' });
  const thrown = createAnnotationGenerationAggregateSupabaseAdapter({
    caller: () => ({ auth: { getUser: async () => { throw outage; } } }),
    service: () => ({ rpc: async () => ({ data: null, error: null }) }),
  });
  await assert.rejects(thrown.getUser('token', new AbortController().signal), error => {
    assert.equal(error.code, 'unconfirmed');
    assert.equal(error.message, 'unconfirmed');
    return true;
  });
  const returnedOutage = createAnnotationGenerationAggregateSupabaseAdapter({
    caller: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: {
      name: 'AuthRetryableFetchError', status: 503, message: 'provider detail',
    } }) } }),
    service: () => ({ rpc: async () => ({ data: null, error: null }) }),
  });
  await assert.rejects(returnedOutage.getUser('token', new AbortController().signal), error => {
    assert.equal(error.code, 'unconfirmed');
    assert.equal(error.message, 'unconfirmed');
    return true;
  });
  const rejected = createAnnotationGenerationAggregateSupabaseAdapter({
    caller: () => ({ auth: { getUser: async () => ({ data: null, error: { code: 'bad_jwt' } }) } }),
    service: () => ({ rpc: async () => ({ data: null, error: null }) }),
  });
  assert.equal(await rejected.getUser('token', new AbortController().signal), null);
});
