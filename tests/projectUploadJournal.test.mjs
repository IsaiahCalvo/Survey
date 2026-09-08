import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { createProjectUploadJournal } from '../src/services/projectUploadJournal.js';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uuid(1), otherActor = uuid(2), attemptId = uuid(3);
const blob = () => new Blob(['%PDF-test'], { type: 'application/pdf' });
const sha = 'a'.repeat(64);
const file = n => ({ id: uuid(n), documentId: uuid(n + 100), name: `plan-${n}.pdf`, sourceName: `source-${n}.pdf`, size: blob().size, type: 'application/pdf', lastModified: 123 });
const input = () => ({ id: attemptId, projectId: uuid(4), name: 'Project', files: [file(5), file(6)] });
const staged = { contentSha: sha, filePath: `${actor}/${uuid(4)}/${sha}.pdf` };

test('a fresh instance recovers staged bytes and pending metadata without cloud access', async () => {
  const indexedDB = new IDBFactory();
  const first = createProjectUploadJournal({ indexedDB });
  const created = await first.create(actor, input());
  assert.equal(created.version, 1);
  assert.equal(created.revision, 1);
  assert.equal(created.phase, 'preparing');
  assert.equal(created.projectState, 'pending');
  assert.deepEqual(created.files.map(item => item.state), ['pending', 'pending']);
  const saved = await first.stageFile(actor, attemptId, uuid(5), staged, blob());
  assert.equal(saved.revision, 2);
  first.close();
  const cold = createProjectUploadJournal({ indexedDB });
  assert.equal((await cold.get(actor, attemptId)).files[0].state, 'staged');
  assert.equal(await (await cold.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test');
  assert.equal(await cold.readFile(actor, attemptId, uuid(6)), null);
  assert.equal((await cold.list(actor)).length, 1);
  cold.close();
});

function observedFactory(factory, observe) {
  return { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => { const tx = transaction(...parameters); observe(tx, parameters, db); return tx; };
    });
    return request;
  } };
}
async function stageAll(store) {
  for (const n of [5, 6]) await store.stageFile(actor, attemptId, uuid(n), staged, blob());
}
async function confirmed(store) {
  await stageAll(store);
  await store.patchAttempt(actor, attemptId, { phase: 'running', projectState: 'confirmed' });
  for (const n of [5, 6]) await store.patchFile(actor, attemptId, uuid(n), { state: 'confirmed', pageCount: 1 });
  await store.patchAttempt(actor, attemptId, { phase: 'complete' });
}

test('identical IDs are actor scoped and metadata listing never reads staged PDF records', async () => {
  const calls = [];
  const store = createProjectUploadJournal({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => calls.push(args)) });
  await store.create(actor, input()); await stageAll(store);
  await store.create(otherActor, input());
  calls.length = 0;
  const listed = await store.list(actor);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].actorId, actor);
  assert.equal(listed[0].files[0].blob, undefined);
  assert.deepEqual(calls, [[['attempts'], 'readonly']]);
  assert.equal(await store.readFile(otherActor, attemptId, uuid(5)), null);
  await store.discard(otherActor, attemptId);
  assert.equal((await store.get(actor, attemptId)).files[0].state, 'staged');
  assert.equal(await store.get(otherActor, attemptId), null);
  assert.equal(await (await store.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test');
  store.close();
});

test('parallel file jobs across instances preserve every update and revision', async () => {
  const indexedDB = new IDBFactory();
  const a = createProjectUploadJournal({ indexedDB }), b = createProjectUploadJournal({ indexedDB });
  await a.create(actor, input());
  await Promise.all([a.stageFile(actor, attemptId, uuid(5), staged, blob()), b.stageFile(actor, attemptId, uuid(6), staged, blob())]);
  await Promise.all([a.patchFile(actor, attemptId, uuid(5), { state: 'storage-pending', pageCount: 2 }), b.patchFile(actor, attemptId, uuid(6), { state: 'storage-pending', pageCount: 3 })]);
  const row = await a.get(actor, attemptId);
  assert.equal(row.revision, 5);
  assert.deepEqual(row.files.map(file => [file.state, file.pageCount]), [['storage-pending', 2], ['storage-pending', 3]]);
  a.close(); b.close();
});

test('failed staging is atomic, retains earlier staged files, and sends no change event', async (t) => {
  const window = new EventTarget(); window.Event = Event;
  const previousWindow = globalThis.window;
  globalThis.window = window;
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  let events = 0, failWrite = false;
  window.addEventListener('project-upload-journal-changed', () => events++);
  const store = createProjectUploadJournal({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    if (failWrite && args[1] === 'readwrite' && args[0].includes('files')) {
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const object = objectStore(name);
        if (name === 'files') object.add = () => { throw new DOMException('Disk full', 'QuotaExceededError'); };
        return object;
      };
    }
  }) });
  await store.create(actor, input()); await store.stageFile(actor, attemptId, uuid(5), staged, blob());
  assert.equal(events, 2);
  failWrite = true;
  await assert.rejects(store.stageFile(actor, attemptId, uuid(6), staged, blob()), { name: 'QuotaExceededError' });
  assert.equal(events, 2);
  const row = await store.get(actor, attemptId);
  assert.equal(row.revision, 2);
  assert.deepEqual(row.files.map(file => file.state), ['staged', 'pending']);
  assert.equal(await store.readFile(actor, attemptId, uuid(6)), null);
  assert.equal(await (await store.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test');
  store.close();
});

test('finish refuses incomplete attempts and atomically deletes only confirmed local data', async () => {
  const indexedDB = new IDBFactory(), store = createProjectUploadJournal({ indexedDB });
  await store.create(actor, input());
  await assert.rejects(store.finish(actor, attemptId), { code: 'incomplete' });
  await assert.rejects(store.patchAttempt(actor, attemptId, { phase: 'ready' }));
  await assert.rejects(store.patchAttempt(actor, attemptId, { phase: 'complete', projectState: 'confirmed' }));
  await store.create(otherActor, input());
  await confirmed(store);
  assert.equal(await store.finish(actor, attemptId), true);
  assert.equal(await store.get(actor, attemptId), null);
  assert.equal(await store.readFile(actor, attemptId, uuid(5)), null);
  assert.equal((await store.list(otherActor)).length, 1);
  store.close();
});

test('target binding preserves immutable candidate IDs and never retargets confirmed files', async () => {
  const store = createProjectUploadJournal({ indexedDB: new IDBFactory() });
  await store.create(actor, input()); await stageAll(store);
  const destination = uuid(200), filePath = staged.filePath;
  await store.patchFile(actor, attemptId, uuid(5), { state: 'storage-pending', documentId: destination, filePath });
  const bound = await store.get(actor, attemptId);
  assert.equal(bound.files[0].candidateDocumentId, uuid(105));
  assert.equal(bound.files[0].documentId, destination);
  assert.equal(bound.files[0].filePath, filePath);
  await store.patchFile(actor, attemptId, uuid(5), { state: 'confirmed', documentId: destination, filePath });
  await assert.rejects(store.patchFile(actor, attemptId, uuid(5), { state: 'storage-pending', documentId: uuid(201) }));
  await assert.rejects(store.patchFile(actor, attemptId, uuid(5), { candidateDocumentId: uuid(201) }));
  await assert.rejects(store.patchAttempt(actor, attemptId, { projectId: uuid(201) }));
  assert.equal((await store.get(actor, attemptId)).files[0].documentId, destination);
  store.close();
});

test('invalid identity, path, hash, metadata, and Blob size fail without changing persisted records', async () => {
  const store = createProjectUploadJournal({ indexedDB: new IDBFactory() });
  await assert.rejects(store.create('guest', input()));
  await assert.rejects(store.create(actor, { ...input(), files: [file(5), file(5)] }));
  await assert.rejects(store.create(actor, { ...input(), name: '\0bad' }));
  await store.create(actor, input());
  await assert.rejects(store.create(actor, input()), { name: 'ConstraintError' });
  await assert.rejects(store.stageFile(actor, attemptId, uuid(5), { ...staged, contentSha: 'bad' }, blob()));
  await assert.rejects(store.stageFile(actor, attemptId, uuid(5), staged, new Blob(['wrong size'])));
  await assert.rejects(store.stageFile(actor, attemptId, uuid(5), staged, { size: blob().size }));
  await stageAll(store);
  for (const filePath of [`${otherActor}/legacy.pdf`, `${actor}/../other.pdf`, `${actor}/%2e%2e/a.pdf`, `https://${actor}/x.pdf`, `${actor}/x.pdf?query`, `${actor}//a.pdf`, `${actor}/x\\a.pdf`]) {
    await assert.rejects(store.patchFile(actor, attemptId, uuid(5), { state: 'storage-pending', filePath }));
  }
  assert.equal((await store.get(actor, attemptId)).revision, 3);
  store.close();
});

test('staging and target patches reject another project path and the old shared actor hash path', async () => {
  const store = createProjectUploadJournal({ indexedDB: new IDBFactory() });
  await store.create(actor, input());
  for (const filePath of [`${actor}/${uuid(99)}/${sha}.pdf`, `${actor}/${sha}.pdf`]) {
    await assert.rejects(store.stageFile(actor, attemptId, uuid(5), { contentSha: sha, filePath }, blob()));
  }
  assert.equal((await store.get(actor, attemptId)).revision, 1);
  assert.equal(await store.readFile(actor, attemptId, uuid(5)), null);
  await store.stageFile(actor, attemptId, uuid(5), staged, blob());
  for (const filePath of [`${actor}/${uuid(99)}/${sha}.pdf`, `${actor}/${sha}.pdf`]) {
    await assert.rejects(store.patchFile(actor, attemptId, uuid(5), { state: 'storage-pending', filePath }));
  }
  assert.equal((await store.get(actor, attemptId)).files[0].filePath, staged.filePath);
  assert.equal((await store.get(actor, attemptId)).revision, 2);
  store.close();
});

test('unavailable, blocked, timed-out, and wrong-schema storage never fall back to memory', async () => {
  await assert.rejects(createProjectUploadJournal({ indexedDB: null }).create(actor, input()), { code: 'unavailable' });
  const neverOpens = createProjectUploadJournal({ indexedDB: { open: () => ({}) }, timeoutMs: 5 });
  await assert.rejects(neverOpens.list(actor), { code: 'timed-out' }); neverOpens.close();
  const blocked = createProjectUploadJournal({ indexedDB: { open: () => { const request = {}; queueMicrotask(() => request.onblocked()); return request; } } });
  await assert.rejects(blocked.list(actor), { code: 'blocked' }); blocked.close();
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('wrong', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('other');
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  const wrong = createProjectUploadJournal({ indexedDB, dbName: 'wrong' });
  await assert.rejects(wrong.list(actor), { code: 'schema' }); wrong.close();
});

test('version or forced connection close keeps pending data for a fresh instance', async () => {
  const indexedDB = new IDBFactory(); let db;
  const store = createProjectUploadJournal({ indexedDB: observedFactory(indexedDB, (_tx, _args, opened) => { db = opened; }) });
  await store.create(actor, input()); await store.stageFile(actor, attemptId, uuid(5), staged, blob());
  forceCloseDatabase(db);
  assert.equal((await store.get(actor, attemptId)).revision, 2);
  db.onversionchange(); store.close();
  const cold = createProjectUploadJournal({ indexedDB });
  assert.equal(await (await cold.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test'); cold.close();
  await assert.rejects(store.get(actor, attemptId), { code: 'closed' });
});

test('an empty project retains its stable identity until confirmed and can then finish', async () => {
  const store = createProjectUploadJournal({ indexedDB: new IDBFactory() });
  await store.create(actor, { ...input(), files: [] });
  await assert.rejects(store.finish(actor, attemptId), { code: 'incomplete' });
  await store.patchAttempt(actor, attemptId, { phase: 'ready' });
  assert.equal((await store.get(actor, attemptId)).projectId, uuid(4));
  await store.patchAttempt(actor, attemptId, { phase: 'complete', projectState: 'confirmed' });
  assert.equal(await store.finish(actor, attemptId), true);
  assert.deepEqual(await store.list(actor), []); store.close();
});

test('a quota error after adding bytes rolls back both records and failed cleanup keeps all bytes', async () => {
  let failMetadata = false, failDelete = false;
  const store = createProjectUploadJournal({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    if (args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name);
      if (name === 'attempts' && failMetadata) object.put = () => { throw new DOMException('Disk full', 'QuotaExceededError'); };
      if (name === 'attempts' && failDelete) object.delete = () => { throw new Error('cleanup interrupted'); };
      return object;
    };
  }) });
  await store.create(actor, input());
  failMetadata = true;
  await assert.rejects(store.stageFile(actor, attemptId, uuid(5), staged, blob()), { name: 'QuotaExceededError' });
  assert.equal((await store.get(actor, attemptId)).revision, 1);
  assert.equal(await store.readFile(actor, attemptId, uuid(5)), null);
  failMetadata = false;
  await confirmed(store);
  failDelete = true;
  await assert.rejects(store.finish(actor, attemptId), /cleanup interrupted/);
  assert.equal((await store.get(actor, attemptId)).phase, 'complete');
  assert.equal(await (await store.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test');
  failDelete = false;
  await store.finish(actor, attemptId); store.close();
});

test('a missing commit event times out without acknowledgement and keeps recoverable records', async () => {
  let hideCompletion = false;
  const indexedDB = new IDBFactory();
  const store = createProjectUploadJournal({ timeoutMs: 10, indexedDB: observedFactory(indexedDB, (tx, args) => {
    if (hideCompletion && args[1] === 'readwrite') Object.defineProperty(tx, 'oncomplete', { set() {} });
  }) });
  await store.create(actor, input());
  hideCompletion = true;
  await assert.rejects(store.stageFile(actor, attemptId, uuid(5), staged, blob()), { code: 'timed-out' });
  store.close();
  const cold = createProjectUploadJournal({ indexedDB });
  assert.equal((await cold.get(actor, attemptId)).files[0].state, 'staged');
  assert.equal(await (await cold.readFile(actor, attemptId, uuid(5))).text(), '%PDF-test'); cold.close();
});

test('closing an opening journal rejects the pending request and closes a late database result', async () => {
  let request, closed = 0;
  const store = createProjectUploadJournal({ indexedDB: { open: () => (request = {}) } });
  const pending = store.create(actor, input());
  store.close();
  await assert.rejects(pending, { code: 'closed' });
  request.result = { close() { closed++; } };
  request.onsuccess();
  assert.ok(closed > 0);
});
