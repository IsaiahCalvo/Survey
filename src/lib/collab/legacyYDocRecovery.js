import { snapshotRegisteredYDoc, summarizeRegisteredYDoc } from './ydocRegistry.js';

const errorInfo = error => ({ name: error?.name || 'Error', message: error?.message || String(error) });

// Configurable work/retention guardrails, not a hard browser heap ceiling: IDB
// clones each cursor value and the registry encodes its Yjs snapshot before we
// can inspect it. Raising a cap is explicit; failures never erase source data.
export const LEGACY_RECOVERY_INSPECT_LIMITS = Object.freeze({
  maxRecords: 10_000, maxBinaryBytes: 32 * 1024 * 1024, maxTextBytes: 32 * 1024 * 1024,
  maxValues: 250_000, maxDepth: 100,
});
export const LEGACY_RECOVERY_EXPORT_LIMITS = Object.freeze({
  maxGraphNodes: 50_000, maxValues: 500_000, maxDepth: 100,
  maxBinaryBytes: 64 * 1024 * 1024, maxJsonBytes: 128 * 1024 * 1024,
});

export class LegacyYDocRecoveryLimitError extends Error {
  constructor(limit, actual, maximum) {
    super(`Legacy recovery ${limit} exceeded (${actual} > ${maximum})`);
    this.name = 'LegacyYDocRecoveryLimitError';
    this.code = 'LEGACY_RECOVERY_LIMIT';
    this.limit = limit; this.actual = actual; this.maximum = maximum;
  }
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Legacy recovery cancelled');
    error.name = 'AbortError';
    error.code = 'LEGACY_RECOVERY_ABORTED';
    throw error;
  }
}

const isControlError = error => error instanceof LegacyYDocRecoveryLimitError || error?.code === 'LEGACY_RECOVERY_ABORTED';

function recoveryBudget(defaults, limits, signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('signal must be an AbortSignal');
  if (limits !== undefined && (!limits || typeof limits !== 'object' || Array.isArray(limits))) throw new TypeError('limits must be an object');
  const caps = { ...defaults };
  for (const [key, value] of Object.entries(limits || {})) {
    if (!Object.hasOwn(defaults, key) || !Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid recovery limit: ${key}`);
    caps[key] = value;
  }
  const counts = Object.create(null);
  const check = (key, value) => {
    checkAbort(signal);
    if (value > caps[key]) throw new LegacyYDocRecoveryLimitError(key, value, caps[key]);
  };
  const add = (key, value = 1) => { counts[key] = (counts[key] || 0) + value; check(key, counts[key]); };
  checkAbort(signal);
  return { check, add, counts };
}

function abortableRead(promise, signal) {
  if (!signal) return promise;
  let cancel;
  return new Promise((resolve, reject) => {
    cancel = () => { try { checkAbort(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', cancel, { once: true });
    cancel();
    Promise.resolve(promise).then(resolve, reject);
  }).finally(() => signal.removeEventListener('abort', cancel));
}

// Raw UTF-8 text size, not JSON-escaped size. Lone surrogates encode as U+FFFD.
// Check in bounded chunks without allocating a complete TextEncoder copy.
function measureText(text, add) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes >= 8192) { add(bytes); bytes = 0; }
  }
  add(bytes);
}

// Count every visited value (including property keys/primitives/references), but
// traverse each object and charge each full backing buffer only once. Depth is
// root=0 for the registry snapshot and for each store schema/cursor record.
function inspectionVisitor(budget) {
  const seen = new WeakSet();
  const buffers = new WeakSet();
  function visit(value, depth = 0) {
    budget.add('maxValues'); budget.check('maxDepth', depth);
    if (typeof value === 'string') measureText(value, count => budget.add('maxTextBytes', count));
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const buffer = value instanceof ArrayBuffer ? value : value.buffer;
      if (!buffers.has(buffer)) { buffers.add(buffer); budget.add('maxBinaryBytes', buffer.byteLength); }
    } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
      budget.add('maxBinaryBytes', value.size);
      visit(value.type, depth + 1);
      if (typeof value.name === 'string') visit(value.name, depth + 1);
    } else if (value instanceof RegExp) { visit(value.source, depth + 1); visit(value.flags, depth + 1); }
    else if (value instanceof Map) { for (const [key, entry] of value) { visit(key, depth + 1); visit(entry, depth + 1); } }
    else if (value instanceof Set) { for (const entry of value) visit(entry, depth + 1); }
    else {
      if (value instanceof Error) for (const key of ['name', 'message', 'stack', 'cause']) {
        if (key in value && !Object.prototype.propertyIsEnumerable.call(value, key)) { visit(key, depth + 1); visit(value[key], depth + 1); }
      }
      for (const key in value) if (Object.hasOwn(value, key)) { visit(key, depth + 1); visit(value[key], depth + 1); }
    }
  }
  return visit;
}

function openExisting(indexedDB, name, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    let missing = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => {
      try { checkAbort(signal); } catch (error) {
        try { request?.transaction?.abort(); } catch { /* already closed */ }
        finish(error);
      }
    };
    const timer = setTimeout(() => finish(new Error('Legacy database open timed out')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    cancel();
    if (settled) return;
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

function readStores(db, timeoutMs, { includeRecords = true, budget, visit, signal } = {}) {
  checkAbort(signal);
  const names = [...db.objectStoreNames];
  if (!names.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readonly');
    let failed = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const fail = error => {
      if (failed) return;
      failed = true; cleanup();
      try { tx.abort(); } catch { /* already closed */ }
      reject(error);
    };
    const cancel = () => { try { checkAbort(signal); } catch (error) { fail(error); } };
    const timer = setTimeout(() => fail(new Error('Legacy database read timed out')), timeoutMs);
    let stores = [];
    tx.oncomplete = () => { cleanup(); if (!failed) resolve(stores); };
    tx.onabort = tx.onerror = () => { cleanup(); failed = true; reject(tx.error || new Error('Legacy database read failed')); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      stores = names.map((name, storeIndex) => {
        const store = tx.objectStore(name);
        const result = { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
          indexes: [...store.indexNames].map(indexName => {
            const index = store.index(indexName);
            return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          }) };
        if (!includeRecords) return result;
        result.records = [];
        visit?.(String(storeIndex));
        visit?.(result);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (failed) return;
          try {
            checkAbort(signal);
            const value = cursor.result;
            if (!value) return;
            budget?.add('maxRecords');
            const record = { key: value.key, value: value.value };
            visit?.(String(result.records.length));
            visit?.(record);
            // Cursor results are structured clones; retain only after validation.
            result.records.push(record);
            value.continue();
          } catch (error) { fail(error); }
        };
        return result;
      });
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Cheap startup probe. Existing entries count as present even when empty or of
 * an unknown schema. This reports only metadata, not a recoverable snapshot or
 * an ownership decision. A failed source remains explicit beside a present one.
 */
export async function probeLegacyYDocRecovery(documentId, { indexedDB, timeoutMs = 5000, signal } = {}) {
  if (typeof documentId !== 'string' || !documentId.trim()) throw new Error('documentId required');
  checkAbort(signal);
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
    db = await openExisting(storage, documentId, timeoutMs, signal);
    persisted = db ? { state: 'present', databaseName: documentId, version: db.version,
      stores: await readStores(db, timeoutMs, { includeRecords: false, signal }) } : { state: 'absent', databaseName: documentId };
  } catch (error) {
    if (isControlError(error)) throw error;
    persisted = { state: 'read-failed', databaseName: documentId, error: errorInfo(error) };
  } finally { db?.close(); }
  checkAbort(signal);
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
export async function inspectLegacyYDocRecovery(documentId, { indexedDB, timeoutMs = 5000, limits, signal } = {}) {
  if (!documentId || typeof documentId !== 'string') throw new Error('documentId required');
  const budget = recoveryBudget(LEGACY_RECOVERY_INSPECT_LIMITS, limits, signal);
  const visit = inspectionVisitor(budget);
  let registry;
  try { registry = snapshotRegisteredYDoc(documentId); }
  catch (error) { registry = { state: 'read-failed', documentId, error: errorInfo(error) }; }
  visit(registry);
  let persisted;
  let db;
  try {
    const storage = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
    if (!storage?.open) throw new Error('IndexedDB unavailable');
    db = await openExisting(storage, documentId, timeoutMs, signal);
    persisted = db ? { state: 'present', databaseName: documentId, version: db.version,
      stores: await readStores(db, timeoutMs, { budget, visit, signal }) } : { state: 'absent', databaseName: documentId };
  } catch (error) {
    if (isControlError(error)) throw error;
    persisted = { state: 'read-failed', databaseName: documentId, error: errorInfo(error) };
  } finally { db?.close(); }
  checkAbort(signal);
  // Schema/record content was charged before retention; charge only the source
  // wrapper here, without revisiting that content or its array-index keys.
  visit(Object.hasOwn(persisted, 'stores') ? { ...persisted, stores: undefined } : persisted);
  const states = [registry.state, persisted.state];
  const result = { formatVersion: 1, documentId, capturedAt: new Date().toISOString(),
    state: states.includes('present') ? 'present' : states.includes('read-failed') ? 'read-failed' : 'absent',
    provenance: { actorUserId: null, attribution: 'unknown-legacy', automaticImportAllowed: false },
    registry, indexedDB: persisted };
  visit({ ...result, registry: undefined, indexedDB: undefined });
  return result;
}

function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

// Exact UTF-8 size of our plain JSON output, without allocating JSON.stringify
// plus a second UTF-8 copy. Escapes and unpaired UTF-16 surrogates match JSON.
function measureJSON(value, add) {
  function string(text) {
    let bytes = 2;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
      else if (code < 32) bytes += 6;
      else if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
      else bytes += 3;
      if (bytes >= 8192) { add(bytes); bytes = 0; }
    }
    add(bytes);
  }
  if (value === null || value === undefined) add(4);
  else if (typeof value === 'string') string(value);
  else if (typeof value === 'boolean') add(value ? 4 : 5);
  else if (typeof value === 'number') add(Number.isFinite(value) ? String(value).length : 4);
  else if (Array.isArray(value)) {
    add(2);
    for (let i = 0; i < value.length; i++) { if (i) add(1); measureJSON(value[i], add); }
  } else {
    add(2);
    let first = true;
    for (const key in value) if (Object.hasOwn(value, key) && value[key] !== undefined) {
      if (!first) add(1); first = false;
      string(key); add(1); measureJSON(value[key], add);
    }
  }
}

/** JSON-safe graph preserves binary bytes, opaque update values, and cycles.
 * Unsupported structured-clone types reject export rather than silently lose
 * them. The inspection bundle and its untouched source remain available. */
export async function buildLegacyYDocRecoveryExport(bundle, { limits, signal } = {}) {
  const budget = recoveryBudget(LEGACY_RECOVERY_EXPORT_LIMITS, limits, signal);
  const seen = new Map();
  const nodes = [];
  let steps = 0;
  async function encode(value, depth = 0) {
    budget.add('maxValues'); budget.check('maxDepth', depth);
    // A timer turn allows UI aborts even for a large primitive array. IDB reads
    // instead yield naturally between cursors (never await inside a live tx).
    if (++steps % 1024 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); checkAbort(signal); }
    if (typeof value === 'string') {
      let bytes = 0;
      measureJSON(value, count => { bytes += count; budget.check('maxJsonBytes', bytes); });
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
      ? value : { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
    if (typeof value === 'undefined') return { type: 'undefined' };
    if (typeof value === 'bigint') return { type: 'bigint', value: String(value) };
    if (typeof value !== 'object') throw new Error(`Unsupported recovery export value: ${typeof value}`);
    if (seen.has(value)) return { ref: seen.get(value) };
    budget.add('maxGraphNodes');
    const id = nodes.length;
    seen.set(value, id);
    const node = { id, type: Object.prototype.toString.call(value).slice(8, -1) };
    nodes.push(node);
    let reservedJsonBytes = 0;
    const reserve = count => { budget.add('maxJsonBytes', count); reservedJsonBytes += count; };
    const reserveValue = encoded => measureJSON(encoded, reserve);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      // Each buffer node is unique; each distinct view additionally emits its
      // visible bytes for v1 compatibility. Charge both before base64 encoding.
      budget.add('maxBinaryBytes', bytes.byteLength);
      reserve(2 + 4 * Math.ceil(bytes.byteLength / 3));
      node.encoding = 'base64'; node.byteLength = bytes.byteLength; node.bytes = base64(bytes);
      if (ArrayBuffer.isView(value)) {
        // Retain the visible bytes for v1 readers, but they alone cannot recover
        // a sliced/shared view. Preserve the full backing store once in the
        // graph, including bytes outside this view and aliases between views.
        node.byteOffset = value.byteOffset;
        if (!(value instanceof DataView)) node.length = value.length;
        node.buffer = await encode(value.buffer, depth + 1);
        reserveValue(node.buffer);
      }
    } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
      budget.add('maxBinaryBytes', value.size);
      reserve(2 + 4 * Math.ceil(value.size / 3));
      const blobBytes = await abortableRead(value.arrayBuffer(), signal);
      checkAbort(signal);
      node.mimeType = value.type; node.bytes = base64(new Uint8Array(blobBytes)); node.encoding = 'base64';
      node.byteLength = value.size;
      if (typeof value.name === 'string') { node.name = value.name; node.lastModified = value.lastModified; }
    } else if (value instanceof Date) node.value = Number.isNaN(value.getTime()) ? null : value.toISOString();
    else if (value instanceof RegExp) { node.source = value.source; node.flags = value.flags; node.lastIndex = value.lastIndex; }
    else if (value instanceof Map) {
      node.entries = [];
      for (const [key, entry] of value) {
        reserve(3 + (node.entries.length ? 1 : 0)); // Pair brackets/comma and entry separator.
        const encodedKey = await encode(key, depth + 1); reserveValue(encodedKey);
        const encodedEntry = await encode(entry, depth + 1); reserveValue(encodedEntry);
        node.entries.push([encodedKey, encodedEntry]);
      }
    } else if (value instanceof Set) {
      node.values = [];
      for (const entry of value) {
        if (node.values.length) reserve(1);
        const encoded = await encode(entry, depth + 1); reserveValue(encoded);
        node.values.push(encoded);
      }
    }
    else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null || value instanceof Error) {
      if (Array.isArray(value)) node.length = value.length;
      if (value instanceof Error) {
        node.name = value.name; node.message = value.message; node.stack = value.stack;
        node.cause = await encode(value.cause, depth + 1); reserveValue(node.cause);
      }
      node.entries = [];
      for (const key in value) if (Object.hasOwn(value, key)) {
        budget.add('maxValues');
        reserve(3 + (node.entries.length ? 1 : 0));
        reserveValue(key);
        const encoded = await encode(value[key], depth + 1); reserveValue(encoded);
        node.entries.push([key, encoded]);
      }
    } else throw new Error(`Unsupported recovery export object: ${node.type}`);
    // Children/keys/refs are charged before appending, so flat primitive arrays
    // cannot retain every child before an aggregate limit failure. Reconcile
    // only the remaining exact node overhead; never charge those bytes twice.
    let nodeJsonBytes = 0;
    measureJSON(node, count => { nodeJsonBytes += count; });
    budget.add('maxJsonBytes', nodeJsonBytes - reservedJsonBytes);
    return { ref: id };
  }
  const result = { format: 'survey-legacy-ydoc-recovery', version: 1,
    provenance: { attribution: 'unknown-legacy', actorUserId: null, automaticImportAllowed: false },
    root: await encode(bundle), nodes };
  // Node payloads were charged once above. Include the exact final envelope,
  // empty-array brackets and separators here, not just input/payload strings.
  measureJSON({ ...result, nodes: [] }, count => budget.add('maxJsonBytes', count));
  budget.add('maxJsonBytes', Math.max(0, nodes.length - 1));
  checkAbort(signal);
  return result;
}
