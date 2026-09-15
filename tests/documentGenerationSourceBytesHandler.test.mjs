import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeSourceObjectPath, handleDocumentGenerationSourceBytes } from '../supabase/functions/document-generation-source-bytes/handler.js';
const id = n => `93000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), sourceId = id(2), documentId = id(3), claimId = id(4);
const payloads = [new TextEncoder().encode('%PDF-1.7\ncomplete\n%%EOF'), new TextEncoder().encode('{"entities":[]}')];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = () => payloads.map((bytes, index) => ({ kind: index ? 'sidecar' : 'pdf',
  bucket_id: 'documents', path: index ? 'project/sidecar_data.json' : 'raw/plan?#%.pdf',
  id: id(10 + index), version: id(20 + index), byte_length: String(bytes.length), content_sha256: null }));
const receipt = (state = 'unverified') => ({ version: 1, source_id: sourceId, actor_user_id: actor,
  document_id: documentId, generation_id: null, source_sql_sha256: 'a'.repeat(64), state,
  objects: ['expired', 'canceled'].includes(state) ? [] : manifest().map((object, index) => ({ ...object,
    content_sha256: state === 'verified' ? hash(payloads[index]) : null })),
  verified_at: state === 'verified' ? '2030-01-01T00:00:00Z' : null, expires_at: '2030-01-02T00:00:00Z' });
const stream = (bytes, observe = {}) => new ReadableStream({ start(controller) {
  controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close();
}, cancel() { observe.canceled = true; } });
const request = (action = 'verify', extra = {}) => new Request('http://localhost/source-bytes', {
  method: 'POST', headers: { Authorization: 'Bearer private-token' }, body: JSON.stringify({ action, source_id: sourceId }), ...extra });
function harness(overrides = {}) {
  const calls = [];
  const defaults = { enabled: true, timeoutMs: 1000, newId: () => claimId,
    getUser: async () => ({ id: actor }), get: async () => receipt(),
    claim: async () => ({ ...receipt('verifying'), verification_claim_id: claimId, verification_claim_expires_at: '2030-01-01T00:02:00Z' }),
    openStream: async object => stream(payloads[object.kind === 'pdf' ? 0 : 1]),
    record: async () => receipt('verified'), release: async () => ({ released: true }), ...overrides };
  const deps = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof value === 'function'
    ? (...args) => { calls.push({ name: key, args }); return value(...args); } : value]));
  return { calls, deps, async run(action = 'verify', extra = {}) {
    const response = await handleDocumentGenerationSourceBytes(request(action, extra), deps);
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  } };
}
const names = h => h.calls.map(call => call.name);
test('expired source or delayed expired claim spends no download bytes', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const source = harness({ get: async () => ({ ...receipt(), expires_at: past }) });
  assert.equal((await source.run()).status, 409); assert.deepEqual(names(source), ['getUser', 'get']);
  const claim = harness({ claim: async () => ({ ...receipt('verifying'), verification_claim_id: claimId,
    verification_claim_expires_at: past }) });
  assert.equal((await claim.run()).status, 503);
  assert.ok(!names(claim).includes('openStream')); assert.ok(!names(claim).includes('record'));
});
test('claim expiry aborts an ignored stream wait before the sidecar or any record', async () => {
  let canceled = false;
  const h = harness({ claim: async () => ({ ...receipt('verifying'), verification_claim_id: claimId,
    verification_claim_expires_at: new Date(Date.now() + 30).toISOString() }),
    openStream: async () => new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled = true; } }) });
  assert.equal((await h.run()).status, 503); assert.equal(canceled, true);
  assert.equal(names(h).filter(n => n === 'openStream').length, 1);
  assert.ok(!names(h).includes('record')); assert.ok(!names(h).includes('release'));
});
test('all captured objects finish hashing before one exact manifest receipt', async () => {
  const h = harness(), result = await h.run(); assert.equal(result.status, 200);
  assert.deepEqual(names(h), ['getUser', 'get', 'newId', 'claim', 'openStream', 'openStream', 'record']);
  const args = h.calls.find(call => call.name === 'record').args;
  assert.deepEqual(args.slice(0, 3), [actor, sourceId, claimId]);
  assert.deepEqual(args[3], receipt('verified').objects);
  assert.deepEqual(result.body, { attestation: receipt('verified') });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), '*');
});
test('get and already verified retry never reread bytes or claim', async () => {
  for (const [action, state] of [['get', 'unverified'], ['verify', 'verified']]) {
    const h = harness({ get: async () => receipt(state) });
    assert.equal((await h.run(action)).status, 200); assert.deepEqual(names(h), ['getUser', 'get']);
  }
});
test('a peer may complete the same exact manifest before our claim', async () => {
  const h = harness({ claim: async () => receipt('verified') });
  assert.equal((await h.run()).status, 200); assert.ok(!names(h).includes('openStream'));
});
test('all success paths strip private lease and future fields', async () => {
  const value = receipt('verified'); value.private_key = 'private-service-key';
  value.verification_claim_id = claimId; value.objects[0].private_object = 'private-service-key';
  const h = harness({ get: async () => value }), result = await h.run();
  assert.equal(result.status, 200); assert.deepEqual(result.body.attestation, receipt('verified'));
});
test('disabled, wrong method, preflight and failed auth make no protected calls', async () => {
  const h = harness({ enabled: false }); assert.equal((await h.run()).status, 503); assert.deepEqual(names(h), []);
  for (const [method, status] of [['OPTIONS', 204], ['GET', 405]]) {
    const h = harness(); assert.equal((await h.run('get', { method, body: undefined })).status, status); assert.deepEqual(names(h), []);
  }
  const missing = harness(); assert.equal((await missing.run('get', { headers: {} })).status, 401);
  const denied = harness({ getUser: async () => null }); assert.equal((await denied.run()).status, 401);
  assert.deepEqual(names(denied), ['getUser']);
});
test('client cannot choose actor, object path, proof hashes or claim', async () => {
  for (const body of [{ action: 'verify', source_id: sourceId, actor_user_id: actor },
    { action: 'verify', source_id: sourceId, path: 'other.pdf' }, { action: 'verify', source_id: sourceId, claim_id: claimId },
    { action: 'verify', source_id: sourceId, objects: [] }, { action: 'publish', source_id: sourceId },
    { action: 'get', source_id: 'bad' }, null]) {
    const h = harness(); assert.equal((await h.run('verify', { body: JSON.stringify(body) })).status, 400);
    assert.deepEqual(names(h), ['getUser']);
  }
});
test('invalid JSON/UTF8 and oversized input never reads source metadata', async () => {
  for (const body of ['{', new Uint8Array([255]), ' '.repeat(8193)]) {
    const h = harness(); assert.equal((await h.run('get', { body })).status, 400); assert.deepEqual(names(h), ['getUser']);
  }
});
test('terminal receipts allow inspection but cannot start byte reads', async () => {
  for (const state of ['expired', 'canceled']) {
    const h = harness({ get: async () => receipt(state) });
    assert.equal((await h.run('get')).status, 200); assert.equal((await h.run()).status, 409);
    assert.ok(!names(h).includes('claim')); assert.ok(!names(h).includes('openStream'));
  }
});
test('malformed identities and manifests cannot authorize reads', async () => {
  for (const mutate of [value => { value.actor_user_id = id(99); }, value => { value.source_id = id(99); },
    value => { value.objects = []; }, value => { value.objects[0].content_sha256 = 'a'.repeat(64); },
    value => { value.objects[0].version = null; }, value => { value.objects[0].byte_length = 5; },
    value => { value.objects[1].path = value.objects[0].path; }, value => { value.objects[1].id = value.objects[0].id; },
    value => { value.objects.reverse(); }, value => { value.objects[0].bucket_id = 'foreign'; }]) {
    const value = receipt(); mutate(value); const h = harness({ get: async () => value });
    assert.equal((await h.run()).status, 502); assert.ok(!names(h).includes('claim'));
  }
});
test('claim must match exact source metadata and private claim identity', async () => {
  for (const mutate of [value => { value.objects[0].version = id(99); }, value => { value.objects.pop(); },
    value => { value.generation_id = id(99); }, value => { value.source_sql_sha256 = 'b'.repeat(64); },
    value => { value.verification_claim_id = id(99); }]) {
    const value = { ...receipt('verifying'), verification_claim_id: claimId, verification_claim_expires_at: '2030-01-01T00:02:00Z' };
    mutate(value); const h = harness({ claim: async () => value });
    assert.equal((await h.run()).status, 502); assert.ok(!names(h).includes('openStream'));
  }
});
test('short, long, failed or missing sidecar streams cannot record a partial manifest', async () => {
  for (const openStream of [async () => stream(new Uint8Array(1)), async () => stream(new Uint8Array(999)),
    async () => null, async object => object.kind === 'pdf' ? stream(payloads[0]) : Promise.reject(new Error('private-service-key'))]) {
    const h = harness({ openStream }), result = await h.run();
    assert.notEqual(result.status, 200); assert.ok(!names(h).includes('record')); assert.ok(names(h).includes('release'));
    assert.ok(!JSON.stringify(result.body).includes('private-service-key'));
  }
});
test('a wrong or lost record reply stays unconfirmed and does not release a possibly committed claim', async () => {
  for (const record of [async () => { throw new Error('private-service-key'); }, async () => receipt(),
    async () => { const value = receipt('verified'); value.objects[1].content_sha256 = 'f'.repeat(64); return value; }]) {
    const h = harness({ record }); assert.notEqual((await h.run()).status, 200); assert.ok(!names(h).includes('release'));
  }
});
test('timeouts bound ignored cancellation during auth, stream, record and request-body reads', async () => {
  const never = () => new Promise(() => {});
  for (const overrides of [{ getUser: never }, { openStream: never },
    { openStream: async () => new ReadableStream({ pull: never, cancel: never }) }, { record: never }]) {
    const h = harness({ timeoutMs: 10, ...overrides }); assert.equal((await h.run()).status, 503);
    assert.ok(!names(h).includes('release'));
  }
  const h = harness({ timeoutMs: 10 });
  assert.equal((await h.run('get', { body: new ReadableStream({ pull: never, cancel: never }), duplex: 'half' })).status, 503);
  assert.ok(!names(h).includes('get'));
});
test('raw reserved names round-trip without normalizing into another storage object', async () => {
  for (const path of ['raw/plan?#%.pdf', '/raw/plan.pdf', '//raw/plan.pdf', 'a//b.pdf', 'raw/literal%2F.pdf', 'raw/space ü.pdf', 'a\\b.pdf']) {
    const encoded = encodeSourceObjectPath(path);
    const url = new URL(`https://storage.invalid/object/documents/${encoded.replace(/^\/+/, '')}`);
    assert.equal(decodeURIComponent(url.pathname.slice('/object/documents/'.length)), path);
    assert.equal(url.search, ''); assert.equal(url.hash, '');
  }
  for (const path of ['a/../b.pdf', './b.pdf', 'a/./b.pdf', '', '\uD800']) {
    assert.throws(() => encodeSourceObjectPath(path), { code: 'invalid_source_path' });
  }
  const value = receipt(); value.objects[0].path = 'a/../b.pdf'; const h = harness({ get: async () => value });
  assert.equal((await h.run()).body.error.code, 'invalid_source_path'); assert.ok(!names(h).includes('claim'));
});
test('already-aborted requests never authenticate', async () => {
  const controller = new AbortController(); controller.abort(); const h = harness();
  assert.equal((await h.run('verify', { signal: controller.signal })).status, 503); assert.deepEqual(names(h), []);
});

test('versioned source proof uses only v2 methods and preserves the selected model', async () => {
  for (const contentModelVersion of [1, 2]) {
    const versioned = state => ({ ...receipt(state), version: 2, content_model_version: contentModelVersion });
    const h = harness({ contentModelVersion,
      get: () => assert.fail('v1 get fallback'), claim: () => assert.fail('v1 claim fallback'),
      record: () => assert.fail('v1 record fallback'),
      getV2: async () => versioned(),
      claimV2: async () => ({ ...versioned('verifying'), verification_claim_id: claimId,
        verification_claim_expires_at: '2030-01-01T00:02:00Z' }),
      recordV2: async () => versioned('verified') });
    const result = await h.run();
    assert.equal(result.status, 200);
    assert.equal(result.body.attestation.content_model_version, contentModelVersion);
    assert.deepEqual(names(h), ['getUser', 'getV2', 'newId', 'claimV2', 'openStream',
      'openStream', 'recordV2']);
    const getArgs = h.calls.find(call => call.name === 'getV2').args;
    assert.deepEqual(getArgs.slice(0, 3), [actor, sourceId, contentModelVersion]);
    assert.equal(getArgs[3] instanceof AbortSignal, true);
    assert.deepEqual(h.calls.find(call => call.name === 'claimV2').args.slice(0, 4),
      [actor, sourceId, claimId, contentModelVersion]);
    assert.deepEqual(h.calls.find(call => call.name === 'recordV2').args.slice(0, 4),
      [actor, sourceId, claimId, versioned('verified').objects]);
    assert.equal(h.calls.find(call => call.name === 'recordV2').args[4], contentModelVersion);
  }
});

test('versioned source proof rejects missing or switched model receipts and maps SG003', async () => {
  for (const value of [receipt(), { ...receipt(), version: 2, content_model_version: 2 }]) {
    const h = harness({ contentModelVersion: 1, getV2: async () => value,
      get: () => assert.fail('v1 fallback') });
    assert.equal((await h.run()).status, 502);
    assert.ok(!names(h).includes('claimV2'));
  }
  const h = harness({ contentModelVersion: 1,
    getV2: async () => { throw Object.assign(new Error('private'), { code: 'SG003' }); } });
  const result = await h.run();
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'SG003');
});
