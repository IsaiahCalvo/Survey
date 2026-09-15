import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentPageReplacementClient }
  from '../src/services/documentPageReplacementClient.js';
import { createDocumentPageReplacementIntentStore }
  from '../src/services/documentPageReplacementIntentStore.js';

const id = n => `ab500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorUserId = id(1), documentId = id(2), sourceGenerationId = id(3);
const targetGenerationId = id(4), definitionDigest = 'd'.repeat(64);
const localPageState = () => ({ items: {}, annotations: {}, pageNames: {}, bookmarks: [],
  pageTransformations: {}, activeSpaceId: null, regionOverlayDisabled: new Map() });
const input = changes => ({ documentId, currentGenerationId: sourceGenerationId,
  contentModelVersion: 2, definitionRevision: '7', definitionDigest,
  operation: { type: 'duplicate', page: 1 }, localPageState: localPageState(),
  captureAccepted: async () => ({ version: 1, actorUserId, documentId,
    pdfGenerationId: sourceGenerationId, coveredSeq: 11, contentModelVersion: 2 }),
  revalidateCapture: async () => true, persistSourceLocalState: async () => {},
  retireGeneration: async () => {}, install: async () => true, ...changes });

function receipt(body, changes = {}) {
  return { version: 5, content_model_version: 2, aggregate_admission_version: 1,
    offered_archive_operation_ids: [...body.archive_operation_ids],
    used_archive_operation_ids: [body.archive_operation_ids[0]], legacy_sidecar_migration: null,
    state: 'published', document_id: body.document_id, source_id: body.source_id,
    candidate_operation_id: body.candidate_operation_id,
    archive_operation_ids: [...body.archive_operation_ids],
    definition_revision: body.definition_revision, definition_digest: body.definition_digest,
    previous_generation_id: body.generation_id, generation_id: targetGenerationId,
    wal_head: body.wal_head, published_at: '2026-09-15T12:00:00.000Z', ...changes };
}

function expired(body, changes = {}) {
  return { version: 5, aggregate_admission_version: 1,
    offered_archive_operation_ids: [...body.archive_operation_ids],
    used_archive_operation_ids: null, state: 'expired', actor_user_id: actorUserId,
    document_id: body.document_id, source_id: body.source_id,
    candidate_operation_id: body.candidate_operation_id,
    archive_operation_ids: [...body.archive_operation_ids],
    definition_revision: body.definition_revision, definition_digest: body.definition_digest,
    expected_generation_id: body.generation_id, expected_wal_head: body.wal_head,
    operation: structuredClone(body.operation), prepared_at: '2026-09-15T10:00:00.000Z',
    expires_at: '2026-09-15T12:00:00.000Z', ...changes };
}

function client(store, transport) {
  return createDocumentPageReplacementClient({ store, transport,
    getActorUserId: () => actorUserId, getAccessToken: async () => 'token',
    isCurrent: ({ actorUserId: actor, documentId: doc }) =>
      actor === actorUserId && doc === documentId,
    reacquire: async () => ({ mode: 'checked', actorUserId, documentId,
      checkedBundle: { pdfGenerationId: targetGenerationId, contentModelVersion: 2 } }) });
}

test('V5 retry persists and sends the first exact definition tuple after head drift', async t => {
  const indexedDB = new IDBFactory();
  const firstStore = createDocumentPageReplacementIntentStore({ indexedDB });
  t.after(() => firstStore.close());
  let firstBody;
  await assert.rejects(client(firstStore, async ({ body }) => {
    firstBody = structuredClone(body); throw new Error('reply lost');
  }).replace(input()), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNRESOLVED' });
  const saved = await firstStore.get(actorUserId, documentId);
  assert.equal(saved.version, 2, 'definition-bound intents use an explicit durable row contract');
  assert.equal(saved.body.definition_revision, '7');
  firstStore.close();

  const coldStore = createDocumentPageReplacementIntentStore({ indexedDB });
  t.after(() => coldStore.close());
  let retryBody;
  const result = await client(coldStore, async ({ body }) => {
    retryBody = structuredClone(body);
    return Response.json({ replacement: receipt(body) });
  }).resume(input({ definitionRevision: '8', definitionDigest: 'e'.repeat(64) }));
  assert.deepEqual(retryBody, firstBody, 'saved tuple wins over the now-current head');
  assert.equal(result.publication.definition_revision, '7');
  assert.equal(result.publication.definition_digest, definitionDigest);
});

test('intent reserve captures the validated definition pair before its IDB callback', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB:new IDBFactory() });
  t.after(() => store.close());
  const reserve = { operation:{ type:'duplicate',page:1 }, generationId:sourceGenerationId,
    walHead:'11', localPageState:localPageState(), definitionRevision:'7', definitionDigest };
  const pending = store.reserve(actorUserId, documentId, reserve);
  reserve.definitionRevision = '8';
  reserve.definitionDigest = 'e'.repeat(64);
  const { row } = await pending;
  assert.equal(row.body.definition_revision, '7');
  assert.equal(row.body.definition_digest, definitionDigest);
});

test('V5 rejects malformed pairs and any receipt definition drift without install', async t => {
  for (const changes of [
    { definitionRevision: undefined }, { definitionDigest: undefined },
    { definitionRevision: 7 }, { definitionRevision: '07' },
    { definitionRevision: '9007199254740992' }, { definitionDigest: 'D'.repeat(64) },
  ]) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    let calls = 0;
    assert.throws(() => client(store, async () => { calls++; }).replace(input(changes)),
      { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
    assert.equal(calls, 0);
    assert.equal(await store.get(actorUserId, documentId), null);
  }

  for (const changes of [
    { definition_revision: '8' }, { definition_digest: 'e'.repeat(64) },
    { version: 4 }, { extra: true },
  ]) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
    t.after(() => store.close());
    let installs = 0;
    await assert.rejects(client(store, async ({ body }) =>
      Response.json({ replacement: receipt(body, changes) })).replace(input({
        install: async () => { installs++; return true; },
      })), { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
    assert.equal(installs, 0);
    assert.equal((await store.get(actorUserId, documentId)).phase, 'dispatched');
  }
});

test('legacy replacement bodies and V4 receipts keep their old shape', async t => {
  const store = createDocumentPageReplacementIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let sent;
  const legacyInput = input();
  delete legacyInput.definitionRevision;
  delete legacyInput.definitionDigest;
  const result = await client(store, async ({ body }) => {
    sent = structuredClone(body);
    const legacy = receipt(body);
    delete legacy.definition_revision; delete legacy.definition_digest;
    legacy.version = 4;
    return Response.json({ replacement: legacy });
  }).replace(legacyInput);
  assert.equal(Object.hasOwn(sent, 'definition_revision'), false);
  assert.equal(Object.hasOwn(sent, 'definition_digest'), false);
  assert.equal(result.publication.version, 4);
});

test('V5 expiry authority binds the saved definition tuple and rejects drift', async t => {
  for (const changes of [{}, { definition_revision:'8' },
    { definition_digest:'e'.repeat(64) }, { definition_revision:7 }]) {
    const store = createDocumentPageReplacementIntentStore({ indexedDB:new IDBFactory() });
    t.after(() => store.close());
    const pending = client(store, async ({ body }) => new Response(JSON.stringify({
      error:{ code:'replacement_expired',message:'expired' }, terminal:expired(body, changes),
    }), { status:409 })).replace(input());
    if (Object.keys(changes).length === 0) {
      await assert.rejects(pending, error => error.code === 'DOCUMENT_PAGE_REPLACEMENT_EXPIRED'
        && typeof error.recovery.candidateOperationId === 'string');
      assert.equal((await store.get(actorUserId, documentId)).phase, 'expired');
    } else {
      await assert.rejects(pending, { code:'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' });
      assert.equal((await store.get(actorUserId, documentId)).phase, 'dispatched');
    }
  }
});
