import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDocumentGenerationSource } from '../supabase/functions/document-generation-source/handler.js';

const actor = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const generationId = '44444444-4444-4444-8444-444444444444';
const begin = { action: 'begin', source_id: sourceId, document_id: documentId, generation_id: null };
const receipt = () => ({ version: 1, source_id: sourceId, actor_user_id: actor, document_id: documentId,
  generation_id: null, state: 'captured', source_byte_state: 'unverified', source_sql_sha256: 'a'.repeat(64),
  wal_head: '9007199254740993', expires_at: '2026-09-09T04:00:00Z', source_object: {
    bucket_id: 'documents', path: 'raw/old?#%.pdf', id: generationId, version: null, byte_length: '123' },
  sidecar_objects: [], visible_capture: { document: { id: documentId }, scope: 'sql-metadata-only',
    sources: { annotation_snapshot: null, annotation_updates: [], document_annotations: [],
      doc_yjs_state: null, doc_yjs_updates: [], survey_sessions: [], survey_items: [], active_generation: null },
    compare: { wal_head: '9007199254740993', covered_head: '9007199254740993' } } });
function deps(overrides = {}) {
  return { enabled: true, getUser: async () => ({ id: actor }), begin: async () => receipt(),
    get: async () => receipt(), cancel: async () => ({ ...receipt(), state: 'canceled',
      source_object: null, sidecar_objects: [], visible_capture: null }), ...overrides };
}
const request = (body = begin, options = {}) => new Request('http://localhost/source', {
  method: 'POST', headers: { Authorization: 'Bearer synthetic-token' }, body: JSON.stringify(body), ...options });
async function run(body = begin, overrides = {}, options = {}) {
  const response = await handleDocumentGenerationSource(request(body, options), deps(overrides));
  return { status: response.status, body: await response.json(), response };
}

test('capture fixes actor from auth and preserves exact integer and opaque legacy path metadata', async () => {
  const result = await run(begin, { begin: async (verifiedActor, input, signal) => {
    assert.equal(verifiedActor, actor); assert.deepEqual(input, begin); assert.equal(signal.aborted, false);
    return receipt();
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.source, receipt());
  assert.equal(result.response.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), '*');
});
test('disabled and preflight do not authenticate or capture; wrong methods fail', async () => {
  const forbidden = () => assert.fail('unexpected dependency call');
  assert.equal((await run(begin, { enabled: false, getUser: forbidden, begin: forbidden })).status, 503);
  for (const [method, status] of [['OPTIONS', 204], ['GET', 405]]) {
    const response = await handleDocumentGenerationSource(new Request('http://localhost', { method }), deps({ getUser: forbidden }));
    assert.equal(response.status, status);
  }
});
test('missing or unverified auth never captures', async () => {
  assert.equal((await run(begin, { begin: () => assert.fail() }, { headers: {} })).status, 401);
  assert.equal((await run(begin, { getUser: async () => null, begin: () => assert.fail() })).status, 401);
});
test('exact requests reject actor injection, missing generation, unknown action and fields', async () => {
  const { generation_id, ...missing } = begin;
  for (const body of [missing, { ...begin, actor_user_id: actor }, { ...begin, extra: 1 },
    { ...begin, generation_id: 1 }, { ...begin, source_id: 'bad' }, { ...begin, action: 'publish' },
    { action: 'get', source_id: sourceId, document_id: documentId }]) {
    assert.equal((await run(body, { begin: () => assert.fail(), get: () => assert.fail() })).status, 400);
  }
});
test('invalid UTF8, JSON and oversized streamed bodies fail without capture', async () => {
  for (const body of [new Uint8Array([0xff]), '{', ' '.repeat(8193)]) {
    const response = await handleDocumentGenerationSource(request(begin, { body }), deps({ begin: () => assert.fail() }));
    assert.equal(response.status, 400);
  }
});
test('same-ID terminal receipts remain terminal and cannot return source bodies', async () => {
  for (const state of ['canceled', 'expired']) {
    const terminal = { ...receipt(), state, source_object: null, visible_capture: null };
    for (const action of ['begin', 'get', 'cancel']) {
      const result = await run(action === 'begin' ? begin : { action, source_id: sourceId }, { [action]: async () => terminal });
      assert.equal(result.status, 200); assert.deepEqual(result.body.source, terminal);
    }
    assert.equal((await run(begin, { begin: async () => ({ ...receipt(), state }) })).status, 502);
  }
});
test('mismatched identities, generation, hashes and rounded counters never confirm capture', async () => {
  for (const change of [{ actor_user_id: generationId }, { source_id: generationId }, { document_id: generationId },
    { generation_id: generationId }, { source_byte_state: 'verified' }, { source_sql_sha256: null },
    { wal_head: 9007199254740992 }, { wal_head: '01' }, { wal_head: '9223372036854775808' }]) {
    assert.equal((await run(begin, { begin: async () => ({ ...receipt(), ...change }) })).status, 502);
  }
  const generated = { ...receipt(), generation_id: generationId };
  generated.visible_capture.sources.active_generation = { baseline: { document_id: documentId,
    generation_id: generationId, base_seq: '0', baseline_snapshot_base64: '' }, snapshot: null, updates: [] };
  assert.equal((await run({ ...begin, generation_id: generationId }, { begin: async () => generated })).status, 200);
});
test('active generation capture requires the exact generation baseline and rows', async () => {
  const generated = { ...receipt(), generation_id: generationId };
  const input = { ...begin, generation_id: generationId };
  assert.equal((await run(input, { begin: async () => generated })).status, 502);
  generated.visible_capture.sources.active_generation = { baseline: { document_id: documentId,
    generation_id: sourceId, base_seq: '0', baseline_snapshot_base64: '' }, snapshot: null, updates: [] };
  assert.equal((await run(input, { begin: async () => generated })).status, 502);
});
test('private source fields and storage fields are not forwarded', async () => {
  const value = receipt(); value.private_body = 'private'; value.source_object.private_path = 'private';
  value.visible_capture.sources.connector_history = { secret: 'private' };
  value.visible_capture.private_history = 'private'; value.visible_capture.compare.private_hash = 'private';
  const result = await run(begin, { begin: async () => value });
  assert.equal(result.status, 200); assert.equal(JSON.stringify(result.body).includes('private'), false);
});
test('foreign survey or cross-document annotation projection fails closed', async () => {
  for (const patch of [
    { survey_sessions: [{ id: sourceId, document_id: documentId, user_id: generationId }] },
    { survey_items: [{ session_id: sourceId }] },
    { annotation_updates: [{ document_id: generationId }] },
    { annotation_snapshot: { document_id: generationId } },
  ]) {
    const value = receipt(); Object.assign(value.visible_capture.sources, patch);
    const result = await run(begin, { begin: async () => value });
    assert.equal(result.status, 502); assert.equal(JSON.stringify(result.body).includes(generationId), false);
  }
  const value = receipt(); value.visible_capture.sources.survey_sessions = [{ id: sourceId, document_id: documentId, user_id: actor }];
  value.visible_capture.sources.survey_items = [{ id: generationId, session_id: sourceId, notes: 'retained' }];
  assert.equal((await run(begin, { begin: async () => value })).status, 200);
});
test('raw provider and SQL diagnostics are redacted', async () => {
  for (const code of ['42501', '40001', '55P03', '23514', '54000', 'unknown', '__proto__']) {
    const result = await run(begin, { begin: async () => { throw { code, message: 'private-token diagnostic' }; } });
    assert.notEqual(result.status, 200); assert.equal(JSON.stringify(result.body).includes('private-token'), false);
  }
});
test('hanging auth, body, or RPC is bounded; no later phase or automatic cancel', async () => {
  const never = () => new Promise(() => {});
  const forbidden = () => assert.fail('a timeout cannot start later work');
  const auth = await run(begin, { timeoutMs: 10, getUser: never, begin: forbidden, cancel: forbidden });
  assert.equal(auth.body.error.code, 'capture_pending');
  const rpc = await run(begin, { timeoutMs: 10, begin: never, cancel: forbidden });
  assert.equal(rpc.body.error.code, 'capture_pending');
  const body = new ReadableStream({ pull: never, cancel: never });
  const response = await handleDocumentGenerationSource(request(begin, { body, duplex: 'half' }),
    deps({ timeoutMs: 10, begin: forbidden, cancel: forbidden }));
  assert.equal(response.status, 503);
});
test('already-aborted request does not authenticate', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await run(begin, { getUser: () => assert.fail() }, { signal: controller.signal })).status, 503);
});
