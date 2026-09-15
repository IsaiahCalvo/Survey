import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentPageReplacementClient }
  from '../src/services/documentPageReplacementClient.js';
import { createDocumentPageReplacementIntentStore }
  from '../src/services/documentPageReplacementIntentStore.js';
import { createDocumentPageReplacementTransport }
  from '../src/services/documentPageReplacementTransport.js';

const id = n => `aa100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorUserId = id(1), documentId = id(2), generationId = id(3), nextGenerationId = id(4);
const localPageState = () => ({ items: {}, annotations: {}, pageNames: {}, bookmarks: [],
  pageTransformations: {}, activeSpaceId: null, regionOverlayDisabled: new Map() });

function published(body) {
  return { version: 4, content_model_version: 2, aggregate_admission_version: 1,
    offered_archive_operation_ids: [...body.archive_operation_ids],
    used_archive_operation_ids: [body.archive_operation_ids[0]], legacy_sidecar_migration: null,
    state: 'published', document_id: body.document_id, source_id: body.source_id,
    candidate_operation_id: body.candidate_operation_id,
    archive_operation_ids: [...body.archive_operation_ids],
    previous_generation_id: body.generation_id, generation_id: nextGenerationId,
    wal_head: body.wal_head, published_at: '2026-09-15T12:00:00.000Z' };
}

test('normal HTTP transport drives the saved request through reacquire, retire and install', async t => {
  const events = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    events.push(['request', body.document_id, options.headers.Authorization, options.signal]);
    assert.equal(url, '/api/document-replacement');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return Response.json({ replacement: published(body) });
  };
  const transport = createDocumentPageReplacementTransport({ fetch: fetcher });
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const client = createDocumentPageReplacementClient({ store, transport,
    getActorUserId: () => actorUserId,
    isCurrent: scope => scope.actorUserId === actorUserId && scope.documentId === documentId,
    getAccessToken: async ({ actorUserId: actor, signal }) => {
      assert.equal(actor, actorUserId); assert.equal(signal.aborted, false); return 'current-token';
    },
    reacquire: async ({ documentId: requested, signal }) => {
      events.push(['reacquire', requested, signal]);
      return { mode: 'checked', actorUserId, documentId,
        checkedBundle: { pdfGenerationId: nextGenerationId, contentModelVersion: 2 } };
    } });
  const controller = new AbortController();
  const result = await client.replace({ documentId, currentGenerationId: generationId,
    contentModelVersion: 2, operation: { type: 'duplicate', page: 1 },
    localPageState: localPageState(), persistSourceLocalState: async () => events.push(['persist']),
    captureAccepted: async () => ({ version: 1, actorUserId, documentId,
      pdfGenerationId: generationId, coveredSeq: 7, contentModelVersion: 2 }),
    revalidateCapture: async () => true,
    retireGeneration: async value => events.push(['retire', value.replacementGenerationId]),
    install: async value => { events.push(['install', value.checkedBundle.pdfGenerationId]); return true; },
    signal: controller.signal });
  assert.equal(result.checkedBundle.pdfGenerationId, nextGenerationId);
  assert.deepEqual(events.map(event => event[0]),
    ['persist', 'request', 'reacquire', 'retire', 'install']);
  assert.ok(events[1][3] instanceof AbortSignal);
  assert.equal(events[1][3].aborted, false);
  assert.equal(await store.get(actorUserId, documentId), null);
});

test('offline and aborted calls fail once without cookies or fallback', async () => {
  let fetches = 0;
  const transport = createDocumentPageReplacementTransport({
    fetch: async () => { fetches += 1; throw new Error('offline private detail'); },
  });
  const body = { document_id: documentId };
  await assert.rejects(transport({ body, accessToken: 'private-token',
    signal: new AbortController().signal }), error => error.code === 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE'
      && !error.message.includes('private-token') && !error.message.includes('private detail'));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(transport({ body, accessToken: 'private-token', signal: aborted.signal }),
    { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  assert.equal(fetches, 1);
});

test('transport rejects coercible non-string bearer values before fetch', async () => {
  let fetches = 0;
  const transport = createDocumentPageReplacementTransport({ fetch:async () => {
    fetches++; return Response.json({});
  } });
  for (const accessToken of [['token'], { toString:() => 'token' }]) {
    await assert.rejects(transport({ body:{ document_id:documentId }, accessToken,
      signal:new AbortController().signal }), { code:'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  }
  assert.equal(fetches, 0);
});

test('transport is pinned to the existing app origin and one fixed route', async () => {
  const calls = [];
  const transport = createDocumentPageReplacementTransport({
    fetch: async (url, options) => { calls.push([url, options]); return Response.json({}); },
  });
  const signal = new AbortController().signal;
  await transport({ body: { document_id: documentId }, accessToken: 'token', signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/document-replacement');
  assert.deepEqual(calls[0][1].headers, {
    Authorization: 'Bearer token', 'Content-Type': 'application/json',
  });
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].redirect, 'error');
  for (const forbidden of [
    { endpoint: 'https://evil.example' }, { appOrigin: 'https://evil.example' },
    { supabaseUrl: 'https://evil.example', publicKey: 'key' },
  ]) assert.throws(() => createDocumentPageReplacementTransport({
    ...forbidden, fetch: async () => Response.json({}),
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
});
