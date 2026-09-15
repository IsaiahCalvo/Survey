import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import {
  createDocumentDefinitionRevisionCache,
} from '../src/services/documentDefinitionRevisionCache.js';

const id = n => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACTOR_A = id(1);
const ACTOR_B = id(2);
const DOCUMENT_ID = id(3);
const TEMPLATE_ID = id(4);
const NEXT_TEMPLATE_ID = id(5);
const OPERATION_ID = id(6);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_E = 'e'.repeat(64);

const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const digest = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const modules = text => [{ id:'module-doors', name:'Doors', categories:[{
  id:'category-doors', name:'Door checks', checklist:[{ id:'check-door', text }],
}] }];
const entities = name => [{ id:'entity-door', name, color:'#112233', opacity:0.35,
  borderColor:null, borderOpacity:null, matchFill:false }];

async function receipt({ revision = 1, text = 'Door condition', name = 'Door',
  operationId = null, requestSha256 = null, archives = [] } = {}) {
  const content = { version:1, documentId:DOCUMENT_ID, definitionRevision:revision,
    surveyDefinition:{ source:{ templateId:TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T12:00:00Z', structureSha256:SHA_A }, modules:modules(text) },
    entityCatalog:{ source:{ templateId:TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T12:00:00Z', entitiesSha256:SHA_B }, entities:entities(name) },
    archivedSemanticIds:archives };
  return { status:'accepted', ...content, definitionDigest:await digest(content),
    review:{ reviewedAt:'2026-09-15T13:00:00Z', operationId, requestSha256 } };
}

async function reviewed() {
  const currentReceipt = await receipt();
  const archives = [{ kind:'checklistItem', id:'check-door' }];
  return { status:'reviewed', version:1, actorUserId:ACTOR_A, documentId:DOCUMENT_ID,
    currentReceipt,
    wire:{ status:'preview', version:1, documentId:DOCUMENT_ID,
      current:{ definitionRevision:1, definitionDigest:currentReceipt.definitionDigest },
      surveyDefinition:{ source:{ templateId:NEXT_TEMPLATE_ID,
        templateUpdatedAt:'2026-09-15T13:00:00Z', structureSha256:SHA_C },
      modules:modules('Door condition revised') },
      entityCatalog:{ source:{ templateId:NEXT_TEMPLATE_ID,
        templateUpdatedAt:'2026-09-15T13:00:00Z', entitiesSha256:SHA_D },
      entities:entities('Door revised') },
      review:{ operationId:OPERATION_ID, requestSha256:SHA_E,
        archivedSemanticIds:archives } },
    expectedArchivedSemanticIds:archives };
}

test('validated receipts survive a cold open under their exact actor, revision, and digest', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-receipts' });
  const value = await receipt();
  const saved = await first.putReceipt(ACTOR_A, DOCUMENT_ID, value);
  assert.deepEqual(saved, value);
  value.surveyDefinition.modules[0].name = 'caller mutation';
  first.close();

  const cold = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-receipts' });
  t.after(() => cold.close());
  assert.equal(await cold.getReceipt(ACTOR_B, DOCUMENT_ID, 1, saved.definitionDigest), null);
  assert.deepEqual(await cold.getReceipt(ACTOR_A, DOCUMENT_ID, 1, saved.definitionDigest), saved);
});

test('receipt validation, byte limits, and immutable revision conflicts fail closed', async t => {
  const indexedDB = new IDBFactory();
  const cache = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-receipt-conflict' });
  t.after(() => cache.close());
  const original = await receipt();
  await cache.putReceipt(ACTOR_A, DOCUMENT_ID, original);
  const changed = await receipt({ text:'A different valid revision body' });
  await assert.rejects(cache.putReceipt(ACTOR_A, DOCUMENT_ID, changed), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
  });
  assert.deepEqual(await cache.getReceipt(ACTOR_A, DOCUMENT_ID, 1,
    original.definitionDigest), original);
  assert.equal(await cache.getReceipt(ACTOR_A, DOCUMENT_ID, 1,
    changed.definitionDigest), null);

  const corrupt = structuredClone(original);
  corrupt.surveyDefinition.modules[0].name = 'changed without a digest';
  const unopened = createDocumentDefinitionRevisionCache({
    indexedDB:{ open() { assert.fail('bad receipt must fail before storage opens'); } },
    dbName:'definition-revision-invalid',
  });
  await assert.rejects(unopened.putReceipt(ACTOR_A, DOCUMENT_ID, corrupt), {
    code:'DOCUMENT_DEFINITION_REVISION_INTEGRITY',
  });
  unopened.close();

  const size = new TextEncoder().encode(stable({ actorUserId:ACTOR_A,
    documentId:DOCUMENT_ID, definitionRevision:original.definitionRevision,
    definitionDigest:original.definitionDigest, receipt:original })).byteLength;
  const limited = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'definition-revision-limit', maxReceiptBytes:size - 1 });
  t.after(() => limited.close());
  await assert.rejects(limited.putReceipt(ACTOR_A, DOCUMENT_ID, original), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
});

test('a whole validated review is owned before open and survives under its exact actor scope', async t => {
  const indexedDB = new IDBFactory();
  const first = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-intent-restart' });
  const input = await reviewed();
  const expected = structuredClone(input);
  const saving = first.reserveIntent(ACTOR_A, DOCUMENT_ID, input);
  input.wire.surveyDefinition.modules[0].name = 'caller mutation';
  input.wire.review.operationId = id(90);
  const reserved = await saving;
  assert.equal(reserved.created, true);
  assert.equal(reserved.row.phase, 'pending');
  assert.equal(reserved.row.revision, 1);
  assert.equal(reserved.row.operationId, OPERATION_ID);
  assert.equal(reserved.row.requestSha256, SHA_E);
  assert.deepEqual(reserved.row.review, expected);
  first.close();

  const cold = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-intent-restart' });
  t.after(() => cold.close());
  assert.deepEqual(await cold.getIntent(ACTOR_A, DOCUMENT_ID), reserved.row);
  assert.equal(await cold.getIntent(ACTOR_B, DOCUMENT_ID), null);
  const retried = await cold.reserveIntent(ACTOR_A, DOCUMENT_ID, expected);
  assert.equal(retried.created, false);
  assert.deepEqual(retried.row, reserved.row);
});

test('saved review keeps server archive order and treats colon IDs as exact tuples', async t => {
  const existing = [
    { kind:'entity', id:'entity-Z:west' },
    { kind:'entity', id:'entity-a:east' },
  ];
  const added = [{ kind:'module', id:'module:b:2' }];
  const currentReceipt = await receipt({ archives:existing });
  const review = await reviewed();
  review.currentReceipt = currentReceipt;
  review.wire.current = { definitionRevision:1,
    definitionDigest:currentReceipt.definitionDigest };
  review.wire.review.archivedSemanticIds = added;
  review.expectedArchivedSemanticIds = [...existing, ...added];
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'definition-revision-archive-order' });
  t.after(() => cache.close());
  const saved = await cache.reserveIntent(ACTOR_A, DOCUMENT_ID, review);
  assert.deepEqual(saved.row.review.expectedArchivedSemanticIds,
    [...existing, ...added]);
});

test('pending cancel and dispatched finish require the exact durable replay proof', async t => {
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:new IDBFactory(),
    dbName:'definition-revision-intent-phases' });
  t.after(() => cache.close());
  const review = await reviewed();
  let { row } = await cache.reserveIntent(ACTOR_A, DOCUMENT_ID, review);
  for (const args of [[2, OPERATION_ID], [1, id(91)]]) {
    await assert.rejects(cache.cancelIntent(ACTOR_A, DOCUMENT_ID, ...args), {
      code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
    });
    assert.deepEqual(await cache.getIntent(ACTOR_A, DOCUMENT_ID), row);
  }
  assert.equal(await cache.cancelIntent(ACTOR_A, DOCUMENT_ID, row.revision,
    row.operationId), true);
  assert.equal(await cache.getIntent(ACTOR_A, DOCUMENT_ID), null);

  ({ row } = await cache.reserveIntent(ACTOR_A, DOCUMENT_ID, review));
  await assert.rejects(cache.markDispatched(ACTOR_A, DOCUMENT_ID, row.revision,
    id(92)), { code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT' });
  const dispatched = await cache.markDispatched(ACTOR_A, DOCUMENT_ID,
    row.revision, row.operationId);
  assert.equal(dispatched.phase, 'dispatched');
  assert.equal(dispatched.revision, 2);
  assert.deepEqual(await cache.markDispatched(ACTOR_A, DOCUMENT_ID,
    row.revision, row.operationId), dispatched, 'a lost reply replays the same dispatch');
  const reserveRetry = await cache.reserveIntent(ACTOR_A, DOCUMENT_ID, review);
  assert.equal(reserveRetry.created, false);
  assert.deepEqual(reserveRetry.row, dispatched,
    'a restart must not replace or reject the exact dispatched review');
  await assert.rejects(cache.cancelIntent(ACTOR_A, DOCUMENT_ID,
    dispatched.revision, dispatched.operationId), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
  });
  for (const args of [
    [1, OPERATION_ID, SHA_E],
    [2, id(93), SHA_E],
    [2, OPERATION_ID, 'f'.repeat(64)],
  ]) {
    await assert.rejects(cache.finishIntent(ACTOR_A, DOCUMENT_ID, ...args), {
      code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
    });
    assert.deepEqual(await cache.getIntent(ACTOR_A, DOCUMENT_ID), dispatched);
  }
  assert.equal(await cache.finishIntent(ACTOR_A, DOCUMENT_ID, dispatched.revision,
    dispatched.operationId, dispatched.requestSha256), true);
  assert.equal(await cache.getIntent(ACTOR_A, DOCUMENT_ID), null);
});

test('two exact dispatch calls converge on one durable dispatched row', async t => {
  const indexedDB = new IDBFactory();
  const left = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-dispatch-race' });
  const right = createDocumentDefinitionRevisionCache({ indexedDB,
    dbName:'definition-revision-dispatch-race' });
  t.after(() => { left.close(); right.close(); });
  const { row } = await left.reserveIntent(ACTOR_A, DOCUMENT_ID, await reviewed());
  const [a, b] = await Promise.all([
    left.markDispatched(ACTOR_A, DOCUMENT_ID, row.revision, row.operationId),
    right.markDispatched(ACTOR_A, DOCUMENT_ID, row.revision, row.operationId),
  ]);
  assert.deepEqual(a, b);
  assert.equal(a.phase, 'dispatched');
  assert.equal(a.revision, 2);
});

test('review validation and the full intent-row byte limit run before storage opens', async () => {
  const value = await reviewed();
  const row = { version:1, revision:1, actorUserId:ACTOR_A, documentId:DOCUMENT_ID,
    phase:'pending', operationId:OPERATION_ID, requestSha256:SHA_E, review:value };
  const rowBytes = new TextEncoder().encode(stable(row)).byteLength;
  const unopened = { open() { assert.fail('rejected review must not open storage'); } };
  const limited = createDocumentDefinitionRevisionCache({ indexedDB:unopened,
    dbName:'definition-review-limit', maxReviewBytes:rowBytes - 1 });
  await assert.rejects(limited.reserveIntent(ACTOR_A, DOCUMENT_ID, value), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  limited.close();

  const changed = structuredClone(value);
  changed.currentReceipt = await receipt({ text:'wrong current body' });
  const invalid = createDocumentDefinitionRevisionCache({ indexedDB:unopened,
    dbName:'definition-review-invalid' });
  await assert.rejects(invalid.reserveIntent(ACTOR_A, DOCUMENT_ID, changed), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_INVALID',
  });
  invalid.close();
});

function failingWrites(factory, storeName, method) {
  return { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result;
      const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters);
        if (parameters[1] !== 'readwrite') return tx;
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name);
          if (name === storeName) store[method] = () => {
            throw new DOMException('synthetic full storage', 'QuotaExceededError');
          };
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
}

test('quota failures reject without removing an old receipt or pending apply intent', async t => {
  const factory = new IDBFactory();
  const receiptDb = 'definition-revision-receipt-quota';
  const seedReceipts = createDocumentDefinitionRevisionCache({ indexedDB:factory,
    dbName:receiptDb });
  const firstReceipt = await receipt();
  await seedReceipts.putReceipt(ACTOR_A, DOCUMENT_ID, firstReceipt);
  seedReceipts.close();
  const fullReceipts = createDocumentDefinitionRevisionCache({
    indexedDB:failingWrites(factory, 'receipts', 'add'), dbName:receiptDb });
  const nextReceipt = await receipt({ revision:2, text:'Second revision',
    operationId:OPERATION_ID, requestSha256:SHA_E });
  await assert.rejects(fullReceipts.putReceipt(ACTOR_A, DOCUMENT_ID, nextReceipt), {
    name:'QuotaExceededError',
  });
  fullReceipts.close();
  const receiptReadback = createDocumentDefinitionRevisionCache({ indexedDB:factory,
    dbName:receiptDb });
  t.after(() => receiptReadback.close());
  assert.deepEqual(await receiptReadback.getReceipt(ACTOR_A, DOCUMENT_ID, 1,
    firstReceipt.definitionDigest), firstReceipt);
  assert.equal(await receiptReadback.getReceipt(ACTOR_A, DOCUMENT_ID, 2,
    nextReceipt.definitionDigest), null);

  const intentDb = 'definition-revision-intent-quota';
  const seedIntent = createDocumentDefinitionRevisionCache({ indexedDB:factory,
    dbName:intentDb });
  const { row } = await seedIntent.reserveIntent(ACTOR_A, DOCUMENT_ID, await reviewed());
  seedIntent.close();
  const fullIntents = createDocumentDefinitionRevisionCache({
    indexedDB:failingWrites(factory, 'intents', 'put'), dbName:intentDb });
  await assert.rejects(fullIntents.markDispatched(ACTOR_A, DOCUMENT_ID,
    row.revision, row.operationId), { name:'QuotaExceededError' });
  fullIntents.close();
  const intentReadback = createDocumentDefinitionRevisionCache({ indexedDB:factory,
    dbName:intentDb });
  t.after(() => intentReadback.close());
  assert.deepEqual(await intentReadback.getIntent(ACTOR_A, DOCUMENT_ID), row);
});

test('receipt reads use one exact key and never scan or load the receipt store', async t => {
  const factory = new IDBFactory();
  const dbName = 'definition-revision-exact-read';
  const seed = createDocumentDefinitionRevisionCache({ indexedDB:factory, dbName });
  const first = await receipt();
  const second = await receipt({ revision:2, text:'Second revision',
    operationId:OPERATION_ID, requestSha256:SHA_E });
  await seed.putReceipt(ACTOR_A, DOCUMENT_ID, first);
  await seed.putReceipt(ACTOR_A, DOCUMENT_ID, second);
  seed.close();
  const exactOnly = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result;
      const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters);
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name);
          if (name === 'receipts') {
            store.getAll = () => assert.fail('exact receipt read must not load all rows');
            store.openCursor = () => assert.fail('exact receipt read must not scan rows');
          }
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
  const cache = createDocumentDefinitionRevisionCache({ indexedDB:exactOnly, dbName });
  t.after(() => cache.close());
  assert.deepEqual(await cache.getReceipt(ACTOR_A, DOCUMENT_ID, 2,
    second.definitionDigest), second);
  assert.equal(await cache.getReceipt(ACTOR_A, DOCUMENT_ID, 3, 'f'.repeat(64)), null);
  assert.deepEqual(await cache.getReceipt(ACTOR_A, DOCUMENT_ID, 1,
    first.definitionDigest), first, 'later reads keep older immutable receipts');
});

test('the current head is separate from historical receipts and cannot move back', async t => {
  const indexedDB = new IDBFactory();
  const dbName = 'definition-revision-current-head';
  const cache = createDocumentDefinitionRevisionCache({ indexedDB, dbName });
  const first = await receipt();
  const second = await receipt({ revision:2, text:'Second revision',
    operationId:OPERATION_ID, requestSha256:SHA_E });
  assert.deepEqual(await cache.putCurrentReceipt(ACTOR_A, DOCUMENT_ID, second), second);
  await cache.putReceipt(ACTOR_A, DOCUMENT_ID, first);
  assert.deepEqual(await cache.getCurrentReceipt(ACTOR_A, DOCUMENT_ID), second,
    'a historical cache fill must not replace the current pointer');
  await assert.rejects(cache.putCurrentReceipt(ACTOR_A, DOCUMENT_ID, first), {
    code:'DOCUMENT_DEFINITION_REVISION_CACHE_CONFLICT',
  });
  assert.deepEqual(await cache.getCurrentReceipt(ACTOR_A, DOCUMENT_ID), second);
  cache.close();

  const cold = createDocumentDefinitionRevisionCache({ indexedDB, dbName });
  t.after(() => cold.close());
  assert.deepEqual(await cold.getCurrentReceipt(ACTOR_A, DOCUMENT_ID), second);
  assert.equal(await cold.getCurrentReceipt(ACTOR_B, DOCUMENT_ID), null);
});

test('a failed current-pointer write cannot leave its receipt half-saved', async t => {
  const factory = new IDBFactory();
  const dbName = 'definition-revision-current-quota';
  const init = createDocumentDefinitionRevisionCache({ indexedDB:factory, dbName });
  assert.equal(await init.getCurrentReceipt(ACTOR_A, DOCUMENT_ID), null);
  init.close();
  const value = await receipt();
  const full = createDocumentDefinitionRevisionCache({
    indexedDB:failingWrites(factory, 'current', 'put'), dbName });
  await assert.rejects(full.putCurrentReceipt(ACTOR_A, DOCUMENT_ID, value), {
    name:'QuotaExceededError',
  });
  full.close();
  const cold = createDocumentDefinitionRevisionCache({ indexedDB:factory, dbName });
  t.after(() => cold.close());
  assert.equal(await cold.getCurrentReceipt(ACTOR_A, DOCUMENT_ID), null);
  assert.equal(await cold.getReceipt(ACTOR_A, DOCUMENT_ID, 1,
    value.definitionDigest), null);
});
