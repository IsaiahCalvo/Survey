import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { createLocalDocumentDraftStore } from '../src/services/localDocumentDraftStore.js';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';

const localId = 'local:00000000-0000-4000-8000-000000000001';
const pdf = (text = 'original') => Object.assign(new File([`%PDF-1.7\n${text}\n%%EOF`], 'plan.pdf', { type: 'application/pdf' }),
  { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 });
const state = (text = 'first') => buildLocalDocumentState({ pdfId: localId,
  annotationsByPage: { 1: { objects: [{ id: 'mark', text }] } },
  items: { item: { text } }, annotations: { mark: { pageNumber: 1 } }, surveyMarkers: { marker: { pageNumber: 1 } },
  callouts: [], pageNames: { 1: text }, bookmarks: [], spaces: [], regionOverlayDisabled: { region: true } });

function observedFactory(factory, observe) {
  return { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => { const tx = transaction(...parameters); observe(tx, parameters, db); return tx; };
    });
    return request;
  } };
}

async function rawDatabase(factory, name = 'survey-local-document-drafts-v1') {
  return new Promise((resolve, reject) => {
    const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function alter(factory, names, run) {
  const db = await rawDatabase(factory);
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); run(tx);
  }); } finally { db.close(); }
}

test('a draft cold-opens its full state and original bytes without a canonical or cloud binding', async () => {
  const indexedDB = new IDBFactory(); const first = createLocalDocumentDraftStore({ indexedDB });
  const file = pdf(); const writer = first.createWriter(file);
  const saved = await writer.capture(state());
  assert.equal(saved.sequence, 1); assert.equal(saved.sessionId, writer.sessionId);
  assert.equal(saved.writerId, writer.writerId); assert.equal(saved.sourceLocalId, localId);
  await writer.seal(); first.close();
  const cold = createLocalDocumentDraftStore({ indexedDB });
  const [metadata] = await cold.listDrafts();
  assert.equal(metadata.sessionId, saved.sessionId); assert.equal(metadata.sequence, 1);
  const recovered = await cold.readDraft(saved.sessionId, { expectedSequence: 1 });
  assert.deepEqual(recovered.state, state());
  assert.equal(await recovered.file.text(), '%PDF-1.7\noriginal\n%%EOF');
  for (const key of ['id', 'localId', '_surveyPdfId', 'storageMode', 'localRevision', 'filePath', 'user_id']) {
    assert.equal(Object.hasOwn(recovered.file, key), false, key);
  }
  assert.equal(recovered.metadata.sourceLocalId, localId); cold.close();
});

test('queued snapshots have ordered receipts, capture caller values at invocation, and keep only the latest full state', async () => {
  const store = createLocalDocumentDraftStore({ indexedDB: new IDBFactory() }); const file = pdf();
  const writer = store.createWriter(file); const input = state('captured');
  const first = writer.capture(input);
  input.entries[`pdfSidebar_${localId}`] = '{}'; input.pdfId = 'wrong';
  const one = await first;
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 1 })).state, state('captured'));
  const two = writer.capture(state('second')); const three = writer.capture(state('third'));
  const barrier = writer.flush(); assert.equal(barrier, three);
  assert.deepEqual((await Promise.all([two, three])).map(value => value.sequence), [2, 3]);
  await assert.rejects(store.readDraft(writer.sessionId, { expectedSequence: one.sequence }), { code: 'sequence-conflict' });
  const recovered = await store.readDraft(writer.sessionId, { expectedSequence: 3 });
  assert.deepEqual(recovered.state, state('third'));
  recovered.state.entries[`pdfSidebar_${localId}`] = '{}';
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 3 })).state, state('third'));
  const empty = buildLocalDocumentState({ pdfId: localId }); await writer.capture(empty);
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 4 })).state, empty, 'last deletion/undo is a full snapshot');
  store.close();
});

test('writers isolate the same document and same-name same-size Files; later caller identity changes cannot switch retained bytes', async () => {
  const store = createLocalDocumentDraftStore({ indexedDB: new IDBFactory() }); const file = pdf('AAAA');
  const a = store.createWriter(file); const b = store.createWriter(file); const c = store.createWriter(pdf('BBBB'));
  assert.equal(new Set([a.sessionId, b.sessionId, c.sessionId]).size, 3);
  assert.equal(new Set([a.writerId, b.writerId, c.writerId]).size, 3);
  file.localRevision = 90; file.localId = 'switched'; file.id = 'cloud';
  file.arrayBuffer = () => assert.fail('must not read overridden bytes');
  file.slice = () => assert.fail('must not read overridden bytes');
  await Promise.all([a.capture(state('a')), b.capture(state('b')), c.capture(state('c'))]);
  for (const [writer, text, content] of [[a, 'a', 'AAAA'], [b, 'b', 'AAAA'], [c, 'c', 'BBBB']]) {
    const saved = await store.readDraft(writer.sessionId, { expectedSequence: 1 });
    assert.equal(saved.metadata.baseCanonicalRevision, 1); assert.equal(saved.metadata.sourceLocalId, localId);
    assert.match(await saved.file.text(), new RegExp(content)); assert.deepEqual(saved.state, state(text));
  }
  store.close();
});

test('many captures write PDF bytes once and list metadata without reading either payload store', async () => {
  const calls = []; const touches = []; let pdfPuts = 0; let commits = 0;
  const store = createLocalDocumentDraftStore({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    calls.push(args); const objectStore = tx.objectStore.bind(tx);
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => { commits++; });
    tx.objectStore = name => {
      touches.push(name); const object = objectStore(name);
      if (name === 'pdfBytes') for (const method of ['add', 'put']) {
        const original = object[method].bind(object);
        object[method] = (...args) => { pdfPuts++; return original(...args); };
      }
      return object;
    };
  }) });
  const writer = store.createWriter(pdf());
  for (let i = 1; i <= 20; i++) {
    assert.equal((await writer.capture(state(String(i)))).sequence, i);
    assert.equal(commits, i, 'receipt follows transaction complete');
  }
  assert.equal(pdfPuts, 1); assert.equal(touches.filter(name => name === 'pdfBytes').length, 1);
  calls.length = 0; touches.length = 0;
  const rows = await store.listDrafts();
  assert.deepEqual(calls, [[['sessions'], 'readonly']]); assert.deepEqual(touches, ['sessions']);
  assert.equal(rows[0].sequence, 20); assert.equal(Object.hasOwn(rows[0], 'blob'), false); assert.equal(Object.hasOwn(rows[0], 'state'), false);
  store.close();
});

test('explicit discard checks the current sequence and tombstones the session against later or queued writes', async () => {
  const indexedDB = new IDBFactory(); const store = createLocalDocumentDraftStore({ indexedDB });
  const writer = store.createWriter(pdf()); await writer.capture(state('one')); await writer.capture(state('two'));
  await assert.rejects(store.discardDraft(writer.sessionId, { expectedSequence: 1 }), { code: 'sequence-conflict' });
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 2 })).state, state('two'));
  const other = createLocalDocumentDraftStore({ indexedDB });
  // The discard transaction starts before this writer's queued capture.
  const discard = other.discardDraft(writer.sessionId, { expectedSequence: 2 });
  const late = writer.capture(state('late'));
  const outcomes = await Promise.allSettled([discard, late]);
  // Either lock ordering is safe: newer commit vetoes discard, or tombstone
  // vetoes the newer write. They must never both claim success.
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  if (outcomes[0].status === 'rejected') {
    assert.equal(outcomes[0].reason.code, 'sequence-conflict');
    await other.discardDraft(writer.sessionId, { expectedSequence: 3 });
  } else assert.equal(outcomes[1].reason.code, 'discarded');
  assert.deepEqual(await store.listDrafts(), []);
  await assert.rejects(writer.capture(state('cannot resurrect')), { code: 'discarded' });
  await assert.rejects(store.readDraft(writer.sessionId, { expectedSequence: 3 }), { code: 'discarded' });
  store.close(); other.close();
  const cold = createLocalDocumentDraftStore({ indexedDB }); assert.deepEqual(await cold.listDrafts(), []); cold.close();
});

test('quota failure rolls back initial and later captures, preserves the last good draft, and allows retry', async () => {
  const factory = new IDBFactory(); let failStore = 'pdfBytes';
  const store = createLocalDocumentDraftStore({ indexedDB: observedFactory(factory, (tx, args) => {
    if (args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name);
      if (name === failStore) for (const method of ['add', 'put']) object[method] = () => { throw new DOMException('Full', 'QuotaExceededError'); };
      return object;
    };
  }) });
  const writer = store.createWriter(pdf());
  await assert.rejects(writer.capture(state('failed first')), { name: 'QuotaExceededError' });
  await assert.rejects(writer.flush(), { name: 'QuotaExceededError' });
  assert.deepEqual(await store.listDrafts(), []);
  failStore = null; const good = await writer.capture(state('good')); assert.equal(good.sequence, 2);
  failStore = 'snapshots'; await assert.rejects(writer.capture(state('failed later')), { name: 'QuotaExceededError' });
  const preserved = await store.readDraft(writer.sessionId, { expectedSequence: 2 });
  assert.deepEqual(preserved.state, state('good')); assert.match(await preserved.file.text(), /original/);
  failStore = null; assert.equal((await writer.capture(state('retry'))).sequence, 4);
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 4 })).state, state('retry'));
  store.close();
});

test('request success followed by transaction abort does not issue a receipt or partial recovery data', async () => {
  let inject = true;
  const store = createLocalDocumentDraftStore({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    if (!inject || args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name); const put = object.put.bind(object);
      object.put = (...args) => { const request = put(...args); request.addEventListener('success', () => { if (inject) { inject = false; tx.abort(); } }); return request; };
      return object;
    };
  }) });
  const writer = store.createWriter(pdf()); await assert.rejects(writer.capture(state()));
  assert.deepEqual(await store.listDrafts(), []);
  const receipt = await writer.capture(state('retry')); assert.equal(receipt.sequence, 2); store.close();
});

test('seal synchronously blocks new captures and drains accepted writes; close never deletes drafts', async () => {
  const indexedDB = new IDBFactory(); const store = createLocalDocumentDraftStore({ indexedDB });
  const writer = store.createWriter(pdf()); assert.equal(await writer.flush(), null);
  const first = writer.capture(state('first')); const last = writer.capture(state('last'));
  assert.equal(writer.seal(), last);
  assert.throws(() => writer.capture(state('too late')), { code: 'sealed' });
  await first; assert.equal((await writer.seal()).sequence, 2); store.close();
  assert.throws(() => store.createWriter(pdf()), { code: 'closed' });
  assert.throws(() => writer.capture(state()), { code: 'closed' });
  await assert.rejects(store.listDrafts(), { code: 'closed' });
  const cold = createLocalDocumentDraftStore({ indexedDB });
  assert.deepEqual((await cold.readDraft(writer.sessionId, { expectedSequence: 2 })).state, state('last')); cold.close();
});

test('strict bounded snapshots require all six valid local payloads before any disk write', async () => {
  let opens = 0;
  const store = createLocalDocumentDraftStore({ indexedDB: { open() { opens++; throw Error('unexpected storage'); } } });
  const writer = store.createWriter(pdf());
  for (const change of [s => { delete s.entries[`pdfData_${localId}`]; }, s => { s.entries.extra = '{}'; },
    s => { s.entries[`callouts_${localId}`] = '{}'; }, s => { s.entries[`pdfSidebar_${localId}`] = 'invalid'; },
    s => { s.pdfId = 'wrong'; }, s => { Object.defineProperty(s, 'hidden', { value: true }); }]) {
    const input = state(); change(input); assert.throws(() => writer.capture(input));
  }
  assert.equal(opens, 0); store.close();
  const exact = JSON.stringify(state()); const size = Buffer.byteLength(exact);
  const limited = createLocalDocumentDraftStore({ indexedDB: new IDBFactory(), maxStateBytes: size - 1 });
  assert.throws(() => limited.createWriter(pdf()).capture(state()), { code: 'state-too-large' }); limited.close();
  const boundary = createLocalDocumentDraftStore({ indexedDB: new IDBFactory(), maxStateBytes: size });
  await boundary.createWriter(pdf()).capture(state()); boundary.close();
});

test('draft change events follow committed writes and discard, but never failed writes', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const surface = new EventTarget(); surface.Event = Event; let events = 0; let commits = 0; let abort = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: surface });
  t.after(() => previous ? Object.defineProperty(globalThis, 'window', previous) : delete globalThis.window);
  surface.addEventListener('local-document-draft-changed', () => { events++; assert.ok(commits >= events); });
  const store = createLocalDocumentDraftStore({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    if (args[1] === 'readwrite') { tx.addEventListener('complete', () => { commits++; }); if (abort) tx.abort(); }
  }) });
  const writer = store.createWriter(pdf()); await writer.capture(state());
  assert.equal(events, 1);
  const [metadata] = await store.listDrafts(); assert.equal(metadata.updatedAt, metadata.updated_at);
  abort = true; await assert.rejects(writer.capture(state('failed'))); assert.equal(events, 1);
  abort = false; await store.discardDraft(writer.sessionId, { expectedSequence: 1 }); assert.equal(events, 2); store.close();
});

test('a newer canonical page file cannot change bytes or state retained by the independent draft database', async () => {
  const indexedDB = new IDBFactory(); const library = createLocalDocumentStore({ indexedDB });
  const original = await library.importLocalDocument(pdf('old page layout'));
  const opened = await library.openLocalDocument(original.localId);
  const drafts = createLocalDocumentDraftStore({ indexedDB }); const writer = drafts.createWriter(opened);
  const oldState = buildLocalDocumentState({ pdfId: original.localId, pageNames: { 2: 'Old page two' } });
  await writer.capture(oldState);
  await library.replaceLocalDocument(original.localId, pdf('new page layout'), { expectedRevision: 1,
    state: buildLocalDocumentState({ pdfId: original.localId, pageNames: { 1: 'Remapped page one' } }) });
  const saved = await drafts.readDraft(writer.sessionId, { expectedSequence: 1 });
  assert.match(await saved.file.text(), /old page layout/); assert.deepEqual(saved.state, oldState);
  assert.match(await (await library.openLocalDocument(original.localId)).text(), /new page layout/);
  drafts.close(); library.close();
});

test('corrupt or missing bytes, metadata, and state fail closed without repairing or deleting the draft', async () => {
  const changes = [
    ['pdfBytes', (_value, object, sessionId) => object.delete(sessionId)],
    ['snapshots', (_value, object, sessionId) => object.delete(sessionId)],
    ['pdfBytes', (value, object) => object.put({ ...value, fileId: crypto.randomUUID() })],
    ['snapshots', (value, object) => object.put({ ...value, writerId: crypto.randomUUID() })],
    ['snapshots', (value, object) => object.put({ ...value, sequence: 90 })],
    ['snapshots', (value, object) => object.put({ ...value, state: { ...value.state, entries: {} } })],
    ['pdfBytes', (value, object) => object.put({ ...value, blob: new Blob(['bad']) })],
    ['pdfBytes', (value, object) => object.put({ ...value, blob: new Blob(['x'.repeat(value.blob.size)]) })],
  ];
  for (const [name, change] of changes) {
    const indexedDB = new IDBFactory(); let writeTransactions = 0;
    const drafts = createLocalDocumentDraftStore({ indexedDB: observedFactory(indexedDB, (_tx, args) => { if (args[1] === 'readwrite') writeTransactions++; }) });
    const writer = drafts.createWriter(pdf()); await writer.capture(state());
    await alter(indexedDB, [name], tx => {
      const object = tx.objectStore(name); const request = object.get(writer.sessionId);
      request.onsuccess = () => change(request.result, object, writer.sessionId);
    });
    await assert.rejects(drafts.readDraft(writer.sessionId, { expectedSequence: 1 }));
    assert.equal(writeTransactions, 1, 'failed recovery is read-only');
    assert.equal((await drafts.listDrafts()).length, 1, 'damaged payload still has its recovery metadata'); drafts.close();
  }
});

test('missing or changed session metadata cannot be recreated by a previously committed writer', async () => {
  for (const change of ['delete', 'sequence', 'scope']) {
    const indexedDB = new IDBFactory(); const drafts = createLocalDocumentDraftStore({ indexedDB });
    const writer = drafts.createWriter(pdf()); await writer.capture(state('prior'));
    await alter(indexedDB, ['sessions'], tx => {
      const object = tx.objectStore('sessions'); const request = object.get(writer.sessionId);
      request.onsuccess = () => {
        if (change === 'delete') object.delete(writer.sessionId);
        else object.put({ ...request.result, ...(change === 'sequence' ? { sequence: 50 } : { fileId: crypto.randomUUID() }) });
      };
    });
    await assert.rejects(writer.capture(state('cannot overwrite')), { code: change === 'delete' ? 'corrupt' : 'sequence-conflict' }); drafts.close();
  }
});

test('active transaction timeout aborts new state and preserves the previous durable draft', async () => {
  const indexedDB = new IDBFactory(); let keepAlive = false; let requests = 0;
  const store = createLocalDocumentDraftStore({ timeoutMs: 60, indexedDB: observedFactory(indexedDB, (tx, args) => {
    if (!keepAlive || args[1] !== 'readwrite') return;
    const again = () => {
      try {
        const request = tx.objectStore('sessions').get('keep-alive'); requests++;
        request.onsuccess = () => { if (keepAlive) again(); };
      } catch (error) { if (!['TransactionInactiveError', 'InvalidStateError'].includes(error.name)) throw error; }
    };
    again();
  }) });
  const writer = store.createWriter(pdf()); await writer.capture(state('last good'));
  keepAlive = true; await assert.rejects(writer.capture(state('timed out')), { code: 'timed-out' }); keepAlive = false;
  assert.ok(requests > 1);
  assert.deepEqual((await store.readDraft(writer.sessionId, { expectedSequence: 1 })).state, state('last good'));
  assert.equal((await writer.capture(state('retry'))).sequence, 3); store.close();
});

test('graceful close permits an active transaction to finish, while forced connection close can reopen', async () => {
  const indexedDB = new IDBFactory(); let store;
  store = createLocalDocumentDraftStore({ indexedDB: observedFactory(indexedDB, (_tx, args) => { if (args[1] === 'readwrite') store.close(); }) });
  const writer = store.createWriter(pdf()); const receipt = await writer.capture(state('closing'));
  let connection;
  const cold = createLocalDocumentDraftStore({ indexedDB: observedFactory(indexedDB, (_tx, _args, db) => { connection = db; }) });
  assert.deepEqual((await cold.readDraft(receipt.sessionId, { expectedSequence: 1 })).state, state('closing'));
  forceCloseDatabase(connection); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await cold.listDrafts()).length, 1); cold.close();
});

test('blocked, timed-out, unavailable, and closed-during-open requests reject and close late connections', async () => {
  for (const mode of ['blocked', 'timed-out', 'closed']) {
    let request;
    const store = createLocalDocumentDraftStore({ indexedDB: { open() { return (request = {}); } }, timeoutMs: 5 });
    const pending = store.listDrafts();
    if (mode === 'blocked') request.onblocked();
    if (mode === 'closed') store.close();
    await assert.rejects(pending, { code: mode });
    let closes = 0; request.result = { close() { closes++; } }; request.onsuccess(); assert.equal(closes, 1);
    let aborts = 0; request.transaction = { abort() { aborts++; } }; request.onupgradeneeded(); assert.equal(aborts, 1);
    store.close();
  }
  const missing = createLocalDocumentDraftStore({ indexedDB: null });
  await assert.rejects(missing.listDrafts(), { code: 'unavailable' }); missing.close();
});

test('invalid File, PDF header, limits and exact recovery selectors fail without changing storage', async () => {
  const store = createLocalDocumentDraftStore({ indexedDB: new IDBFactory(), maxDocumentBytes: 100 });
  for (const file of [{ ...pdf() }, new File(['%PDF-1.7'], 'raw.pdf'), Object.assign(pdf(), { id: 'cloud' }),
    Object.assign(pdf(), { localRevision: 0 }), pdf('x'.repeat(100))]) assert.throws(() => store.createWriter(file), { code: 'invalid-input' });
  const invalid = Object.assign(new File(['not pdf'], 'bad.pdf'), { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 });
  await assert.rejects(store.createWriter(invalid).capture(state()), { code: 'invalid-input' });
  const writer = store.createWriter(pdf()); await writer.capture(state());
  for (const sequence of [undefined, 0, -1, 1.5, Infinity]) {
    await assert.rejects(store.readDraft(writer.sessionId, { expectedSequence: sequence }), { code: 'invalid-input' });
    await assert.rejects(store.discardDraft(writer.sessionId, { expectedSequence: sequence }), { code: 'invalid-input' });
  }
  await assert.rejects(store.readDraft('bad', { expectedSequence: 1 }), { code: 'invalid-input' });
  await assert.rejects(store.readDraft(crypto.randomUUID(), { expectedSequence: 1 }), { code: 'not-found' });
  assert.equal((await store.listDrafts()).length, 1); store.close();
});

test('failed explicit discard rolls back its tombstone and both payload deletions', async () => {
  let inject = false;
  const store = createLocalDocumentDraftStore({ indexedDB: observedFactory(new IDBFactory(), (tx, args) => {
    if (!inject || args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name);
      if (name === 'snapshots') object.delete = () => { throw new DOMException('Discard failed', 'QuotaExceededError'); };
      return object;
    };
  }) });
  const writer = store.createWriter(pdf()); await writer.capture(state('keep'));
  inject = true; await assert.rejects(store.discardDraft(writer.sessionId, { expectedSequence: 1 }), { name: 'QuotaExceededError' });
  const kept = await store.readDraft(writer.sessionId, { expectedSequence: 1 }); assert.deepEqual(kept.state, state('keep'));
  assert.match(await kept.file.text(), /original/);
  inject = false; await writer.capture(state('still writable')); await store.discardDraft(writer.sessionId, { expectedSequence: 2 });
  assert.deepEqual(await store.listDrafts(), []); store.close();
});

test('restricted IndexedDB access is an explicit failed operation, not a module-load or memory fallback', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Restricted', 'SecurityError'); } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'indexedDB', previous) : delete globalThis.indexedDB);
  const store = createLocalDocumentDraftStore(); const writer = store.createWriter(pdf());
  await assert.rejects(writer.capture(state()), { name: 'SecurityError' });
  await assert.rejects(store.listDrafts(), { name: 'SecurityError' }); store.close();
});
