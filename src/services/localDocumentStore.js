// Device-owned PDFs, not a cache: no auth, cloud bindings, eviction or legacy
// migration. Metadata reads never load PDF bytes. Both records commit together.
import { createLocalDocumentStateReader } from './localDocumentState.js';
import { LocalPdfByteSnapshotError, snapshotLocalPdfBlob } from './localPdfByteSnapshot.js';
export const LOCAL_DOCUMENT_DB_NAME = 'survey-local-documents-v1';
export const LOCAL_DOCUMENT_MAX_BYTES = 256 * 1024 * 1024;
export const LOCAL_DOCUMENT_MAX_STATE_BYTES = 16 * 1024 * 1024;
const MANIFESTS = 'manifests';
const PDF_BYTES = 'pdfBytes';
const DOCUMENT_STATE = 'documentState';
const LOCAL_ID = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LocalDocumentStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalDocumentStoreError'; this.code = code; }
}
const fail = (code, message) => new LocalDocumentStoreError(code, message);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const checkId = id => { if (typeof id !== 'string' || !LOCAL_ID.test(id)) throw fail('invalid-input', 'A valid local document ID is required.'); };
const checkRevision = revision => { if (!positiveInteger(revision) || revision === Number.MAX_SAFE_INTEGER) throw fail('invalid-input', 'The current local PDF revision is required.'); };
const publicManifest = row => ({ id: row.localId, localId: row.localId, storageMode: 'local',
  name: row.name, size: row.size, type: row.type, created_at: row.created_at, updated_at: row.updated_at, revision: row.revision });

// Strict, bounded JSON snapshot: never silently drop undefined, cycles, sparse
// slots, accessors or exotic objects. Count UTF-8 JSON without an encoded copy.
function copyDocumentState(input, localId, maxBytes) {
  let bytes = 0; let values = 0;
  const ancestors = new Set();
  const add = count => { bytes += count; if (bytes > maxBytes) throw fail('state-too-large', `Local document state exceeds ${maxBytes} JSON bytes.`); };
  const string = text => {
    let count = 2;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ([34, 92, 8, 9, 10, 12, 13].includes(code)) count += 2;
      else if (code < 32) count += 6;
      else if (code < 128) count++;
      else if (code < 2048) count += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { count += 4; i++; }
      else if (code >= 0xd800 && code <= 0xdfff) count += 6;
      else count += 3;
      if (count >= 8192) { add(count); count = 0; }
    }
    add(count);
  };
  const copy = (value, depth = 0) => {
    if (++values > 250_000 || depth > 100) throw fail('state-too-large', 'Local document state is too complex.');
    if (value === null) { add(4); return null; }
    if (typeof value === 'string') { string(value); return value; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return value; }
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) { add(String(value).length); return value; }
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw fail('invalid-state', 'Local document state must contain only finite JSON values without cycles.');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw fail('invalid-state', 'Local document state must use plain JSON objects.');
    const keys = Reflect.ownKeys(value);
    if (keys.length > 250_000 - values) throw fail('state-too-large', 'Local document state has too many properties.');
    for (const key of keys) {
      if (typeof key !== 'string') throw fail('invalid-state', 'Local document state cannot contain symbol keys.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || (!descriptor.enumerable && !(array && key === 'length'))) {
        throw fail('invalid-state', 'Local document state cannot contain accessors or hidden properties.');
      }
    }
    ancestors.add(value); add(2);
    const result = array ? [] : {};
    const entry = key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('invalid-state', 'Local document state cannot contain accessors or sparse arrays.');
      return descriptor.value;
    };
    if (array) {
      if (value.length > 250_000) throw fail('state-too-large', 'Local document state has too many array values.');
      for (let index = 0; index < value.length; index++) { if (index) add(1); result.push(copy(entry(String(index)), depth + 1)); }
      for (const key in value) if (Object.hasOwn(value, key) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw fail('invalid-state', 'Local document state arrays cannot contain custom properties.');
    } else {
      let first = true;
      for (const key in value) if (Object.hasOwn(value, key)) {
        if (++values > 250_000) throw fail('state-too-large', 'Local document state has too many values.');
        if (!first) add(1); first = false; string(key); add(1);
        Object.defineProperty(result, key, { value: copy(entry(key), depth + 1), enumerable: true, configurable: true, writable: true });
      }
    }
    ancestors.delete(value);
    return result;
  };
  const result = copy(input);
  if (!result || Array.isArray(result) || result.version !== 1 || result.pdfId !== localId
    || !result.entries || Array.isArray(result.entries) || typeof result.entries !== 'object'
    || Object.values(result.entries).some(value => typeof value !== 'string')) {
    throw fail('invalid-state', 'Local document state must have version 1, this PDF identity, and string-valued entries.');
  }
  return result;
}

// Shared strict snapshot validation for the independent crash-draft store.
export { copyDocumentState as copyLocalDocumentState };

function notifyChange() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('local-document-store-changed')); }
  catch { /* Notification failure cannot undo a completed storage commit. */ }
}

export function createLocalDocumentStore({ indexedDB, dbName = LOCAL_DOCUMENT_DB_NAME,
  maxDocumentBytes = LOCAL_DOCUMENT_MAX_BYTES, maxStateBytes = LOCAL_DOCUMENT_MAX_STATE_BYTES, timeoutMs = 10_000 } = {}) {
  if (typeof dbName !== 'string' || !dbName.trim() || !positiveInteger(maxDocumentBytes) || !positiveInteger(maxStateBytes) || !positiveInteger(timeoutMs)) throw new TypeError('Invalid local document store options.');
  let connection = null;
  let opening = null;
  let cancelOpen = null;
  let closed = false;
  const pendingPreparations = new Set();
  const active = () => { if (closed) throw fail('closed', 'The local document store is closed.'); };

  async function database() {
    active();
    if (connection) return connection;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer); cancelOpen = null;
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(fail('timed-out', 'Opening the local PDF library timed out. Please retry.')), timeoutMs);
      cancelOpen = () => {
        try { request?.transaction?.abort(); } catch { /* already closed */ }
        finish(fail('closed', 'The local document store is closed.'));
      };
      try {
        const storage = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
        if (!storage?.open) throw fail('unavailable', 'Local PDF storage is unavailable in this browser.');
        request = storage.open(dbName, 2);
      } catch (error) { finish(error); return; }
      request.onupgradeneeded = event => {
        if (settled || closed) { request.transaction.abort(); return; }
        try {
          if (event.oldVersion === 0) {
            request.result.createObjectStore(MANIFESTS, { keyPath: 'localId' });
            request.result.createObjectStore(PDF_BYTES, { keyPath: 'localId' });
          }
          // v1 may exist from the initial bytes-only library. Add state storage
          // without rewriting, importing, clearing or deleting existing rows.
          if (event.oldVersion < 2) request.result.createObjectStore(DOCUMENT_STATE, { keyPath: 'localId' });
        } catch (error) { request.transaction.abort(); finish(error); }
      };
      request.onblocked = () => finish(fail('blocked', 'The local PDF library is busy in another window. Close that window and retry.'));
      request.onerror = () => finish(request.error || fail('unavailable', 'The local PDF library could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); finish(fail('closed', 'The local document store is closed.')); return; }
        if (!db.objectStoreNames.contains(MANIFESTS) || !db.objectStoreNames.contains(PDF_BYTES) || !db.objectStoreNames.contains(DOCUMENT_STATE)) {
          db.close(); finish(fail('corrupt', 'The local PDF library schema is incomplete. Its data was preserved.')); return;
        }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transact(stores, mode, run) {
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(stores, mode); }
      catch (error) { if (connection === db) connection = null; reject(error); return; }
      let result;
      let error;
      const abort = cause => { error ||= cause; try { tx.abort(); } catch { /* already settled */ } };
      const timer = setTimeout(() => abort(fail('timed-out', 'Saving or reading the local PDF timed out. Please retry.')), timeoutMs);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = () => { clearTimeout(timer); reject(error || tx.error || fail('unavailable', 'The local PDF operation did not commit.')); };
      tx.onerror = event => { error ||= event.target?.error || tx.error; };
      try { run(tx, value => { result = value; }, abort); }
      catch (cause) { abort(cause); }
    });
  }

  async function prepare(file) {
    active();
    let name; let declaredSize; let blob;
    try {
      name = file?.name;
      declaredSize = file?.size;
      // Native branding rejects file-like objects and bypasses instance or
      // File-subclass overrides. Capture metadata and the source before await.
      blob = Blob.prototype.slice.call(file, 0, undefined, 'application/pdf');
    } catch { throw fail('invalid-input', 'Choose a real PDF File or a named Blob.'); }
    const size = blob.size;
    if (typeof name !== 'string' || !name.trim() || name.length > 1024
      || !positiveInteger(size) || size > maxDocumentBytes || declaredSize !== size) {
      throw fail('invalid-input', `Choose a nonempty PDF with a name up to 1024 characters and size up to ${maxDocumentBytes} bytes.`);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    pendingPreparations.add(cancel);
    let ownedBlob;
    try {
      ownedBlob = await snapshotLocalPdfBlob(blob, { maxBytes: maxDocumentBytes, timeoutMs, signal: controller.signal });
    } catch (error) {
      if (error?.code === 'aborted' && closed) throw fail('closed', 'The local document store is closed.');
      if (error instanceof LocalPdfByteSnapshotError) throw fail(error.code, error.message);
      throw error;
    } finally { pendingPreparations.delete(cancel); }
    active();
    return { name, size, type: 'application/pdf', blob: ownedBlob };
  }

  function validateManifest(value, localId) {
    if (!value || value.localId !== localId || value.id !== localId || value.storageMode !== 'local'
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 1024
      || !positiveInteger(value.size) || value.type !== 'application/pdf' || !positiveInteger(value.revision)
      || (value.bytesRevision !== undefined && (!positiveInteger(value.bytesRevision) || value.bytesRevision > value.revision))
      || (value.stateRevision !== undefined && (!positiveInteger(value.stateRevision) || value.stateRevision > value.revision))
      || !Number.isFinite(Date.parse(value.created_at)) || !Number.isFinite(Date.parse(value.updated_at))) {
      throw fail('corrupt', 'The local PDF metadata is incomplete. Its stored data was preserved.');
    }
    return value;
  }

  async function commitImport(prepared, localId, state) {
    const timestamp = new Date().toISOString();
    const manifest = { id: localId, localId, storageMode: 'local', name: prepared.name,
      size: prepared.size, type: prepared.type, created_at: timestamp, updated_at: timestamp, revision: 1 };
    await transact(state ? [MANIFESTS, PDF_BYTES, DOCUMENT_STATE] : [MANIFESTS, PDF_BYTES], 'readwrite', (tx, done) => {
      tx.objectStore(MANIFESTS).add({ ...manifest, bytesRevision: 1, ...(state ? { stateRevision: 1 } : {}) });
      tx.objectStore(PDF_BYTES).add({ localId, revision: 1, blob: prepared.blob });
      if (state) tx.objectStore(DOCUMENT_STATE).add({ localId, revision: 1, state });
      done(manifest);
    });
    notifyChange();
    return manifest;
  }

  async function importLocalDocument(file) {
    const prepared = await prepare(file);
    return commitImport(prepared, `local:${crypto.randomUUID()}`);
  }

  // Recovery creates a separate document, never a patch to its source. Capture
  // state before reading bytes; only the six outer storage keys are rekeyed.
  // Annotation IDs, authors, page layout and user content remain unchanged.
  async function importLocalDocumentCopy(file, inputState) {
    active();
    const sourceId = inputState && Object.getOwnPropertyDescriptor(inputState, 'pdfId')?.value;
    checkId(sourceId);
    const snapshot = copyDocumentState(inputState, sourceId, maxStateBytes);
    if (Object.keys(snapshot).some(key => !['version', 'pdfId', 'entries'].includes(key))) {
      throw fail('invalid-state', 'The recovery snapshot contains unsupported fields. Its source was kept.');
    }
    const reader = createLocalDocumentStateReader({ localId: sourceId,
      _surveyPdfId: sourceId, storageMode: 'local', _localDocumentState: snapshot });
    const localId = `local:${crypto.randomUUID()}`;
    const entries = Object.fromEntries(Object.keys(snapshot.entries).map(key => [
      key.slice(0, -sourceId.length) + localId, reader.getItem(key),
    ]));
    const state = copyDocumentState({ version: 1, pdfId: localId, entries }, localId, maxStateBytes);
    const prepared = await prepare(file);
    return commitImport(prepared, localId, state);
  }

  async function listLocalDocuments() {
    return transact([MANIFESTS], 'readonly', (tx, done, abort) => {
      const records = [];
      const request = tx.objectStore(MANIFESTS).openCursor();
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { done(records.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.localId.localeCompare(b.localId))); return; }
          checkId(cursor.key); records.push(publicManifest(validateManifest(cursor.value, cursor.key))); cursor.continue();
        } catch (error) { abort(error); }
      };
    });
  }

  async function replaceLocalDocument(localId, file, options = {}) {
    const { expectedRevision } = options;
    checkId(localId);
    checkRevision(expectedRevision);
    const hasState = Object.hasOwn(options, 'state');
    const state = hasState ? copyDocumentState(options.state, localId, maxStateBytes) : undefined;
    const prepared = await prepare(file);
    const manifest = await transact(hasState ? [MANIFESTS, PDF_BYTES, DOCUMENT_STATE] : [MANIFESTS, PDF_BYTES], 'readwrite', (tx, done, abort) => {
      const manifests = tx.objectStore(MANIFESTS);
      const request = manifests.get(localId);
      request.onsuccess = () => {
        try {
          if (!request.result) throw fail('not-found', 'This local PDF is no longer in the device library.');
          const previous = validateManifest(request.result, localId);
          if (previous.revision !== expectedRevision) throw fail('revision-conflict', 'This local PDF changed in another window. Reopen it before saving again.');
          const next = { id: localId, localId, storageMode: 'local', name: prepared.name,
            size: prepared.size, type: prepared.type, created_at: previous.created_at,
            updated_at: new Date().toISOString(), revision: expectedRevision + 1,
            bytesRevision: expectedRevision + 1,
            ...(hasState ? { stateRevision: expectedRevision + 1 } : previous.stateRevision ? { stateRevision: previous.stateRevision } : {}) };
          manifests.put(next);
          tx.objectStore(PDF_BYTES).put({ localId, revision: next.revision, blob: prepared.blob });
          if (hasState) tx.objectStore(DOCUMENT_STATE).put({ localId, revision: next.revision, state });
          done(publicManifest(next));
        } catch (error) { abort(error); }
      };
    });
    notifyChange();
    return manifest;
  }

  async function saveLocalDocumentState(localId, input, { expectedRevision } = {}) {
    active(); checkId(localId); checkRevision(expectedRevision);
    const state = copyDocumentState(input, localId, maxStateBytes);
    const manifest = await transact([MANIFESTS, DOCUMENT_STATE], 'readwrite', (tx, done, abort) => {
      const manifests = tx.objectStore(MANIFESTS); const request = manifests.get(localId);
      request.onsuccess = () => {
        try {
          if (!request.result) throw fail('not-found', 'This local PDF is no longer in the device library.');
          const previous = validateManifest(request.result, localId);
          if (previous.revision !== expectedRevision) throw fail('revision-conflict', 'This local PDF changed in another window. Reopen it before saving again.');
          const next = { ...publicManifest(previous), bytesRevision: previous.bytesRevision || previous.revision,
            stateRevision: expectedRevision + 1, revision: expectedRevision + 1, updated_at: new Date().toISOString() };
          manifests.put(next); tx.objectStore(DOCUMENT_STATE).put({ localId, revision: next.revision, state });
          done(publicManifest(next));
        } catch (error) { abort(error); }
      };
    });
    notifyChange(); return manifest;
  }

  async function openLocalDocument(localId) {
    checkId(localId);
    const { manifest, row, snapshot } = await transact([MANIFESTS, PDF_BYTES, DOCUMENT_STATE], 'readonly', (tx, done, abort) => {
      const metadata = tx.objectStore(MANIFESTS).get(localId);
      const bytes = tx.objectStore(PDF_BYTES).get(localId);
      const state = tx.objectStore(DOCUMENT_STATE).get(localId);
      let pending = 3;
      const read = () => {
        if (--pending) return;
        try {
          if (!metadata.result) throw fail('not-found', 'This local PDF is no longer in the device library.');
          const manifest = validateManifest(metadata.result, localId);
          const row = bytes.result;
          if (!row || row.localId !== localId || row.revision !== (manifest.bytesRevision || manifest.revision) || !(row.blob instanceof Blob) || row.blob.size !== manifest.size) {
            throw fail('corrupt', 'The local PDF bytes do not match its metadata. Its stored data was preserved.');
          }
          const snapshot = state.result;
          if (manifest.stateRevision ? (!snapshot || snapshot.localId !== localId || snapshot.revision !== manifest.stateRevision) : snapshot !== undefined) {
            throw fail('corrupt', 'The local PDF state does not match its metadata. Its stored data was preserved.');
          }
          done({ manifest, row, snapshot });
        } catch (error) { abort(error); }
      };
      metadata.onsuccess = read; bytes.onsuccess = read; state.onsuccess = read;
    });
    const file = new File([row.blob], manifest.name, { type: manifest.type, lastModified: Date.parse(manifest.updated_at) });
    Object.assign(file, { localId, _surveyPdfId: localId, storageMode: 'local', localRevision: manifest.revision });
    if (snapshot) file._localDocumentState = copyDocumentState(snapshot.state, localId, maxStateBytes);
    return file;
  }

  // Graceful handle close, not transaction cancellation: seal future calls and
  // pending opens, but an already active IDB transaction may still commit.
  function close() {
    closed = true;
    for (const cancel of pendingPreparations) cancel();
    cancelOpen?.(); connection?.close(); connection = null;
  }
  return { importLocalDocument, importLocalDocumentCopy, listLocalDocuments, openLocalDocument, replaceLocalDocument, saveLocalDocumentState, close };
}

let defaultStore;
const productionStore = () => (defaultStore ||= createLocalDocumentStore());
export const importLocalDocument = file => productionStore().importLocalDocument(file);
export const importLocalDocumentCopy = (file, state) => productionStore().importLocalDocumentCopy(file, state);
export const listLocalDocuments = () => productionStore().listLocalDocuments();
export const openLocalDocument = localId => productionStore().openLocalDocument(localId);
export const replaceLocalDocument = (localId, file, options) => productionStore().replaceLocalDocument(localId, file, options);
export const saveLocalDocumentState = (localId, state, options) => productionStore().saveLocalDocumentState(localId, state, options);
