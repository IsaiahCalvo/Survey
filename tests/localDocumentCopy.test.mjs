import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalDocumentStore } from '../src/services/localDocumentStore.js';
import { buildLocalDocumentState, createLocalDocumentStateReader } from '../src/services/localDocumentState.js';

const pdf = (text = 'old pages', name = 'recovered.pdf') => new File([`%PDF-1.7\n${text}\n%%EOF`], name, { type: 'application/pdf' });
const sourceId = 'local:12345678-1234-1234-1234-123456789abc';
const entityCatalog = documentId => ({status:'accepted',version:1,documentId,catalogRevision:1,
  sourceTemplateId:'entity-template',sourceTemplateUpdatedAt:null,sourceEntitiesSha256:'a'.repeat(64),
  entities:[{id:'entity',name:'Entity',color:'#123456',opacity:0.5,borderColor:'#654321',borderOpacity:1,matchFill:false}]});
const surveyDefinition = documentId => ({status:'accepted',version:1,documentId,definitionRevision:1,
  sourceTemplateId:'survey-template',sourceTemplateUpdatedAt:null,sourceStructureSha256:'b'.repeat(64),
  modules:[{id:'module',name:'Module',categories:[{id:'category',name:'Category',checklist:[{id:'check',text:'Check'}]}]}]});
const snapshot = (pdfId = sourceId, options = {}) => buildLocalDocumentState({ pdfId,
  annotationsByPage: { 1: { objects: [{ id: `mark:${pdfId}`, meta: { authorId: 'original-author' }, data: { text: pdfId } }] } },
  items: { item: { name: 'Keep this' } }, annotations: { annotation: { page: 1 } },
  surveyMarkers: { marker: { pageNumber: 1 } }, callouts: [], pageNames: { 1: 'Old page' },
  bookmarks: [{ id: 'bookmark', pageNumber: 1 }], spaces: [], activeSpaceId: null,
  pageTransformations: { 1: { rotation: 90 } }, regionOverlayDisabled: new Map([['region', true]]),
  ...options,
});

test('recovery copy commits complete state with retained bytes under a fresh independent identity', async () => {
  const indexedDB = new IDBFactory();
  const store = createLocalDocumentStore({ indexedDB });
  const original = await store.importLocalDocument(pdf());
  const oldState = snapshot(original.localId);
  await store.saveLocalDocumentState(original.localId, oldState, { expectedRevision: 1 });
  const retained = await store.openLocalDocument(original.localId);
  await store.replaceLocalDocument(original.localId, pdf('new layout'), { expectedRevision: 2, state: snapshot(original.localId) });
  // Stray caller bindings must never become identity or authority on the copy.
  retained.id = 'cloud-row'; retained.filePath = '/private/original.pdf'; retained.user_id = 'cloud-user';
  const copy = await store.importLocalDocumentCopy(retained, oldState);
  assert.notEqual(copy.localId, original.localId);
  assert.equal(copy.revision, 1);
  store.close();
  const cold = createLocalDocumentStore({ indexedDB });
  const reopened = await cold.openLocalDocument(copy.localId);
  assert.match(await reopened.text(), /old pages/);
  assert.match(await (await cold.openLocalDocument(original.localId)).text(), /new layout/);
  assert.equal(reopened.localId, reopened._surveyPdfId);
  for (const key of ['id', 'filePath', 'user_id', 'supabaseFilePath']) assert.equal(Object.hasOwn(reopened, key), false);
  const reader = createLocalDocumentStateReader(reopened);
  assert.equal(Object.keys(reopened._localDocumentState.entries).length, 6);
  for (const [key, value] of Object.entries(oldState.entries)) {
    assert.equal(reader.getItem(key.slice(0, -original.localId.length) + copy.localId), value,
      'rekey outer state identity only; preserve annotation IDs, authors and user strings');
    assert.equal(reader.getItem(key), null);
  }
  assert.equal((await cold.listLocalDocuments()).length, 2);
  cold.close();
});

test('copy captures a full immutable state before an asynchronous PDF read', async () => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  const file = pdf();
  const state = snapshot(); const expected = structuredClone(state.entries);
  const copying = store.importLocalDocumentCopy(file, state);
  state.entries[`annotationsByPage_${sourceId}`] = '{}';
  state.entries[`pdfSidebar_${sourceId}`] = '{}';
  const copy = await copying;
  const opened = await store.openLocalDocument(copy.localId);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(opened._localDocumentState.entries[key.slice(0, -sourceId.length) + copy.localId], value);
  }
  store.close();
});

test('copy binds recovery state to native PDF bytes despite an overridden read method', async () => {
  const store = createLocalDocumentStore({ indexedDB: new IDBFactory() });
  const retained = pdf('old pages');
  let overriddenReads = 0;
  retained.arrayBuffer = () => { overriddenReads++; return pdf('new pages').arrayBuffer(); };
  const copy = await store.importLocalDocumentCopy(retained, snapshot());
  const opened = await store.openLocalDocument(copy.localId);
  assert.equal(overriddenReads, 0);
  assert.match(await opened.text(), /old pages/);
  assert.ok(opened._localDocumentState.entries[`annotationsByPage_${copy.localId}`].includes('original-author'));
  store.close();
});

test('state-store quota failure leaves no partial copy; retry creates one complete document', async () => {
  const factory = new IDBFactory(); let armed = false;
  const indexedDB = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters); const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name);
          if (armed && name === 'documentState' && tx.mode === 'readwrite') {
            store.add = () => { throw new DOMException('Injected state quota', 'QuotaExceededError'); };
          }
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
  const store = createLocalDocumentStore({ indexedDB });
  const original = await store.importLocalDocument(pdf());
  armed = true;
  await assert.rejects(store.importLocalDocumentCopy(pdf(), snapshot()), { name: 'QuotaExceededError' });
  assert.deepEqual(await store.listLocalDocuments(), [original]);
  armed = false;
  const copy = await store.importLocalDocumentCopy(pdf(), snapshot());
  const opened = await store.openLocalDocument(copy.localId);
  assert.ok(opened._localDocumentState.entries[`pdfSidebar_${copy.localId}`]);
  assert.equal((await store.listLocalDocuments()).length, 2);
  store.close();
});

test('copy stays unacknowledged when all three writes succeed but their transaction then aborts', async () => {
  const factory = new IDBFactory();
  const names = ['manifests', 'pdfBytes', 'documentState'];
  let armed = false; let successfulWrites = 0; let copyAcknowledged = false;
  const indexedDB = { open(...args) {
    const request = factory.open(...args);
    request.addEventListener('success', () => {
      const db = request.result; const transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        const tx = transaction(...parameters);
        if (!armed || tx.mode !== 'readwrite' || !names.every(name => tx.objectStoreNames.contains(name))) return tx;
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = objectStore(name); const add = store.add.bind(store);
          store.add = (...values) => {
            const write = add(...values);
            write.addEventListener('success', () => {
              if (++successfulWrites === names.length) tx.abort();
            });
            return write;
          };
          return store;
        };
        return tx;
      };
    });
    return request;
  } };
  const store = createLocalDocumentStore({ indexedDB });
  let inspection;
  try {
    const original = await store.importLocalDocument(pdf('source pages'));
    const originalState = snapshot(original.localId);
    await store.saveLocalDocumentState(original.localId, originalState, { expectedRevision: 1 });
    const originalManifest = (await store.listLocalDocuments())[0];
    inspection = await new Promise((resolve, reject) => {
      const request = factory.open('survey-local-documents-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawRows = async () => {
      const records = await new Promise((resolve, reject) => {
        const tx = inspection.transaction(names, 'readonly');
        const requests = names.map(name => tx.objectStore(name).getAll());
        tx.oncomplete = () => resolve(requests.map(request => request.result));
        tx.onabort = () => reject(tx.error);
      });
      // Compare stored PDF bytes too, not only Blob size/type or row counts.
      records[1] = await Promise.all(records[1].map(async row => ({
        ...row, blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())),
      })));
      return records;
    };
    const before = await rawRows();
    armed = true;
    await assert.rejects(store.importLocalDocumentCopy(pdf('copy pages'), snapshot()).then(value => {
      copyAcknowledged = true;
      return value;
    }), { name: 'LocalDocumentStoreError', code: 'unavailable' });
    assert.equal(successfulWrites, 3, 'abort happens after every add request succeeds');
    assert.equal(copyAcknowledged, false, 'request success is not a durable copy receipt');
    assert.deepEqual(await rawRows(), before, 'no new manifest, bytes or state survive the abort');
    assert.deepEqual(await store.listLocalDocuments(), [originalManifest]);
    const reopened = await store.openLocalDocument(original.localId);
    assert.equal(await reopened.text(), await pdf('source pages').text());
    assert.deepEqual(reopened._localDocumentState, originalState);
    armed = false;
    const retry = await store.importLocalDocumentCopy(pdf('copy pages'), snapshot());
    assert.equal((await store.listLocalDocuments()).length, 2);
    assert.match(await (await store.openLocalDocument(retry.localId)).text(), /copy pages/);
  } finally {
    inspection?.close();
    store.close();
  }
});

test('copy rejects malformed or oversized snapshots and bad PDF bytes before exposing any library entry', async () => {
  const indexedDB = new IDBFactory(); const store = createLocalDocumentStore({ indexedDB });
  for (const mutate of [
    state => { delete state.entries[`pdfData_${sourceId}`]; },
    state => { state.entries.unrelated = '{}'; },
    state => { state.entries[`annotationsByPage_${sourceId}`] = 'null'; },
    state => { state.entries[`callouts_${sourceId}`] = '{}'; },
    state => { state.entries[`pdfSidebar_${sourceId}`] = '{broken'; },
    state => { state.extra = undefined; },
    state => { state.extra = 'must not silently disappear'; },
  ]) {
    const state = snapshot(); mutate(state);
    await assert.rejects(store.importLocalDocumentCopy(pdf(), state));
  }
  await assert.rejects(store.importLocalDocumentCopy(new File(['not a PDF'], 'bad.pdf'), snapshot()));
  const limited = createLocalDocumentStore({ indexedDB, maxStateBytes: 10 });
  await assert.rejects(limited.importLocalDocumentCopy(pdf(), snapshot()), { code: 'state-too-large' });
  assert.deepEqual(await store.listLocalDocuments(), []);
  store.close(); limited.close();
});

test('save, byte replacement, and cold reopen preserve both optional document-owned snapshots', async () => {
  const indexedDB=new IDBFactory();let store=createLocalDocumentStore({indexedDB});
  const imported=await store.importLocalDocument(pdf());
  const state=snapshot(imported.localId,{entityCatalog:entityCatalog(imported.localId),surveyDefinition:surveyDefinition(imported.localId)});
  await store.saveLocalDocumentState(imported.localId,state,{expectedRevision:1});
  await store.replaceLocalDocument(imported.localId,pdf('replaced pages'),{expectedRevision:2,state});
  store.close();store=createLocalDocumentStore({indexedDB});
  const reopened=await store.openLocalDocument(imported.localId);
  assert.match(await reopened.text(),/replaced pages/);
  assert.equal((await store.listLocalDocuments()).find(value=>value.localId===imported.localId).revision,3);
  assert.deepEqual(JSON.parse(reopened._localDocumentState.entries[`entityCatalog_${imported.localId}`]),entityCatalog(imported.localId));
  assert.deepEqual(JSON.parse(reopened._localDocumentState.entries[`surveyDefinition_${imported.localId}`]),surveyDefinition(imported.localId));
  store.close();
});

test('recovery copy preserves content IDs and rebinds only both embedded document identities', async () => {
  const indexedDB=new IDBFactory();const store=createLocalDocumentStore({indexedDB});
  const source=await store.importLocalDocument(pdf());
  const state=snapshot(source.localId,{entityCatalog:entityCatalog(source.localId),surveyDefinition:surveyDefinition(source.localId)});
  const sourceBefore=structuredClone(state);
  const copy=await store.importLocalDocumentCopy(await store.openLocalDocument(source.localId),state);
  const opened=await store.openLocalDocument(copy.localId);
  const copiedCatalog=JSON.parse(opened._localDocumentState.entries[`entityCatalog_${copy.localId}`]);
  const copiedDefinition=JSON.parse(opened._localDocumentState.entries[`surveyDefinition_${copy.localId}`]);
  assert.deepEqual(copiedCatalog,{...entityCatalog(source.localId),documentId:copy.localId});
  assert.deepEqual(copiedDefinition,{...surveyDefinition(source.localId),documentId:copy.localId});
  assert.match(opened._localDocumentState.entries[`annotationsByPage_${copy.localId}`],new RegExp(`mark:${source.localId}`));
  assert.deepEqual(state,sourceBefore,'the recovery source remains unchanged');
  store.close();
});

test('copy captures optional snapshots before async PDF preparation and corrupt input creates no artifact', async () => {
  const indexedDB=new IDBFactory();const store=createLocalDocumentStore({indexedDB});
  const source=await store.importLocalDocument(pdf());
  const state=snapshot(source.localId,{entityCatalog:entityCatalog(source.localId),surveyDefinition:surveyDefinition(source.localId)});
  const copying=store.importLocalDocumentCopy(pdf('delayed bytes'),state);
  state.entries[`entityCatalog_${source.localId}`]=JSON.stringify({...entityCatalog(source.localId),entities:[]});
  state.entries[`surveyDefinition_${source.localId}`]=JSON.stringify({...surveyDefinition(source.localId),modules:[]});
  const copy=await copying;const opened=await store.openLocalDocument(copy.localId);
  assert.equal(JSON.parse(opened._localDocumentState.entries[`entityCatalog_${copy.localId}`]).entities.length,1);
  assert.equal(JSON.parse(opened._localDocumentState.entries[`surveyDefinition_${copy.localId}`]).modules.length,1);

  const corrupt=snapshot(source.localId,{entityCatalog:entityCatalog(source.localId),surveyDefinition:surveyDefinition(source.localId)});
  corrupt.entries[`surveyDefinition_${source.localId}`]=JSON.stringify({...surveyDefinition(source.localId),documentId:copy.localId});
  const before=await store.listLocalDocuments();
  await assert.rejects(store.importLocalDocumentCopy(await store.openLocalDocument(source.localId),corrupt));
  assert.deepEqual(await store.listLocalDocuments(),before);
  store.close();
});
