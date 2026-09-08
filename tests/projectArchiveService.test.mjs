import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as Y from 'yjs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { IndexeddbPersistence } from 'y-indexeddb';
import { purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { cleanupDocumentStorage } from '../src/services/documentStorageCleanup.js';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';
import { getOrCreateYDoc, snapshotRegisteredYDoc, _evictForTest } from '../src/lib/collab/ydocRegistry.js';

const source = readFileSync(new URL('../src/services/projectArchiveService.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const projectId = '11111111-1111-4111-8111-111111111111';
const deletedId = '22222222-2222-4222-8222-222222222222';
const survivorId = '33333333-3333-4333-8333-333333333333';
function fixture(data = { ok: true, orphaned_paths: [], deleted_document_ids: [deletedId] }, purge = null) {
  const state = { queries: [], rpcCalls: [], purged: [], warnings: [],
    localCopies: new Map([[deletedId, 'deleted document local state'], [survivorId, 'foreign owner pending edits']]),
    response: { data, error: null }, purgeError: false };
  const context = {
    cleanupDocumentStorage,
    console: { error() {}, warn: (...args) => state.warnings.push(args) },
    supabase: {
      from(table) {
        state.queries.push(table);
        const builder = { select: () => builder, eq: async () => ({ data: [{ id: deletedId }, { id: survivorId }], error: null }) };
        return builder;
      },
      async rpc(name, args) { state.rpcCalls.push({ name, args }); return state.response; },
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    },
    async purgeAnnotationDoc(id) { state.purged.push(id); if (state.purgeError) throw Error('local fixture unavailable'); if (purge) await purge(id); state.localCopies.delete(id); },
  };
  vm.runInNewContext(source, context);
  return { state, remove: () => context.deleteProjectForever(projectId) };
}

test('project deletion clears only authoritative deleted IDs, preserving detached survivor pending edits', async () => {
  const f = fixture(); const result = await f.remove();
  assert.equal(result.success, true);
  assert.equal(f.state.localCopies.get(survivorId), 'foreign owner pending edits');
  assert.equal(f.state.localCopies.has(deletedId), false);
  assert.deepEqual(f.state.purged, [deletedId]);
  assert.deepEqual(f.state.queries, [], 'do not pre-read a stale list of project children');
});

for (const receipt of [undefined, null, {}, deletedId, 3, [deletedId, 'not-a-uuid'], [deletedId, null]]) {
  test(`missing or malformed deleted-ID receipt keeps every local copy: ${JSON.stringify(receipt)}`, async () => {
    const f = fixture({ ok: true, orphaned_paths: [], ...(receipt === undefined ? {} : { deleted_document_ids: receipt }) });
    const result = await f.remove();
    assert.equal(result.success, true, 'server purge already succeeded');
    assert.equal(result.localCleanupDeferred, true);
    assert.equal(f.state.localCopies.size, 2); assert.deepEqual(f.state.purged, []); assert.deepEqual(f.state.queries, []);
    assert.equal(f.state.warnings.length, 1);
  });
}

test('empty authoritative receipt purges nothing and does not warn', async () => {
  const f = fixture({ ok: true, orphaned_paths: [], deleted_document_ids: [] });
  const result = await f.remove(); assert.equal(result.success, true); assert.equal(result.localCleanupDeferred, undefined);
  assert.equal(f.state.localCopies.size, 2); assert.deepEqual(f.state.purged, []); assert.deepEqual(f.state.warnings, []);
});

test('duplicate authoritative IDs are cleaned only once', async () => {
  const f = fixture({ ok: true, orphaned_paths: [], deleted_document_ids: [deletedId, deletedId] });
  assert.equal((await f.remove()).success, true); assert.deepEqual(f.state.purged, [deletedId]);
  assert.equal(f.state.localCopies.get(survivorId), 'foreign owner pending edits');
});

test('failed local cleanup does not misreport successful project purge', async () => {
  const f = fixture(); f.state.purgeError = true;
  const result = await f.remove(); assert.equal(result.success, true); assert.equal(result.localCleanupDeferred, true);
  assert.equal(f.state.localCopies.size, 2); assert.deepEqual(f.state.purged, [deletedId]);
});

test('failed or refused server purge never clears local copies', async () => {
  for (const response of [{ data: null, error: { message: 'fixture failure' } }, { data: { ok: false, reason: 'not_owner' }, error: null }]) {
    const f = fixture(); f.state.response = response;
    assert.equal((await f.remove()).success, false); assert.deepEqual(f.state.purged, []); assert.equal(f.state.localCopies.size, 2);
  }
});

test('actual project service and purge preserve a survivor pending Yjs mark across cold IndexedDB reopen', { timeout: 5000 }, async t => {
  const factory = new IDBFactory();
  const previous = new Map(['indexedDB', 'IDBKeyRange'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
  const documents = [], keys = [];
  t.after(() => {
    for (const key of keys) _evictForTest(key);
    for (const doc of documents) doc.destroy();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  async function seed(id, actor, mark) {
    const key = getLegacyYDocScopeKey(id, actor); keys.push(key);
    const doc = getOrCreateYDoc(key); documents.push(doc);
    // Local-only marks have never had a cloud transport or acknowledgement.
    doc.getMap('annotations').set('pending-mark', mark);
    const persistence = new IndexeddbPersistence(key, doc);
    try { await persistence.whenSynced; } finally { await persistence.destroy(); }
    return { key, doc };
  }
  const deleted = await seed(deletedId, 'project-owner', { id: 'deleted-mark', text: 'Delete this document only' });
  const survivorMark = { id: 'survivor-mark', text: 'Pending foreign-owner edit, not uploaded' };
  const survivor = await seed(survivorId, 'foreign-owner', survivorMark);
  const f = fixture(undefined, purgeAnnotationDoc);
  const result = await f.remove();
  assert.equal(result.success, true); assert.equal(result.localCleanupDeferred, undefined);
  const databases = new Set((await factory.databases()).map(entry => entry.name));
  assert.equal(databases.has(deleted.key), false);
  assert.equal(snapshotRegisteredYDoc(deleted.key).state, 'absent');
  assert.equal(deleted.doc.getMap('annotations').size, 0);
  assert.equal(databases.has(survivor.key), true);
  assert.equal(snapshotRegisteredYDoc(survivor.key).state, 'present');
  assert.deepEqual(survivor.doc.getMap('annotations').get('pending-mark'), survivorMark);
  // Drop the old registry document; only persisted bytes can hydrate this Doc.
  _evictForTest(survivor.key);
  const cold = new Y.Doc(); documents.push(cold);
  assert.equal(cold.getMap('annotations').size, 0);
  const reopened = new IndexeddbPersistence(survivor.key, cold);
  try { await reopened.whenSynced; } finally { await reopened.destroy(); }
  assert.deepEqual(cold.getMap('annotations').get('pending-mark'), survivorMark);
  assert.deepEqual(f.state.queries, []); assert.deepEqual(f.state.purged, [deletedId]);
});
