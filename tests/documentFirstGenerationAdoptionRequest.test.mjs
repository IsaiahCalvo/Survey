import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocumentFirstGenerationAdoptionRequestHandler as create } from '../src/services/documentFirstGenerationAdoptionRequest.js';
import { stageDocumentGenerationAdoptionUpload } from '../supabase/functions/document-generation-adoption/handler.js';

const id = n => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = char => char.repeat(64);
const actor = id(1), documentId = id(2), operationId = id(3), sourceId = id(4), candidateId = id(5);
const archives = [id(6), id(7)];
const receipt = (state = 'review') => ({ version: 1, state, actor_user_id: actor, owner_user_id: id(8),
  document_id: documentId, adoption_operation_id: operationId, source_id: sourceId,
  candidate_operation_id: candidateId, offered_archive_operation_ids: archives,
  used_archive_operation_ids: [archives[0]], review_sha256: hash('a'), source_sql_sha256: hash('b'), wal_head: '0',
  objects: [{ kind: 'pdf', byte_length: '10', content_sha256: hash('c') }],
  canonical_annotations: { version: 1, policy: 'legacy-sql-v1', through_seq: '0',
    baseline_sha256: hash('d'), contributors: [] },
  entity_catalog: { status: 'absent', revision: null, content_sha256: null },
  survey_definition: { status: 'absent', revision: null, content_sha256: null },
  expires_at: new Date(Date.now() + 60000).toISOString(),
  ...(state !== 'review' ? { confirmed_at: new Date().toISOString() } : {}) });
const request = value => new Request('https://edge.test/', { method: 'POST',
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const handler = overrides => create({ enabled: true, getUser: async () => ({ id: actor }),
  preview: async () => receipt(), confirm: async () => receipt('confirmed'), status: async () => receipt(),
  publish: async () => receipt('confirmed'), ...overrides });

test('production composition is separately gated and uses the adoption prepare broker', () => {
  const edge = readFileSync(new URL('../supabase/functions/document-generation-adoption/handler.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../supabase/functions/document-generation-adoption/index.ts', import.meta.url), 'utf8');
  assert.match(index, /SURVEY_FIRST_GENERATION_ADOPTION.*v1-explicit-owner-consent/);
  assert.match(index, /get_document_generation_source_v2/);
  assert.doesNotMatch(index, /get_document_generation_source_bytes_v2/);
  assert.match(edge, /prepare_document_first_generation_adoption_service_v1/);
  assert.doesNotMatch(edge, /rpc\('prepare_document_generation_replacement_v3'/);
  assert.match(edge, /handleDocumentGenerationSourceBytes/);
  assert.match(edge, /handleDocumentGenerationUpload/);
});

test('a retry verifies a reserved upload with an existing object without another signed PUT', async () => {
  const calls = [], uploads = [];
  const operation = await stageDocumentGenerationAdoptionUpload({
    body: { action:'begin', operation_id: candidateId }, blob: new Blob(['pdf']), signal: new AbortController().signal,
    runUpload: async body => {
      calls.push(body);
      return calls.length === 1
        ? { operation:{ state:'reserved',object:{ id:id(20),version:id(21) } } }
        : { operation:{ state:'verified',object:{ id:id(20),version:id(21) } } };
    },
    putSignedUpload: async (...args) => { uploads.push(args); },
  });
  assert.equal(operation.state,'verified');
  assert.deepEqual(calls,[{ action:'begin',operation_id:candidateId },{ action:'verify',operation_id:candidateId }]);
  assert.equal(uploads.length,0);
});

test('frozen action bodies derive actor only from bearer auth', async () => {
  const seen = [];
  const h = handler({ preview: async value => { seen.push(value); return receipt(); } });
  const response = await h(request({ action: 'preview', document_id: documentId,
    adoption_operation_id: operationId, source_id: sourceId, candidate_operation_id: candidateId,
    archive_operation_ids: archives }));
  assert.equal(response.status, 200);
  assert.equal(seen[0].actorUserId, actor);
  assert.equal(Object.hasOwn(seen[0].input, 'actor_user_id'), false);
  for (const invalid of [
    { action: 'preview', document_id: documentId, adoption_operation_id: operationId, source_id: sourceId,
      candidate_operation_id: candidateId, archive_operation_ids: archives, actor_user_id: actor },
    { action: 'confirm', adoption_operation_id: operationId },
    { action: 'status', adoption_operation_id: operationId, review_sha256: hash('a') },
  ]) assert.equal((await h(request(invalid))).status, 400);
});

test('confirm, status, and publish use only their frozen identity fields and accept exact replay receipts', async () => {
  const calls = [];
  const h = handler({
    confirm: async value => { calls.push(value.input); return receipt('confirmed'); },
    status: async value => { calls.push(value.input); return receipt('confirmed'); },
    publish: async value => { calls.push(value.input); return receipt('confirmed'); },
  });
  assert.equal((await h(request({ action: 'confirm', adoption_operation_id: operationId,
    review_sha256: hash('a') }))).status, 200);
  assert.equal((await h(request({ action: 'status', adoption_operation_id: operationId }))).status, 200);
  assert.equal((await h(request({ action: 'publish', adoption_operation_id: operationId,
    review_sha256: hash('a') }))).status, 200);
  assert.deepEqual(calls.map(value => Object.keys(value)), [
    ['action', 'adoption_operation_id', 'review_sha256'], ['action', 'adoption_operation_id'],
    ['action', 'adoption_operation_id', 'review_sha256']]);
});

test('errors are bounded, redacted, and mapped to the frozen HTTP contract', async () => {
  for (const [errorCode, status, publicCode] of [
    ['42501', 403, 'forbidden'], ['40001', 409, 'adoption_conflict'], ['SG004', 409, 'legacy_entity_adoption_required'],
    ['adoption_expired', 410, 'adoption_expired'], ['secret_database_error', 500, 'internal_error'],
  ]) {
    const h = handler({ status: async () => { throw Object.assign(new Error('private detail'), { code: errorCode }); } });
    const response = await h(request({ action: 'status', adoption_operation_id: operationId }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code: publicCode } });
  }
});

test('disabled, unauthenticated, oversized, and aborted requests stop before workflow', async () => {
  let calls = 0;
  const disabled = create({ enabled: false, getUser: async () => ({ id: actor }), preview: async () => { calls++; },
    confirm: async () => {}, status: async () => {}, publish: async () => {} });
  assert.equal((await disabled(request({ action: 'status', adoption_operation_id: operationId }))).status, 503);
  const noAuth = handler({ getUser: async () => null, status: async () => { calls++; } });
  assert.equal((await noAuth(request({ action: 'status', adoption_operation_id: operationId }))).status, 401);
  const oversized = new Request('https://edge.test/', { method: 'POST',
    headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ action: 'status',
      adoption_operation_id: operationId, padding: 'x'.repeat(9000) }) });
  assert.equal((await handler({ status: async () => { calls++; } })(oversized)).status, 400);
  const controller = new AbortController(); controller.abort();
  const aborted = new Request('https://edge.test/', { method: 'POST', signal: controller.signal,
    headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ action: 'status', adoption_operation_id: operationId }) });
  assert.equal((await handler({ status: async () => { calls++; } })(aborted)).status, 503);
  assert.equal(calls, 0);
});
