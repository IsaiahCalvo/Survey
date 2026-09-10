import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { createAnnotationGenerationAggregateTransport } from '../src/services/annotationGenerationAggregateTransport.js';
import { handleAnnotationGenerationAggregate } from '../supabase/functions/annotation-generation-aggregate/handler.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { initializeSurveyCrdtV2, updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const id = n => `ad000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(1), generationId = id(2), actorUserId = id(3), writerId = 'writer-a';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function validFixture() {
  const doc = createDetachedYDoc('aggregate-transport');
  initializeSurveyCrdtV2(doc, { surveyMarkers: {}, spaces: [] });
  const baseline = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc);
  updateSurveyMarkersV2(doc, markers => ({ ...markers, one: { annotationId: 'one', pageNumber: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: {}, note: 'owned' } }), { origin: 'test' });
  const update = Y.encodeStateAsUpdate(doc, vector); doc.destroy(); return { baseline, update };
}
const { baseline, update } = validFixture();
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const publicReceipt = (overrides = {}) => ({ version: 1, status: 'accepted', document_id: documentId,
  generation_id: generationId, content_model_version: 2, actor_user_id: actorUserId,
  client_id: writerId, client_seq: '1', seq: '7', data_sha256: sha(update), ...overrides });
const publicReceiptV2 = (overrides = {}) => ({ ...publicReceipt(), version: 2,
  current_generation_id: generationId, is_current: true, ...overrides });
const ok = value => new Response(JSON.stringify({ result: value }), { status: 200,
  headers: { 'content-type': 'application/json' } });
const errorResponse = (code, reason) => new Response(JSON.stringify({ error: { code, message: 'safe',
  ...(reason ? { reason } : {}) } }), { status: 409,
  headers: { 'content-type': 'application/json' } });
const input = changes => ({ documentId, generationId, contentModelVersion: 2, actorUserId, writerId, clientSeq: '1',
  update: new Uint8Array(update), ...changes });

test('submits owned binary bytes to the strict handler route and returns acceptance proof only', async () => {
  let call;
  const transport = createAnnotationGenerationAggregateTransport({ request: async value => { call = value; return ok(publicReceipt()); } });
  const result = await transport.submit(input());
  assert.deepEqual(result, { documentId, generationId, contentModelVersion: 2, actorUserId,
    writerId, clientSeq: '1', seq: '7', updateSha256: sha(update) });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.hasOwn(result, 'isCurrent'), false); assert.equal(Object.hasOwn(result, 'currentGenerationId'), false);
  const url = new URL(`https://local.invalid/${call.functionName}`);
  assert.equal(url.pathname.endsWith('/annotation-generation-aggregate'), true);
  assert.deepEqual(Object.fromEntries(url.searchParams), { document_id: documentId, generation_id: generationId,
    content_model_version: '2', client_id: writerId, client_seq: '1' });
  assert.equal(call.headers['Content-Type'], 'application/octet-stream');
  assert.ok(call.body instanceof Blob); assert.equal(call.body.type, 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await call.body.arrayBuffer()), update);
  assert.equal(call.body.size, update.byteLength); assert.equal(url.searchParams.has('actor_user_id'), false);
});

test('receipt v2 is explicit, adds one unique query field, and returns generation identity without access authority', async () => {
  let call;
  const transport = createAnnotationGenerationAggregateTransport({ receiptVersion: 2,
    request: async value => { call = value; return ok(publicReceiptV2()); } });
  const result = await transport.submit(input());
  assert.equal(result.currentGenerationId, generationId); assert.equal(result.isCurrent, true);
  assert.equal(Object.hasOwn(result, 'writeAuthorized'), false); assert.equal(Object.isFrozen(result), true);
  const params = new URLSearchParams(call.functionName.slice(call.functionName.indexOf('?') + 1));
  assert.deepEqual(params.getAll('receipt_version'), ['2']);
});

test('default and explicit v1 remain exact and never accept or request v2 fields', async () => {
  for (const options of [{}, { receiptVersion: 1 }]) {
    let call; const transport = createAnnotationGenerationAggregateTransport({ ...options,
      request: async value => { call = value; return ok(publicReceipt()); } });
    const result = await transport.submit(input());
    assert.equal(Object.hasOwn(result, 'isCurrent'), false);
    assert.equal(call.functionName.includes('receipt_version'), false);
  }
});

test('bad receipt versions and unknown factory fields fail before any request', async () => {
  for (const options of [{ receiptVersion: null }, { receiptVersion: undefined },
    { receiptVersion: 0 }, { receiptVersion: 3 }, { receiptVersion: '2' },
    { receiptVersion: 2, extra: true }]) {
    let calls = 0;
    assert.throws(() => createAnnotationGenerationAggregateTransport({ request: async () => { calls++; }, ...options }),
      { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
    assert.equal(calls, 0);
  }
});

test('v1 rejects a v2 response rather than inferring or stripping current metadata', async () => {
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => ok(publicReceiptV2()) });
  await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
});

test('v2 rejects contradictory current identity and never downgrades to v1', async () => {
  for (const receipt of [publicReceiptV2({ is_current: false }), publicReceiptV2({ current_generation_id: id(9) }),
    publicReceiptV2({ current_generation_id: null }), publicReceiptV2({ is_current: 'true' }), publicReceipt()]) {
    let calls = 0; const transport = createAnnotationGenerationAggregateTransport({ receiptVersion: 2,
      request: async () => { calls++; return ok(receipt); } });
    await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
    assert.equal(calls, 1);
  }
  for (const receipt of [publicReceiptV2({ current_generation_id: id(9), is_current: false }),
    publicReceiptV2({ current_generation_id: null, is_current: false })]) {
    const transport = createAnnotationGenerationAggregateTransport({ receiptVersion: 2, request: async () => ok(receipt) });
    const result = await transport.submit(input()); assert.equal(result.isCurrent, false);
    assert.equal(result.currentGenerationId, receipt.current_generation_id);
  }
});

test('captures caller bytes and identity before the request await', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let call;
  const transport = createAnnotationGenerationAggregateTransport({ request: async value => { call = value; await gate; return ok(publicReceipt()); } });
  const submitted = input(), pending = transport.submit(submitted);
  submitted.update.fill(0); submitted.writerId = 'mutated'; submitted.clientSeq = '9';
  release(); const result = await pending;
  assert.deepEqual(new Uint8Array(await call.body.arrayBuffer()), update); assert.equal(result.updateSha256, sha(update));
});

test('buffers read from the immutable request Blob cannot change later reads or receipt identity', async () => {
  let call;
  const transport = createAnnotationGenerationAggregateTransport({ request: async value => { call = value; return ok(publicReceipt()); } });
  const result = await transport.submit(input());
  const first = new Uint8Array(await call.body.arrayBuffer()); first.fill(0);
  assert.deepEqual(new Uint8Array(await call.body.arrayBuffer()), update);
  assert.equal(result.updateSha256, sha(update));
});

test('rejects malformed or mismatched receipts without retry or fallback', async () => {
  for (const change of [{ document_id: id(9) }, { generation_id: id(9) }, { actor_user_id: id(9) },
    { client_id: 'other' }, { client_seq: '2' }, { seq: '0' }, { data_sha256: 'f'.repeat(64) },
    { extra: true }]) {
    let calls = 0; const transport = createAnnotationGenerationAggregateTransport({ request: async () => { calls++; return ok(publicReceipt(change)); } });
    await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
    assert.equal(calls, 1);
  }
});

test('capacity and maintenance errors remain typed and never retry', async () => {
  for (const [code, mapped, reason] of [['annotation_generation_capacity', 'SG004', null],
    ['maintenance_required', 'ANNOTATION_AGGREGATE_WORK_LIMIT', null],
    ['maintenance_required', 'ANNOTATION_AGGREGATE_WORK_LIMIT', 'aggregate-input-bytes']]) {
    let calls = 0; const transport = createAnnotationGenerationAggregateTransport({ request: async () => { calls++;
      return errorResponse(code, reason); } });
    await assert.rejects(transport.submit(input()), error => error.code === mapped
      && (reason === null || error.reason === reason)); assert.equal(calls, 1);
  }
});

test('pre-abort makes no request; in-flight abort is passed through and seals a late success', async () => {
  const pre = new AbortController(); pre.abort(); let preCalls = 0;
  const preTransport = createAnnotationGenerationAggregateTransport({ request: async () => { preCalls++; return ok(publicReceipt()); } });
  await assert.rejects(preTransport.submit(input({ signal: pre.signal })), { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  assert.equal(preCalls, 0);
  let release, start, observedSignal; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { start = resolve; });
  const transport = createAnnotationGenerationAggregateTransport({ request: async value => {
    observedSignal = value.signal; start(); await gate; return ok(publicReceipt()); } });
  const controller = new AbortController(), pending = transport.submit(input({ signal: controller.signal }));
  await started; controller.abort(); release();
  await assert.rejects(pending, { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  assert.equal(observedSignal.aborted, true);
});

function composedRequest({ loseFirstReply = false, receiptVersion = 1, currentGenerationId = generationId,
  initiallyAccepted = false, commitSeq = '1', reprobingGenerationId = currentGenerationId,
  missingExtra = null } = {}) {
  let stored = null, calls = 0, probes = 0, checkpoints = 0, commits = 0;
  const deps = { runtimeVerified: true, timeoutMs: 2_000, getUser: async () => ({ id: actorUserId }),
    probe: async () => { probes++; const accepted = stored !== null || initiallyAccepted;
      return !accepted ? ({ version: receiptVersion, status: 'missing', document_id: documentId,
      generation_id: generationId, content_model_version: 2, actor_user_id: actorUserId,
      client_id: writerId, client_seq: '1', ...(missingExtra ?? {}) }) : (receiptVersion === 2
        ? publicReceiptV2({ accepted: true, seq: stored?.seq ?? '7',
          current_generation_id: stored ? reprobingGenerationId : currentGenerationId,
          is_current: (stored ? reprobingGenerationId : currentGenerationId) === generationId })
        : publicReceipt({ accepted: true, seq: stored?.seq ?? '7' })); },
    readFixedCheckpoint: async () => { checkpoints++; return ({ version: 1, actor_user_id: actorUserId, document_id: documentId,
      generation_id: generationId, content_model_version: 2, head: '0', base_seq: '0', checkpoint: {
        at_seq: '0', writer_id: null, writer_epoch: '0', encoding_version: 1,
        snapshot_sha256: sha(baseline), snapshot: hex(baseline) } }); },
    readFixedTailPage: async () => { throw new Error('head zero must not read tail'); },
    commit: async (_actor, value) => {
      commits++;
      stored = { version: receiptVersion, status: 'accepted', accepted: true, document_id: documentId,
        generation_id: generationId, content_model_version: 2, actor_user_id: actorUserId,
        client_id: writerId, client_seq: '1', seq: commitSeq, data_sha256: sha(update),
        ...(receiptVersion === 2 ? { current_generation_id: currentGenerationId,
          is_current: currentGenerationId === generationId } : {}),
        checkpoint_stored: value.checkpoint !== null, checkpoint: value.checkpoint === null ? null : {
          at_seq: value.checkpoint.atSeq, writer_id: 'survey-private-aggregate-v1', writer_epoch: '1',
          encoding_version: value.checkpoint.encodingVersion, snapshot_sha256: value.checkpoint.snapshotSha256 } };
      return stored;
    } };
  if (receiptVersion === 2) {
    deps.probeV2 = deps.probe; deps.commitV2 = deps.commit;
    deps.probe = async () => { throw new Error('v1 probe must not run'); };
    deps.commit = async () => { throw new Error('v1 commit must not run'); };
  }
  return { get counts() { return { calls, probes, checkpoints, commits }; }, request: async call => {
    calls++; const response = await handleAnnotationGenerationAggregate(new Request(
      `https://edge.invalid/functions/v1/${call.functionName}`, { method: 'POST', headers: {
        authorization: 'Bearer checked', ...call.headers }, body: call.body, signal: call.signal }), deps);
    if (loseFirstReply && calls === 1 && response.status === 200 && stored !== null) {
      throw new TypeError('reply lost after commit');
    }
    return response;
  } };
}

test('portable transport composes with the real handler for a new write and exact lost-reply recovery', async () => {
  const composed = composedRequest({ loseFirstReply: true });
  const transport = createAnnotationGenerationAggregateTransport({ request: composed.request });
  await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  assert.deepEqual(composed.counts, { calls: 1, probes: 1, checkpoints: 1, commits: 1 });
  const accepted = await transport.submit(input());
  assert.equal(accepted.seq, '1'); assert.equal(accepted.updateSha256, sha(update));
  assert.deepEqual(composed.counts, { calls: 2, probes: 2, checkpoints: 1, commits: 1 });
});

test('receipt v2 composes through the real handler and keeps retired identity non-authorizing', async () => {
  const replacement = id(8), composed = composedRequest({ receiptVersion: 2, currentGenerationId: replacement });
  const transport = createAnnotationGenerationAggregateTransport({ request: composed.request, receiptVersion: 2 });
  const result = await transport.submit(input());
  assert.equal(result.seq, '1'); assert.equal(result.currentGenerationId, replacement); assert.equal(result.isCurrent, false);
  assert.equal(Object.hasOwn(result, 'writeAuthorized'), false);
});

test('already accepted v2 receipts short-circuit all state reads for current, retired, and revoked same-generation cases', async () => {
  for (const currentGenerationId of [generationId, id(8), generationId]) {
    const composed = composedRequest({ receiptVersion: 2, currentGenerationId, initiallyAccepted: true });
    const transport = createAnnotationGenerationAggregateTransport({ request: composed.request, receiptVersion: 2 });
    const result = await transport.submit(input());
    assert.equal(result.currentGenerationId, currentGenerationId);
    assert.deepEqual(composed.counts, { calls: 1, probes: 1, checkpoints: 0, commits: 0 });
  }
});

test('raced v2 commit uses current metadata from the exact fresh re-probe, not the stale commit result', async () => {
  const replacement = id(9);
  const composed = composedRequest({ receiptVersion: 2, currentGenerationId: generationId,
    commitSeq: '7', reprobingGenerationId: replacement });
  const transport = createAnnotationGenerationAggregateTransport({ request: composed.request, receiptVersion: 2 });
  const result = await transport.submit(input());
  assert.equal(result.seq, '7'); assert.equal(result.currentGenerationId, replacement); assert.equal(result.isCurrent, false);
  assert.deepEqual(composed.counts, { calls: 1, probes: 2, checkpoints: 1, commits: 1 });
});

test('v2 missing receipt discloses no current-generation metadata', async () => {
  const composed = composedRequest({ receiptVersion: 2, missingExtra: {
    current_generation_id: generationId, is_current: true } });
  const transport = createAnnotationGenerationAggregateTransport({ request: composed.request, receiptVersion: 2 });
  await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  assert.deepEqual(composed.counts, { calls: 1, probes: 1, checkpoints: 0, commits: 0 });
});

test('a lost response retries only when the caller resubmits the exact key and bytes', async () => {
  let attempts = 0;
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
    attempts++; if (attempts === 1) throw new TypeError('lost reply'); return ok(publicReceipt());
  } });
  await assert.rejects(transport.submit(input()));
  const result = await transport.submit(input());
  assert.equal(result.seq, '7'); assert.equal(attempts, 2);
});

test('reserved writer characters round-trip through one unique query value without actor authority', async () => {
  const reserved = 'writer /?&=+#%'; let functionName;
  const transport = createAnnotationGenerationAggregateTransport({ request: async call => {
    functionName = call.functionName; return ok(publicReceipt({ client_id: reserved }));
  } });
  const result = await transport.submit(input({ writerId: reserved }));
  const params = new URLSearchParams(functionName.slice(functionName.indexOf('?') + 1));
  assert.deepEqual(params.getAll('client_id'), [reserved]); assert.equal(params.has('actor_user_id'), false);
  assert.equal(result.writerId, reserved);
});

test('response parsing is bounded and requires a native JSON Response', async () => {
  for (const supplied of [
    { status: 200, json: async () => ({ result: publicReceipt() }) },
    new Response(JSON.stringify({ result: publicReceipt(), padding: 'x'.repeat(17 * 1024) }), {
      status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    const transport = createAnnotationGenerationAggregateTransport({ request: async () => { calls++; return supplied; } });
    await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
    assert.equal(calls, 1);
  }
});

test('abort during a stalled response stream stays sanitized when the stream later fails privately', async () => {
  for (const spoofedCode of [undefined, 'ANNOTATION_AGGREGATE_PROTOCOL', 'ANNOTATION_AGGREGATE_UNCONFIRMED']) {
    let readStarted, failRead;
    const started = new Promise(resolve => { readStarted = resolve; });
    const body = new ReadableStream({ pull(controller) { readStarted(); return new Promise((_resolve, reject) => {
      failRead = () => { const privateError = Object.assign(new Error('synthetic-private-provider-detail'),
        ...(spoofedCode ? [{ code: spoofedCode }] : []));
        controller.error(privateError); reject(privateError); };
    }); } });
    const transport = createAnnotationGenerationAggregateTransport({ request: async () => new Response(body, {
      status: 200, headers: { 'content-type': 'application/json' } }) });
    const controller = new AbortController();
    const pending = transport.submit(input({ signal: controller.signal }));
    await started; controller.abort(); failRead();
    await assert.rejects(pending, error => error.code === 'ANNOTATION_AGGREGATE_UNCONFIRMED'
      && !JSON.stringify(error).includes('synthetic-private-provider-detail'));
  }
});
