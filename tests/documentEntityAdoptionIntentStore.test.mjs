import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentEntityAdoptionIntentStore } from '../src/services/documentEntityAdoptionIntentStore.js';

const id = n => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1);
const actorB = id(2);
const documentId = id(3);
const operationId = id(4);
const requestSha256 = 'a'.repeat(64);
const preview = Object.freeze({ status: 'preview', version: 1, documentId,
  source: Object.freeze({ templateId: id(5), templateUpdatedAt: '2026-09-09T12:00:00.000Z',
    entitiesSha256: 'b'.repeat(64) }),
  entities: Object.freeze([{ id: 'owner', name: 'Owner', color: '#112233', opacity: 0.7,
    borderColor: '#445566', borderOpacity: 0.5, matchFill: false }]),
});
const accepted = Object.freeze({ status: 'accepted', version: 1, documentId, catalogRevision: 1,
  source: preview.source, seed: Object.freeze({ operationId, requestSha256 }),
  entities: preview.entities });

test('pending reviewed adoption survives restart with one exact operation and actor scope', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentEntityAdoptionIntentStore({ indexedDB });
  t.after(() => first.close());
  const input = { preview, operationId, requestSha256 };
  const [left, right] = await Promise.all([
    first.reserve(actorA, documentId, input),
    first.reserve(actorA, documentId, input),
  ]);
  assert.deepEqual(left.row, right.row);
  assert.deepEqual([left.created, right.created].sort(), [false, true]);
  first.close();

  const reopened = createDocumentEntityAdoptionIntentStore({ indexedDB });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.get(actorA, documentId), left.row);
  assert.equal(await reopened.get(actorB, documentId), null);
  const otherActor = await reopened.reserve(actorB, documentId, {
    preview, operationId: id(8), requestSha256: 'c'.repeat(64),
  });
  assert.notEqual(otherActor.row.operationId, left.row.operationId);
  assert.deepEqual(await reopened.get(actorA, documentId), left.row);
});

test('dispatch and finish use exact revision, operation, and request proof', async t => {
  const store = createDocumentEntityAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  const { row } = await store.reserve(actorA, documentId, { preview, operationId, requestSha256 });
  await assert.rejects(store.markDispatched(actorA, documentId, row.revision, id(90)), {
    code: 'DOCUMENT_ENTITY_ADOPTION_STORE_INVALID',
  });
  assert.equal((await store.get(actorA, documentId)).phase, 'pending');
  const dispatched = await store.markDispatched(actorA, documentId, row.revision, operationId);
  assert.equal(dispatched.phase, 'dispatched');
  assert.equal(dispatched.revision, 2);
  assert.deepEqual(await store.markDispatched(actorA, documentId, row.revision, operationId), dispatched,
    'a lost dispatch reply reuses the durable operation');
  for (const args of [
    [1, operationId, requestSha256],
    [2, id(91), requestSha256],
    [2, operationId, 'd'.repeat(64)],
  ]) {
    await assert.rejects(store.finish(actorA, documentId, ...args), {
      code: 'DOCUMENT_ENTITY_ADOPTION_STORE_INVALID',
    });
    assert.deepEqual(await store.get(actorA, documentId), dispatched);
  }
  assert.equal(await store.finish(actorA, documentId, 2, operationId, requestSha256), true);
  assert.equal(await store.get(actorA, documentId), null);
});

test('verified accepted catalog cache survives restart and stays actor scoped', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentEntityAdoptionIntentStore({ indexedDB });
  await first.putAccepted(actorA, documentId, accepted);
  first.close();
  const reopened = createDocumentEntityAdoptionIntentStore({ indexedDB });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.getAccepted(actorA, documentId), accepted);
  assert.equal(await reopened.getAccepted(actorB, documentId), null);
});
