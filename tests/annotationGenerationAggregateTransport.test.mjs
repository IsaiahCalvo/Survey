import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAnnotationGenerationAggregateTransport } from '../src/services/annotationGenerationAggregateTransport.js';

const documentId = 'ad000000-0000-4000-8000-000000000001';
const generationId = 'ad000000-0000-4000-8000-000000000002';
const actorUserId = 'ad000000-0000-4000-8000-000000000003';
const update = Uint8Array.of(1, 2, 3);
const digest = createHash('sha256').update(update).digest('hex');
const receipt = {
  version: 1,
  status: 'accepted',
  document_id: documentId,
  generation_id: generationId,
  content_model_version: 2,
  actor_user_id: actorUserId,
  client_id: 'writer',
  client_seq: '1',
  seq: '9',
  data_sha256: digest,
};
const currentGenerationId = 'ad000000-0000-4000-8000-000000000004';
const receiptV2 = { ...receipt, version: 2, current_generation_id: currentGenerationId,
  is_current: false };
const input = overrides => ({ documentId, generationId, contentModelVersion: 2,
  actorUserId, writerId: 'writer', clientSeq: '1', update: new Uint8Array(update), ...overrides });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
});

test('submits one owned binary request and returns a sealed receipt proof', async () => {
  let call;
  const transport = createAnnotationGenerationAggregateTransport({ request: async value => {
    call = value;
    return json({ result: receipt });
  } });
  const submitted = input();
  const pending = transport.submit(submitted);
  submitted.update.fill(0);
  submitted.writerId = 'changed';
  const result = await pending;
  assert.deepEqual(result, { documentId, generationId, contentModelVersion: 2, actorUserId,
    writerId: 'writer', clientSeq: '1', seq: '9', updateSha256: digest });
  assert.equal(Object.isFrozen(result), true);
  assert.ok(call.body instanceof Blob);
  assert.equal(call.body.type, 'application/octet-stream');
  assert.deepEqual(new Uint8Array(await call.body.arrayBuffer()), update);
  assert.equal(new URL(`https://unit.invalid/${call.functionName}`).searchParams.has('actor_user_id'), false);
});

test('explicit receipt v2 returns locked current-generation observation without changing v1 default', async () => {
  let call;
  const transport = createAnnotationGenerationAggregateTransport({ receiptVersion: 2,
    request: async value => { call = value; return json({ result: receiptV2 }); } });
  const result = await transport.submit(input());
  assert.deepEqual(result, { documentId, generationId, contentModelVersion: 2, actorUserId,
    writerId: 'writer', clientSeq: '1', seq: '9', updateSha256: digest,
    currentGenerationId, isCurrent: false });
  assert.equal(new URL(`https://unit.invalid/${call.functionName}`).searchParams.get('receipt_version'), '2');
  let v1Call;
  const explicitV1 = createAnnotationGenerationAggregateTransport({ receiptVersion: 1,
    request: async value => { v1Call = value; return json({ result: receipt }); } });
  const v1Result = await explicitV1.submit(input());
  assert.equal(new URL(`https://unit.invalid/${v1Call.functionName}`).searchParams.has('receipt_version'), false);
  assert.equal(Object.hasOwn(v1Result, 'currentGenerationId'), false);
  await assert.rejects(async () => createAnnotationGenerationAggregateTransport({ request: async () => {},
    receiptVersion: 3 }), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
  for (const bad of [null, undefined]) {
    await assert.rejects(async () => createAnnotationGenerationAggregateTransport({
      request: async () => {}, receiptVersion: bad,
    }), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
  }
  await assert.rejects(async () => createAnnotationGenerationAggregateTransport({ request: async () => {},
    receiptVersion: 2, extra: true }), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
});

test('the immutable request body cannot be changed through a returned buffer', async () => {
  let firstRead;
  const transport = createAnnotationGenerationAggregateTransport({ request: async call => {
    firstRead = new Uint8Array(await call.body.arrayBuffer());
    firstRead.fill(0);
    assert.deepEqual(new Uint8Array(await call.body.arrayBuffer()), update);
    return json({ result: receipt });
  } });
  const result = await transport.submit(input());
  assert.equal(result.updateSha256, digest);
});

test('rejects noncanonical input and oversized response bodies before accepting proof', async () => {
  let calls = 0;
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
    calls += 1;
    return json({ result: receipt });
  } });
  await assert.rejects(transport.submit(input({ clientSeq: '01' })), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
  assert.equal(calls, 0);
  const tooLarge = createAnnotationGenerationAggregateTransport({ request: async () => new Response(
    JSON.stringify({ result: receipt, padding: 'x'.repeat(17 * 1024) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ) });
  await assert.rejects(tooLarge.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
});

test('maps semantic errors without exposing provider text or retrying', async () => {
  const cases = [
    [409, 'annotation_generation_capacity', 'SG004'],
    [409, 'maintenance_required', 'ANNOTATION_AGGREGATE_WORK_LIMIT'],
    [401, 'unauthorized', 'ANNOTATION_ACTOR_MISMATCH'],
  ];
  for (const [status, publicCode, localCode] of cases) {
    let calls = 0;
    const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
      calls += 1;
      return json({ error: { code: publicCode, message: 'provider detail' } }, status);
    } });
    await assert.rejects(transport.submit(input()), error => {
      assert.equal(error.code, localCode);
      assert.equal(error.message.includes('provider detail'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('rejects a semantic error on the wrong HTTP status', async () => {
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => json({
    error: { code: 'annotation_generation_capacity', message: 'wrong status' },
  }, 413) });
  await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
});

test('rejects an ill-formed writer before URL encoding or network work', async () => {
  let calls = 0;
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
    calls += 1;
    return json({ result: receipt });
  } });
  await assert.rejects(transport.submit(input({ writerId: 'bad\ud800writer' })), {
    code: 'ANNOTATION_AGGREGATE_PROTOCOL',
  });
  assert.equal(calls, 0);
});

test('rejects a proxy typed array as protocol input without leaking a TypeError', async () => {
  let calls = 0;
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
    calls += 1;
    return json({ result: receipt });
  } });
  await assert.rejects(transport.submit(input({ update: new Proxy(Uint8Array.of(1), {}) })), {
    code: 'ANNOTATION_AGGREGATE_PROTOCOL',
  });
  assert.equal(calls, 0);
});

test('abort settles a hanging request and seals its late response', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => {
    await gate;
    return json({ result: receipt });
  } });
  const pending = transport.submit(input({ signal: controller.signal }));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  release();
});

test('sanitizes a failed response stream and bounds content length before conversion', async () => {
  const failedStream = new ReadableStream({ pull(controller) { controller.error(new Error('provider detail')); } });
  const failed = createAnnotationGenerationAggregateTransport({ request: async () => new Response(failedStream, {
    status: 200, headers: { 'content-type': 'application/json' },
  }) });
  await assert.rejects(failed.submit(input()), { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  const longLength = createAnnotationGenerationAggregateTransport({ request: async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json', 'content-length': '9'.repeat(100) },
  }) });
  await assert.rejects(longLength.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
});

test('does not trust provider stream errors that spoof internal transport codes', async () => {
  for (const spoofedCode of ['ANNOTATION_AGGREGATE_PROTOCOL', 'ANNOTATION_AGGREGATE_UNCONFIRMED']) {
    const stream = new ReadableStream({ pull(controller) {
      controller.error(Object.assign(new Error('synthetic-private-provider-detail'), { code: spoofedCode }));
    } });
    const transport = createAnnotationGenerationAggregateTransport({ request: async () => new Response(stream, {
      status: 200, headers: { 'content-type': 'application/json' },
    }) });
    await assert.rejects(transport.submit(input()), error => {
      assert.equal(error.code, 'ANNOTATION_AGGREGATE_UNCONFIRMED');
      assert.equal(error.message.includes('synthetic-private-provider-detail'), false);
      return true;
    });
  }
});

test('cancels a response body when its metadata is invalid', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull() {},
    cancel() { cancelled = true; },
  });
  const transport = createAnnotationGenerationAggregateTransport({ request: async () => new Response(body, {
    status: 200, headers: { 'content-type': 'text/plain' },
  }) });
  await assert.rejects(transport.submit(input()), { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
  assert.equal(cancelled, true);
});
