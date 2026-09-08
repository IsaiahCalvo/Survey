import { captureRegisteredYDoc } from './ydocRegistry.js';
import { buildLegacyYDocRecoveryExport, LEGACY_RECOVERY_EXPORT_LIMITS } from './legacyYDocRecovery.js';

// Deliberately outside all actor-scoped Yjs databases and transport namespaces.
// Records are append-only and can be found by documentId without decoding data.
export const LEGACY_RECOVERY_ARCHIVE_DATABASE = 'survey-legacy-recovery-v1';
export const LEGACY_RECOVERY_ARCHIVE_STORE = 'rawRegistrySnapshots';
export const LEGACY_RECOVERY_ARCHIVE_LIMITS = Object.freeze({
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxJsonBytes: LEGACY_RECOVERY_EXPORT_LIMITS.maxJsonBytes,
});
const provenance = Object.freeze({ actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false });
const receipts = new WeakMap();
const failure = (code, message, cause) => Object.assign(new Error(message, cause ? { cause } : undefined), { code });

async function bounded(options, work) {
  const { signal, timeoutMs = 5000 } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive safe integer');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal');
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let reason;
  const cancel = () => { reason ||= failure('LEGACY_RECOVERY_ABORTED', 'The recovery archive save was canceled'); controller.abort(); };
  const timer = setTimeout(() => {
    reason ||= failure('LEGACY_RECOVERY_TIMEOUT', 'The recovery archive save timed out'); controller.abort();
  }, timeoutMs);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const check = () => {
    if (performance.now() >= deadline && !reason) {
      reason = failure('LEGACY_RECOVERY_TIMEOUT', 'The recovery archive save timed out'); controller.abort();
    }
    if (reason) throw reason;
  };
  let rejectOnAbort;
  try {
    check();
    const interrupted = new Promise((_, reject) => {
      rejectOnAbort = () => reject(reason || failure('LEGACY_RECOVERY_ABORTED', 'The recovery archive save was canceled'));
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    // Crypto and third-party async work may not honor a signal themselves.
    // The operation still settles by the deadline; late work must pass check()
    // before opening storage or issuing any write.
    const result = await Promise.race([work({ signal: controller.signal, check }), interrupted]);
    check(); return result;
  }
  catch (error) { check(); throw error; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}

function factoryFor(options) {
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  if (typeof factory?.open !== 'function') throw failure('LEGACY_RECOVERY_UNAVAILABLE', 'Local recovery archive storage is unavailable');
  return factory;
}

function openArchive(factory, create, control) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let missing = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true;
      control.signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(db);
    };
    const aborted = () => {
      try { request?.transaction?.abort(); } catch { /* no active upgrade */ }
      try { control.check(); } catch (error) { finish(error); }
    };
    control.signal.addEventListener('abort', aborted, { once: true });
    try {
      control.check();
      request = create ? factory.open(LEGACY_RECOVERY_ARCHIVE_DATABASE, 1) : factory.open(LEGACY_RECOVERY_ARCHIVE_DATABASE);
      request.onupgradeneeded = event => {
        try {
          if (settled) { request.transaction.abort(); return; }
          control.check();
          if (!create) { missing = true; request.transaction.abort(); return; }
          if (event.oldVersion !== 0) throw failure('LEGACY_RECOVERY_SCHEMA', 'Unsupported recovery archive schema');
          const store = request.result.createObjectStore(LEGACY_RECOVERY_ARCHIVE_STORE, { keyPath: 'id' });
          store.createIndex('documentId', 'documentId', { unique: false });
        } catch (error) { try { request.transaction.abort(); } catch { /* ended */ } finish(error); }
      };
      request.onerror = () => finish(failure(missing ? 'LEGACY_RECOVERY_INCOMPLETE' : 'LEGACY_RECOVERY_STORAGE_FAILED',
        missing ? 'The recovery archive is missing' : 'The recovery archive could not be opened', request.error));
      request.onblocked = () => finish(failure('LEGACY_RECOVERY_BLOCKED', 'The recovery archive is blocked'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        try {
          control.check();
          if (db.name !== LEGACY_RECOVERY_ARCHIVE_DATABASE || db.version !== 1
            || !db.objectStoreNames.contains(LEGACY_RECOVERY_ARCHIVE_STORE)) throw failure('LEGACY_RECOVERY_SCHEMA', 'Unsupported recovery archive schema');
          finish(null, db);
        } catch (error) { db.close(); finish(error); }
      };
    } catch (error) { finish(error); }
  });
}

function transact(db, mode, record, control) {
  return new Promise((resolve, reject) => {
    let tx;
    let result;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      control.signal.removeEventListener('abort', aborted);
      db.removeEventListener('versionchange', invalidated);
      db.removeEventListener('close', invalidated);
      if (error) { try { tx?.abort(); } catch { /* already complete */ } reject(error); }
      else resolve(result);
    };
    const aborted = () => { try { control.check(); } catch (error) { finish(error); } };
    const invalidated = () => finish(failure('LEGACY_RECOVERY_STALE', 'Recovery archive storage changed during the save check'));
    control.signal.addEventListener('abort', aborted, { once: true });
    db.addEventListener('versionchange', invalidated);
    db.addEventListener('close', invalidated);
    try {
      control.check();
      tx = db.transaction(LEGACY_RECOVERY_ARCHIVE_STORE, mode === 'readwrite' ? 'readwrite' : 'readonly');
      const store = tx.objectStore(LEGACY_RECOVERY_ARCHIVE_STORE);
      if (store.keyPath !== 'id' || !store.indexNames.contains('documentId')
        || store.index('documentId').keyPath !== 'documentId') throw failure('LEGACY_RECOVERY_SCHEMA', 'Unsupported recovery archive schema');
      let request;
      if (mode === 'count') request = store.index('documentId').count(record.documentId);
      else if (mode === 'list') {
        result = [];
        let jsonBytes = 0;
        request = store.index('documentId').openCursor(record.documentId);
        request.onsuccess = () => {
          try {
            control.check();
            const cursor = request.result;
            if (!cursor) return;
            if (result.length >= record.maxRecords) throw failure('LEGACY_RECOVERY_LIMIT', 'Too many recovery archives to export at once');
            const value = cursor.value;
            if (value?.documentId !== record.documentId || typeof value.exportJson !== 'string'
              || !sameRecord(value, value)) throw failure('LEGACY_RECOVERY_INCOMPLETE', 'A recovery archive record could not be read');
            // IDB has already cloned one cursor value; this is a retained-data
            // cap, not a promise that browsers can avoid that transient clone.
            if (jsonBytes + value.exportJson.length > record.maxJsonBytes) throw failure('LEGACY_RECOVERY_LIMIT', 'Recovery archives exceed the export size limit');
            jsonBytes += new TextEncoder().encode(value.exportJson).byteLength;
            if (jsonBytes > record.maxJsonBytes) throw failure('LEGACY_RECOVERY_LIMIT', 'Recovery archives exceed the export size limit');
            result.push({ id: value.id, formatVersion: value.formatVersion, kind: value.kind,
              documentId: value.documentId, capturedAt: value.capturedAt, provenance: { ...provenance }, exportJson: value.exportJson });
            cursor.continue();
          } catch (error) { finish(error); }
        };
      } else request = mode === 'readwrite' ? store.add(record) : store.get(record.id);
      if (mode !== 'list') request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { try { control.check(); finish(); } catch (error) { finish(error); } };
      tx.onerror = tx.onabort = event => finish(failure('LEGACY_RECOVERY_STORAGE_FAILED', 'The recovery archive transaction failed', tx.error || event?.target?.error));
    } catch (error) { finish(error); }
  });
}

function sameRecord(actual, expected) {
  return typeof actual?.id === 'string' && /^sha256:[a-f0-9]{64}$/.test(actual.id)
    && actual.id === expected.id && typeof actual.documentId === 'string' && actual.documentId === expected.documentId
    && actual.formatVersion === 1 && actual.kind === 'raw-registry-archive'
    && typeof actual.capturedAt === 'string' && actual.capturedAt.length <= 32 && actual.provenance?.actorUserId === null
    && actual.provenance.attribution === 'unknown-legacy' && actual.provenance.automaticImportAllowed === false
    && actual.exportJson === expected.exportJson;
}

async function verify(saved, control) {
  control.check();
  if (!saved.capture.isCurrent()) throw failure('LEGACY_RECOVERY_STALE', 'The old local document changed during recovery');
  if (!saved.record) return; // Proven absence requires no storage or database creation.
  const db = await openArchive(saved.factory, false, control);
  try {
    const actual = await transact(db, 'readonly', saved.record, control);
    if (!sameRecord(actual, saved.record)) throw failure('LEGACY_RECOVERY_INCOMPLETE', 'The recovery archive does not contain the exact saved copy');
  } finally { db.close(); }
  control.check();
  if (!saved.capture.isCurrent()) throw failure('LEGACY_RECOVERY_STALE', 'The old local document changed during recovery');
}

/** Saves only raw in-memory legacy bytes. No account ownership, auto-import,
 * cloud acknowledgment, raw-source write, or full legacy-source backup claim. */
export async function prepareLegacyRecoveryClose(documentId, options = {}) {
  return bounded(options, async control => {
    if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') throw new TypeError('readOnly must be a boolean');
    const caps = { ...LEGACY_RECOVERY_ARCHIVE_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(caps)) {
      if (!Object.hasOwn(LEGACY_RECOVERY_ARCHIVE_LIMITS, key) || !Number.isSafeInteger(value) || value <= 0) throw new TypeError('Invalid recovery archive limit');
    }
    const capture = captureRegisteredYDoc(documentId);
    control.check();
    if (!capture || !['absent', 'present'].includes(capture.snapshot?.state) || typeof capture.isCurrent !== 'function') {
      throw failure('LEGACY_RECOVERY_INCOMPLETE', 'The old local document could not be captured');
    }
    const saved = { capture, record: null, factory: null };
    if (capture.snapshot.state === 'present') {
      const snapshot = capture.snapshot;
      const bytes = [snapshot.update, snapshot.pending?.structs, snapshot.pending?.deleteSet]
        .reduce((sum, value) => sum + (value?.byteLength || 0), 0);
      if (bytes > caps.maxSnapshotBytes) throw failure('LEGACY_RECOVERY_LIMIT', 'The old local document exceeds the archive size limit');
      control.check();
      // Reference acquisition is not document content. Exclude its volatile
      // counter so repeated close checks reuse the same immutable archive.
      const { refCount: _refCount, ...metadata } = snapshot.metadata;
      const graph = await buildLegacyYDocRecoveryExport({ formatVersion: 1, kind: 'raw-registry-archive', documentId, provenance,
        registry: { ...snapshot, metadata } },
        { signal: control.signal, limits: { maxJsonBytes: caps.maxJsonBytes } });
      control.check();
      const exportJson = JSON.stringify(graph);
      control.check();
      if (!capture.isCurrent()) throw failure('LEGACY_RECOVERY_STALE', 'The old local document changed during recovery');
      saved.factory = factoryFor(options);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exportJson)))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      control.check();
      saved.record = { id: `sha256:${hash}`, formatVersion: 1, kind: 'raw-registry-archive', documentId,
        capturedAt: new Date().toISOString(), provenance: { ...provenance }, exportJson };
      const db = await openArchive(saved.factory, !options.readOnly, control);
      try {
        if (!capture.isCurrent()) throw failure('LEGACY_RECOVERY_STALE', 'The old local document changed during recovery');
        const existing = await transact(db, 'readonly', saved.record, control);
        if (existing !== undefined) {
          if (!sameRecord(existing, saved.record)) throw failure('LEGACY_RECOVERY_INCOMPLETE', 'The existing recovery archive does not match its content key');
        } else {
          if (options.readOnly) throw failure('LEGACY_RECOVERY_INCOMPLETE', 'This read-only document has no saved recovery archive');
          try { await transact(db, 'readwrite', saved.record, control); }
          catch (error) {
            // Another close request can win the immutable add. A conflicting
            // key is not proof: the fresh read below must match exact content.
            if (error?.cause?.name !== 'ConstraintError') throw error;
          }
        }
      } finally { db.close(); }
    }
    await verify(saved, control);
    const receipt = Object.freeze({ documentId, kind: 'legacy-recovery-close', rawRegistryState: capture.snapshot.state,
      archiveId: saved.record?.id ?? null, archiveDatabase: saved.record ? LEGACY_RECOVERY_ARCHIVE_DATABASE : null });
    receipts.set(receipt, saved);
    return receipt;
  });
}

/** Live-state check only; final close also requires fresh disk verification. */
export function isLegacyRecoveryReceiptCurrent(receipt) {
  try { return receipts.get(receipt)?.capture.isCurrent() === true; } catch { return false; }
}

export async function validateLegacyRecoveryReceipt(receipt, options = {}) {
  return bounded(options, async control => {
    if (!isLegacyRecoveryReceiptCurrent(receipt)) throw failure('LEGACY_RECOVERY_STALE', 'The recovery archive receipt is not current');
    const saved = receipts.get(receipt);
    if (options.indexedDB !== undefined && saved.factory && options.indexedDB !== saved.factory) throw failure('LEGACY_RECOVERY_SCOPE_MISMATCH', 'The recovery archive storage scope changed');
    await verify(saved, control);
    if (!isLegacyRecoveryReceiptCurrent(receipt)) throw failure('LEGACY_RECOVERY_STALE', 'The old local document changed during final verification');
    return true;
  });
}

async function readArchives(documentId, options, mode) {
  if (typeof documentId !== 'string' || !documentId.trim()) throw new TypeError('documentId required');
  return bounded(options, async control => {
    const maxRecords = options.maxRecords ?? 20;
    const maxJsonBytes = options.maxJsonBytes ?? LEGACY_RECOVERY_ARCHIVE_LIMITS.maxJsonBytes;
    if (!Number.isSafeInteger(maxRecords) || maxRecords <= 0 || !Number.isSafeInteger(maxJsonBytes) || maxJsonBytes <= 0) throw new TypeError('Positive archive read limits required');
    let db;
    try { db = await openArchive(factoryFor(options), false, control); }
    catch (error) {
      if (error?.code !== 'LEGACY_RECOVERY_INCOMPLETE') throw error;
      return mode === 'count' ? { state: 'absent', count: 0 } : { state: 'absent', records: [] };
    }
    try {
      const value = await transact(db, mode, { documentId, maxRecords, maxJsonBytes }, control);
      return mode === 'count' ? { state: value > 0 ? 'present' : 'absent', count: value }
        : { state: value.length > 0 ? 'present' : 'absent', records: value };
    } finally { db.close(); }
  });
}

/** Metadata only: index count does not read or decode archive payloads. */
export function probeLegacyRecoveryArchives(documentId, options = {}) {
  return readArchives(documentId, options, 'count');
}

/** Explicit recovery read; returns existing recovery-format JSON, never imports it. */
export function listLegacyRecoveryArchives(documentId, options = {}) {
  return readArchives(documentId, options, 'list');
}
