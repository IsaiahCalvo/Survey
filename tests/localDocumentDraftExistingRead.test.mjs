import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalDocumentDraftStore, readExistingLocalDocumentDraft, verifyExistingLocalDocumentDraftReceipt, LOCAL_DOCUMENT_DRAFT_DB_NAME } from '../src/services/localDocumentDraftStore.js';
import { buildLocalDocumentState } from '../src/services/localDocumentState.js';
import { fingerprintLocalPdfBlob } from '../src/services/localPdfByteFingerprint.js';

const localId = 'local:00000000-0000-4000-8000-000000000001';
const pdf = text => Object.assign(new File([`%PDF-1.7\n${text || 'AAAA'}\n%%EOF`], 'export.pdf', { type: 'application/pdf' }),
  { storageMode: 'local', localId, _surveyPdfId: localId, localRevision: 1 });
const state = text => buildLocalDocumentState({ pdfId: localId, annotationsByPage: { 1: { objects: [{ id: text || 'mark' }] } },
  pageNames: { 1: 'keep page name' }, regionOverlayDisabled: { region: true } });
const options = receipt => ({ expectedSequence: receipt.sequence });
const open = (factory, version, upgrade) => new Promise((resolve, reject) => {
  const request = factory.open(LOCAL_DOCUMENT_DRAFT_DB_NAME, version);
  request.onupgradeneeded = () => upgrade?.(request.result);
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function seed(t, factory) {
  const store = createLocalDocumentDraftStore({ indexedDB: factory }); t.after(() => store.close());
  const writer = store.createWriter(pdf()); const receipt = await writer.capture(state());
  return { store, writer, receipt };
}
function reader(t, factory, extra = {}) {
  const value = createLocalDocumentDraftStore({ indexedDB: factory, existingOnly: true, ...extra });
  t.after(() => value.close()); return value;
}
async function contents(factory) {
  const db = await open(factory); const names = Array.from(db.objectStoreNames);
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readonly'); const requests = names.map(name => tx.objectStore(name).getAll());
    tx.oncomplete = () => resolve({ version: db.version, rows: Object.fromEntries(names.map((name, index) => [name, requests[index].result])) });
    tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
async function change(factory, names, callback) {
  const db = await open(factory);
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); callback(tx);
  }); } finally { db.close(); }
}
function quotaReadOnly(factory, calls) {
  return { open(...args) {
    calls.opens.push(args);
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        calls.transactions.push(args);
        if (args[1] !== 'readonly') throw new DOMException('No space for any writes', 'QuotaExceededError');
        return transaction(...args);
      };
      const close = db.close.bind(db);
      db.close = () => { calls.closes++; close(); };
    });
    return request;
  } };
}

test('absent existing-only read aborts creation and reports no database after rejection', async t => {
  const factory = new IDBFactory(); const value = reader(t, factory);
  await assert.rejects(value.readDraft(crypto.randomUUID(), { expectedSequence: 1 }), { code: 'not-found' });
  assert.deepEqual(await factory.databases(), []);
  await assert.rejects(value.listDrafts(), { code: 'not-found' });
  assert.deepEqual(await factory.databases(), []);
});

test('all existing-only write APIs fail before a database is opened', async t => {
  let opens = 0;
  const value = reader(t, { open() { opens++; throw new Error('must not open'); } });
  assert.throws(() => value.createWriter(pdf()), { code: 'read-only' });
  await assert.rejects(value.discardDraft(crypto.randomUUID(), { expectedSequence: 1 }), { code: 'read-only' });
  assert.equal(opens, 0);
});

test('v1 inline export keeps database version, rows and all six state entries unchanged', async t => {
  const factory = new IDBFactory(); const sessionId = crypto.randomUUID(); const writerId = crypto.randomUUID(); const fileId = crypto.randomUUID();
  const blob = Blob.prototype.slice.call(pdf()); const snapshot = state();
  const db = await open(factory, 1, db => {
    for (const name of ['sessions', 'pdfBytes', 'snapshots']) db.createObjectStore(name, { keyPath: 'sessionId' });
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['sessions', 'pdfBytes', 'snapshots'], 'readwrite');
    tx.objectStore('sessions').add({ sessionId, writerId, fileId, sourceLocalId: localId, sequence: 1, baseCanonicalRevision: 1,
      name: 'old-v1.pdf', type: 'application/pdf', size: blob.size, created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z', discarded: false });
    tx.objectStore('pdfBytes').add({ sessionId, writerId, fileId, blob });
    tx.objectStore('snapshots').add({ sessionId, writerId, fileId, sequence: 1, state: snapshot });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  }); db.close();
  const before = await contents(factory); const calls = { opens: [], transactions: [], closes: 0 };
  const value = reader(t, quotaReadOnly(factory, calls));
  const recovered = await value.readDraft(sessionId, { expectedSequence: 1 });
  assert.equal(await recovered.file.text(), await pdf().text()); assert.deepEqual(recovered.state, snapshot);
  assert.equal(Object.keys(recovered.state.entries).length, 6);
  assert.deepEqual(calls.opens, [[LOCAL_DOCUMENT_DRAFT_DB_NAME]], 'no requested version');
  assert.deepEqual(calls.transactions, [[['sessions', 'pdfBytes', 'snapshots'], 'readonly'], [['sessions'], 'readonly']]);
  assert.deepEqual(await contents(factory), before); assert.equal(before.version, 1);
});

test('public existing-only v2 export succeeds with all writes quota-blocked and closes its scoped connection', async t => {
  const factory = new IDBFactory(); const { receipt } = await seed(t, factory);
  const calls = { opens: [], transactions: [], closes: 0 };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: quotaReadOnly(factory, calls) });
  t.after(() => original ? Object.defineProperty(globalThis, 'indexedDB', original) : delete globalThis.indexedDB);
  const before = await contents(factory);
  const recovered = await readExistingLocalDocumentDraft(receipt.sessionId, options(receipt));
  assert.equal(await recovered.file.text(), await pdf().text()); assert.deepEqual(recovered.state, state());
  for (const key of ['id', 'localId', 'storageMode', 'filePath', 'user_id']) assert.equal(Object.hasOwn(recovered.file, key), false);
  assert.deepEqual(calls.opens, [[LOCAL_DOCUMENT_DRAFT_DB_NAME]]); assert.equal(calls.closes, 1);
  assert.deepEqual(calls.transactions, [['sessions', 'readonly'],
    [['sessions', 'pdfBytes', 'snapshots', 'sharedPdfBytes'], 'readonly'], [['sessions'], 'readonly']]);
  assert.deepEqual(await contents(factory), before);
});

test('corrupt or missing v2 payload, state and metadata are never repaired by export', async t => {
  for (const kind of ['missing-bytes', 'corrupt-bytes', 'missing-state', 'bad-state', 'missing-metadata']) {
    const factory = new IDBFactory(); const { receipt } = await seed(t, factory);
    await change(factory, ['sessions', 'snapshots', 'sharedPdfBytes'], tx => {
      if (kind === 'missing-state') tx.objectStore('snapshots').delete(receipt.sessionId);
      else if (kind === 'missing-metadata') tx.objectStore('sessions').delete(receipt.sessionId);
      else {
        const object = tx.objectStore(kind === 'bad-state' ? 'snapshots' : 'sharedPdfBytes'); const request = object.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (kind === 'missing-bytes') cursor.delete();
          else cursor.update({ ...cursor.value, ...(kind === 'bad-state' ? { state: { broken: true } } : { blob: pdf('BBBB') }) });
        };
      }
    });
    const before = await contents(factory);
    await assert.rejects(reader(t, factory).readDraft(receipt.sessionId, options(receipt)));
    assert.deepEqual(await contents(factory), before);
  }
});

test('stale sequence is rejected before expensive shared byte verification', async t => {
  const factory = new IDBFactory(); const { writer, receipt } = await seed(t, factory);
  await writer.capture(state('newer')); let hashes = 0;
  const value = reader(t, factory, { fingerprintBlob: async () => { hashes++; throw new Error('must not hash'); } });
  await assert.rejects(value.readDraft(receipt.sessionId, options(receipt)), { code: 'sequence-conflict' });
  assert.equal(hashes, 0);
});

test('latest sequence, discard, writer and File identity are checked again after asynchronous byte verification', async t => {
  for (const kind of ['new-edit', 'discard', 'writer', 'file', 'source', 'removed']) {
    const factory = new IDBFactory(); const { store, writer, receipt } = await seed(t, factory);
    const value = reader(t, factory, { fingerprintBlob: async (blob, options) => {
      if (kind === 'new-edit') await writer.capture(state('later'));
      else if (kind === 'discard') await store.discardDraft(receipt.sessionId, { expectedSequence: 1 });
      else await change(factory, ['sessions'], tx => {
        const object = tx.objectStore('sessions'); const request = object.get(receipt.sessionId);
        request.onsuccess = () => {
          if (kind === 'removed') object.delete(receipt.sessionId);
          else object.put({ ...request.result, ...({ writer: { writerId: crypto.randomUUID() }, file: { fileId: crypto.randomUUID() },
            source: { sourceLocalId: `local:${crypto.randomUUID()}` } }[kind]) });
        };
      });
      return fingerprintLocalPdfBlob(blob, options);
    } });
    await assert.rejects(value.readDraft(receipt.sessionId, options(receipt)), {
      code: kind === 'discard' ? 'discarded' : kind === 'removed' ? 'not-found' : 'sequence-conflict',
    }, kind);
  }
});

test('read retirement during byte verification rejects instead of returning a stale export', async t => {
  const factory = new IDBFactory(); const { receipt } = await seed(t, factory);
  let value;
  value = reader(t, factory, { fingerprintBlob: async (blob, options) => {
    value.close(); return fingerprintLocalPdfBlob(blob, options);
  } });
  await assert.rejects(value.readDraft(receipt.sessionId, options(receipt)), { code: 'closed' });
});

test('unknown existing versions are rejected without upgrade or source changes', async t => {
  const factory = new IDBFactory(); const db = await open(factory, 4, db => db.createObjectStore('future-data'));
  db.close(); const value = reader(t, factory);
  await assert.rejects(value.readDraft(crypto.randomUUID(), { expectedSequence: 1 }), { code: 'unsupported-format' });
  assert.deepEqual(await factory.databases(), [{ name: LOCAL_DOCUMENT_DRAFT_DB_NAME, version: 4 }]);
});

test('database removal during verification cannot recreate storage or return the retired snapshot', async t => {
  const factory = new IDBFactory(); const { store, receipt } = await seed(t, factory);
  const value = reader(t, factory, { fingerprintBlob: async (blob, options) => {
    store.close();
    await new Promise((resolve, reject) => {
      const request = factory.deleteDatabase(LOCAL_DOCUMENT_DRAFT_DB_NAME);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    return fingerprintLocalPdfBlob(blob, options);
  } });
  await assert.rejects(value.readDraft(receipt.sessionId, options(receipt)), { code: 'not-found' });
  assert.deepEqual(await factory.databases(), []);
});

test('neither snapshot-read nor final-metadata request success permits export before transaction completion', async t => {
  for (const { abortPhase, storeName } of [{ abortPhase: 2, storeName: 'sharedPdfBytes' }, { abortPhase: 3, storeName: 'sessions' }]) {
    const factory = new IDBFactory(); const { receipt } = await seed(t, factory);
    const before = await contents(factory); let phase = 0; let successfulAbortRequest = false;
    const wrapped = { open(...args) {
      const request = factory.open(...args);
      request.addEventListener('success', () => {
        const db = request.result; const transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args); const currentPhase = ++phase;
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const object = objectStore(name); const get = object.get.bind(object);
            object.get = (...args) => {
              const read = get(...args);
              if (currentPhase === abortPhase && name === storeName) {
                read.addEventListener('success', () => { successfulAbortRequest = true; tx.abort(); });
              }
              return read;
            };
            return object;
          };
          return tx;
        };
      });
      return request;
    } };
    await assert.rejects(reader(t, wrapped).readDraft(receipt.sessionId, options(receipt)), { code: 'aborted' });
    assert.equal(successfulAbortRequest, true);
    assert.deepEqual(await contents(factory), before);
  }
});

test('public final receipt check reads only session metadata, opens without version and closes its handle', async t => {
  const factory = new IDBFactory(); const { store, receipt } = await seed(t, factory);
  const { metadata } = await store.readDraft(receipt.sessionId, options(receipt));
  const calls = { opens: [], transactions: [], closes: 0 };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: quotaReadOnly(factory, calls) });
  t.after(() => original ? Object.defineProperty(globalThis, 'indexedDB', original) : delete globalThis.indexedDB);
  assert.equal(await verifyExistingLocalDocumentDraftReceipt(metadata), true);
  assert.deepEqual(calls.opens, [[LOCAL_DOCUMENT_DRAFT_DB_NAME]]);
  assert.deepEqual(calls.transactions, [['sessions', 'readonly'], [['sessions'], 'readonly']]);
  assert.equal(calls.closes, 1);
});

test('receipt comparison captures its input before awaiting storage and never rehashes bytes', async t => {
  const factory = new IDBFactory(); const { store, receipt } = await seed(t, factory);
  const { metadata } = await store.readDraft(receipt.sessionId, options(receipt));
  const value = reader(t, factory, {
    fingerprintBlob: () => assert.fail('metadata verification cannot hash a PDF'),
    compareBytes: () => assert.fail('metadata verification cannot compare PDF bytes'),
  });
  const checking = value.verifyReceipt(metadata);
  metadata.sequence = 999; metadata.writerId = crypto.randomUUID(); metadata.name = 'caller changed';
  assert.equal(await checking, true);
});

test('final receipt check rejects changed metadata, discarded or missing sessions without writes', async t => {
  for (const kind of ['sequence', 'writerId', 'fileId', 'sourceLocalId', 'baseCanonicalRevision', 'size', 'name', 'updated_at', 'discard', 'missing']) {
    const factory = new IDBFactory(); const { store, receipt } = await seed(t, factory);
    const { metadata } = await store.readDraft(receipt.sessionId, options(receipt));
    if (kind === 'discard') await store.discardDraft(receipt.sessionId, options(receipt));
    else await change(factory, ['sessions'], tx => {
      const object = tx.objectStore('sessions'); const request = object.get(receipt.sessionId);
      request.onsuccess = () => {
        if (kind === 'missing') { object.delete(receipt.sessionId); return; }
        const row = request.result;
        const changes = { sequence: row.sequence + 1, writerId: crypto.randomUUID(), fileId: crypto.randomUUID(),
          sourceLocalId: `local:${crypto.randomUUID()}`, baseCanonicalRevision: row.baseCanonicalRevision + 1,
          size: row.size + 1, name: 'other.pdf', updated_at: '2026-09-09T00:00:00Z' };
        object.put({ ...row, [kind]: changes[kind] });
      };
    });
    const before = await contents(factory);
    await assert.rejects(reader(t, factory).verifyReceipt(metadata), {
      code: kind === 'discard' ? 'discarded' : kind === 'missing' ? 'not-found' : 'sequence-conflict',
    }, kind);
    assert.deepEqual(await contents(factory), before);
  }
});

test('receipt check never creates missing storage and fails after a metadata request succeeds but its transaction aborts', async t => {
  const factory = new IDBFactory(); const { store, receipt } = await seed(t, factory);
  const { metadata } = await store.readDraft(receipt.sessionId, options(receipt));
  const emptyFactory = new IDBFactory();
  await assert.rejects(reader(t, emptyFactory).verifyReceipt(metadata), { code: 'not-found' });
  assert.deepEqual(await emptyFactory.databases(), []);
  let succeeded = false;
  const wrapped = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args); const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const object = objectStore(name); const get = object.get.bind(object);
          object.get = (...args) => {
            const read = get(...args); read.addEventListener('success', () => { succeeded = true; tx.abort(); }); return read;
          };
          return object;
        };
        return tx;
      };
    });
    return request;
  } };
  await assert.rejects(reader(t, wrapped).verifyReceipt(metadata), { code: 'aborted' });
  assert.equal(succeeded, true);
});
