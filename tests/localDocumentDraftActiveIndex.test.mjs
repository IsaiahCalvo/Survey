import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBCursor, IDBFactory } from 'fake-indexeddb';

import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { createLocalDocumentDraftStore } from '../src/services/localDocumentDraftStore.js';

const localId = 'local:72000000-0000-4000-8000-000000000001';
const pdf = () => Object.assign(new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'draft.pdf', {
  type: 'application/pdf', lastModified: 1,
}), { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 });
const state = label => buildLocalDocumentState({ pdfId: localId,
  annotationsByPage: { 1: { objects: [{ id: label }] } }, items: {}, annotations: {},
  surveyMarkers: {}, callouts: [], pageNames: {}, bookmarks: [], spaces: [],
  regionOverlayDisabled: {},
});
const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});
const transaction = value => new Promise((resolve, reject) => {
  value.oncomplete = resolve;
  value.onabort = () => reject(value.error);
  value.onerror = () => {};
});

async function createV2(indexedDB, dbName, rows) {
  const open = indexedDB.open(dbName, 2);
  open.onupgradeneeded = () => {
    const db = open.result;
    const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
    const bytes = db.createObjectStore('pdfBytes', { keyPath: 'sessionId' });
    bytes.createIndex('payloadId', 'payloadId');
    db.createObjectStore('snapshots', { keyPath: 'sessionId' });
    db.createObjectStore('sharedPdfBytes', { keyPath: 'payloadId' });
    for (const row of rows) sessions.add(row);
  };
  return request(open);
}

const metadata = ({ sessionId, discarded = false }) => discarded
  ? { sessionId, writerId: crypto.randomUUID(), fileId: crypto.randomUUID(), sequence: 1, discarded: true }
  : { sessionId, writerId: crypto.randomUUID(), fileId: crypto.randomUUID(), sourceLocalId: localId,
    baseCanonicalRevision: 1, name: 'draft.pdf', size: 15, type: 'application/pdf',
    created_at: '2026-09-09T00:00:00.000Z', updated_at: '2026-09-09T00:00:01.000Z',
    sequence: 1, discarded: false };

test('v3 list cursor work follows active rows, not retained tombstones', async () => {
  const indexedDB = new IDBFactory();
  const store = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-count' });
  const active = [];
  for (let index = 0; index < 2; index += 1) {
    const writer = store.createWriter(pdf());
    await writer.capture(state(`active-${index}`));
    active.push(writer.sessionId);
  }
  for (let index = 0; index < 24; index += 1) {
    const writer = store.createWriter(pdf());
    await writer.capture(state(`discarded-${index}`));
    await store.discardDraft(writer.sessionId, { expectedSequence: 1 });
  }
  let continues = 0;
  const original = IDBCursor.prototype.continue;
  IDBCursor.prototype.continue = function countedContinue(...args) {
    continues += 1;
    return original.apply(this, args);
  };
  try {
    assert.deepEqual((await store.listDrafts()).map(row => row.sessionId).sort(), active.sort());
  } finally {
    IDBCursor.prototype.continue = original;
    store.close();
  }
  assert.equal(continues, 2);
});

test('v2 upgrade atomically indexes live rows and preserves tombstones and metadata', async () => {
  const indexedDB = new IDBFactory();
  const live = metadata({ sessionId: crypto.randomUUID() });
  const dead = metadata({ sessionId: crypto.randomUUID(), discarded: true });
  const old = await createV2(indexedDB, 'active-index-migrate', [live, dead]);
  const seed = old.transaction(['pdfBytes', 'snapshots'], 'readwrite');
  seed.objectStore('pdfBytes').put({ sessionId: live.sessionId, writerId: live.writerId,
    fileId: live.fileId, blob: new Blob(['retained-pdf']) });
  seed.objectStore('snapshots').put({ sessionId: live.sessionId, writerId: live.writerId,
    fileId: live.fileId, sequence: 1, state: { retained: true } });
  await transaction(seed);
  old.onversionchange = () => old.close();
  const store = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-migrate' });
  assert.deepEqual((await store.listDrafts()).map(row => row.sessionId), [live.sessionId]);
  store.close();
  const db = await request(indexedDB.open('active-index-migrate'));
  assert.equal(db.version, 3);
  const tx = db.transaction(['sessions', 'pdfBytes', 'snapshots', 'draftMeta'], 'readonly');
  const liveAfter = await request(tx.objectStore('sessions').get(live.sessionId));
  const deadAfter = await request(tx.objectStore('sessions').get(dead.sessionId));
  const bytesAfter = await request(tx.objectStore('pdfBytes').get(live.sessionId));
  const snapshotAfter = await request(tx.objectStore('snapshots').get(live.sessionId));
  const countAfter = await request(tx.objectStore('draftMeta').get('activeCount'));
  await transaction(tx);
  assert.deepEqual(liveAfter, { ...live, active: 1 });
  assert.deepEqual(deadAfter, { ...dead, active: 0 });
  assert.equal(await bytesAfter.blob.text(), 'retained-pdf');
  assert.deepEqual(snapshotAfter.state, { retained: true });
  assert.deepEqual(countAfter, { key: 'activeCount', value: 1 });
  db.close();
});

test('malformed v2 metadata aborts migration without creating a partial v3 index', async () => {
  const indexedDB = new IDBFactory();
  const valid = metadata({ sessionId: crypto.randomUUID() });
  const malformed = { sessionId: crypto.randomUUID(), writerId: 'bad', fileId: crypto.randomUUID(),
    sequence: 1, discarded: false };
  const old = await createV2(indexedDB, 'active-index-corrupt', [valid, malformed]);
  old.onversionchange = () => old.close();
  const store = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-corrupt' });
  await assert.rejects(store.listDrafts(), { code: 'corrupt' });
  store.close();
  const db = await request(indexedDB.open('active-index-corrupt'));
  assert.equal(db.version, 2);
  assert.equal(db.transaction('sessions').objectStore('sessions').indexNames.contains('active'), false);
  db.close();
});

test('v3 active index rows still receive full metadata validation', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'active-index-live-corrupt';
  const store = createLocalDocumentDraftStore({ indexedDB, dbName });
  const writer = store.createWriter(pdf());
  await writer.capture(state('valid'));
  const db = await request(indexedDB.open(dbName));
  const tx = db.transaction('sessions', 'readwrite');
  const sessions = tx.objectStore('sessions');
  const row = await request(sessions.get(writer.sessionId));
  sessions.put({ ...row, writerId: 'malformed', active: 1 });
  await transaction(tx);
  db.close();
  const cold = createLocalDocumentDraftStore({ indexedDB, dbName });
  await assert.rejects(cold.listDrafts(), { code: 'corrupt' });
  cold.close();
});

test('missing or wrong active projection fails closed instead of hiding a live draft', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'active-index-projection-corrupt';
  const store = createLocalDocumentDraftStore({ indexedDB, dbName });
  const writer = store.createWriter(pdf());
  await writer.capture(state('valid'));
  for (const active of [undefined, 0]) {
    const db = await request(indexedDB.open(dbName));
    const tx = db.transaction('sessions', 'readwrite');
    const sessions = tx.objectStore('sessions');
    const row = await request(sessions.get(writer.sessionId));
    const next = { ...row };
    if (active === undefined) delete next.active;
    else next.active = active;
    sessions.put(next);
    await transaction(tx);
    db.close();
    const cold = createLocalDocumentDraftStore({ indexedDB, dbName });
    await assert.rejects(cold.listDrafts(), { code: 'corrupt' });
    cold.close();
    const repairDb = await request(indexedDB.open(dbName));
    const repair = repairDb.transaction('sessions', 'readwrite');
    const repairStore = repair.objectStore('sessions');
    const damaged = await request(repairStore.get(writer.sessionId));
    repairStore.put({ ...damaged, active: 1 });
    await transaction(repair);
    repairDb.close();
  }
});

test('capture and discard preserve a live draft whose active projection is damaged', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'active-index-mutation-corrupt';
  const store = createLocalDocumentDraftStore({ indexedDB, dbName });
  const writer = store.createWriter(pdf());
  await writer.capture(state('valid'));
  const db = await request(indexedDB.open(dbName));
  const damage = db.transaction('sessions', 'readwrite');
  const sessions = damage.objectStore('sessions');
  const row = await request(sessions.get(writer.sessionId));
  sessions.put({ ...row, active: 0 });
  await transaction(damage);
  db.close();
  await assert.rejects(writer.capture(state('late')), { code: 'corrupt' });
  await assert.rejects(store.discardDraft(writer.sessionId, { expectedSequence: 1 }), { code: 'corrupt' });
  store.close();
  const inspect = await request(indexedDB.open(dbName));
  const inspectTx = inspect.transaction(['sessions', 'pdfBytes', 'snapshots', 'draftMeta'], 'readonly');
  assert.deepEqual(await request(inspectTx.objectStore('sessions').get(writer.sessionId)), { ...row, active: 0 });
  assert.equal(await request(inspectTx.objectStore('pdfBytes').count()), 1);
  assert.equal(await request(inspectTx.objectStore('snapshots').count()), 1);
  assert.deepEqual(await request(inspectTx.objectStore('draftMeta').get('activeCount')), { key: 'activeCount', value: 1 });
  await transaction(inspectTx);
  inspect.close();
});

test('v3 database missing its active index fails schema validation', async () => {
  const indexedDB = new IDBFactory();
  const open = indexedDB.open('active-index-missing-schema', 3);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('sessions', { keyPath: 'sessionId' });
    const bytes = db.createObjectStore('pdfBytes', { keyPath: 'sessionId' });
    bytes.createIndex('payloadId', 'payloadId');
    db.createObjectStore('snapshots', { keyPath: 'sessionId' });
    db.createObjectStore('sharedPdfBytes', { keyPath: 'payloadId' });
    const meta = db.createObjectStore('draftMeta', { keyPath: 'key' });
    meta.put({ key: 'activeCount', value: 0 });
  };
  const malformed = await request(open);
  malformed.close();
  const store = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-missing-schema' });
  await assert.rejects(store.listDrafts(), { code: 'corrupt' });
  store.close();
});

test('v3 database rejects an active index with the wrong contract', async () => {
  for (const [suffix, keyPath, options] of [
    ['key-path', 'wrongActive', {}],
    ['unique', 'active', { unique: true }],
    ['multi-entry', 'active', { multiEntry: true }],
  ]) {
    const indexedDB = new IDBFactory();
    const dbName = `active-index-wrong-${suffix}`;
    const open = indexedDB.open(dbName, 3);
    open.onupgradeneeded = () => {
      const db = open.result;
      const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
      sessions.createIndex('active', keyPath, options);
      const bytes = db.createObjectStore('pdfBytes', { keyPath: 'sessionId' });
      bytes.createIndex('payloadId', 'payloadId');
      db.createObjectStore('snapshots', { keyPath: 'sessionId' });
      db.createObjectStore('sharedPdfBytes', { keyPath: 'payloadId' });
      const meta = db.createObjectStore('draftMeta', { keyPath: 'key' });
      meta.put({ key: 'activeCount', value: 0 });
    };
    const malformed = await request(open);
    malformed.close();
    const store = createLocalDocumentDraftStore({ indexedDB, dbName });
    await assert.rejects(store.listDrafts(), { code: 'corrupt' });
    store.close();
  }
});

test('bad v3 index shape blocks capture and discard before stored data can change', async () => {
  const indexedDB = new IDBFactory(); const dbName = 'active-index-schema-mutation';
  const sessionId = crypto.randomUUID(); const row = { ...metadata({ sessionId }), active: 1, wrongActive: 1 };
  const open = indexedDB.open(dbName, 3);
  open.onupgradeneeded = () => {
    const db = open.result;
    const sessions = db.createObjectStore('sessions', { keyPath: 'sessionId' });
    sessions.createIndex('active', 'wrongActive'); sessions.add(row);
    const bytes = db.createObjectStore('pdfBytes', { keyPath: 'sessionId' });
    bytes.createIndex('payloadId', 'payloadId'); bytes.add({ sessionId, writerId: row.writerId, fileId: row.fileId, blob: new Blob(['kept']) });
    db.createObjectStore('snapshots', { keyPath: 'sessionId' }).add({ sessionId, writerId: row.writerId,
      fileId: row.fileId, sequence: 1, state: state('kept') });
    db.createObjectStore('sharedPdfBytes', { keyPath: 'payloadId' });
    const meta = db.createObjectStore('draftMeta', { keyPath: 'key' });
    meta.add({ key: 'activeCount', value: 1 });
  };
  const seeded = await request(open); seeded.close();
  const store = createLocalDocumentDraftStore({ indexedDB, dbName });
  const writer = store.createWriter(pdf());
  await assert.rejects(writer.capture(state('new')), { code: 'corrupt' });
  await assert.rejects(store.discardDraft(sessionId, { expectedSequence: 1 }), { code: 'corrupt' });
  store.close();
  const inspect = await request(indexedDB.open(dbName));
  const tx = inspect.transaction(['sessions', 'pdfBytes', 'snapshots', 'draftMeta'], 'readonly');
  assert.deepEqual(await request(tx.objectStore('sessions').get(sessionId)), row);
  assert.equal(await request(tx.objectStore('pdfBytes').count()), 1);
  assert.equal(await request(tx.objectStore('snapshots').count()), 1);
  assert.deepEqual(await request(tx.objectStore('draftMeta').get('activeCount')), { key: 'activeCount', value: 1 });
  await transaction(tx); inspect.close();
});

test('repeat discard cannot decrement the active count or hide another live draft', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'active-index-double-discard';
  const first = createLocalDocumentDraftStore({ indexedDB, dbName });
  const second = createLocalDocumentDraftStore({ indexedDB, dbName });
  const discardedWriter = first.createWriter(pdf());
  const retainedWriter = second.createWriter(pdf());
  await discardedWriter.capture(state('discard-me'));
  await retainedWriter.capture(state('keep-me'));
  await first.discardDraft(discardedWriter.sessionId, { expectedSequence: 1 });
  await assert.rejects(second.discardDraft(discardedWriter.sessionId, { expectedSequence: 1 }), { code: 'discarded' });
  assert.deepEqual((await second.listDrafts()).map(row => row.sessionId), [retainedWriter.sessionId]);
  first.close(); second.close();
  const db = await request(indexedDB.open(dbName));
  const tx = db.transaction('draftMeta', 'readonly');
  assert.deepEqual(await request(tx.objectStore('draftMeta').get('activeCount')), { key: 'activeCount', value: 1 });
  await transaction(tx);
  db.close();
});

test('first capture rejects active-count overflow without adding a draft', async () => {
  const indexedDB = new IDBFactory();
  const dbName = 'active-index-count-overflow';
  const store = createLocalDocumentDraftStore({ indexedDB, dbName });
  assert.deepEqual(await store.listDrafts(), []);
  store.close();
  const db = await request(indexedDB.open(dbName));
  const tx = db.transaction('draftMeta', 'readwrite');
  tx.objectStore('draftMeta').put({ key: 'activeCount', value: Number.MAX_SAFE_INTEGER });
  await transaction(tx);
  db.close();
  const cold = createLocalDocumentDraftStore({ indexedDB, dbName });
  const writer = cold.createWriter(pdf());
  await assert.rejects(writer.capture(state('overflow')), { code: 'corrupt' });
  cold.close();
  const inspectDb = await request(indexedDB.open(dbName));
  const inspectTx = inspectDb.transaction('sessions', 'readonly');
  assert.equal(await request(inspectTx.objectStore('sessions').count()), 0);
  await transaction(inspectTx);
  inspectDb.close();
});

test('two stores cannot expose a ghost draft or revive a discarded session', async () => {
  const indexedDB = new IDBFactory();
  const first = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-race' });
  const second = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-race' });
  const writer = first.createWriter(pdf());
  await writer.capture(state('first'));
  const discard = second.discardDraft(writer.sessionId, { expectedSequence: 1 });
  const late = writer.capture(state('late'));
  const results = await Promise.allSettled([discard, late]);
  if (results[0].status === 'rejected') {
    assert.equal(results[0].reason.code, 'sequence-conflict');
    await second.discardDraft(writer.sessionId, { expectedSequence: 2 });
  } else {
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, 'discarded');
  }
  assert.deepEqual(await first.listDrafts(), []);
  await assert.rejects(writer.capture(state('cannot-revive')), { code: 'discarded' });
  first.close(); second.close();
  const cold = createLocalDocumentDraftStore({ indexedDB, dbName: 'active-index-race' });
  assert.deepEqual(await cold.listDrafts(), []);
  cold.close();
});
