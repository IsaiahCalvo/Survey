/**
 * Device files: open a PDF with no account (flag `device-files`, 2026-11-10;
 * on for everyone since KAL-658, 2026-11-16).
 *
 * Drawboard lets anyone open a PDF from the device without signing in. Such a
 * "Temporary" file lives only in that browser (drawboard-trial/file-model.md),
 * and with two tabs open the last save silently wins. Survey's version keeps
 * the PDF here, untouched, and its marks in the annotation store's own device
 * copy (annotationDocSync.js opened local-only under DEVICE_ACTOR_ID). That
 * copy is a CRDT log, so two tabs never wipe each other's marks.
 *
 * Signing in does not delete anything: the files stay listed as "on this
 * device" until the person saves one to their account (saveDeviceFileToAccount
 * in home/deviceFileActions.js uploads it and carries its marks across) or
 * deletes it.
 *
 * Bare IndexedDB, like offlineDocuments.js, so the browser, Electron and the
 * Capacitor web view run the same code. With no IndexedDB (some private
 * windows) nothing can be kept and the caller falls back to asking for a
 * sign-in, as before.
 */

const DB_NAME = 'survey-device-files-v1';
const DB_VERSION = 1;
const META_STORE = 'meta';
const BYTES_STORE = 'bytes';
const REQUEST_TIMEOUT_MS = 8_000;

// Fired (sync) before a device file moves to the cloud: open tabs close and
// set detail.closed = true (AppShell).
export const DEVICE_FILE_LEAVE_EVENT = 'survey:device-file-leave';
export const DEVICE_FILES_CHANGED_EVENT = 'survey:device-files-changed';
/** The annotation store's actor for marks made on device files. */
export const DEVICE_ACTOR_ID = 'device-local';
const ID_PREFIX = 'device-';

export const isDeviceDocumentId = (id) => typeof id === 'string' && id.startsWith(ID_PREFIX);

function newDeviceId() {
  const uuid = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${ID_PREFIX}${uuid}`;
}

function settle(request, transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (!done) { done = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* closed */ }
      finish(reject, new Error('IndexedDB request timed out'));
    }, timeoutMs);
    request.onsuccess = () => finish(resolve, request.result);
    request.onerror = () => finish(reject, request.error || new Error('IndexedDB request failed'));
  });
}

function committed(transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { transaction.abort(); } catch { /* closed */ }
      reject(new Error('IndexedDB transaction timed out'));
    }, timeoutMs);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
    transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
  });
}

function openDatabase(indexedDb, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), timeoutMs);
    request.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB open blocked')); };
    request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('IndexedDB open failed')); };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(BYTES_STORE)) database.createObjectStore(BYTES_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
  });
}

async function toArrayBuffer(bytes) {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (typeof bytes.arrayBuffer === 'function') return bytes.arrayBuffer();
  return null;
}

/** A device file as a Documents-list row (same field names as the documents table). */
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function deviceFileRow(meta) {
  return {
    id: meta.id,
    name: meta.name,
    file_size: meta.size,
    page_count: meta.pageCount ?? null,
    created_at: new Date(meta.createdAt).toISOString(),
    updated_at: new Date(meta.updatedAt).toISOString(),
    project_id: null,
    file_path: null,
    device_file: true,
  };
}

export function createDeviceFiles({
  indexedDb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined),
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
  onChange = null,
} = {}) {
  let dbPromise = null;
  let disabled = !indexedDb?.open;

  const db = async () => {
    if (disabled) return null;
    if (!dbPromise) {
      dbPromise = openDatabase(indexedDb, timeoutMs).then((database) => {
        database.onversionchange = () => { try { database.close(); } catch { /* */ } dbPromise = null; };
        return database;
      }).catch((error) => {
        disabled = true;
        dbPromise = null;
        console.warn('[deviceFiles] disabled:', error?.message || error);
        return null;
      });
    }
    return dbPromise;
  };
  const notify = () => { try { onChange?.(); } catch { /* listener */ } };

  /** Keep a PDF on this device. Returns its list row, or null if nothing can be kept. */
  const add = async ({ name, bytes, pageCount = null }) => {
    const database = await db();
    const buffer = await toArrayBuffer(bytes);
    if (!database || !buffer) return null;
    const at = now();
    const meta = {
      id: newDeviceId(),
      name: String(name || 'Untitled.pdf'),
      size: buffer.byteLength,
      pageCount,
      createdAt: at,
      updatedAt: at,
    };
    try {
      const tx = database.transaction([META_STORE, BYTES_STORE], 'readwrite');
      tx.objectStore(BYTES_STORE).put({ id: meta.id, bytes: buffer });
      tx.objectStore(META_STORE).put(meta);
      await committed(tx, timeoutMs);
    } catch (error) {
      console.warn('[deviceFiles] keep failed:', error?.message || error);
      return null;
    }
    notify();
    return deviceFileRow(meta);
  };

  /**
   * The row already keeping these exact bytes, or null. Opening the same PDF
   * again reopens that copy, with its marks, instead of a blank second one
   * (Drawboard makes a new copy each time). Same size first, then bytes.
   */
  const findSame = async (bytes) => {
    const database = await db();
    const buffer = await toArrayBuffer(bytes);
    if (!database || !buffer) return null;
    const wanted = new Uint8Array(buffer);
    try {
      const tx = database.transaction(META_STORE, 'readonly');
      const metas = await settle(tx.objectStore(META_STORE).getAll(), tx, timeoutMs);
      const sameSize = (metas || []).filter((m) => m.size === wanted.byteLength).sort((a, b) => b.updatedAt - a.updatedAt);
      for (const meta of sameSize) {
        const kept = await read(meta.id);
        const have = kept?.bytes ? new Uint8Array(kept.bytes) : null;
        if (have && sameBytes(have, wanted)) return deviceFileRow(meta);
      }
    } catch (error) {
      console.warn('[deviceFiles] find failed:', error?.message || error);
    }
    return null;
  };

  const list = async () => {
    const database = await db();
    if (!database) return [];
    try {
      const tx = database.transaction(META_STORE, 'readonly');
      const rows = await settle(tx.objectStore(META_STORE).getAll(), tx, timeoutMs);
      return (rows || []).sort((a, b) => b.updatedAt - a.updatedAt).map(deviceFileRow);
    } catch (error) {
      console.warn('[deviceFiles] list failed:', error?.message || error);
      return [];
    }
  };

  /** { row, bytes: ArrayBuffer } or null. */
  const read = async (id) => {
    if (!isDeviceDocumentId(id)) return null;
    const database = await db();
    if (!database) return null;
    try {
      const tx = database.transaction([META_STORE, BYTES_STORE], 'readonly');
      const [meta, stored] = await Promise.all([
        settle(tx.objectStore(META_STORE).get(id), tx, timeoutMs),
        settle(tx.objectStore(BYTES_STORE).get(id), tx, timeoutMs),
      ]);
      if (!meta || !stored?.bytes) return null;
      return { row: deviceFileRow(meta), bytes: stored.bytes };
    } catch (error) {
      console.warn('[deviceFiles] read failed:', error?.message || error);
      return null;
    }
  };

  const update = async (id, patch) => {
    const database = await db();
    if (!database || !isDeviceDocumentId(id)) return false;
    try {
      const tx = database.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const meta = await settle(store.get(id), tx, timeoutMs);
      if (!meta) return false;
      const next = { ...meta, updatedAt: now() };
      if (typeof patch?.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
      if (Number.isFinite(patch?.pageCount)) next.pageCount = patch.pageCount;
      store.put(next);
      await committed(tx, timeoutMs);
    } catch (error) {
      console.warn('[deviceFiles] update failed:', error?.message || error);
      return false;
    }
    notify();
    return true;
  };

  /**
   * Swap the kept PDF for new bytes (a page was moved, turned, added or
   * deleted). The marks already follow the new pages, so the kept PDF must
   * too, or a reload would lay them over the old pages. False when nothing
   * was written; the caller then undoes the page change.
   */
  const replaceBytes = async (id, bytes, { pageCount } = {}) => {
    const database = await db();
    const buffer = await toArrayBuffer(bytes);
    if (!database || !buffer || !isDeviceDocumentId(id)) return false;
    try {
      const tx = database.transaction([META_STORE, BYTES_STORE], 'readwrite');
      const metaStore = tx.objectStore(META_STORE);
      const meta = await settle(metaStore.get(id), tx, timeoutMs);
      if (!meta) { try { tx.abort(); } catch { /* done */ } return false; }
      tx.objectStore(BYTES_STORE).put({ id, bytes: buffer });
      const next = { ...meta, size: buffer.byteLength, updatedAt: now() };
      if (Number.isFinite(pageCount)) next.pageCount = pageCount;
      metaStore.put(next);
      await committed(tx, timeoutMs);
    } catch (error) {
      console.warn('[deviceFiles] replace failed:', error?.message || error);
      return false;
    }
    notify();
    return true;
  };

  /** Bumps the "last edited" time (marks were made). Quiet: no list redraw needed mid-edit. */
  const touch = (id) => update(id, {});

  const remove = async (id) => {
    const database = await db();
    if (!database || !isDeviceDocumentId(id)) return false;
    try {
      const tx = database.transaction([META_STORE, BYTES_STORE], 'readwrite');
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(BYTES_STORE).delete(id);
      await committed(tx, timeoutMs);
    } catch (error) {
      console.warn('[deviceFiles] delete failed:', error?.message || error);
      return false;
    }
    notify();
    return true;
  };

  return { add, findSame, list, read, update, replaceBytes, touch, remove, isDisabled: () => disabled };
}

let shared = null;
export function deviceFiles() {
  if (!shared) {
    shared = createDeviceFiles({
      onChange: () => {
        try { globalThis.dispatchEvent?.(new CustomEvent(DEVICE_FILES_CHANGED_EVENT)); } catch { /* no DOM */ }
      },
    });
  }
  return shared;
}
