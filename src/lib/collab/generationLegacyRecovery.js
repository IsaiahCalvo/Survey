import { captureRegisteredYDoc } from './ydocRegistry.js';
import { getLegacyYDocScopeKey } from './legacyYDocScope.js';
import { buildLegacyYDocRecoveryExport } from './legacyYDocRecovery.js';

// Separate from live Yjs stores and the old raw-only recovery archive. Adds are
// immutable; no deletion, import, compaction or server acceptance is performed.
export const GENERATION_LEGACY_RECOVERY_DATABASE = 'survey-generation-legacy-recovery-v1';
export const GENERATION_LEGACY_RECOVERY_STORE = 'registryArchives';
const DATABASE = GENERATION_LEGACY_RECOVERY_DATABASE;
const STORE = GENERATION_LEGACY_RECOVERY_STORE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 64 * 1024 * 1024;
const failure = (code, cause) => Object.assign(new Error(
  'The old local document could not be confirmed in recovery storage.', cause ? { cause } : undefined,
), { code: `GENERATION_LEGACY_RECOVERY_${code}` });

function openArchive(factory, create, control) {
  return new Promise((resolve, reject) => {
    let request, settled = false, missing = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true; control.signal.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(db);
    };
    const cancel = () => {
      try { request?.transaction?.abort(); } catch { /* upgrade already ended */ }
      finish(control.signal.reason || failure('ABORTED'));
    };
    control.signal.addEventListener('abort', cancel, { once: true });
    try {
      control.check();
      if (typeof factory?.open !== 'function') throw failure('UNAVAILABLE');
      request = create ? factory.open(DATABASE, 1) : factory.open(DATABASE);
      request.onupgradeneeded = event => {
        try {
          if (settled || !create) { missing = true; request.transaction.abort(); return; }
          control.check();
          if (event.oldVersion !== 0) throw failure('SCHEMA');
          const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('documentId', 'documentId', { unique: false });
        } catch (error) { try { request.transaction.abort(); } catch { /* ended */ } finish(error); }
      };
      request.onerror = () => finish(failure(missing ? 'INCOMPLETE' : 'STORAGE', request.error));
      request.onblocked = () => finish(failure('BLOCKED'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        try {
          control.check();
          if (db.name !== DATABASE || db.version !== 1 || db.objectStoreNames.length !== 1
            || !db.objectStoreNames.contains(STORE)) throw failure('SCHEMA');
          finish(null, db);
        } catch (error) { db.close(); finish(error); }
      };
    } catch (error) { finish(error); }
  });
}

function transact(db, record, write, control) {
  return new Promise((resolve, reject) => {
    let tx, result, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      control.signal.removeEventListener('abort', cancel);
      db.removeEventListener('versionchange', changed); db.removeEventListener('close', changed);
      if (error) { try { tx?.abort(); } catch { /* already ended */ } reject(error); }
      else resolve(result);
    };
    const cancel = () => finish(control.signal.reason || failure('ABORTED'));
    const changed = () => { finish(failure('STALE')); db.close(); };
    control.signal.addEventListener('abort', cancel, { once: true });
    db.addEventListener('versionchange', changed); db.addEventListener('close', changed);
    try {
      control.check();
      tx = db.transaction(STORE, write ? 'readwrite' : 'readonly');
      const store = tx.objectStore(STORE);
      if (store.keyPath !== 'id' || store.autoIncrement || store.indexNames.length !== 1
        || !store.indexNames.contains('documentId') || store.index('documentId').keyPath !== 'documentId'
        || store.index('documentId').unique || store.index('documentId').multiEntry) throw failure('SCHEMA');
      const read = store.get(record.id);
      read.onsuccess = () => {
        try {
          control.check(); result = read.result;
          if (result === undefined && write) {
            const add = store.add(record);
            add.onsuccess = () => { try { control.check(); result = record; } catch (error) { finish(error); } };
          }
        } catch (error) { finish(error); }
      };
      tx.oncomplete = () => { try { control.check(); finish(); } catch (error) { finish(error); } };
      tx.onabort = tx.onerror = () => finish(failure('STORAGE', tx.error));
    } catch (error) { finish(error); }
  });
}

const equalRecord = (actual, expected) => actual && Object.keys(actual).length === Object.keys(expected).length
  && Object.keys(expected).every(key => actual[key] === expected[key]);

/** Archive only the two existing registry entries, including unresolved Yjs
 * evidence. This is not a backup of every legacy database or external queue.
 * isCurrent checks live memory only; validate MUST run before accepting close.
 */
export function createGenerationLegacyRecovery({ documentId, actorUserId, pdfGenerationId,
  indexedDb = globalThis.indexedDB, isCurrent: scopeCurrent, timeoutMs = 5000 } = {}) {
  if (![documentId, actorUserId, pdfGenerationId].every(value => typeof value === 'string' && UUID.test(value))
    || typeof scopeCurrent !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new TypeError('Exact generation recovery scope and a bounded timeout are required');
  }
  const keys = [documentId, getLegacyYDocScopeKey(documentId, actorUserId)];
  const receipts = new WeakMap();
  const scopeValid = () => { try { return scopeCurrent() === true; } catch { return false; } };
  const current = saved => scopeValid() && saved.captures.every(capture => capture.isCurrent());
  const isCurrent = receipt => {
    const saved = receipt && receipts.get(receipt);
    return !!saved && current(saved);
  };
  async function bounded(saved, signal, work) {
    if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('signal must be an AbortSignal');
    }
    const controller = new AbortController(), deadline = performance.now() + timeoutMs;
    const check = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (performance.now() >= deadline) throw failure('TIMEOUT');
      if (!current(saved)) throw failure('STALE');
    };
    let rejectTimeout;
    const expired = new Promise((_, reject) => { rejectTimeout = reject; });
    const stop = reason => { if (!controller.signal.aborted) { controller.abort(reason); rejectTimeout(reason); } };
    const cancel = () => stop(failure('ABORTED'));
    const timer = setTimeout(() => stop(failure('TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      // Observe the interruption promise even when the initial check throws.
      expired.catch(() => {});
      check();
      const result = await Promise.race([work({ signal: controller.signal, check }), expired]);
      check(); return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  async function verify(saved, control) {
    control.check();
    if (!saved.record) return; // Both exact registry entries are still absent.
    const db = await openArchive(indexedDb, false, control);
    try {
      const actual = await transact(db, saved.record, false, control);
      if (!equalRecord(actual, saved.record)) throw failure('INCOMPLETE');
    } finally { db.close(); }
    control.check();
  }
  return Object.freeze({
    async prepare({ readOnly = false, signal } = {}) {
      if (typeof readOnly !== 'boolean') throw new TypeError('readOnly must be boolean');
      if (!scopeValid()) throw failure('STALE');
      const saved = { captures: keys.map(captureRegisteredYDoc), record: null };
      return bounded(saved, signal, async control => {
        if (saved.captures.some(capture => capture.snapshot.state === 'present')) {
          let byteLength = 0;
          const sources = saved.captures.map((capture, index) => {
            const snapshot = capture.snapshot;
            for (const bytes of [snapshot.update, snapshot.pending?.structs, snapshot.pending?.deleteSet]) {
              byteLength += bytes?.byteLength || 0;
            }
            if (byteLength > MAX_BYTES) throw failure('LIMIT');
            // Registry keys identify sources; they are NEVER document IDs or
            // proof that raw pre-account bytes belong to the current actor.
            const { refCount: _refs, ...metadata } = snapshot.metadata || {};
            return { documentId, sourceRegistryKey: keys[index],
              provenance: { actorUserId: index === 0 ? null : actorUserId,
                attribution: index === 0 ? 'unknown-legacy' : 'actor-scoped-registry', automaticImportAllowed: false },
              registry: { ...snapshot, documentId, ...(snapshot.metadata ? { metadata } : {}) } };
          });
          const graph = await buildLegacyYDocRecoveryExport({ version: 1, kind: 'generation-legacy-registry-archive',
            documentId, actorUserId, pdfGenerationId, sources }, { signal: control.signal });
          control.check();
          const exportJson = JSON.stringify(graph);
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exportJson)));
          control.check();
          saved.record = { id: `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`,
            version: 1, documentId, actorUserId, pdfGenerationId, exportJson };
          const db = await openArchive(indexedDb, !readOnly, control);
          try {
            const actual = await transact(db, saved.record, !readOnly, control);
            if (!equalRecord(actual, saved.record)) throw failure('INCOMPLETE');
          } finally { db.close(); }
        }
        await verify(saved, control);
        const receipt = Object.freeze({ documentId, actorUserId, pdfGenerationId,
          kind: 'generation-legacy-recovery', archiveId: saved.record?.id ?? null });
        receipts.set(receipt, saved); return receipt;
      });
    },
    isCurrent,
    async validate(receipt, { signal } = {}) {
      if (!isCurrent(receipt)) throw failure('STALE');
      const saved = receipts.get(receipt);
      return bounded(saved, signal, async control => { await verify(saved, control); return true; });
    },
  });
}
