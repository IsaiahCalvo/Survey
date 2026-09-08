import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { getOrCreateYDoc, releaseYDoc, snapshotRegisteredYDoc, captureRegisteredYDoc, _getRefCountForTest, _evictForTest } from '../src/lib/collab/ydocRegistry.js';
import { prepareLegacyRecoveryClose, isLegacyRecoveryReceiptCurrent, validateLegacyRecoveryReceipt,
  probeLegacyRecoveryArchives, listLegacyRecoveryArchives,
  LEGACY_RECOVERY_ARCHIVE_DATABASE as DATABASE, LEGACY_RECOVERY_ARCHIVE_STORE as STORE } from '../src/lib/collab/legacyYDocRecoveryArchive.js';

const code = expected => error => error?.code === expected;
const complete = tx => new Promise((resolve, reject) => {
  tx.addEventListener('complete', resolve, { once: true });
  tx.addEventListener('abort', () => reject(tx.error || new Error('aborted')), { once: true });
});
function open(factory, name = DATABASE) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rows(factory) {
  const db = await open(factory);
  try { const tx = db.transaction(STORE, 'readonly'); const done = complete(tx); const read = tx.objectStore(STORE).getAll(); await done; return read.result; }
  finally { db.close(); }
}
function setup(t, { absent = false } = {}) {
  const documentId = `archive-test-${crypto.randomUUID()}`;
  const indexedDB = new IDBFactory();
  const doc = absent ? null : getOrCreateYDoc(documentId);
  doc?.getMap('custom-root').set('note', 'unattributed local work');
  t.after(() => { doc?.destroy(); _evictForTest(documentId); });
  return { documentId, doc, indexedDB, options: { indexedDB, timeoutMs: 1000 } };
}

test('archives exact raw bytes separately, waits for a fresh read, and preserves source identity and refs', async t => {
  const { documentId, doc, indexedDB, options } = setup(t);
  const before = snapshotRegisteredYDoc(documentId);
  const refs = _getRefCountForTest(documentId);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  assert.equal(receipt.rawRegistryState, 'present');
  assert.equal(receipt.archiveDatabase, DATABASE);
  assert.equal(isLegacyRecoveryReceiptCurrent(receipt), true);
  assert.equal(await validateLegacyRecoveryReceipt(receipt, options), true);
  assert.equal(_getRefCountForTest(documentId), refs);
  assert.deepEqual(snapshotRegisteredYDoc(documentId), before);
  assert.equal(doc.isDestroyed, false);
  assert.deepEqual((await indexedDB.databases()).map(db => db.name), [DATABASE]);
  const [record] = await rows(indexedDB);
  assert.equal(record.documentId, documentId);
  assert.deepEqual(record.provenance, { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false });
  const graph = JSON.parse(record.exportJson);
  assert.equal(graph.format, 'survey-legacy-ydoc-recovery');
  assert.ok(graph.nodes.some(node => node.encoding === 'base64' && node.bytes === Buffer.from(before.update).toString('base64')));
  assert.ok(graph.nodes.some(node => node.entries?.some(([key, value]) => key === 'guid' && value === documentId)));
  assert.ok(!graph.nodes.some(node => node.entries?.some(([key]) => key === 'refCount')));
});

test('repeated and concurrent preparation reuse immutable content despite ref count changes', async t => {
  const { documentId, indexedDB, options } = setup(t);
  const [a, b] = await Promise.all([prepareLegacyRecoveryClose(documentId, options), prepareLegacyRecoveryClose(documentId, options)]);
  getOrCreateYDoc(documentId);
  const c = await prepareLegacyRecoveryClose(documentId, options);
  releaseYDoc(documentId);
  assert.equal(a.archiveId, b.archiveId);
  assert.equal(a.archiveId, c.archiveId);
  assert.equal((await rows(indexedDB)).length, 1);
});

test('absent raw registry gets an explicit no-storage receipt and later appearance makes it stale', async t => {
  const { documentId, indexedDB, options } = setup(t, { absent: true });
  const receipt = await prepareLegacyRecoveryClose(documentId, { ...options, readOnly: true });
  assert.equal(receipt.rawRegistryState, 'absent');
  assert.equal(receipt.archiveId, null);
  assert.equal(await validateLegacyRecoveryReceipt(receipt, options), true);
  assert.deepEqual(await indexedDB.databases(), []);
  const created = getOrCreateYDoc(documentId);
  t.after(() => created.destroy());
  assert.equal(isLegacyRecoveryReceiptCurrent(receipt), false);
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, options), code('LEGACY_RECOVERY_STALE'));
});

test('forged receipts, live edits, new empty roots, removal and replacement fail closed', async t => {
  const { documentId, doc, options } = setup(t);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  assert.equal(isLegacyRecoveryReceiptCurrent({ ...receipt }), false);
  await assert.rejects(validateLegacyRecoveryReceipt({ ...receipt }, options), code('LEGACY_RECOVERY_STALE'));
  doc.getMap('custom-root').set('late', true);
  assert.equal(isLegacyRecoveryReceiptCurrent(receipt), false);
  const edited = await prepareLegacyRecoveryClose(documentId, options);
  doc.getArray('new-empty-root');
  assert.equal(isLegacyRecoveryReceiptCurrent(edited), false);
  const expanded = await prepareLegacyRecoveryClose(documentId, options);
  const update = Y.encodeStateAsUpdate(doc);
  _evictForTest(documentId);
  assert.equal(isLegacyRecoveryReceiptCurrent(expanded), false);
  const replacement = getOrCreateYDoc(documentId);
  t.after(() => replacement.destroy());
  Y.applyUpdate(replacement, update);
  assert.equal(isLegacyRecoveryReceiptCurrent(expanded), false);
});

test('capture current check uses private bytes even if a returned snapshot is changed', async t => {
  const { documentId, doc } = setup(t);
  const captured = captureRegisteredYDoc(documentId);
  captured.snapshot.update.fill(0);
  captured.snapshot.metadata.rootNames.push('forged');
  assert.equal(captured.isCurrent(), true);
  doc.getMap('custom-root').set('real-edit', 1);
  assert.equal(captured.isCurrent(), false);
});

test('pending struct evidence survives archival and pending changes invalidate the receipt', async t => {
  const { documentId, doc, indexedDB, options } = setup(t);
  const source = new Y.Doc(); t.after(() => source.destroy());
  const text = source.getText('pending-text');
  text.insert(0, 'a'); const vector = Y.encodeStateVector(source);
  text.insert(1, 'b');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source, vector));
  assert.ok(doc.store.pendingStructs);
  const pending = new Uint8Array(doc.store.pendingStructs.update);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  const graph = JSON.parse((await rows(indexedDB))[0].exportJson);
  assert.ok(graph.nodes.some(node => node.bytes === Buffer.from(pending).toString('base64')));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  assert.equal(isLegacyRecoveryReceiptCurrent(receipt), false);
});

test('read-only close cannot create storage but can verify an existing identical archive', async t => {
  const { documentId, doc, indexedDB, options } = setup(t);
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, readOnly: true }), code('LEGACY_RECOVERY_INCOMPLETE'));
  assert.deepEqual(await indexedDB.databases(), []);
  const saved = await prepareLegacyRecoveryClose(documentId, options);
  const verified = await prepareLegacyRecoveryClose(documentId, { ...options, readOnly: true });
  assert.equal(verified.archiveId, saved.archiveId);
  doc.getMap('custom-root').set('new', true);
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, readOnly: true }), code('LEGACY_RECOVERY_INCOMPLETE'));
  assert.equal((await rows(indexedDB)).length, 1);
});

test('fresh verification rejects altered/missing archive records and never recreates a deleted database', async t => {
  const { documentId, indexedDB, options } = setup(t);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  const db = await open(indexedDB);
  const tx = db.transaction(STORE, 'readwrite'); const done = complete(tx);
  tx.objectStore(STORE).delete(receipt.archiveId); await done; db.close();
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, options), code('LEGACY_RECOVERY_INCOMPLETE'));
  await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(DATABASE); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, options), code('LEGACY_RECOVERY_INCOMPLETE'));
  assert.deepEqual(await indexedDB.databases(), []);
});

test('size limits, invalid options and pre-cancellation do not create an archive', async t => {
  const { documentId, indexedDB, options } = setup(t);
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, limits: { maxSnapshotBytes: 1 } }), code('LEGACY_RECOVERY_LIMIT'));
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, limits: { maxJsonBytes: 1 } }), code('LEGACY_RECOVERY_LIMIT'));
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, timeoutMs: 0 }), TypeError);
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, signal: {} }), TypeError);
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, signal: AbortSignal.abort() }), code('LEGACY_RECOVERY_ABORTED'));
  assert.deepEqual(await indexedDB.databases(), []);
});

test('blocked or timed-out opens cannot create a database when an upgrade arrives late', async t => {
  const { documentId } = setup(t);
  for (const blocked of [true, false]) {
    let request; let aborted = 0; let created = 0;
    const indexedDB = { open() { request = { transaction: { abort() { aborted++; } }, result: { createObjectStore() { created++; } } };
      if (blocked) queueMicrotask(() => request.onblocked()); return request; } };
    await assert.rejects(prepareLegacyRecoveryClose(documentId, { indexedDB, timeoutMs: 40 }), code(blocked ? 'LEGACY_RECOVERY_BLOCKED' : 'LEGACY_RECOVERY_TIMEOUT'));
    request.onupgradeneeded({ oldVersion: 0 });
    assert.ok(aborted > 0);
    assert.equal(created, 0);
  }
});

test('quota errors and cancellation after add success never issue a receipt or commit queued bytes', async t => {
  const { documentId, indexedDB, options } = setup(t);
  const original = IDBObjectStore.prototype.add;
  const mock = t.mock.method(IDBObjectStore.prototype, 'add', function () { throw new DOMException('Quota full', 'QuotaExceededError'); });
  await assert.rejects(prepareLegacyRecoveryClose(documentId, options), error => error.name === 'QuotaExceededError');
  assert.equal((await rows(indexedDB)).length, 0);
  const controller = new AbortController();
  mock.mock.mockImplementation(function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => controller.abort(), { once: true });
    return request;
  });
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, signal: controller.signal }), code('LEGACY_RECOVERY_ABORTED'));
  assert.equal((await rows(indexedDB)).length, 0);
});

test('fresh verification rejects edits during its read and refuses a different storage factory', async t => {
  const { documentId, doc, options } = setup(t);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, { indexedDB: new IDBFactory() }), code('LEGACY_RECOVERY_SCOPE_MISMATCH'));
  const original = IDBObjectStore.prototype.get;
  t.mock.method(IDBObjectStore.prototype, 'get', function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => doc.getMap('custom-root').set('during-read', true), { once: true });
    return request;
  });
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, options), code('LEGACY_RECOVERY_STALE'));
});

test('metadata probe never reads payloads; bounded archive export works after raw memory is gone', async t => {
  const { documentId, doc, indexedDB, options } = setup(t);
  assert.deepEqual(await probeLegacyRecoveryArchives(documentId, options), { state: 'absent', count: 0 });
  assert.deepEqual(await listLegacyRecoveryArchives(documentId, options), { state: 'absent', records: [] });
  assert.deepEqual(await indexedDB.databases(), []);
  await prepareLegacyRecoveryClose(documentId, options);
  doc.getMap('custom-root').set('second', true);
  await prepareLegacyRecoveryClose(documentId, options);
  const cursor = t.mock.method(IDBObjectStore.prototype, 'get', () => { throw new Error('probe must not read a payload'); });
  assert.deepEqual(await probeLegacyRecoveryArchives(documentId, options), { state: 'present', count: 2 });
  cursor.mock.restore();
  _evictForTest(documentId);
  const exported = await listLegacyRecoveryArchives(documentId, options);
  assert.equal(exported.state, 'present');
  assert.equal(exported.records.length, 2);
  assert.ok(exported.records.every(record => record.documentId === documentId && JSON.parse(record.exportJson).format === 'survey-legacy-ydoc-recovery'));
  assert.deepEqual(await listLegacyRecoveryArchives('other-document', options), { state: 'absent', records: [] });
  await assert.rejects(listLegacyRecoveryArchives(documentId, { ...options, maxRecords: 1 }), code('LEGACY_RECOVERY_LIMIT'));
  await assert.rejects(listLegacyRecoveryArchives(documentId, { ...options, maxJsonBytes: 1 }), code('LEGACY_RECOVERY_LIMIT'));
  await assert.rejects(listLegacyRecoveryArchives(documentId, { ...options, signal: AbortSignal.abort() }), code('LEGACY_RECOVERY_ABORTED'));
  assert.equal((await rows(indexedDB)).length, 2);
});

test('changed content under a matching immutable key is not accepted as an existing archive', async t => {
  const { documentId, indexedDB, options } = setup(t);
  const receipt = await prepareLegacyRecoveryClose(documentId, options);
  const [record] = await rows(indexedDB);
  const db = await open(indexedDB);
  const tx = db.transaction(STORE, 'readwrite'); const done = complete(tx);
  tx.objectStore(STORE).put({ ...record, exportJson: '{}' }); await done; db.close();
  await assert.rejects(validateLegacyRecoveryReceipt(receipt, options), code('LEGACY_RECOVERY_INCOMPLETE'));
  await assert.rejects(prepareLegacyRecoveryClose(documentId, options), code('LEGACY_RECOVERY_INCOMPLETE'));
  assert.equal((await rows(indexedDB)).length, 1);
});

test('a stalled content digest respects cancellation/deadline and cannot write after late completion', async t => {
  const { documentId, indexedDB, options } = setup(t);
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let finish;
  let args;
  t.mock.method(crypto.subtle, 'digest', (...values) => { args = values; return new Promise(resolve => { finish = resolve; }); });
  await assert.rejects(prepareLegacyRecoveryClose(documentId, { ...options, timeoutMs: 30 }), code('LEGACY_RECOVERY_TIMEOUT'));
  assert.deepEqual(await indexedDB.databases(), []);
  finish(await original(...args));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(await indexedDB.databases(), []);
});
