import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { handleAnnotationGenerationAggregate } from '../supabase/functions/annotation-generation-aggregate/handler.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { initializeSurveyCrdtV2, updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const uuid = n => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uuid(1), documentId = uuid(2), generationId = uuid(3);
const token = 'verified-caller-bearer';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const doc = createDetachedYDoc('aggregate-handler-contract');
initializeSurveyCrdtV2(doc, { surveyMarkers: {}, spaces: [] });
const snapshot = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc);
updateSurveyMarkersV2(doc, markers => ({ ...markers, 'marker-a': { annotationId: 'marker-a',
  pageNumber: 1, bounds: { x: 1, y: 1, width: 2, height: 2 }, moduleId: 'module-a',
  categoryId: 'category-a', entityId: 'entity-a', entityName: 'Entity', entityColor: '#fff',
  checklistResponses: {}, note: 'valid' } }), { origin: 'test' });
const update = Y.encodeStateAsUpdate(doc, vector); doc.destroy();
const query = new URLSearchParams({ document_id: documentId, generation_id: generationId,
  content_model_version: '2', client_id: 'writer-a', client_seq: '1' });
const receipt = (overrides = {}) => ({ version: 1, status: 'accepted', document_id: documentId,
  generation_id: generationId, content_model_version: 2, actor_user_id: actor,
  client_id: 'writer-a', client_seq: '1', seq: '1', data_sha256: digest(update), ...overrides });
const rawReceipt = overrides => ({ ...receipt(), accepted: true, ...overrides });
const missing = () => ({ version: 1, status: 'missing', document_id: documentId,
  generation_id: generationId, content_model_version: 2, actor_user_id: actor,
  client_id: 'writer-a', client_seq: '1' });
const checkpoint = ({ head = '0' } = {}) => ({ version: 1, actor_user_id: actor, document_id: documentId,
  generation_id: generationId, content_model_version: 2, head, base_seq: '0',
  checkpoint: { at_seq: '0', writer_id: null, writer_epoch: '0', encoding_version: 1,
    snapshot_sha256: digest(snapshot), snapshot: hex(snapshot) } });

function harness(overrides = {}) {
  const calls = [];
  const values = {
    runtimeVerified: true, timeoutMs: 2_000,
    getUser: async () => ({ id: actor }),
    probe: async () => rawReceipt(),
    readFixedCheckpoint: async () => checkpoint(),
    readFixedTailPage: async (_token, input) => ({ version: 3,
      document_id: documentId, generation_id: generationId, content_model_version: 2,
      through_seq: input.throughSeq, rows: [], has_more: false }),
    commit: async () => receipt(), ...overrides,
  };
  const deps = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    typeof value === 'function' ? (...args) => { calls.push({ name: key, args }); return value(...args); } : value]));
  async function run({ params = query, body = update, authorization = `Bearer ${token}`, signal,
    method = 'POST', contentType = 'application/octet-stream', headers = {} } = {}) {
    const request = new Request(`https://edge.invalid/aggregate?${params}`, { method, signal,
      headers: { ...(authorization == null ? {} : { authorization }), 'content-type': contentType, ...headers },
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
      ...(method === 'POST' ? { body } : {}) });
    const response = await handleAnnotationGenerationAggregate(request, deps);
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  return { calls, deps, run };
}
const names = h => h.calls.map(call => call.name);
const stream = (size, chunk = 1024 * 1024) => { let sent = 0; return new ReadableStream({
  pull(controller) { if (sent === size) return controller.close(); const count = Math.min(chunk, size - sent);
    controller.enqueue(new Uint8Array(count)); sent += count; },
}); };

test('exact receipt is actor bound and skips aggregate reads and commit', async () => {
  const h = harness();
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { result: receipt() });
  assert.deepEqual(names(h), ['getUser', 'probe']);
  assert.equal(h.calls[0].args[0], token);
  assert.equal(h.calls[1].args[0], actor);
  assert.deepEqual(h.calls[1].args[1], { documentId, generationId, contentModelVersion: 2,
    writerId: 'writer-a', clientSeq: '1', update });
});

test('strict query, content type and bearer checks reject spoofed authority before broker work', async () => {
  const invalid = [
    { authorization: null },
    { contentType: 'application/json' },
    { params: new URLSearchParams([...query, ['actor_user_id', uuid(9)]]) },
    { params: new URLSearchParams([...query, ['document_id', documentId]]) },
    { params: new URLSearchParams({ ...Object.fromEntries(query), content_model_version: '1' }) },
  ];
  for (const options of invalid) {
    const h = harness(); const response = await h.run(options);
    assert.ok(response.status >= 400); assert.ok(names(h).every(name => name === 'getUser'));
    assert.ok(!JSON.stringify(response.body).includes(token));
  }
});

test('all three 40001 attempts reacquire receipt and fixed state before bounded failure', async () => {
  let commits = 0;
  const tailUpdate = update;
  const h = harness({ probe: async () => missing(), readFixedCheckpoint: async () => checkpoint({ head: '1' }),
    readFixedTailPage: async (_token, input) => ({ version: 3,
      document_id: documentId, generation_id: generationId, content_model_version: 2,
      through_seq: input.throughSeq, rows: [{ seq: '1', actor_user_id: actor, client_id: 'peer',
        client_seq: '1', data: hex(tailUpdate) }], has_more: false }),
    commit: async () => { commits += 1; throw Object.assign(new Error('private sql'), { code: '40001' }); } });
  const response = await h.run();
  assert.equal(response.status, 409); assert.equal(response.body.error.code, 'aggregate_changed');
  assert.equal(commits, 3);
  assert.deepEqual(names(h).filter(x => x === 'probe'), ['probe', 'probe', 'probe']);
  assert.equal(names(h).filter(x => x === 'readFixedCheckpoint').length, 3);
  assert.equal(names(h).filter(x => x === 'readFixedTailPage').length, 3);
  assert.ok(!JSON.stringify(response.body).includes('private sql'));
});

test('WORK_LIMIT and SG004 admission failures perform no commit or fallback', async () => {
  for (const [code, publicCode] of [['ANNOTATION_AGGREGATE_WORK_LIMIT', 'maintenance_required'], ['SG004', 'annotation_generation_capacity']]) {
    const h = harness({ probe: async () => missing(),
      readFixedCheckpoint: async () => { throw Object.assign(new Error('secret bytes'), { code }); } });
    const response = await h.run();
    assert.ok(response.status >= 400); assert.equal(response.body.error.code, publicCode);
    assert.equal(names(h).includes('commit'), false);
    assert.ok(!JSON.stringify(response.body).includes('secret bytes'));
  }
});

test('revocation at commit does not retry as a CAS race or expose service data', async () => {
  const h = harness({ probe: async () => missing(),
    commit: async () => { throw Object.assign(new Error('service-key SELECT'), { code: '42501' }); } });
  const response = await h.run();
  assert.equal(response.status, 403); assert.equal(response.body.error.code, 'not_permitted');
  assert.equal(names(h).filter(x => x === 'commit').length, 1);
  assert.ok(!JSON.stringify(response.body).includes('service-key'));
});

test('caller cancellation reaches the active broker call and prevents a late commit', async () => {
  let seenSignal; let release;
  const held = new Promise(resolve => { release = resolve; });
  const h = harness({ probe: async (_actor, _input, signal) => { seenSignal = signal; await held; return missing(); } });
  const controller = new AbortController();
  const pending = h.run({ signal: controller.signal });
  await Promise.race([new Promise(async resolve => { while (!seenSignal) { await new Promise(r => setImmediate(r)); } resolve(); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('probe did not start')), 1000))]);
  controller.abort(); release();
  const response = await pending;
  assert.equal(seenSignal.aborted, true); assert.ok(response.status >= 400);
  assert.equal(names(h).includes('commit'), false);
});

test('runtime-off and preflight do no authentication or broker work', async () => {
  const off = harness({ runtimeVerified: false });
  assert.equal((await off.run()).status, 503); assert.deepEqual(names(off), []);
  const preflight = harness();
  assert.equal((await preflight.run({ method: 'OPTIONS' })).status, 204); assert.deepEqual(names(preflight), []);
});

test('null, rejected, and malformed auth cannot reach a private broker', async () => {
  for (const getUser of [async () => null, async () => ({ id: 'bad' })]) {
    const h = harness({ getUser }); const response = await h.run();
    assert.equal(response.status, 401); assert.deepEqual(names(h), ['getUser']);
  }
  const outage = harness({ getUser: async () => { throw new Error('auth secret'); } });
  const response = await outage.run();
  assert.equal(response.status, 502); assert.equal(response.body.error.code, 'unconfirmed');
  assert.deepEqual(names(outage), ['getUser']); assert.ok(!JSON.stringify(response.body).includes('auth secret'));
});

test('noncanonical model and oversized decimal query values are rejected before auth', async () => {
  for (const change of [
    { content_model_version: '02' }, { content_model_version: '2e0' }, { content_model_version: ' 2' },
    { client_seq: '9223372036854775808' }, { client_seq: '9'.repeat(4096) },
  ]) {
    const params = new URLSearchParams(Object.fromEntries(query));
    for (const [key, value] of Object.entries(change)) params.set(key, value);
    const h = harness(); const response = await h.run({ params });
    assert.equal(response.status, 400); assert.deepEqual(names(h), []);
  }
});

test('accepted receipt must match every scope, key, sequence and digest field', async () => {
  const bad = [{ document_id: uuid(8) }, { generation_id: uuid(8) }, { actor_user_id: uuid(8) },
    { content_model_version: 1 }, { client_id: 'other' }, { client_seq: '2' }, { seq: '0' },
    { data_sha256: 'f'.repeat(64) }, { accepted: false }];
  for (const change of bad) {
    const h = harness({ probe: async () => rawReceipt(change) }); const response = await h.run();
    assert.ok(response.status >= 400); assert.equal(names(h).includes('commit'), false);
  }
});

test('stream byte accounting ignores a small Content-Length claim and rejects transport cap plus one', async () => {
  const h = harness(); const response = await h.run({ body: stream(64 * 1024 * 1024 + 1),
    headers: { 'content-length': '1' } });
  assert.equal(response.status, 413); assert.equal(response.body.error.code, 'transport_limit');
  assert.deepEqual(names(h), ['getUser']);
});

test('an exact historical oversized receipt succeeds before the new-row admission cap', async () => {
  const large = new Uint8Array(16 * 1024 * 1024 + 1);
  const accepted = rawReceipt({ data_sha256: digest(large) });
  const h = harness({ probe: async () => accepted });
  const response = await h.run({ body: large });
  assert.equal(response.status, 200); assert.equal(response.body.result.data_sha256, digest(large));
  assert.deepEqual(names(h), ['getUser', 'probe']);
});

test('a fresh oversized row maps SG004 and never reads aggregate state or commits', async () => {
  const large = new Uint8Array(16 * 1024 * 1024 + 1);
  const h = harness({ probe: async () => missing() });
  const response = await h.run({ body: large });
  assert.equal(response.body.error.code, 'annotation_generation_capacity');
  assert.deepEqual(names(h), ['getUser', 'probe']);
});

test('a dependency that ignores abort is bounded by handler timeout and cannot commit late', async () => {
  let resolve; const blocked = new Promise(done => { resolve = done; });
  const h = harness({ timeoutMs: 5, probe: async () => blocked });
  const response = await h.run();
  assert.ok(response.status >= 400); assert.equal(names(h).includes('commit'), false);
  resolve(rawReceipt()); await new Promise(done => setImmediate(done));
  assert.equal(names(h).includes('commit'), false);
});

test('a raced commit canonical receipt is re-probed and accepted without trusting the stale plan sequence', async () => {
  let probes = 0;
  const acceptedAtTwo = rawReceipt({ seq: '2' });
  const h = harness({
    probe: async () => (++probes === 1 ? missing() : acceptedAtTwo),
    commit: async () => ({ ...acceptedAtTwo, checkpoint_stored: false, checkpoint: null }),
  });
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { result: receipt({ seq: '2' }) });
  assert.equal(probes, 2); assert.equal(names(h).filter(name => name === 'commit').length, 1);
});

test('a raced commit is never accepted when the trusted receipt re-probe is absent or mismatched', async () => {
  for (const secondProbe of [missing(), rawReceipt({ seq: '3' }), rawReceipt({ data_sha256: 'f'.repeat(64) })]) {
    let probes = 0;
    const acceptedAtTwo = rawReceipt({ seq: '2' });
    const h = harness({
      probe: async () => (++probes === 1 ? missing() : secondProbe),
      commit: async () => ({ ...acceptedAtTwo, checkpoint_stored: false, checkpoint: null }),
    });
    const response = await h.run();
    assert.equal(response.status, 502); assert.equal(response.body.error.code, 'invalid_broker_response');
    assert.equal(probes, 2); assert.equal(names(h).filter(name => name === 'commit').length, 1);
  }
});

test('malformed fixed-tail envelopes fail before row decoding or commit', async () => {
  for (const change of [{ version: 2 }, { has_more: 'false' }, { through_seq: '2' }, { extra: true }]) {
    const h = harness({ probe: async () => missing(), readFixedCheckpoint: async () => checkpoint({ head: '1' }),
      readFixedTailPage: async () => ({ version: 3, document_id: documentId, generation_id: generationId,
        content_model_version: 2, through_seq: '1', rows: [], has_more: false, ...change }) });
    const response = await h.run();
    assert.equal(response.status, 502); assert.equal(response.body.error.code, 'invalid_broker_response');
    assert.equal(names(h).includes('commit'), false);
  }
});
