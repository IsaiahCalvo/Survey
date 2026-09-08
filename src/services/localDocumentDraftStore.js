import { copyLocalDocumentState, LOCAL_DOCUMENT_MAX_BYTES, LOCAL_DOCUMENT_MAX_STATE_BYTES } from './localDocumentStore.js';
import { createLocalDocumentStateReader, isManagedLocalDocument } from './localDocumentState.js';

// Recovery data, not a cache. No canonical database access, account ownership,
// automatic acknowledgement, eviction, or merge into a changed PDF.
export const LOCAL_DOCUMENT_DRAFT_DB_NAME = 'survey-local-document-drafts-v1';
const SESSIONS = 'sessions';
const BYTES = 'pdfBytes';
const SNAPSHOTS = 'snapshots';
const stores = [SESSIONS, BYTES, SNAPSHOTS];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positive = value => Number.isSafeInteger(value) && value > 0;
export class LocalDocumentDraftStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalDocumentDraftStoreError'; this.code = code; }
}
const fail = (code, message) => new LocalDocumentDraftStoreError(code, message);
const checkSession = id => { if (typeof id !== 'string' || !uuid.test(id)) throw fail('invalid-input', 'A valid draft session is required.'); };
const checkSequence = value => { if (!positive(value)) throw fail('invalid-input', 'The exact draft sequence is required.'); };
const metadataOf = row => ({ sessionId: row.sessionId, writerId: row.writerId, fileId: row.fileId,
  sourceLocalId: row.sourceLocalId, baseCanonicalRevision: row.baseCanonicalRevision,
  name: row.name, size: row.size, type: row.type, created_at: row.created_at,
  updated_at: row.updated_at, createdAt: row.created_at, updatedAt: row.updated_at, sequence: row.sequence });
function notifyChange() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new window.Event('local-document-draft-changed')); }
  catch { /* A notification failure cannot undo a storage commit. */ }
}

export function createLocalDocumentDraftStore({ indexedDB, dbName = LOCAL_DOCUMENT_DRAFT_DB_NAME,
  maxDocumentBytes = LOCAL_DOCUMENT_MAX_BYTES, maxStateBytes = LOCAL_DOCUMENT_MAX_STATE_BYTES, timeoutMs = 10_000 } = {}) {
  if (typeof dbName !== 'string' || !dbName.trim() || !positive(maxDocumentBytes)
    || !positive(maxStateBytes) || !positive(timeoutMs)) throw new TypeError('Invalid local draft store options.');
  let connection = null; let opening = null; let cancelOpen = null; let closed = false;
  const active = () => { if (closed) throw fail('closed', 'The local draft store is closed.'); };

  async function database() {
    active();
    if (connection) return connection;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request; let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true; clearTimeout(timer); cancelOpen = null;
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(fail('timed-out', 'Opening local drafts timed out. Please retry.')), timeoutMs);
      cancelOpen = () => {
        try { request?.transaction?.abort(); } catch { /* already settled */ }
        finish(fail('closed', 'The local draft store is closed.'));
      };
      try {
        const storage = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
        if (!storage?.open) throw fail('unavailable', 'Local draft storage is unavailable.');
        request = storage.open(dbName, 1);
      } catch (error) { finish(error); return; }
      request.onupgradeneeded = () => {
        if (settled || closed) { request.transaction.abort(); return; }
        try { for (const name of stores) request.result.createObjectStore(name, { keyPath: 'sessionId' }); }
        catch (error) { request.transaction.abort(); finish(error); }
      };
      request.onblocked = () => finish(fail('blocked', 'Local drafts are busy in another window. Please retry.'));
      request.onerror = () => finish(request.error || fail('unavailable', 'Local drafts could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); finish(fail('closed', 'The local draft store is closed.')); return; }
        if (stores.some(name => !db.objectStoreNames.contains(name))) {
          db.close(); finish(fail('corrupt', 'Local draft storage is incomplete. Its data was kept.')); return;
        }
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        finish(null, db);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transact(names, mode, run) {
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(names, mode); }
      catch (error) { if (connection === db) connection = null; reject(error); return; }
      let result; let error;
      const abort = cause => { error ||= cause; try { tx.abort(); } catch { /* already settled */ } };
      const timer = setTimeout(() => abort(fail('timed-out', 'The local draft operation timed out. Please retry.')), timeoutMs);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = () => { clearTimeout(timer); reject(error || tx.error || fail('aborted', 'The local draft operation did not commit.')); };
      tx.onerror = event => { error ||= event.target?.error || tx.error; };
      try { run(tx, value => { result = value; }, abort); } catch (cause) { abort(cause); }
    });
  }

  function copyState(input, sourceLocalId) {
    const copy = copyLocalDocumentState(input, sourceLocalId, maxStateBytes);
    createLocalDocumentStateReader({ localId: sourceLocalId, _surveyPdfId: sourceLocalId,
      storageMode: 'local', _localDocumentState: copy });
    return copy;
  }

  function validateMetadata(row, sessionId) {
    if (!row || row.sessionId !== sessionId || !uuid.test(row.writerId || '') || !uuid.test(row.fileId || '')
      || !positive(row.sequence) || typeof row.discarded !== 'boolean') throw fail('corrupt', 'The draft metadata is invalid. Its data was kept.');
    if (row.discarded) return row;
    if (!isManagedLocalDocument({ storageMode: 'local', localId: row.sourceLocalId, _surveyPdfId: row.sourceLocalId })
      || !positive(row.baseCanonicalRevision) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 1024
      || !positive(row.size) || row.size > maxDocumentBytes || row.type !== 'application/pdf'
      || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
      || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) {
      throw fail('corrupt', 'The draft metadata is invalid. Its data was kept.');
    }
    return row;
  }

  async function checkPdf(blob) {
    const header = new Uint8Array(await Blob.prototype.arrayBuffer.call(Blob.prototype.slice.call(blob, 0, 1024)));
    const signature = [37, 80, 68, 70, 45];
    if (!header.some((_byte, index) => signature.every((value, offset) => header[index + offset] === value))) {
      throw fail('invalid-input', 'The draft file is not a PDF.');
    }
  }

  function createWriter(file) {
    active();
    if (!(file instanceof File) || !isManagedLocalDocument(file) || !positive(file.localRevision)
      || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 1024) {
      throw fail('invalid-input', 'A managed local PDF is required for a draft.');
    }
    // Native Blob slicing captures immutable bytes, not overridable file methods
    // or mutable identity fields. State-only saves may change localRevision.
    const blob = Blob.prototype.slice.call(file, 0, undefined, 'application/pdf');
    if (!positive(blob.size) || blob.size > maxDocumentBytes) throw fail('invalid-input', 'The draft PDF is empty or exceeds the local file limit.');
    const sessionId = crypto.randomUUID(); const writerId = crypto.randomUUID(); const fileId = crypto.randomUUID();
    const base = { sessionId, writerId, fileId, sourceLocalId: file.localId, baseCanonicalRevision: file.localRevision,
      name: file.name, size: blob.size, type: 'application/pdf', created_at: new Date().toISOString() };
    let sequence = 0; let committedSequence = 0; let sealed = false; let checked = false;
    let tail = Promise.resolve(null);
    const capture = input => {
      active();
      if (sealed) throw fail('sealed', 'This draft writer is sealed.');
      if (sequence === Number.MAX_SAFE_INTEGER) throw fail('sequence-exhausted', 'Start a new draft session before editing again.');
      const currentSequence = ++sequence;
      // Copy before queuing: a caller may mutate or reuse its snapshot at once.
      const snapshot = copyState(input, base.sourceLocalId);
      const write = async () => {
        active();
        if (!checked) { await checkPdf(blob); checked = true; }
        const first = committedSequence === 0;
        // Later receipts confirm this state transaction, not a fresh byte
        // integrity check. readDraft checks retained bytes before recovery.
        const receipt = await transact(first ? stores : [SESSIONS, SNAPSHOTS], 'readwrite', (tx, done, abort) => {
          const metadata = tx.objectStore(SESSIONS); const request = metadata.get(sessionId);
          request.onsuccess = () => {
            try {
              const prior = request.result;
              if (prior) {
                validateMetadata(prior, sessionId);
                if (prior.discarded) throw fail('discarded', 'This draft was discarded. Start a new draft session.');
                if (prior.writerId !== writerId || prior.fileId !== fileId || prior.sourceLocalId !== base.sourceLocalId
                  || prior.sequence !== committedSequence) throw fail('sequence-conflict', 'The draft changed before this write. Its data was kept.');
              } else if (!first) throw fail('corrupt', 'The draft metadata is missing. Its remaining data was kept.');
              const next = { ...base, sequence: currentSequence, discarded: false, updated_at: new Date().toISOString() };
              if (first) {
                metadata.add(next);
                tx.objectStore(BYTES).add({ sessionId, writerId, fileId, blob });
              } else metadata.put(next);
              tx.objectStore(SNAPSHOTS).put({ sessionId, writerId, fileId, sequence: currentSequence, state: snapshot });
              done(Object.freeze({ sessionId, writerId, fileId, sourceLocalId: base.sourceLocalId, sequence: currentSequence }));
            } catch (error) { abort(error); }
          };
        });
        committedSequence = currentSequence;
        notifyChange();
        return receipt;
      };
      tail = tail.catch(() => {}).then(write);
      // Keep rejected captures observable to callers without an unhandled
      // rejection if a mounted writer is detached before its flush callback.
      tail.catch(() => {});
      return tail;
    };
    const flush = () => tail;
    const seal = () => { sealed = true; return flush(); };
    return Object.freeze({ sessionId, writerId, fileId, capture, flush, seal });
  }

  async function listDrafts() {
    return transact([SESSIONS], 'readonly', (tx, done, abort) => {
      const rows = []; const request = tx.objectStore(SESSIONS).openCursor();
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { done(rows); return; }
          const row = validateMetadata(cursor.value, cursor.key);
          if (!row.discarded) rows.push(metadataOf(row));
          cursor.continue();
        } catch (error) { abort(error); }
      };
    });
  }

  async function readDraft(sessionId, { expectedSequence } = {}) {
    checkSession(sessionId); checkSequence(expectedSequence);
    const { metadata, blob, state } = await transact(stores, 'readonly', (tx, done, abort) => {
      const requests = stores.map(name => tx.objectStore(name).get(sessionId)); let pending = requests.length;
      for (const request of requests) request.onsuccess = () => {
        if (--pending) return;
        try {
          const [row, bytes, snapshot] = requests.map(request => request.result);
          if (!row) throw fail('not-found', 'The requested draft was not found.');
          validateMetadata(row, sessionId);
          if (row.discarded) throw fail('discarded', 'This draft was discarded.');
          if (row.sequence !== expectedSequence) throw fail('sequence-conflict', 'The draft changed. Refresh its details before recovery.');
          for (const record of [bytes, snapshot]) {
            if (!record || record.sessionId !== sessionId || record.writerId !== row.writerId || record.fileId !== row.fileId) {
              throw fail('corrupt', 'The draft bytes and state do not match. Its data was kept.');
            }
          }
          if (!(bytes.blob instanceof Blob) || bytes.blob.size !== row.size || snapshot.sequence !== row.sequence) {
            throw fail('corrupt', 'The draft bytes or state are incomplete. Its data was kept.');
          }
          done({ metadata: metadataOf(row), blob: bytes.blob, state: copyState(snapshot.state, row.sourceLocalId) });
        } catch (error) { abort(error); }
      };
    });
    await checkPdf(blob);
    // Deliberately no local/cloud identity. Only atomic import-copy may turn
    // these retained bytes and state into an editable library document.
    const file = new File([blob], metadata.name, { type: metadata.type, lastModified: Date.parse(metadata.updated_at) });
    return { metadata, file, state };
  }

  async function discardDraft(sessionId, { expectedSequence } = {}) {
    checkSession(sessionId); checkSequence(expectedSequence);
    const discarded = await transact(stores, 'readwrite', (tx, done, abort) => {
      const metadata = tx.objectStore(SESSIONS); const request = metadata.get(sessionId);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (!row) throw fail('not-found', 'The requested draft was not found.');
          validateMetadata(row, sessionId);
          if (row.sequence !== expectedSequence) throw fail('sequence-conflict', 'A newer draft exists. Refresh before discarding it.');
          // Retain a tiny tombstone: no delayed writer can recreate this session.
          metadata.put({ sessionId, writerId: row.writerId, fileId: row.fileId, sequence: row.sequence, discarded: true });
          tx.objectStore(BYTES).delete(sessionId); tx.objectStore(SNAPSHOTS).delete(sessionId);
          done(true);
        } catch (error) { abort(error); }
      };
    });
    notifyChange();
    return discarded;
  }

  // Graceful connection close is not cancellation: an active transaction may
  // still commit. Use writer.seal() and await it before close() when draining.
  function close() { closed = true; cancelOpen?.(); connection?.close(); connection = null; }
  return Object.freeze({ createWriter, listDrafts, readDraft, discardDraft, close });
}

let defaultStore;
const production = () => (defaultStore ||= createLocalDocumentDraftStore());
export const createLocalDocumentDraftWriter = file => production().createWriter(file);
export const createLocalDraftWriter = createLocalDocumentDraftWriter;
export const listLocalDocumentDrafts = () => production().listDrafts();
export const readLocalDocumentDraft = (sessionId, options) => production().readDraft(sessionId, options);
export const discardLocalDocumentDraft = (sessionId, options) => production().discardDraft(sessionId, options);
