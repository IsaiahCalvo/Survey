import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentFirstGenerationAdoptionIntentStore } from '../src/services/documentFirstGenerationAdoptionIntentStore.js';

const id = n => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1), actorB = id(2), documentA = id(3), documentB = id(4);
const sha = char => char.repeat(64);
const identity = offset => Object.freeze({ adoptionOperationId: id(offset), sourceId: id(offset + 1),
  candidateOperationId: id(offset + 2), archiveOperationIds: Object.freeze([id(offset + 3), id(offset + 4)]) });
const ids = identity(10);
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });

function receipt(state = 'review', identityValue = ids) {
  return { version: 1, state, actor_user_id: actorA, owner_user_id: id(30), document_id: documentA,
    adoption_operation_id: identityValue.adoptionOperationId, source_id: identityValue.sourceId,
    candidate_operation_id: identityValue.candidateOperationId,
    offered_archive_operation_ids: [...identityValue.archiveOperationIds],
    used_archive_operation_ids: [identityValue.archiveOperationIds[0]],
    review_sha256: sha('a'), source_sql_sha256: sha('b'), wal_head: '0',
    objects: [{ kind: 'pdf', byte_length: '12', content_sha256: sha('c') }],
    canonical_annotations: { version: 1, policy: 'legacy-sql-v1', through_seq: '0',
      baseline_sha256: sha('d'), contributors: [] },
    entity_catalog: { status: 'absent', revision: null, content_sha256: null },
    survey_definition: { status: 'absent', revision: null, content_sha256: null },
    expires_at: '2026-09-16T12:00:00.000Z',
    ...(state === 'confirmed' || state === 'published' ? { confirmed_at: '2026-09-15T12:00:00.000Z' } : {}),
    ...(state === 'published' ? { generation_id: id(31), content_model_version: 2,
      pdf: { byte_length: '12', content_sha256: sha('c') },
      legacy_sidecar_migration: { version: 2, state: 'archived',
        origin: { mode: 'legacy', adoption_operation_id: identityValue.adoptionOperationId } },
      published_at: '2026-09-15T12:01:00.000Z' } : {}),
  };
}

test('reservation isolates exact actor and document and survives a cold store', async t => {
  const indexedDB = new IDBFactory(), dbName = 'adoption-intent-isolation';
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB, dbName }); t.after(() => store.close());
  const first = await store.reserve(actorA, documentA, ids);
  assert.equal(first.created, true); assert.equal(first.row.phase, 'reserved');
  assert.equal(new Set([first.row.ids.adoptionOperationId, first.row.ids.sourceId,
    first.row.ids.candidateOperationId, ...first.row.ids.archiveOperationIds]).size, 5);
  const retry = await store.reserve(actorA, documentA, identity(40));
  assert.equal(retry.created, false); assert.deepEqual(retry.row.ids, first.row.ids, 'same scope keeps its durable reservation');
  assert.equal(await store.get(actorB, documentA), null);
  assert.equal(await store.get(actorA, documentB), null);
  store.close();
  const cold = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB, dbName }); t.after(() => cold.close());
  assert.deepEqual((await cold.get(actorA, documentA)).ids, first.row.ids);
});

test('strict receipts and phase order reject without replacing the durable raw intent', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory(), dbName: 'adoption-intent-strict' });
  const reserved = (await store.reserve(actorA, documentA, ids)).row;
  const before = await store.get(actorA, documentA);
  await assert.rejects(store.putReview(actorA, documentA, reserved.revision, { ...receipt(), extra: true }),
    { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_PROTOCOL' });
  assert.deepEqual(await store.get(actorA, documentA), before);
  const foreign = { ...receipt(), actor_user_id: actorB };
  await assert.rejects(store.putReview(actorA, documentA, reserved.revision, foreign),
    { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_PROTOCOL' });
  assert.deepEqual(await store.get(actorA, documentA), before);
  await assert.rejects(store.putConfirmed(actorA, documentA, reserved.revision, receipt('confirmed')),
    { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_INVALID' });
  assert.deepEqual(await store.get(actorA, documentA), before);
  store.close();
});

test('each acknowledged phase is durable, revision-bound, and finish is the only deletion', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory(), dbName: 'adoption-intent-phases' }); t.after(() => store.close());
  let row = (await store.reserve(actorA, documentA, ids)).row;
  row = await store.putReview(actorA, documentA, row.revision, receipt());
  await assert.rejects(store.putReview(actorA, documentA, row.revision - 1, receipt()),
    { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_INVALID' });
  row = await store.markConsent(actorA, documentA, row.revision, sha('a'));
  row = await store.putConfirmed(actorA, documentA, row.revision, receipt('confirmed'));
  row = await store.putPublished(actorA, documentA, row.revision, receipt('published'));
  assert.equal((await store.get(actorA, documentA)).phase, 'published');
  await assert.rejects(store.finish(actorA, documentA, row.revision, id(99)),
    { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_INVALID' });
  assert.equal((await store.get(actorA, documentA)).phase, 'published');
  assert.equal(await store.finish(actorA, documentA, row.revision, ids.adoptionOperationId), true);
  assert.equal(await store.get(actorA, documentA), null);
});

test('a quota failure rejects reserve before it can be acknowledged or read back', async () => {
  const factory = new IDBFactory();
  const quotaFactory = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters);
        if (parameters[1] === 'readwrite') {
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = objectStore(name);
            store.add = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
            return store;
          };
        }
        return tx;
      };
    });
    return request;
  } };
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: quotaFactory, dbName: 'adoption-intent-quota' });
  await assert.rejects(store.reserve(actorA, documentA, ids), { name: 'QuotaExceededError' });
  store.close();
  const readback = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: factory, dbName: 'adoption-intent-quota' });
  assert.equal(await readback.get(actorA, documentA), null);
  readback.close();
});

test('a malformed foreign raw row is rejected without deleting or rewriting it', async () => {
  const indexedDB = new IDBFactory(), dbName = 'adoption-intent-malformed-raw';
  const open = indexedDB.open(dbName, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('intents', { keyPath: ['actorUserId', 'documentId'] });
  const db = await request(open);
  const raw = { actorUserId: actorB, documentId: documentB, phase: 'foreign', injected: true };
  const write = db.transaction('intents', 'readwrite'); write.objectStore('intents').add(raw);
  await new Promise((resolve, reject) => { write.oncomplete = resolve; write.onabort = () => reject(write.error); });
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB, dbName });
  await assert.rejects(store.get(actorB, documentB), { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_STORE_INVALID' });
  const read = db.transaction('intents', 'readonly');
  assert.deepEqual(await request(read.objectStore('intents').get([actorB, documentB])), raw);
  store.close(); db.close();
});
