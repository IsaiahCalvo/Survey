import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalDocumentDraftStore, LOCAL_DOCUMENT_DRAFT_DB_NAME } from '../src/services/localDocumentDraftStore.js';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { fingerprintLocalPdfBlob, sameLocalPdfBytes } from '../src/services/localPdfByteFingerprint.js';

const localId = 'local:00000000-0000-4000-8000-000000000001';
const names = ['sessions', 'pdfBytes', 'snapshots', 'sharedPdfBytes'];
const file = (text = 'AAAA') => Object.assign(new File([`%PDF-1.7\n${text}\n%%EOF`], 'same.pdf', { type: 'application/pdf' }),
  { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: 1 });
const state = (text = 'mark') => buildLocalDocumentState({ pdfId: localId,
  annotationsByPage: { 1: { objects: [{ id: text, meta: { authorId: 'unchanged' } }] } }, pageNames: { 1: text } });
const options = receipt => ({ expectedSequence: receipt.sequence });
const open = (factory, version, upgrade) => new Promise((resolve, reject) => {
  const request = factory.open(LOCAL_DOCUMENT_DRAFT_DB_NAME, version);
  request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function inspect(factory) {
  const db = await open(factory);
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readonly'); const requests = names.map(name => tx.objectStore(name).getAll());
    tx.oncomplete = () => resolve(Object.fromEntries(names.map((name, i) => [name, requests[i].result])));
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
async function change(factory, stores, run) {
  const db = await open(factory);
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); run(tx);
  }); } finally { db.close(); }
}
function observed(factory, observe) {
  return { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...args) => { const tx = transaction(...args); observe(tx, args); return tx; };
    });
    return request;
  } };
}
function storeFor(t, factory, extra = {}) {
  const store = createLocalDocumentDraftStore({ indexedDB: factory, ...extra }); t.after(() => store.close()); return store;
}

test('additive v3 upgrade preserves every v1 payload while indexing live rows and tombstones', async t => {
  const factory = new IDBFactory(); const sessionId = crypto.randomUUID();
  const writerId = crypto.randomUUID(); const fileId = crypto.randomUUID(); const blob = file();
  const tombstone = { sessionId: crypto.randomUUID(), writerId: crypto.randomUUID(), fileId: crypto.randomUUID(), sequence: 2, discarded: true };
  const row = { sessionId, writerId, fileId, sourceLocalId: localId, baseCanonicalRevision: 1, sequence: 1,
    name: blob.name, size: blob.size, type: 'application/pdf', discarded: false,
    created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z' };
  const bytes = { sessionId, writerId, fileId, blob: Blob.prototype.slice.call(blob) };
  const storedBytes = structuredClone(bytes);
  const snapshot = { sessionId, writerId, fileId, sequence: 1, state: state() };
  const db = await open(factory, 1, db => { for (const name of names.slice(0, 3)) db.createObjectStore(name, { keyPath: 'sessionId' }); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(names.slice(0, 3), 'readwrite');
    tx.objectStore('sessions').add(row); tx.objectStore('sessions').add(tombstone);
    tx.objectStore('pdfBytes').add(bytes); tx.objectStore('snapshots').add(snapshot);
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  }); db.close();
  const store = storeFor(t, factory);
  assert.equal((await store.listDrafts()).length, 1);
  const upgraded = await inspect(factory);
  assert.deepEqual(upgraded.sessions.find(item => item.sessionId === sessionId), { ...row, active: 1 });
  assert.deepEqual(upgraded.sessions.find(item => item.sessionId === tombstone.sessionId), { ...tombstone, active: 0 });
  assert.deepEqual(upgraded.snapshots, [snapshot]);
  assert.deepEqual(upgraded.pdfBytes[0], storedBytes); assert.equal(upgraded.sharedPdfBytes.length, 0);
  const restored = await store.readDraft(sessionId, { expectedSequence: 1 });
  assert.equal(await restored.file.text(), await blob.text()); assert.deepEqual(restored.state, state());
  await store.createWriter(blob).capture(state('new session'));
  const after = await inspect(factory);
  assert.deepEqual(after.pdfBytes.find(item => item.sessionId === sessionId), storedBytes);
  assert.equal(after.sharedPdfBytes.length, 1, 'new sessions may share, but old inline bytes remain untouched');
});

test('concurrent identical sessions share one immutable payload while keeping all independent recovery states', async t => {
  const factory = new IDBFactory(); const a = storeFor(t, factory); const b = storeFor(t, factory);
  const receipts = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).createWriter(file()).capture(state(`mark-${i}`))));
  const rows = await inspect(factory);
  assert.equal(rows.sharedPdfBytes.length, 1); assert.equal(rows.pdfBytes.length, 8); assert.equal(rows.snapshots.length, 8);
  assert.equal(new Set(rows.pdfBytes.map(row => row.payloadIncarnation)).size, 1);
  assert.equal(rows.pdfBytes.filter(row => Object.hasOwn(row, 'blob')).length, 0);
  for (const [i, receipt] of receipts.entries()) {
    const restored = await a.readDraft(receipt.sessionId, options(receipt));
    assert.deepEqual(restored.state, state(`mark-${i}`)); assert.equal(await restored.file.text(), await file().text());
  }
});

test('equal names, sizes and local identities never share different PDF content', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory);
  const a = await store.createWriter(file('AAAA')).capture(state('a'));
  const b = await store.createWriter(file('BBBB')).capture(state('b'));
  assert.equal((await inspect(factory)).sharedPdfBytes.length, 2);
  assert.match(await (await store.readDraft(a.sessionId, options(a))).file.text(), /AAAA/);
  assert.match(await (await store.readDraft(b.sessionId, options(b))).file.text(), /BBBB/);
});

test('forced hash collision falls back inline and never replaces another session payload', async t => {
  const factory = new IDBFactory(); const key = await fingerprintLocalPdfBlob(file('AAAA'));
  const store = storeFor(t, factory, { fingerprintBlob: async () => key });
  const a = await store.createWriter(file('AAAA')).capture(state('a'));
  const before = (await inspect(factory)).sharedPdfBytes[0];
  const b = await store.createWriter(file('BBBB')).capture(state('b'));
  const rows = await inspect(factory);
  assert.deepEqual(rows.sharedPdfBytes, [before]);
  assert.ok(rows.pdfBytes.find(row => row.sessionId === b.sessionId).blob instanceof Blob);
  assert.match(await (await store.readDraft(a.sessionId, options(a))).file.text(), /AAAA/);
  assert.match(await (await store.readDraft(b.sessionId, options(b))).file.text(), /BBBB/);
});

test('corrupt shared content is rejected on read; new capture keeps an inline copy without repairing the damaged source', async t => {
  const factory = new IDBFactory(); const store = storeFor(t, factory);
  const a = await store.createWriter(file('AAAA')).capture(state('a'));
  await change(factory, ['sharedPdfBytes'], tx => {
    const object = tx.objectStore('sharedPdfBytes'); const request = object.openCursor();
    request.onsuccess = () => request.result.update({ ...request.result.value, blob: file('BBBB') });
  });
  const damaged = (await inspect(factory)).sharedPdfBytes[0];
  await assert.rejects(store.readDraft(a.sessionId, options(a)), { code: 'corrupt' });
  const b = await store.createWriter(file('AAAA')).capture(state('b'));
  const rows = await inspect(factory);
  assert.deepEqual(rows.sharedPdfBytes, [damaged]); assert.equal(rows.snapshots.length, 2);
  assert.ok(rows.pdfBytes.find(row => row.sessionId === b.sessionId).blob);
  assert.equal(await (await store.readDraft(b.sessionId, options(b))).file.text(), await file('AAAA').text());
});

test('unavailable fingerprint or comparison keeps a readable inline draft; shared reads never skip verification', async t => {
  const factory = new IDBFactory(); const normal = storeFor(t, factory);
  const shared = await normal.createWriter(file()).capture(state('shared'));
  let fingerprints = 0;
  const unavailable = storeFor(t, factory, { fingerprintBlob: async () => { fingerprints++; throw new Error('crypto unavailable'); } });
  const inline = await unavailable.createWriter(file()).capture(state('inline'));
  assert.deepEqual((await unavailable.readDraft(inline.sessionId, options(inline))).state, state('inline'));
  assert.equal(fingerprints, 1, 'inline recovery does not depend on crypto');
  await assert.rejects(unavailable.readDraft(shared.sessionId, options(shared)), { code: 'corrupt' });
  const noCompare = storeFor(t, factory, { compareBytes: async () => { throw new Error('comparison timed out'); } });
  const other = await noCompare.createWriter(file()).capture(state('other'));
  assert.ok((await inspect(factory)).pdfBytes.find(row => row.sessionId === other.sessionId).blob);
});

test('last-reference discard during comparison cannot bind a retired payload incarnation', async t => {
  const factory = new IDBFactory(); const owner = storeFor(t, factory);
  const original = await owner.createWriter(file()).capture(state('old'));
  const oldIncarnation = (await inspect(factory)).sharedPdfBytes[0].incarnation;
  let compares = 0;
  const newcomer = storeFor(t, factory, { compareBytes: async (left, right, options) => {
    compares++;
    await owner.discardDraft(original.sessionId, { expectedSequence: 1 });
    return sameLocalPdfBytes(left, right, options);
  } });
  const receipt = await newcomer.createWriter(file()).capture(state('new'));
  const rows = await inspect(factory);
  assert.equal(compares, 1); assert.equal(rows.sharedPdfBytes.length, 1);
  assert.notEqual(rows.sharedPdfBytes[0].incarnation, oldIncarnation);
  assert.equal(rows.pdfBytes[0].payloadIncarnation, rows.sharedPdfBytes[0].incarnation);
  assert.equal(rows.sessions.find(row => row.sessionId === original.sessionId).discarded, true);
  assert.deepEqual((await newcomer.readDraft(receipt.sessionId, options(receipt))).state, state('new'));
});

test('repeated payload-incarnation races are bounded and preserve the new snapshot inline', async t => {
  const factory = new IDBFactory(); const original = storeFor(t, factory);
  await original.createWriter(file()).capture(state('old'));
  let compares = 0;
  const racing = storeFor(t, factory, { compareBytes: async (left, right, options) => {
    compares++;
    await change(factory, ['sharedPdfBytes'], tx => {
      const request = tx.objectStore('sharedPdfBytes').openCursor();
      request.onsuccess = () => request.result.update({ ...request.result.value, incarnation: crypto.randomUUID() });
    });
    return sameLocalPdfBytes(left, right, options);
  } });
  const receipt = await racing.createWriter(file()).capture(state('new'));
  assert.equal(compares, 3);
  const rows = await inspect(factory);
  assert.ok(rows.pdfBytes.find(row => row.sessionId === receipt.sessionId).blob instanceof Blob);
  assert.equal(rows.snapshots.length, 2, 'no prior recovery state is removed by a failed sharing attempt');
  assert.deepEqual((await racing.readDraft(receipt.sessionId, options(receipt))).state, state('new'));
});

test('discard retains shared bytes for other sessions, deletes the last payload, and never revives tombstones', async t => {
  const factory = new IDBFactory(); const a = storeFor(t, factory); const b = storeFor(t, factory);
  const writer = a.createWriter(file()); const first = await writer.capture(state('a'));
  const second = await b.createWriter(file()).capture(state('b'));
  await a.discardDraft(first.sessionId, options(first));
  assert.equal((await inspect(factory)).sharedPdfBytes.length, 1);
  assert.deepEqual((await b.readDraft(second.sessionId, options(second))).state, state('b'));
  await assert.rejects(writer.capture(state('late')), { code: 'discarded' });
  await b.discardDraft(second.sessionId, options(second));
  const rows = await inspect(factory);
  assert.equal(rows.sharedPdfBytes.length, 0); assert.equal(rows.pdfBytes.length, 0); assert.equal(rows.snapshots.length, 0);
  assert.equal(rows.sessions.length, 2); assert.ok(rows.sessions.every(row => row.discarded));
});

test('shared-payload quota failure and abort after all requests succeed roll back every new row', async t => {
  for (const mode of ['quota', 'late-abort']) {
    const factory = new IDBFactory(); let armed = true; let successes = 0;
    const store = storeFor(t, observed(factory, (tx, args) => {
      if (!armed || args[1] !== 'readwrite') return;
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const object = objectStore(name);
        for (const method of ['add', 'put']) {
          const original = object[method].bind(object);
          object[method] = (...args) => {
            if (mode === 'quota' && name === 'sharedPdfBytes') throw new DOMException('disk full', 'QuotaExceededError');
            const request = original(...args);
            if (mode === 'late-abort') request.addEventListener('success', () => { if (++successes === 5) tx.abort(); });
            return request;
          };
        }
        return object;
      };
    }));
    const writer = store.createWriter(file());
    await assert.rejects(writer.capture(state()), mode === 'quota' ? { name: 'QuotaExceededError' } : { code: 'aborted' });
    if (mode === 'late-abort') assert.equal(successes, 5);
    assert.ok(Object.values(await inspect(factory)).every(rows => rows.length === 0));
    armed = false;
    const receipt = await writer.capture(state('retry'));
    assert.deepEqual((await store.readDraft(receipt.sessionId, options(receipt))).state, state('retry'));
  }
});

test('state-only captures neither hash, compare, read nor write PDF payloads', async t => {
  const factory = new IDBFactory(); let hashes = 0; let compares = 0; const transactions = [];
  const store = storeFor(t, observed(factory, (_tx, args) => transactions.push(args)), {
    fingerprintBlob: (...args) => { hashes++; return fingerprintLocalPdfBlob(...args); },
    compareBytes: (...args) => { compares++; return sameLocalPdfBytes(...args); },
  });
  const writer = store.createWriter(file()); await writer.capture(state());
  transactions.length = 0;
  for (let i = 0; i < 20; i++) await writer.capture(state(String(i)));
  assert.equal(hashes, 1); assert.equal(compares, 0);
  assert.deepEqual(transactions, Array.from({ length: 20 }, () => [['sessions', 'snapshots'], 'readwrite']));
  const before = transactions.length; await store.listDrafts();
  assert.deepEqual(transactions.slice(before), [[['sessions', 'draftMeta'], 'readonly']]);
});

test('missing, changed-incarnation, malformed and unsupported shared references fail closed without repair', async t => {
  for (const kind of ['missing', 'incarnation', 'wrong-size', 'unknown-format', 'wrong-writer', 'mixed-inline-reference']) {
    const factory = new IDBFactory(); const store = storeFor(t, factory);
    const receipt = await store.createWriter(file()).capture(state());
    const rows = await inspect(factory); const reference = rows.pdfBytes[0];
    await change(factory, ['pdfBytes', 'sharedPdfBytes'], tx => {
      if (kind === 'missing') tx.objectStore('sharedPdfBytes').delete(reference.payloadId);
      else if (kind === 'incarnation') tx.objectStore('sharedPdfBytes').put({ ...rows.sharedPdfBytes[0], incarnation: crypto.randomUUID() });
      else tx.objectStore('pdfBytes').put({ ...reference, ...({
        'wrong-size': { size: reference.size + 1 },
        'unknown-format': { payloadId: 'sha256-chunks-v9:unsupported', fingerprint: 'sha256-chunks-v9:unsupported' },
        'wrong-writer': { writerId: crypto.randomUUID() },
        'mixed-inline-reference': { blob: file() },
      }[kind]) });
    });
    const damaged = await inspect(factory);
    await assert.rejects(store.readDraft(receipt.sessionId, options(receipt)), { code: 'corrupt' }, kind);
    assert.deepEqual(await inspect(factory), damaged, `${kind}: a failed read cannot repair, overwrite or delete stored data`);
  }
});

test('real hash timeout falls back inline and a late digest cannot create a second write or receipt', async t => {
  const subtle = globalThis.crypto.subtle;
  const previous = Object.getOwnPropertyDescriptor(subtle, 'digest');
  let release; let digestCalls = 0; let commits = 0;
  Object.defineProperty(subtle, 'digest', { configurable: true, value: () => {
    digestCalls++;
    return new Promise(resolve => { release = resolve; });
  } });
  const restore = () => previous ? Object.defineProperty(subtle, 'digest', previous) : delete subtle.digest;
  t.after(restore);
  const factory = new IDBFactory();
  const store = storeFor(t, observed(factory, (tx, args) => {
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => { commits++; });
  }), { timeoutMs: 20 });
  const writer = store.createWriter(file());
  const receipt = await writer.capture(state());
  assert.equal(receipt.sequence, 1); assert.equal(commits, 1); assert.equal(digestCalls, 1);
  const rows = await inspect(factory);
  assert.equal(rows.sharedPdfBytes.length, 0); assert.ok(rows.pdfBytes[0].blob instanceof Blob);
  restore(); release(new ArrayBuffer(32));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commits, 1); assert.equal(digestCalls, 1);
  assert.deepEqual(await writer.flush(), receipt);
  assert.deepEqual(await inspect(factory), rows);
  assert.deepEqual((await store.readDraft(receipt.sessionId, options(receipt))).state, state());
});

test('failed last-reference payload deletion rolls back tombstone, state and reference too', async t => {
  const factory = new IDBFactory(); let armed = false;
  const store = storeFor(t, observed(factory, (tx, args) => {
    if (!armed || args[1] !== 'readwrite') return;
    const objectStore = tx.objectStore.bind(tx);
    tx.objectStore = name => {
      const object = objectStore(name);
      if (name === 'sharedPdfBytes') object.delete = () => { throw new Error('Injected payload delete failure'); };
      return object;
    };
  }));
  const writer = store.createWriter(file()); const receipt = await writer.capture(state());
  const before = await inspect(factory); armed = true;
  await assert.rejects(store.discardDraft(receipt.sessionId, options(receipt)), /Injected payload delete failure/);
  assert.deepEqual(await inspect(factory), before);
  assert.deepEqual((await store.readDraft(receipt.sessionId, options(receipt))).state, state());
  armed = false;
  await store.discardDraft(receipt.sessionId, options(receipt));
  assert.equal((await inspect(factory)).sharedPdfBytes.length, 0);
});

test('a blocked v1 upgrade leaves its schema intact and retry upgrades after the old connection closes', async t => {
  const factory = new IDBFactory();
  const old = await open(factory, 1, db => { for (const name of names.slice(0, 3)) db.createObjectStore(name, { keyPath: 'sessionId' }); });
  t.after(() => old.close());
  const store = storeFor(t, factory);
  await assert.rejects(store.listDrafts(), { code: 'blocked' });
  assert.equal(old.version, 1); assert.equal(old.objectStoreNames.contains('sharedPdfBytes'), false);
  old.close();
  assert.deepEqual(await store.listDrafts(), []);
  const upgraded = await open(factory);
  assert.equal(upgraded.version, 3); assert.ok(upgraded.objectStoreNames.contains('sharedPdfBytes'));
  assert.ok(upgraded.objectStoreNames.contains('draftMeta')); upgraded.close();
});
