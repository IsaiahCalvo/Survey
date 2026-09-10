import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleAnnotationGenerationAggregate }
  from '../supabase/functions/annotation-generation-aggregate/handler.js';

const scope = Object.freeze({
  documentId: 'a1000000-0000-4000-8000-000000000001',
  generationId: 'a1000000-0000-4000-8000-000000000002',
  actorUserId: 'a1000000-0000-4000-8000-000000000003',
  writerId: 'aggregate-handler-writer',
  clientSeq: '1',
});
const update = new Uint8Array([1, 2, 3, 4]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const request = (bytes = update, receiptVersion = null) => new Request(
  `https://local.test/annotation-generation-aggregate?document_id=${scope.documentId}`
    + `&generation_id=${scope.generationId}&content_model_version=2`
    + `&client_id=${scope.writerId}&client_seq=${scope.clientSeq}`
    + (receiptVersion === null ? '' : `&receipt_version=${receiptVersion}`),
  { method: 'POST', headers: { Authorization: 'Bearer verified-token',
    'Content-Type': 'application/octet-stream' }, body: bytes },
);

test('an authenticated exact receipt binds the actor and skips every aggregate read and commit', async () => {
  const calls = [];
  const response = await handleAnnotationGenerationAggregate(request(), {
    runtimeVerified: true,
    async getUser(token) {
      calls.push(['auth', token]);
      return { id: scope.actorUserId };
    },
    async probe(actor, input) {
      calls.push(['probe', actor, input]);
      return { version: 1, status: 'accepted', accepted: true,
        document_id: scope.documentId, generation_id: scope.generationId,
        content_model_version: 2, actor_user_id: scope.actorUserId,
        client_id: scope.writerId, client_seq: scope.clientSeq, seq: '9',
        data_sha256: sha256(update) };
    },
    async readFixedCheckpoint() { throw new Error('must not read checkpoint'); },
    async readFixedTailPage() { throw new Error('must not read tail'); },
    async commit() { throw new Error('must not commit'); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { version: 1, status: 'accepted',
    document_id: scope.documentId, generation_id: scope.generationId,
    content_model_version: 2, actor_user_id: scope.actorUserId,
    client_id: scope.writerId, client_seq: scope.clientSeq, seq: '9',
    data_sha256: sha256(update) } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['auth', 'verified-token']);
  assert.equal(calls[1][0], 'probe');
  assert.equal(calls[1][1], scope.actorUserId);
  assert.deepEqual(calls[1][2].update, update);
  assert.notEqual(calls[1][2].update, update);
});

test('explicit receipt v2 carries exact locked generation identity while v1 remains default', async () => {
  const currentGenerationId = 'a1000000-0000-4000-8000-000000000004';
  let v1Calls = 0;
  const deps = {
    runtimeVerified: true,
    async getUser() { return { id: scope.actorUserId }; },
    async probe() { v1Calls += 1; throw new Error('v1 probe must not run'); },
    async probeV2() {
      return { version: 2, status: 'accepted', accepted: true,
        document_id: scope.documentId, generation_id: scope.generationId,
        content_model_version: 2, actor_user_id: scope.actorUserId,
        client_id: scope.writerId, client_seq: scope.clientSeq, seq: '9',
        data_sha256: sha256(update), current_generation_id: currentGenerationId,
        is_current: false };
    },
    async readFixedCheckpoint() { throw new Error('must not read checkpoint'); },
    async readFixedTailPage() { throw new Error('must not read tail'); },
    async commit() { throw new Error('must not commit'); },
    async commitV2() { throw new Error('must not commit'); },
  };
  const response = await handleAnnotationGenerationAggregate(request(update, '2'), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { version: 2, status: 'accepted',
    document_id: scope.documentId, generation_id: scope.generationId,
    content_model_version: 2, actor_user_id: scope.actorUserId,
    client_id: scope.writerId, client_seq: scope.clientSeq, seq: '9',
    data_sha256: sha256(update), current_generation_id: currentGenerationId,
    is_current: false } });
  assert.equal(v1Calls, 0);
});
