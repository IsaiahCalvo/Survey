import { copyLocalDocumentState, LOCAL_DOCUMENT_MAX_BYTES, LOCAL_DOCUMENT_MAX_STATE_BYTES } from './localDocumentStore.js';
import { createLocalDocumentStateReader, isManagedLocalDocument } from './localDocumentState.js';
import { fingerprintLocalPdfBlob, sameLocalPdfBytes } from './localPdfByteFingerprint.js';

// Recovery data, not a cache. No canonical database access, account ownership,
// automatic acknowledgement, eviction, or merge into a changed PDF.
export const LOCAL_DOCUMENT_DRAFT_DB_NAME = 'survey-local-document-drafts-v1';
const SESSIONS = 'sessions';
const BYTES = 'pdfBytes';
const SNAPSHOTS = 'snapshots';
const SHARED_BYTES = 'sharedPdfBytes';
const ACTIVE = 'active';
const DRAFT_META = 'draftMeta';
const ACTIVE_COUNT = 'activeCount';
const legacyStores = [SESSIONS, BYTES, SNAPSHOTS];
const stores = [...legacyStores, SHARED_BYTES];
const fingerprintPattern = /^sha256-chunks-v1:[0-9a-f]{64}$/;
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
  maxDocumentBytes = LOCAL_DOCUMENT_MAX_BYTES, maxStateBytes = LOCAL_DOCUMENT_MAX_STATE_BYTES, timeoutMs = 10_000,
  fingerprintBlob = fingerprintLocalPdfBlob, compareBytes = sameLocalPdfBytes, existingOnly = false } = {}) {
  if (typeof dbName !== 'string' || !dbName.trim() || !positive(maxDocumentBytes)
    || !positive(maxStateBytes) || !positive(timeoutMs) || typeof fingerprintBlob !== 'function'
    || typeof compareBytes !== 'function' || typeof existingOnly !== 'boolean') throw new TypeError('Invalid local draft store options.');
  let connection = null; let opening = null; let cancelOpen = null; let closed = false;
  const active = () => { if (closed) throw fail('closed', 'The local draft store is closed.'); };

  async function database() {
    active();
    if (connection) return connection;
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request; let settled = false; let openFailure;
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
        request = existingOnly ? storage.open(dbName) : storage.open(dbName, 3);
      } catch (error) { finish(error); return; }
      request.onupgradeneeded = event => {
        if (settled || closed) { request.transaction.abort(); return; }
        if (existingOnly) {
          openFailure = fail('not-found', 'No existing local recovery storage was found.');
          request.transaction.abort();
          return;
        }
        try {
          if (event.oldVersion === 0) for (const name of legacyStores) request.result.createObjectStore(name, { keyPath: 'sessionId' });
          if (event.oldVersion < 2) {
            request.result.createObjectStore(SHARED_BYTES, { keyPath: 'payloadId' });
            request.transaction.objectStore(BYTES).createIndex('payloadId', 'payloadId');
          }
          if (event.oldVersion < 3) {
            const sessions = request.transaction.objectStore(SESSIONS);
            sessions.createIndex(ACTIVE, ACTIVE);
            const draftMeta = request.result.createObjectStore(DRAFT_META, { keyPath: 'key' });
            let activeCount = 0;
            const cursorRequest = sessions.openCursor();
            cursorRequest.onerror = () => {
              openFailure = cursorRequest.error || fail('corrupt', 'Local draft metadata could not be indexed. Its data was kept.');
              request.transaction.abort();
            };
            cursorRequest.onsuccess = () => {
              try {
                const cursor = cursorRequest.result;
                if (!cursor) { draftMeta.put({ key: ACTIVE_COUNT, value: activeCount }); return; }
                const row = validateMetadata(cursor.value, cursor.key);
                if (!row.discarded) activeCount += 1;
                cursor.update({ ...row, active: row.discarded ? 0 : 1 });
                cursor.continue();
              } catch (error) {
                openFailure = error;
                request.transaction.abort();
              }
            };
          }
        }
        catch (error) { request.transaction.abort(); finish(error); }
      };
      request.onblocked = () => finish(fail('blocked', 'Local drafts are busy in another window. Please retry.'));
      request.onerror = () => finish(openFailure || request.error || fail('unavailable', 'Local drafts could not be opened.'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); finish(fail('closed', 'The local draft store is closed.')); return; }
        if (existingOnly && db.version !== 1 && db.version !== 2 && db.version !== 3) {
          db.close(); finish(fail('unsupported-format', 'This recovery storage version is not supported. Its data was kept.')); return;
        }
        const requiredStores = existingOnly && db.version === 1 ? legacyStores
          : db.version >= 3 ? [...stores, DRAFT_META] : stores;
        if (requiredStores.some(name => !db.objectStoreNames.contains(name))) {
          db.close(); finish(fail('corrupt', 'Local draft storage is incomplete. Its data was kept.')); return;
        }
        if (db.version >= 3) {
          let schema;
          try {
            schema = db.transaction(SESSIONS, 'readonly');
            const sessions = schema.objectStore(SESSIONS);
            if (!sessions.indexNames.contains(ACTIVE)) throw fail('corrupt', 'Local draft storage is incomplete. Its data was kept.');
            const index = sessions.index(ACTIVE);
            if (index.keyPath !== ACTIVE || index.unique || index.multiEntry) {
              throw fail('corrupt', 'Local draft storage is incomplete. Its data was kept.');
            }
          } catch (error) {
            try { schema?.abort(); } catch { /* already settled */ }
            db.close(); finish(error); return;
          }
          try { schema.abort(); } catch { /* already settled */ }
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
    if (existingOnly && mode !== 'readonly') throw fail('read-only', 'Existing recovery storage is read-only.');
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(existingOnly
        ? names.filter(name => db.objectStoreNames.contains(name)) : names, mode); }
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

  const validPayload = (row, key) => row && row.payloadId === key && fingerprintPattern.test(key)
    && row.fingerprint === key && uuid.test(row.incarnation || '') && positive(row.size)
    && row.size <= maxDocumentBytes && row.blob instanceof Blob && row.blob.size === row.size;
  const validReference = row => row && !Object.hasOwn(row, 'blob') && fingerprintPattern.test(row.payloadId || '')
    && row.fingerprint === row.payloadId && uuid.test(row.payloadIncarnation || '') && positive(row.size);

  async function findSharedPayload(blob, key) {
    const row = await transact([SHARED_BYTES], 'readonly', (tx, done) => {
      const request = tx.objectStore(SHARED_BYTES).get(key);
      request.onsuccess = () => done(request.result);
    });
    if (!row) return { key, incarnation: crypto.randomUUID(), existing: false };
    // Hash keys select candidates, never establish byte equality. A collision
    // or damaged candidate must not replace bytes belonging to other drafts.
    if (!validPayload(row, key) || row.size !== blob.size) return null;
    try {
      if (!await compareBytes(blob, row.blob, { timeoutMs })) return null;
    } catch { return null; }
    return { key, incarnation: row.incarnation, existing: true };
  }

  function createWriter(file) {
    active();
    if (existingOnly) throw fail('read-only', 'Existing recovery storage is read-only.');
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
    let fingerprintAttempted = false; let fingerprint = null;
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
        if (first && !fingerprintAttempted) {
          fingerprintAttempted = true;
          try {
            const key = await fingerprintBlob(blob, { timeoutMs });
            if (fingerprintPattern.test(key)) fingerprint = key;
          } catch { /* A failed optimization still permits an inline draft. */ }
        }
        // Later receipts confirm this state transaction, not a fresh byte
        // integrity check. readDraft checks retained bytes before recovery.
        let receipt;
        for (let attempt = 0; ; attempt++) {
          // Races are bounded. Inline storage remains the safe fallback rather
          // than waiting indefinitely for another writer or a last-ref discard.
          const shared = first && fingerprint && attempt < 3 ? await findSharedPayload(blob, fingerprint) : null;
          try {
            receipt = await transact(first
              ? [...(shared ? stores : legacyStores), DRAFT_META]
              : [SESSIONS, SNAPSHOTS], 'readwrite', (tx, done, abort) => {
              const metadata = tx.objectStore(SESSIONS); const request = metadata.get(sessionId);
              request.onsuccess = () => {
                try {
                  const prior = request.result;
                  if (prior) {
                    validateMetadata(prior, sessionId);
                    if (prior.discarded) throw fail('discarded', 'This draft was discarded. Start a new draft session.');
                    if (prior.active !== 1) throw fail('corrupt', 'The active draft index is invalid. Its data was kept.');
                    if (prior.writerId !== writerId || prior.fileId !== fileId || prior.sourceLocalId !== base.sourceLocalId
                      || prior.sequence !== committedSequence) throw fail('sequence-conflict', 'The draft changed before this write. Its data was kept.');
                  } else if (!first) throw fail('corrupt', 'The draft metadata is missing. Its remaining data was kept.');
                  const next = { ...base, sequence: currentSequence, discarded: false,
                    active: 1, updated_at: new Date().toISOString() };
                  const commitWrites = () => {
                    if (first) {
                      metadata.add(next);
                      tx.objectStore(BYTES).add(shared
                        ? { sessionId, writerId, fileId, payloadId: shared.key, payloadIncarnation: shared.incarnation,
                          fingerprint: shared.key, size: blob.size }
                        : { sessionId, writerId, fileId, blob });
                    } else metadata.put(next);
                    tx.objectStore(SNAPSHOTS).put({ sessionId, writerId, fileId, sequence: currentSequence, state: snapshot });
                    done(Object.freeze({ sessionId, writerId, fileId, sourceLocalId: base.sourceLocalId, sequence: currentSequence }));
                  };
                  const commit = () => {
                    if (!first) { commitWrites(); return; }
                    const draftMeta = tx.objectStore(DRAFT_META);
                    const count = draftMeta.get(ACTIVE_COUNT);
                    count.onsuccess = () => {
                      try {
                        const value = count.result;
                        if (!value || value.key !== ACTIVE_COUNT || !Number.isSafeInteger(value.value)
                          || value.value < 0 || value.value === Number.MAX_SAFE_INTEGER) {
                          throw fail('corrupt', 'The active draft count is invalid. Its data was kept.');
                        }
                        draftMeta.put({ key: ACTIVE_COUNT, value: value.value + 1 });
                        commitWrites();
                      } catch (error) { abort(error); }
                    };
                  };
                  if (!shared) { commit(); return; }
                  const payloads = tx.objectStore(SHARED_BYTES); const payload = payloads.get(shared.key);
                  payload.onsuccess = () => {
                    try {
                      const row = payload.result;
                      if (shared.existing ? (!validPayload(row, shared.key) || row.incarnation !== shared.incarnation || row.size !== blob.size) : !!row) {
                        throw fail('payload-race', 'The shared PDF changed before this draft committed.');
                      }
                      if (!shared.existing) payloads.add({ payloadId: shared.key, fingerprint: shared.key,
                        incarnation: shared.incarnation, size: blob.size, blob });
                      commit();
                    } catch (error) { abort(error); }
                  };
                } catch (error) { abort(error); }
              };
            });
            break;
          } catch (error) { if (error?.code !== 'payload-race') throw error; }
        }
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
    return transact([SESSIONS, DRAFT_META], 'readonly', (tx, done, abort) => {
      const rows = [];
      const sessions = tx.objectStore(SESSIONS);
      const indexed = sessions.indexNames.contains(ACTIVE);
      if (tx.objectStoreNames.contains(DRAFT_META) && !indexed) {
        abort(fail('corrupt', 'Local draft storage is incomplete. Its data was kept.'));
        return;
      }
      const activeIndex = indexed ? sessions.index(ACTIVE) : null;
      if (indexed && (activeIndex.keyPath !== ACTIVE || activeIndex.unique || activeIndex.multiEntry)) {
        abort(fail('corrupt', 'Local draft storage is incomplete. Its data was kept.'));
        return;
      }
      let cursorFinished = false;
      let countsFinished = !indexed;
      let expectedActiveCount; let activeCount;
      const finish = () => {
        if (!cursorFinished || !countsFinished) return;
        if (indexed && activeCount !== expectedActiveCount) {
          abort(fail('corrupt', 'The draft metadata index is invalid. Its data was kept.'));
          return;
        }
        done(rows);
      };
      if (indexed) {
        const counts = [tx.objectStore(DRAFT_META).get(ACTIVE_COUNT), activeIndex.count(1)];
        let pending = counts.length;
        counts.forEach((count, index) => {
          count.onerror = () => abort(count.error);
          count.onsuccess = () => {
            if (index === 0) {
              const value = count.result;
              if (!value || value.key !== ACTIVE_COUNT || !Number.isSafeInteger(value.value) || value.value < 0) {
                abort(fail('corrupt', 'The active draft count is invalid. Its data was kept.'));
                return;
              }
              expectedActiveCount = value.value;
            } else activeCount = count.result;
            if (--pending === 0) { countsFinished = true; finish(); }
          };
        });
      }
      const request = indexed ? activeIndex.openCursor(1) : sessions.openCursor();
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { cursorFinished = true; finish(); return; }
          const row = validateMetadata(cursor.value, indexed ? cursor.primaryKey : cursor.key);
          if (indexed && (row.discarded || row.active !== 1)) {
            throw fail('corrupt', 'The draft metadata index is invalid. Its data was kept.');
          }
          if (!row.discarded) rows.push(metadataOf(row));
          cursor.continue();
        } catch (error) { abort(error); }
      };
    });
  }

  async function readDraft(sessionId, { expectedSequence } = {}) {
    checkSession(sessionId); checkSequence(expectedSequence);
    const { metadata, blob, state, fingerprint } = await transact(stores, 'readonly', (tx, done, abort) => {
      const requests = legacyStores.map(name => tx.objectStore(name).get(sessionId)); let pending = requests.length;
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
          if (snapshot.sequence !== row.sequence) {
            throw fail('corrupt', 'The draft bytes or state are incomplete. Its data was kept.');
          }
          const copiedState = copyState(snapshot.state, row.sourceLocalId);
          if (Object.hasOwn(bytes, 'blob')) {
            if (!(bytes.blob instanceof Blob) || bytes.blob.size !== row.size || Object.hasOwn(bytes, 'payloadId')) {
              throw fail('corrupt', 'The draft bytes or state are incomplete. Its data was kept.');
            }
            done({ metadata: metadataOf(row), blob: bytes.blob, state: copiedState });
            return;
          }
          if (!validReference(bytes) || bytes.size !== row.size || !tx.objectStoreNames.contains(SHARED_BYTES)) {
            throw fail('corrupt', 'The draft PDF reference is invalid. Its data was kept.');
          }
          const payload = tx.objectStore(SHARED_BYTES).get(bytes.payloadId);
          payload.onsuccess = () => {
            try {
              const value = payload.result;
              if (!validPayload(value, bytes.payloadId) || value.incarnation !== bytes.payloadIncarnation || value.size !== row.size) {
                throw fail('corrupt', 'The shared draft PDF is missing or changed. Its data was kept.');
              }
              done({ metadata: metadataOf(row), blob: value.blob, state: copiedState, fingerprint: bytes.fingerprint });
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
    });
    await checkPdf(blob);
    if (fingerprint) {
      let actual;
      try { actual = await fingerprintBlob(blob, { timeoutMs }); }
      catch { throw fail('corrupt', 'The shared recovery PDF could not be verified. Its data was kept.'); }
      if (actual !== fingerprint) throw fail('corrupt', 'The shared recovery PDF bytes have changed. Its data was kept.');
    }
    if (existingOnly) {
      // Export verification can take time. A selected sequence must still
      // identify this exact session/file after hashing, including after a
      // discard or a connection retirement while those bytes were being read.
      await verifyReceipt(metadata);
    }
    // Deliberately no local/cloud identity. Only atomic import-copy may turn
    // these retained bytes and state into an editable library document.
    const file = new File([blob], metadata.name, { type: metadata.type, lastModified: Date.parse(metadata.updated_at) });
    return { metadata, file, state };
  }

  // This is a final selection check, not another PDF-integrity proof. The
  // caller must already hold verified bytes/state from the existing-only read.
  async function verifyReceipt(metadata) {
    if (!existingOnly) throw fail('read-only', 'Receipt verification requires an existing-only reader.');
    if (!metadata || typeof metadata !== 'object') throw fail('invalid-input', 'The selected draft metadata is required.');
    // Copy before awaiting storage so caller mutation cannot change which
    // sequence, writer, immutable File or source is being checked.
    const expected = metadataOf(metadata);
    checkSession(expected.sessionId);
    validateMetadata({ ...expected, discarded: false }, expected.sessionId);
    return transact([SESSIONS], 'readonly', (tx, done, abort) => {
      const request = tx.objectStore(SESSIONS).get(expected.sessionId);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (!row) throw fail('not-found', 'The requested draft is no longer available.');
          validateMetadata(row, expected.sessionId);
          if (row.discarded) throw fail('discarded', 'This draft was discarded.');
          const latest = metadataOf(row);
          if (Object.keys(expected).some(key => latest[key] !== expected[key])) {
            throw fail('sequence-conflict', 'The draft changed during verification. Refresh before exporting it.');
          }
          done(true);
        } catch (error) { abort(error); }
      };
    });
  }

  async function discardDraft(sessionId, { expectedSequence } = {}) {
    checkSession(sessionId); checkSequence(expectedSequence);
    const discarded = await transact([...stores, DRAFT_META], 'readwrite', (tx, done, abort) => {
      const metadata = tx.objectStore(SESSIONS); const request = metadata.get(sessionId);
      request.onsuccess = () => {
        try {
          const row = request.result;
          if (!row) throw fail('not-found', 'The requested draft was not found.');
          validateMetadata(row, sessionId);
          if (row.discarded) throw fail('discarded', 'This draft was already discarded.');
          if (row.active !== 1) throw fail('corrupt', 'The active draft index is invalid. Its data was kept.');
          if (row.sequence !== expectedSequence) throw fail('sequence-conflict', 'A newer draft exists. Refresh before discarding it.');
          // Retain a tiny tombstone: no delayed writer can recreate this session.
          const draftMeta = tx.objectStore(DRAFT_META); const activeCount = draftMeta.get(ACTIVE_COUNT);
          activeCount.onsuccess = () => {
            try {
              const value = activeCount.result;
              if (!value || value.key !== ACTIVE_COUNT || !positive(value.value)) {
                throw fail('corrupt', 'The active draft count is invalid. Its data was kept.');
              }
              draftMeta.put({ key: ACTIVE_COUNT, value: value.value - 1 });
              metadata.put({ sessionId, writerId: row.writerId, fileId: row.fileId,
                sequence: row.sequence, discarded: true, active: 0 });
              const references = tx.objectStore(BYTES); const reference = references.get(sessionId);
              reference.onsuccess = () => {
                try {
                  const bytes = reference.result;
                  references.delete(sessionId);
                  if (!validReference(bytes)) return;
                  const count = references.index('payloadId').count(bytes.payloadId);
                  count.onsuccess = () => {
                    try {
                      if (count.result !== 0) return;
                      const payloads = tx.objectStore(SHARED_BYTES); const payload = payloads.get(bytes.payloadId);
                      payload.onsuccess = () => {
                        try {
                          if (payload.result?.incarnation === bytes.payloadIncarnation) payloads.delete(bytes.payloadId);
                        } catch (error) { abort(error); }
                      };
                    } catch (error) { abort(error); }
                  };
                } catch (error) { abort(error); }
              };
              tx.objectStore(SNAPSHOTS).delete(sessionId);
              done(true);
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
    });
    notifyChange();
    return discarded;
  }

  // Graceful connection close is not cancellation: an active transaction may
  // still commit. Use writer.seal() and await it before close() when draining.
  function close() { closed = true; cancelOpen?.(); connection?.close(); connection = null; }
  return Object.freeze({ createWriter, listDrafts, readDraft, verifyReceipt, discardDraft, close });
}

let defaultStore;
const production = () => (defaultStore ||= createLocalDocumentDraftStore());
export const createLocalDocumentDraftWriter = file => production().createWriter(file);
export const createLocalDraftWriter = createLocalDocumentDraftWriter;
export const listLocalDocumentDrafts = () => production().listDrafts();
export const readLocalDocumentDraft = (sessionId, options) => production().readDraft(sessionId, options);
// Export does not initialize or upgrade the writable store. A fresh scoped
// connection also lets an old v1 draft be exported without a migration write.
export async function readExistingLocalDocumentDraft(sessionId, options) {
  const reader = createLocalDocumentDraftStore({ existingOnly: true });
  try { return await reader.readDraft(sessionId, options); }
  finally { reader.close(); }
}
export async function verifyExistingLocalDocumentDraftReceipt(metadata) {
  const reader = createLocalDocumentDraftStore({ existingOnly: true });
  try { return await reader.verifyReceipt(metadata); }
  finally { reader.close(); }
}
export const discardLocalDocumentDraft = (sessionId, options) => production().discardDraft(sessionId, options);
