import test from 'node:test';
import assert from 'node:assert/strict';
import * as scope from '../src/lib/collab/legacyYDocScope.js';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexeddbPersistence } from 'y-indexeddb';
import { purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { getOrCreateYDoc, snapshotRegisteredYDoc, _evictForTest } from '../src/lib/collab/ydocRegistry.js';

test('legacy document prefix uses an encoded exact document boundary shared by actor keys', () => {
  assert.equal(scope.getLegacyYDocDocumentPrefix('doc:雪/%'), 'legacy-yjs:v1:doc%3A%E9%9B%AA%2F%25:');
  assert.equal(scope.getLegacyYDocScopeKey('doc:雪/%', 'actor:é/雪'),
    'legacy-yjs:v1:doc%3A%E9%9B%AA%2F%25:actor%3A%C3%A9%2F%E9%9B%AA');
  const prefix = scope.getLegacyYDocDocumentPrefix('doc1');
  assert.equal(scope.getLegacyYDocScopeKey('doc1', 'actor:雪').startsWith(prefix), true);
  for (const sibling of ['doc10', 'doc1:actor', 'doc1%3Aactor']) {
    assert.equal(scope.getLegacyYDocScopeKey(sibling, 'actor:雪').startsWith(prefix), false);
  }
  for (const invalid of [null, undefined, '', '  ', 0, {}, []]) {
    assert.throws(() => scope.getLegacyYDocDocumentPrefix(invalid), TypeError);
    assert.throws(() => scope.getLegacyYDocScopeKey(invalid, 'actor'), TypeError);
    assert.throws(() => scope.getLegacyYDocScopeKey('doc', invalid), TypeError);
  }
});

function installIndexedDb(t, factory = new IDBFactory()) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const keyRangeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
  Object.defineProperty(globalThis, 'indexedDB', { value: factory, configurable: true });
  Object.defineProperty(globalThis, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
    if (keyRangeDescriptor) Object.defineProperty(globalThis, 'IDBKeyRange', keyRangeDescriptor);
    else delete globalThis.IDBKeyRange;
  });
  return factory;
}

async function persist(t, registryKey, databaseName = registryKey) {
  const doc = getOrCreateYDoc(registryKey);
  t.after(() => { _evictForTest(registryKey); doc.destroy(); });
  doc.getMap('annotations').set('mark', { id: registryKey });
  doc.getMap('meta').set('crdt_cutover', true);
  const persistence = new IndexeddbPersistence(databaseName, doc);
  await persistence.whenSynced;
  await persistence.destroy();
  return doc;
}

test('explicit purge removes old and all new actor caches but preserves sibling documents', { timeout: 5000 }, async t => {
  const factory = installIndexedDb(t);
  const id = 'purge-doc:雪/%';
  const scopedKeys = ['actor-a', 'actor:é/雪'].map(actor => scope.getLegacyYDocScopeKey(id, actor));
  const targets = [id, `annoflat:${id}`, `annoflat:${id}:actor-a`, ...scopedKeys];
  const names = [id, `anno-${id}`, `anno-${id}-actor-actor-a-g0`, ...scopedKeys];
  const targetDocs = [];
  for (let index = 0; index < targets.length; index++) targetDocs.push(await persist(t, targets[index], names[index]));
  const siblings = [id + '0', id + ':actor', id.replace(':', '%3A')]
    .map(sibling => scope.getLegacyYDocScopeKey(sibling, 'actor:é/雪'));
  siblings.push(`annoflat:${id}0:actor-a`);
  const siblingDocs = [];
  for (const key of siblings) siblingDocs.push(await persist(t, key));

  await purgeAnnotationDoc(id);

  const remaining = new Set((await factory.databases()).map(entry => entry.name));
  for (let index = 0; index < targets.length; index++) {
    assert.equal(snapshotRegisteredYDoc(targets[index]).state, 'absent', targets[index]);
    assert.equal(remaining.has(names[index]), false, names[index]);
    assert.equal(targetDocs[index].getMap('annotations').size, 0);
    assert.equal(targetDocs[index].getMap('meta').size, 0, 'old cutover marker is gone too');
  }
  for (let index = 0; index < siblings.length; index++) {
    assert.equal(snapshotRegisteredYDoc(siblings[index]).state, 'present');
    assert.equal(remaining.has(siblings[index]), true);
    assert.deepEqual(siblingDocs[index].getMap('annotations').get('mark'), { id: siblings[index] });
  }
});

test('missing database enumeration reports an incomplete purge and keeps retry metadata', { timeout: 5000 }, async t => {
  const factory = installIndexedDb(t);
  const listDatabases = factory.databases.bind(factory);
  factory.databases = undefined;
  const id = 'purge-no-enumeration';
  const scopeKey = scope.getLegacyYDocScopeKey(id, 'actor:雪');
  await persist(t, scopeKey);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map([
    [`annotationPersistenceActors:${id}`, '["actor-a"]'],
    [`cloudSyncQueue_${id}`, 'pending-cleanup'],
  ]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => records.get(key) ?? null,
    removeItem: key => records.delete(key),
    get length() { return records.size; },
    key: index => [...records.keys()][index] ?? null,
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });

  await assert.rejects(purgeAnnotationDoc(id), error => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /local purge incomplete/);
    assert.ok(error.errors.some(cause => cause.code === 'LEGACY_YDOC_PURGE_DISCOVERY_UNAVAILABLE'));
    return true;
  });
  assert.equal(records.get(`cloudSyncQueue_${id}`), 'pending-cleanup');
  assert.equal(records.get(`annotationPersistenceActors:${id}`), '["actor-a"]');
  assert.ok((await listDatabases()).some(entry => entry.name === scopeKey), 'unlisted scope is not falsely reported deleted');
});

test('a failed scoped database deletion reports incomplete cleanup and allows an exact retry', { timeout: 5000 }, async t => {
  const factory = installIndexedDb(t);
  const id = 'purge-failed-scope';
  const key = scope.getLegacyYDocScopeKey(id, 'actor:雪');
  const sibling = scope.getLegacyYDocScopeKey(id + '0', 'actor:雪');
  await persist(t, key);
  await persist(t, sibling);
  const deleteDatabase = factory.deleteDatabase.bind(factory);
  const failure = new DOMException('Injected deletion failure', 'UnknownError');
  factory.deleteDatabase = name => {
    if (name === key) throw failure;
    return deleteDatabase(name);
  };
  await assert.rejects(purgeAnnotationDoc(id), error => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.includes(failure));
    return true;
  });
  assert.ok((await factory.databases()).some(entry => entry.name === key));
  assert.ok((await factory.databases()).some(entry => entry.name === sibling));

  factory.deleteDatabase = deleteDatabase;
  await purgeAnnotationDoc(id);
  assert.equal((await factory.databases()).some(entry => entry.name === key), false);
  assert.equal((await factory.databases()).some(entry => entry.name === sibling), true);
});
