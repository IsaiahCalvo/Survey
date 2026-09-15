import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentPageReplacementClient } from '../src/services/documentPageReplacementClient.js';

const actorUserId = '71000000-0000-4000-8000-000000000001';
const documentId = '71000000-0000-4000-8000-000000000002';
const sourceGenerationId = '71000000-0000-4000-8000-000000000003';
const targetGenerationId = '71000000-0000-4000-8000-000000000004';

function clientWith(overrides = {}) {
  const calls = [];
  const store = Object.fromEntries([
    'get', 'reserve', 'discardPending', 'markDispatched', 'markPublished',
    'markExpired', 'resetExpired', 'finish',
  ].map(name => [name, async () => { calls.push(name); return null; }]));
  const client = createDocumentPageReplacementClient({
    store,
    transport: async () => { calls.push('transport'); throw new Error('unused'); },
    reacquire: async () => { calls.push('reacquire'); throw new Error('unused'); },
    getActorUserId: () => actorUserId,
    getAccessToken: async () => 'token',
    isCurrent: () => true,
    ...overrides,
  });
  return { client, store, calls };
}

const runInput = contentModelVersion => ({
  documentId,
  contentModelVersion,
  currentGenerationId: sourceGenerationId,
  operation: { type: 'rotate', page: 1, delta: 90 },
  localPageState: {},
  captureAccepted: async () => { throw new Error('capture must not run'); },
  revalidateCapture: async () => true,
  retireGeneration: async () => {},
  install: async () => true,
  persistSourceLocalState: async () => {},
});

test('model-2 page replacement is supported only through an explicit model-bound capture', async () => {
  const { client, calls } = clientWith();
  await assert.rejects(client.replace(runInput(2)), {
    code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE',
  });
  assert.deepEqual(calls, ['get']);
  calls.length = 0;
  assert.deepEqual(await client.resume(runInput(2)), { recoveredPrior:false,noIntent:true });
  assert.deepEqual(calls, ['get']);
});

test('a model-2 accepted capture cannot enter the legacy intent path when the caller omits its model', async () => {
  const { client, calls } = clientWith();
  await assert.rejects(client.replace({
    ...runInput(undefined),
    captureAccepted: async () => ({
      version: 1, contentModelVersion: 2, actorUserId, documentId,
      pdfGenerationId: sourceGenerationId, coveredSeq: 1,
      annotationState: { contentModelVersion: 2 },
    }),
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  assert.deepEqual(calls, ['get'], 'capture mismatch fails before durable ID reserve');
});

test('contradictory legacy and model-2 capture fields fail before reserve', async () => {
  const { client, calls } = clientWith();
  await assert.rejects(client.replace({
    ...runInput(undefined),
    captureAccepted: async () => ({
      version: 1, contentModelVersion: 1, actorUserId, documentId,
      pdfGenerationId: sourceGenerationId, coveredSeq: 1,
      annotationState: { contentModelVersion: 2 },
    }),
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
  assert.deepEqual(calls, ['get']);
});

test('a legacy replacement cannot install a returned model-2 generation', async () => {
  const { client, store, calls } = clientWith({
    reacquire: async () => {
      calls.push('reacquire');
      return {
        mode: 'checked', actorUserId, documentId,
        checkedBundle: { pdfGenerationId: targetGenerationId, contentModelVersion: 2 },
      };
    },
  });
  store.get = async () => ({
    revision: 1,
    phase: 'published',
    body: { generation_id: sourceGenerationId, operation: { type: 'rotate', page: 1, delta: 90 } },
    publication: { generation_id: targetGenerationId },
    localPageState: {},
  });
  let installed = 0;
  await assert.rejects(client.resume({
    ...runInput(1),
    install: async () => { installed += 1; return true; },
  }), { code: 'DOCUMENT_PAGE_REPLACEMENT_STALE' });
  assert.equal(installed, 0);
  assert.deepEqual(calls, ['reacquire']);
});
