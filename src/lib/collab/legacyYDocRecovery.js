import { snapshotRegisteredYDoc, summarizeRegisteredYDoc } from './ydocRegistry.js';

const errorInfo = error => ({ name: error?.name || 'Error', message: error?.message || String(error) });

function openExisting(indexedDB, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    let missing = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Legacy database open timed out')), timeoutMs);
    try { request = indexedDB.open(name); } catch (error) { finish(error); return; }
    request.onupgradeneeded = () => {
      // Opening an absent name starts creation. Abort that transaction; never
      // create stores, leave an empty database behind, or delete a source.
      missing = true;
      request.transaction.abort();
    };
    request.onerror = () => missing ? finish(null, null) : finish(request.error || new Error('Legacy database open failed'));
    request.onblocked = () => finish(new Error('Legacy database open blocked'));
    request.onsuccess = () => {
      if (settled) request.result.close(); else finish(null, request.result);
    };
  });
}

function readStores(db, timeoutMs, { includeRecords = true } = {}) {
  const names = [...db.objectStoreNames];
  if (!names.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readonly');
    let failed = false;
    const timer = setTimeout(() => {
      failed = true; try { tx.abort(); } catch { /* already closed */ }
      reject(new Error('Legacy database read timed out'));
    }, timeoutMs);
    let stores = [];
    tx.oncomplete = () => { clearTimeout(timer); if (!failed) resolve(stores); };
    tx.onabort = tx.onerror = () => { clearTimeout(timer); failed = true; reject(tx.error || new Error('Legacy database read failed')); };
    try {
      stores = names.map(name => {
        const store = tx.objectStore(name);
        const result = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          indexes: [...store.indexNames].map(indexName => {
            const index = store.index(indexName);
            return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          }) };
        if (!includeRecords) return result;
        result.records = [];
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const value = cursor.result;
          if (!value) return;
          // Cursor results are structured clones, including binary/opaque values.
          // Do not decode, apply, normalize, or attribute any old update here.
          result.records.push({ key: value.key, value: value.value });
          value.continue();
        };
        return result;
      });
    } catch (error) {
      failed = true;
      clearTimeout(timer);
      try { tx.abort(); } catch { /* already closed */ }
      reject(error);
    }
  });
}

/**
 * Cheap startup probe. Existing entries count as present even when empty or of
 * an unknown schema. This reports only metadata, not a recoverable snapshot or
 * an ownership decision. A failed source remains explicit beside a present one.
 */
export async function probeLegacyYDocRecovery(documentId, { indexedDB, timeoutMs = 5000 } = {}) {
  if (typeof documentId !== 'string' || !documentId.trim()) throw new Error('documentId required');
  let registry;
  try { registry = summarizeRegisteredYDoc(documentId); }
  catch (error) { registry = { state: 'read-failed', documentId, error: errorInfo(error) }; }
  let persisted;
  let db;
  try {
    // Access can itself throw in restricted browser contexts. Keep that inside
    // the source failure boundary so an available registry is still reported.
    const storage = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    if (!storage?.open) throw new Error('IndexedDB unavailable');
    db = await openExisting(storage, documentId, timeoutMs);
    persisted = db ? { state: 'present', databaseName: documentId, version: db.version,
      stores: await readStores(db, timeoutMs, { includeRecords: false }) } : { state: 'absent', databaseName: documentId };
  } catch (error) {
    persisted = { state: 'read-failed', databaseName: documentId, error: errorInfo(error) };
  } finally { db?.close(); }
  const states = [registry.state, persisted.state];
  return {
    formatVersion: 1, kind: 'probe', contentRead: false, documentId, capturedAt: new Date().toISOString(),
    state: states.includes('present') ? 'present' : states.includes('read-failed') ? 'read-failed' : 'absent',
    hasReadFailure: states.includes('read-failed'),
    provenance: { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false },
    registry, indexedDB: persisted,
  };
}

/** Inspection only: no Yjs provider, document mutation, writes, or ownership claim. */
export async function inspectLegacyYDocRecovery(documentId, { indexedDB, timeoutMs = 5000 } = {}) {
  if (!documentId || typeof documentId !== 'string') throw new Error('documentId required');
  let registry;
  try { registry = snapshotRegisteredYDoc(documentId); }
  catch (error) { registry = { state: 'read-failed', documentId, error: errorInfo(error) }; }
  let persisted;
  let db;
  try {
    const storage = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    if (!storage?.open) throw new Error('IndexedDB unavailable');
    db = await openExisting(storage, documentId, timeoutMs);
    persisted = db ? { state: 'present', databaseName: documentId, version: db.version,
      stores: await readStores(db, timeoutMs) } : { state: 'absent', databaseName: documentId };
  } catch (error) {
    persisted = { state: 'read-failed', databaseName: documentId, error: errorInfo(error) };
  } finally { db?.close(); }
  const states = [registry.state, persisted.state];
  return { formatVersion: 1, documentId, capturedAt: new Date().toISOString(),
    state: states.includes('present') ? 'present' : states.includes('read-failed') ? 'read-failed' : 'absent',
    provenance: { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false },
    registry, indexedDB: persisted };
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

/** JSON-safe graph preserves binary bytes, opaque update values, and cycles.
 * Unsupported structured-clone types reject export rather than silently lose
 * them. The inspection bundle and its untouched source remain available. */
export async function buildLegacyYDocRecoveryExport(bundle) {
  const seen = new Map();
  const nodes = [];
  async function encode(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
      ? value : { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
    if (typeof value === 'undefined') return { type: 'undefined' };
    if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
    if (typeof value !== 'object') throw new Error(`Unsupported recovery export value: ${typeof value}`);
    if (seen.has(value)) return { ref: seen.get(value) };
    const id = nodes.length;
    seen.set(value, id);
    const node = { id, type: Object.prototype.toString.call(value).slice(8, -1) };
    nodes.push(node);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      node.encoding = 'base64'; node.byteLength = bytes.byteLength; node.bytes = base64(bytes);
      if (ArrayBuffer.isView(value)) {
        // Retain the visible bytes for v1 readers, but they alone cannot recover
        // a sliced/shared view. Preserve the full backing store once in the
        // graph, including bytes outside this view and aliases between views.
        node.byteOffset = value.byteOffset;
        if (!(value instanceof DataView)) node.length = value.length;
        node.buffer = await encode(value.buffer);
      }
    } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
      node.mimeType = value.type; node.bytes = base64(new Uint8Array(await value.arrayBuffer())); node.encoding = 'base64';
      node.byteLength = value.size;
      if (typeof value.name === 'string') { node.name = value.name; node.lastModified = value.lastModified; }
    } else if (value instanceof Date) node.value = Number.isNaN(value.getTime()) ? null : value.toISOString();
    else if (value instanceof RegExp) { node.source = value.source; node.flags = value.flags; node.lastIndex = value.lastIndex; }
    else if (value instanceof Map) { node.entries = []; for (const [key, entry] of value) node.entries.push([await encode(key), await encode(entry)]); }
    else if (value instanceof Set) { node.values = []; for (const entry of value) node.values.push(await encode(entry)); }
    else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null || value instanceof Error) {
      if (Array.isArray(value)) node.length = value.length;
      if (value instanceof Error) { node.name = value.name; node.message = value.message; node.stack = value.stack; node.cause = await encode(value.cause); }
      node.entries = [];
      for (const key of Object.keys(value)) node.entries.push([key, await encode(value[key])]);
    } else throw new Error(`Unsupported recovery export object: ${node.type}`);
    return { ref: id };
  }
  return { format: 'survey-legacy-ydoc-recovery', version: 1,
    provenance: { attribution: 'unknown-legacy', actorUserId: null, automaticImportAllowed: false },
    root: await encode(bundle), nodes };
}
