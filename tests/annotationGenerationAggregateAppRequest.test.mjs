import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAnnotationGenerationAggregateTransport }
  from '../src/services/annotationGenerationAggregateTransport.js';
import { createAnnotationGenerationAggregateAppRequest }
  from '../src/services/annotationGenerationAggregateAppRequest.js';

const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const actorUserId = id(1), documentId = id(2), generationId = id(3);
const update = new Uint8Array([1, 3, 5, 7]);
const sha = value => createHash('sha256').update(value).digest('hex');

function receipt() {
  return { result: { version: 2, status: 'accepted', actor_user_id: actorUserId,
    document_id: documentId, generation_id: generationId, content_model_version: 2,
    client_id: 'writer-a', client_seq: '1', seq: '9', data_sha256: sha(update),
    current_generation_id: generationId, is_current: true } };
}

function fixture(overrides = {}) {
  let token = 'token-one';
  const fetchCalls = [];
  const client = { auth: { getSession: async () => ({ data: { session: {
    user: { id: actorUserId }, access_token: token,
  } }, error: null }) } };
  const fetcher = async (url, options) => {
    fetchCalls.push({ url, options });
    return Response.json(receipt());
  };
  const request = createAnnotationGenerationAggregateAppRequest({ actorUserId, documentId,
    client, supabaseUrl: 'https://survey.supabase.co', publicKey: 'public-anon-key',
    fetch: fetcher, ...overrides });
  const transport = createAnnotationGenerationAggregateTransport({ receiptVersion: 2, request });
  return { client, fetchCalls, request, transport, setToken(value) { token = value; } };
}

const input = signal => ({ actorUserId, documentId, generationId, contentModelVersion: 2,
  writerId: 'writer-a', clientSeq: '1', update, signal });

test('app request composes with the checked builder and reads the current bearer for each call', async () => {
  const h = fixture();
  const firstSignal = new AbortController().signal;
  assert.equal((await h.transport.submit(input(firstSignal))).seq, '9');
  h.setToken('token-two');
  const secondSignal = new AbortController().signal;
  assert.equal((await h.transport.submit(input(secondSignal))).seq, '9');
  assert.equal(h.fetchCalls.length, 2);
  assert.deepEqual(h.fetchCalls.map(call => call.options.headers.Authorization),
    ['Bearer token-one', 'Bearer token-two']);
  for (const [index, call] of h.fetchCalls.entries()) {
    const url = new URL(call.url);
    assert.equal(url.origin, 'https://survey.supabase.co');
    assert.equal(url.pathname, '/functions/v1/annotation-generation-aggregate');
    assert.equal(url.searchParams.get('document_id'), documentId);
    assert.equal(url.searchParams.get('receipt_version'), '2');
    assert.equal(call.options.headers.apikey, 'public-anon-key');
    assert.equal(call.options.headers['Content-Type'], 'application/octet-stream');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error');
    assert.strictEqual(call.options.signal, index === 0 ? firstSignal : secondSignal);
    assert.deepEqual(new Uint8Array(await call.options.body.arrayBuffer()), update);
  }
});

test('actor and document binding fail closed before fetch', async () => {
  const h = fixture();
  h.client.auth.getSession = async () => ({ data: { session: {
    user: { id: id(9) }, access_token: 'do-not-send',
  } } });
  await assert.rejects(h.transport.submit(input(new AbortController().signal)), {
    code: 'ANNOTATION_AGGREGATE_UNCONFIRMED',
  });
  const badDocument = fixture();
  const call = { functionName: `annotation-generation-aggregate?document_id=${id(9)}&generation_id=${generationId}`
    + '&content_model_version=2&client_id=writer-a&client_seq=1&receipt_version=2',
  body: new Blob([update], { type: 'application/octet-stream' }),
  headers: { 'Content-Type': 'application/octet-stream' }, signal: new AbortController().signal };
  await assert.rejects(badDocument.request(call), { code: 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT' });
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(badDocument.fetchCalls.length, 0);
});

test('accessor-backed body, query and headers fail before session lookup or fetch', async () => {
  for (const field of ['body', 'functionName', 'headers']) {
    let sessions = 0;
    let fetches = 0;
    const request = createAnnotationGenerationAggregateAppRequest({ actorUserId, documentId,
      client: { auth: { getSession: async () => { sessions += 1; return { data: { session: {
        user: { id: actorUserId }, access_token: 'never-used-token',
      } } }; } } },
      supabaseUrl: 'https://survey.supabase.co', publicKey: 'public-anon-key',
      fetch: async () => { fetches += 1; return Response.json(receipt()); } });
    const values = {
      functionName: `annotation-generation-aggregate?document_id=${documentId}&generation_id=${generationId}`
        + '&content_model_version=2&client_id=writer-a&client_seq=1&receipt_version=2',
      body: new Blob([update], { type: 'application/octet-stream' }),
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: new AbortController().signal,
    };
    let reads = 0;
    Object.defineProperty(values, field, { enumerable: true, get() {
      reads += 1;
      if (field === 'body' && reads > 1) return new Blob(['bad'], { type: 'text/plain' });
      if (field === 'functionName' && reads > 1) return 'https://attacker.invalid/steal';
      if (field === 'headers' && reads > 1) return { Authorization: 'Bearer stolen' };
      return field === 'body' ? new Blob([update], { type: 'application/octet-stream' })
        : field === 'functionName' ? `annotation-generation-aggregate?document_id=${documentId}&generation_id=${generationId}`
          + '&content_model_version=2&client_id=writer-a&client_seq=1&receipt_version=2'
          : { 'Content-Type': 'application/octet-stream' };
    } });
    await assert.rejects(request(values), { code: 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT' });
    assert.equal(reads, 0, `${field} getter must not run`);
    assert.equal(sessions, 0, `${field} getter reached auth`);
    assert.equal(fetches, 0, `${field} getter reached fetch`);
  }

  let headerReads = 0;
  const headers = {};
  Object.defineProperty(headers, 'Content-Type', { enumerable: true, get() {
    headerReads += 1;
    return 'application/octet-stream';
  } });
  const h = fixture();
  await assert.rejects(h.request({
    functionName: `annotation-generation-aggregate?document_id=${documentId}&generation_id=${generationId}`
      + '&content_model_version=2&client_id=writer-a&client_seq=1&receipt_version=2',
    body: new Blob([update], { type: 'application/octet-stream' }), headers,
    signal: new AbortController().signal,
  }), { code: 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT' });
  assert.equal(headerReads, 0, 'header getter must not run');
  assert.equal(h.fetchCalls.length, 0);
});

test('abort during session lookup reaches no fetch and does not reveal the token', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const h = fixture({ client: { auth: { getSession: () => held } } });
  const controller = new AbortController();
  const pending = h.transport.submit(input(controller.signal));
  controller.abort();
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'ANNOTATION_AGGREGATE_UNCONFIRMED');
    assert.equal(error.message.includes('secret-token'), false);
    return true;
  });
  release({ data: { session: { user: { id: actorUserId }, access_token: 'secret-token' } } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.fetchCalls.length, 0);
});

test('abort during fetch passes through and cancels a late response body', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let cancelled = 0;
  const h = fixture({ fetch: () => held });
  const controller = new AbortController();
  const pending = h.transport.submit(input(controller.signal));
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { code: 'ANNOTATION_AGGREGATE_UNCONFIRMED' });
  release({ body: { cancel: async () => { cancelled += 1; } } });
  for (let attempt = 0; attempt < 20 && cancelled === 0; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(cancelled, 1);
});

test('transport errors are generic, make one attempt, and have no fallback', async () => {
  let calls = 0;
  const h = fixture({ fetch: async () => {
    calls += 1;
    throw new Error('provider failed with Bearer secret-token');
  } });
  await assert.rejects(h.transport.submit(input(new AbortController().signal)), error => {
    assert.equal(error.code, 'ANNOTATION_AGGREGATE_UNCONFIRMED');
    assert.equal(error.message.includes('secret-token'), false);
    return true;
  });
  assert.equal(calls, 1);
});
