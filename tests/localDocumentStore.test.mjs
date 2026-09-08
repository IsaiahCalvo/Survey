import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, forceCloseDatabase } from 'fake-indexeddb';
import { createLocalDocumentStore, LOCAL_DOCUMENT_DB_NAME } from '../src/services/localDocumentStore.js';

const pdf = (text = 'first', name = 'plan.pdf') => new File([`%PDF-1.7\n${text}\n%%EOF`], name, { type: 'application/pdf' });

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

test('local import commits a stable manifest and exact PDF bytes that reopen cold without cloud identity', async () => {
  const indexedDB = new IDBFactory();
  const first = createLocalDocumentStore({ indexedDB });
  const input = pdf();
  input.id = 'cloud-row'; input.user_id = 'actor'; input.supabaseFilePath = 'private/path'; input.filePath = '/original.pdf';
  const manifest = await first.importLocalDocument(input);
  assert.match(manifest.localId, /^local:[0-9a-f-]{36}$/);
  assert.equal(manifest.id, manifest.localId);
  assert.equal(manifest.storageMode, 'local');
  assert.equal(manifest.revision, 1);
  assert.equal(manifest.name, 'plan.pdf');
  assert.equal(manifest.size, input.size);
  assert.deepEqual(await first.listLocalDocuments(), [manifest]);
  first.close();
  const cold = createLocalDocumentStore({ indexedDB });
  const opened = await cold.openLocalDocument(manifest.localId);
  assert.equal(opened.localId, manifest.localId);
  assert.equal(opened._surveyPdfId, manifest.localId);
  assert.equal(opened.localRevision, 1);
  assert.equal(opened.storageMode, 'local');
  for (const key of ['id', 'user_id', 'supabaseFilePath', 'filePath']) assert.equal(Object.hasOwn(opened, key), false);
  assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), new Uint8Array(await input.arrayBuffer()));
  assert.equal(input.id, 'cloud-row', 'import never rewrites caller metadata');
  cold.close();
});

test('same-name same-size imports remain separate; concurrent replacements allow exactly one expected revision', async () => {
  const indexedDB = new IDBFactory();
  const first = createLocalDocumentStore({ indexedDB }); const second = createLocalDocumentStore({ indexedDB });
  const one = await first.importLocalDocument(pdf()); const two = await first.importLocalDocument(pdf());
  assert.notEqual(one.localId, two.localId);
  const attempts = await Promise.allSettled([
    first.replaceLocalDocument(one.localId, pdf('first replacement', 'renamed.pdf'), { expectedRevision: 1 }),
    second.replaceLocalDocument(one.localId, pdf('second replacement', 'second.pdf'), { expectedRevision: 1 }),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'revision-conflict');
  const winner = attempts.find(result => result.status === 'fulfilled').value;
  assert.equal(winner.revision, 2); assert.equal(winner.created_at, one.created_at);
  const opened = await second.openLocalDocument(one.localId);
  assert.equal(opened.localId, one.localId); assert.equal(opened._surveyPdfId, one.localId);
  assert.equal(opened.name, winner.name); assert.equal(opened.localRevision, 2);
  assert.match(await opened.text(), winner.name === 'renamed.pdf' ? /first replacement/ : /second replacement/);
  assert.equal((await first.openLocalDocument(two.localId)).localRevision, 1);
  await assert.rejects(first.replaceLocalDocument(one.localId, pdf(), {}), { code: 'invalid-input' });
  first.close(); second.close();
});

test('state-only save preserves PDF bytes and page replacement atomically reopens its matching state', async () => {
  const factory = new IDBFactory(); const transactions = [];
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (_tx, args) => transactions.push(args)) });
  const imported = await store.importLocalDocument(pdf('original pages'));
  const state = { version: 1, pdfId: imported.localId, entries: { [`annotationsByPage_${imported.localId}`]: '{"1":{"objects":[{"id":"old"}]}}' } };
  transactions.length = 0;
  const saved = await store.saveLocalDocumentState(imported.localId, state, { expectedRevision: 1 });
  assert.equal(saved.revision, 2);
  assert.deepEqual(transactions, [[['manifests', 'documentState'], 'readwrite']], 'state save must not touch the PDF byte store');
  state.entries[`annotationsByPage_${imported.localId}`] = 'changed after save';
  const restored = await store.openLocalDocument(imported.localId);
  assert.match(await restored.text(), /original pages/);
  assert.equal(restored.localRevision, 2);
  assert.match(restored._localDocumentState.entries[`annotationsByPage_${imported.localId}`], /old/);
  const remapped = { version: 1, pdfId: imported.localId, entries: { [`annotationsByPage_${imported.localId}`]: '{"2":{"objects":[{"id":"old"}]}}' } };
  await store.replaceLocalDocument(imported.localId, pdf('new page layout'), { expectedRevision: 2, state: remapped });
  store.close();
  const cold = createLocalDocumentStore({ indexedDB: factory });
  const reopened = await cold.openLocalDocument(imported.localId);
  assert.equal(reopened.localRevision, 3); assert.match(await reopened.text(), /new page layout/);
  assert.deepEqual(reopened._localDocumentState, remapped);
  await cold.replaceLocalDocument(imported.localId, pdf('parse rewrite same pages'), { expectedRevision: 3 });
  assert.deepEqual((await cold.openLocalDocument(imported.localId))._localDocumentState, remapped, 'omitted state preserves its last committed snapshot');
  cold.close();
});

test('state snapshot bounds count exact UTF-8 JSON and reject lossy/complex values without advancing revision', async () => {
  const indexedDB = new IDBFactory(); const seed = createLocalDocumentStore({ indexedDB });
  const row = await seed.importLocalDocument(pdf());
  const state = { version: 1, pdfId: row.localId, entries: { 'keyé😀': 'é漢😀\ud800\n\\"' } };
  const size = Buffer.byteLength(JSON.stringify(state));
  const exact = createLocalDocumentStore({ indexedDB, maxStateBytes: size });
  await exact.saveLocalDocumentState(row.localId, state, { expectedRevision: 1 });
  const limited = createLocalDocumentStore({ indexedDB, maxStateBytes: size - 1 });
  await assert.rejects(limited.saveLocalDocumentState(row.localId, state, { expectedRevision: 2 }), { code: 'state-too-large' });
  const invalid = [undefined, NaN, Infinity, -0, 1n, () => {}, new Date(), new Map(), new Array(2)];
  for (const value of invalid) {
    await assert.rejects(seed.saveLocalDocumentState(row.localId, { ...state, extra: value }, { expectedRevision: 2 }), { code: 'invalid-state' });
  }
  const cyclic = { ...state }; cyclic.self = cyclic;
  await assert.rejects(seed.saveLocalDocumentState(row.localId, cyclic, { expectedRevision: 2 }), { code: 'invalid-state' });
  const accessor = { ...state }; Object.defineProperty(accessor, 'extra', { enumerable: true, get() { assert.fail('must not invoke state getters'); } });
  await assert.rejects(seed.saveLocalDocumentState(row.localId, accessor, { expectedRevision: 2 }), { code: 'invalid-state' });
  await assert.rejects(seed.saveLocalDocumentState(row.localId, { ...state, pdfId: 'other' }, { expectedRevision: 2 }), { code: 'invalid-state' });
  await assert.rejects(seed.saveLocalDocumentState(row.localId, { ...state, extra: new Array(250_001).fill(1) }, { expectedRevision: 2 }), { code: 'state-too-large' });
  let nested = {}; for (let depth = 0; depth < 101; depth++) nested = { child: nested };
  await assert.rejects(seed.saveLocalDocumentState(row.localId, { ...state, extra: nested }, { expectedRevision: 2 }), { code: 'state-too-large' });
  const persisted = await seed.openLocalDocument(row.localId);
  assert.equal(persisted.localRevision, 2); assert.deepEqual(persisted._localDocumentState, state);
  assert.deepEqual(new Uint8Array(await persisted.arrayBuffer()), new Uint8Array(await pdf().arrayBuffer()));
  seed.close(); exact.close(); limited.close();
});

test('strict state copying rejects non-enumerable own values and accessors without silently dropping them', async () => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  const row = await store.importLocalDocument(pdf());
  for (const getter of [false, true]) {
    const state = { version: 1, pdfId: row.localId, entries: {} };
    Object.defineProperty(state, 'hidden', getter
      ? { get() { assert.fail('must not invoke a hidden getter'); } }
      : { value: 'would otherwise be lost' });
    await assert.rejects(store.saveLocalDocumentState(row.localId, state, { expectedRevision: 1 }), { code: 'invalid-state' });
  }
  const array = ['one']; Object.defineProperty(array, 'hidden', { value: 'also lost' });
  await assert.rejects(store.saveLocalDocumentState(row.localId, { version: 1, pdfId: row.localId, entries: {}, extra: array }, { expectedRevision: 1 }), { code: 'invalid-state' });
  assert.equal((await store.openLocalDocument(row.localId)).localRevision, 1);
  const allowed = { version: 1, pdfId: row.localId, entries: {}, extra: ['one', 'two'] };
  await store.saveLocalDocumentState(row.localId, allowed, { expectedRevision: 1 });
  assert.deepEqual((await store.openLocalDocument(row.localId))._localDocumentState, allowed, 'array length is the only permitted non-enumerable built-in key');
  store.close();
});

test('failed state or page-state transaction preserves the prior coherent bytes/state/revision and retries', async () => {
  const factory = new IDBFactory(); let inject = false;
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (tx, args) => {
    if (!inject || args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => { const object = objectStore(name); if (name === 'documentState') object.put = () => { throw new DOMException('Full disk', 'QuotaExceededError'); }; return object; };
  }) });
  const row = await store.importLocalDocument(pdf('original'));
  const original = { version: 1, pdfId: row.localId, entries: { marks: 'old page 1' } };
  await store.saveLocalDocumentState(row.localId, original, { expectedRevision: 1 });
  const next = { ...original, entries: { marks: 'remapped page 2' } };
  inject = true;
  await assert.rejects(store.saveLocalDocumentState(row.localId, next, { expectedRevision: 2 }), { name: 'QuotaExceededError' });
  await assert.rejects(store.replaceLocalDocument(row.localId, pdf('different pages'), { expectedRevision: 2, state: next }), { name: 'QuotaExceededError' });
  const preserved = await store.openLocalDocument(row.localId);
  assert.equal(preserved.localRevision, 2); assert.deepEqual(preserved._localDocumentState, original);
  assert.match(await preserved.text(), /original/);
  inject = false;
  await store.replaceLocalDocument(row.localId, pdf('different pages'), { expectedRevision: 2, state: next });
  const updated = await store.openLocalDocument(row.localId);
  assert.equal(updated.localRevision, 3); assert.deepEqual(updated._localDocumentState, next); assert.match(await updated.text(), /different pages/);
  store.close();
});

test('state-only saves and page replacements share one revision CAS across connections', async () => {
  const indexedDB = new IDBFactory(); const first = createLocalDocumentStore({ indexedDB }); const second = createLocalDocumentStore({ indexedDB });
  const row = await first.importLocalDocument(pdf('original'));
  const state = { version: 1, pdfId: row.localId, entries: { marks: 'saved state' } };
  const pageState = { ...state, entries: { marks: 'new page state' } };
  const results = await Promise.allSettled([
    first.saveLocalDocumentState(row.localId, state, { expectedRevision: 1 }),
    second.replaceLocalDocument(row.localId, pdf('new pages'), { expectedRevision: 1, state: pageState }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'revision-conflict');
  const opened = await second.openLocalDocument(row.localId);
  assert.equal(opened.localRevision, 2);
  const stateWon = results[0].status === 'fulfilled';
  assert.deepEqual(opened._localDocumentState, stateWon ? state : pageState);
  assert.match(await opened.text(), stateWon ? /original/ : /new pages/);
  first.close(); second.close();
});

test('cold upgrade adds state store without replacing a v1 manifest or original PDF bytes', async () => {
  const indexedDB = new IDBFactory(); const localId = `local:${crypto.randomUUID()}`; const file = pdf('v1 source');
  const manifest = { id: localId, localId, storageMode: 'local', name: file.name, size: file.size, type: file.type,
    created_at: '2026-09-08T00:00:00.000Z', updated_at: '2026-09-08T00:00:00.000Z', revision: 1 };
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DOCUMENT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('manifests', { keyPath: 'localId' }).add(manifest);
      request.result.createObjectStore('pdfBytes', { keyPath: 'localId' }).add({ localId, revision: 1, blob: file.slice() });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  db.close();
  const store = createLocalDocumentStore({ indexedDB });
  assert.deepEqual(await store.listLocalDocuments(), [manifest]);
  const opened = await store.openLocalDocument(localId);
  assert.equal(Object.hasOwn(opened, '_localDocumentState'), false); assert.match(await opened.text(), /v1 source/);
  const state = { version: 1, pdfId: localId, entries: {} };
  await store.saveLocalDocumentState(localId, state, { expectedRevision: 1 });
  assert.deepEqual((await store.openLocalDocument(localId))._localDocumentState, state);
  assert.match(await (await store.openLocalDocument(localId)).text(), /v1 source/);
  store.close();
});

test('a missing committed state record fails reopen while preserving its manifest and PDF', async () => {
  const indexedDB = new IDBFactory(); const store = createLocalDocumentStore({ indexedDB });
  const row = await store.importLocalDocument(pdf('preserved'));
  await store.saveLocalDocumentState(row.localId, { version: 1, pdfId: row.localId, entries: {} }, { expectedRevision: 1 });
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open(LOCAL_DOCUMENT_DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction('documentState', 'readwrite'); tx.objectStore('documentState').delete(row.localId);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  await assert.rejects(store.openLocalDocument(row.localId), { code: 'corrupt' });
  assert.equal((await store.listLocalDocuments())[0].revision, 2);
  await store.saveLocalDocumentState(row.localId, { version: 1, pdfId: row.localId, entries: {} }, { expectedRevision: 2 });
  assert.match(await (await store.openLocalDocument(row.localId)).text(), /preserved/);
  store.close();
});

test('list reads metadata only; writes notify and resolve only after real transaction completion', async t => {
  const factory = new IDBFactory(); const transactions = []; let commits = 0; let events = 0;
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const surface = new EventTarget(); surface.Event = Event;
  surface.addEventListener('local-document-store-changed', () => { events++; assert.ok(commits >= events, 'event follows transaction complete'); });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: surface });
  t.after(() => { if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else delete globalThis.window; });
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (tx, args) => {
    transactions.push(args);
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => { commits++; });
  }) });
  const manifest = await store.importLocalDocument(pdf());
  assert.equal(commits, 1); assert.equal(events, 1);
  transactions.length = 0;
  const rows = await store.listLocalDocuments();
  assert.equal(rows.length, 1);
  assert.deepEqual(transactions, [[['manifests'], 'readonly']]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['created_at', 'id', 'localId', 'name', 'revision', 'size', 'storageMode', 'type', 'updated_at'].sort());
  await store.replaceLocalDocument(manifest.localId, pdf('new'), { expectedRevision: 1 });
  assert.equal(commits, 2); assert.equal(events, 2);
  await assert.rejects(store.replaceLocalDocument(manifest.localId, pdf(), { expectedRevision: 1 }), { code: 'revision-conflict' });
  assert.equal(events, 2, 'failed save never announces a durable change');
  store.close();
});

test('quota failure after a manifest write rolls back both initial import and replacement, preserving prior bytes', async () => {
  const factory = new IDBFactory(); let inject = true;
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (tx, args) => {
    if (args[1] !== 'readwrite' || !inject) return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name);
      if (name === 'pdfBytes') for (const method of ['add', 'put']) object[method] = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
      return object;
    };
  }) });
  await assert.rejects(store.importLocalDocument(pdf()), { name: 'QuotaExceededError' });
  assert.deepEqual(await store.listLocalDocuments(), []);
  inject = false;
  const original = await store.importLocalDocument(pdf('original'));
  inject = true;
  await assert.rejects(store.replaceLocalDocument(original.localId, pdf('replacement', 'new-name.pdf'), { expectedRevision: 1 }), { name: 'QuotaExceededError' });
  assert.deepEqual(await store.listLocalDocuments(), [original]);
  assert.equal(await (await store.openLocalDocument(original.localId)).text(), await pdf('original').text());
  inject = false;
  assert.equal((await store.replaceLocalDocument(original.localId, pdf('retry'), { expectedRevision: 1 })).revision, 2);
  store.close();
});

test('request success followed by transaction abort never reports a successful import', async () => {
  const factory = new IDBFactory(); let abortNext = true;
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (tx, args) => {
    if (!abortNext || args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const store = objectStore(name); const add = store.add.bind(store);
      store.add = (...values) => { const request = add(...values); request.addEventListener('success', () => { if (abortNext) { abortNext = false; tx.abort(); } }); return request; };
      return store;
    };
  }) });
  await assert.rejects(store.importLocalDocument(pdf()));
  assert.deepEqual(await store.listLocalDocuments(), []);
  const next = await store.importLocalDocument(pdf('retry'));
  assert.match(await (await store.openLocalDocument(next.localId)).text(), /retry/);
  store.close();
});

test('active transaction timeout aborts queued changes and preserves the last committed PDF and state', async () => {
  const factory = new IDBFactory(); const seed = createLocalDocumentStore({ indexedDB: factory });
  const row = await seed.importLocalDocument(pdf('last good bytes'));
  const oldState = { version: 1, pdfId: row.localId, entries: { marks: 'last good state' } };
  await seed.saveLocalDocumentState(row.localId, oldState, { expectedRevision: 1 }); seed.close();
  let keepAlive = true; let requests = 0;
  const store = createLocalDocumentStore({ timeoutMs: 100, indexedDB: observedFactory(factory, (tx, args) => {
    if (args[1] !== 'readwrite' || !keepAlive) return;
    // Real IndexedDB requests keep this transaction live; no fake completion
    // event or mocked transaction promise substitutes for its eventual abort.
    const again = () => {
      try {
        const request = tx.objectStore('manifests').get(row.localId); requests++;
        request.onsuccess = () => { if (keepAlive) again(); };
      } catch (error) {
        if (error.name !== 'TransactionInactiveError' && error.name !== 'InvalidStateError') throw error;
      }
    };
    again();
  }) });
  await assert.rejects(store.replaceLocalDocument(row.localId, pdf('uncommitted bytes'), {
    expectedRevision: 2, state: { ...oldState, entries: { marks: 'uncommitted state' } },
  }), { code: 'timed-out' });
  keepAlive = false;
  assert.ok(requests > 1, 'timeout occurred during an active request chain, not while opening the database');
  const preserved = await store.openLocalDocument(row.localId);
  assert.equal(preserved.localRevision, 2); assert.deepEqual(preserved._localDocumentState, oldState);
  assert.match(await preserved.text(), /last good bytes/);
  store.close();
});

test('close is graceful for an active write, and does not pretend to cancel its committed result', async () => {
  const factory = new IDBFactory(); let store;
  store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (_tx, args) => {
    if (args[1] === 'readwrite') store.close();
  }) });
  const committed = await store.importLocalDocument(pdf('active at close'));
  await assert.rejects(store.listLocalDocuments(), { code: 'closed' });
  const cold = createLocalDocumentStore({ indexedDB: factory });
  assert.match(await (await cold.openLocalDocument(committed.localId)).text(), /active at close/);
  cold.close();
});

test('bounded invalid PDF input is rejected before disk access; prior library remains intact', async () => {
  const store = createLocalDocumentStore({ indexedDB: { open() { assert.fail('invalid inputs must not open storage'); } }, maxDocumentBytes: 100 });
  for (const file of [new File([], 'empty.pdf'), new File(['not a pdf'], 'bad.pdf'), pdf('x'.repeat(101)), pdf('ok', 'x'.repeat(1025))]) {
    await assert.rejects(store.importLocalDocument(file), { code: 'invalid-input' });
  }
  await assert.rejects(store.openLocalDocument('cloud-uuid'), { code: 'invalid-input' });
  await assert.rejects(store.replaceLocalDocument('local:00000000-0000-0000-0000-000000000000', pdf(), { expectedRevision: 0 }), { code: 'invalid-input' });
  store.close();
});

test('closed handles fail explicitly; a forced closed database can be reopened without losing the library', async () => {
  const factory = new IDBFactory(); let connection;
  const store = createLocalDocumentStore({ indexedDB: observedFactory(factory, (_tx, _args, db) => { connection = db; }) });
  const manifest = await store.importLocalDocument(pdf());
  forceCloseDatabase(connection);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await store.openLocalDocument(manifest.localId)).localRevision, 1);
  store.close();
  await assert.rejects(store.listLocalDocuments(), { code: 'closed' });
  await assert.rejects(store.importLocalDocument(pdf()), { code: 'closed' });
  const fresh = createLocalDocumentStore({ indexedDB: factory });
  assert.equal((await fresh.openLocalDocument(manifest.localId)).localId, manifest.localId);
  fresh.close();
});

test('blocked, timed-out, unavailable and closed-during-open cases reject and close late connections', async () => {
  for (const mode of ['blocked', 'timed-out', 'close']) {
    let request;
    const store = createLocalDocumentStore({ indexedDB: { open() { return (request = {}); } }, timeoutMs: 5 });
    const result = store.listLocalDocuments();
    if (mode === 'blocked') request.onblocked();
    if (mode === 'close') store.close();
    await assert.rejects(result, { code: mode === 'close' ? 'closed' : mode });
    let closes = 0; request.result = { close() { closes++; } }; request.onsuccess();
    assert.equal(closes, 1);
    store.close();
  }
  const unavailable = createLocalDocumentStore({ indexedDB: null });
  await assert.rejects(unavailable.listLocalDocuments(), { code: 'unavailable' });
  unavailable.close();
});

test('missing or mismatched PDF rows fail closed without deleting metadata', async () => {
  const factory = new IDBFactory(); const store = createLocalDocumentStore({ indexedDB: factory });
  const manifest = await store.importLocalDocument(pdf());
  const db = await new Promise((resolve, reject) => { const request = factory.open(LOCAL_DOCUMENT_DB_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction('pdfBytes', 'readwrite'); tx.objectStore('pdfBytes').delete(manifest.localId);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  await assert.rejects(store.openLocalDocument(manifest.localId), { code: 'corrupt' });
  assert.deepEqual(await store.listLocalDocuments(), [manifest]);
  await assert.rejects(store.openLocalDocument('local:00000000-0000-0000-0000-000000000000'), { code: 'not-found' });
  store.close();
});
