/**
 * "Available offline" documents (Nightly flag `offline-docs`, 2026-11-10).
 *
 * Drawboard's apps have "Make available offline": the document's file is kept
 * on the device, it opens with no signal, and marks made meanwhile sync when
 * the device is back online (drawboard-trial/file-model.md). Survey's normal
 * device cache (pdfByteCache.js) deliberately never opens a file without an
 * online access check first (the 2026-09-07 "no settled copy" rule). This
 * store relaxes that rule ONLY for documents the user switched on, and only
 * when the check could not be asked at all (no network). A refusal (access
 * removed, file gone) still drops the copy, and signing out empties it.
 *
 * What is kept per account + document: the document row the list needs to
 * show and open it, and the PDF bytes with the Storage version they came from.
 * Marks are not kept here: the annotation store already keeps its own device
 * copy (annotationDocSync.js, y-indexeddb) and reconciles it on the next
 * online open, which is what sends offline marks.
 *
 * Bare IndexedDB like pdfByteCache.js / thumbnailStore.js, so the browser,
 * Electron's file:// renderer and the Capacitor web view run the same code;
 * every failure degrades to "not available offline", never to a broken open.
 */

const DB_NAME = 'survey-offline-docs-v1';
const DB_VERSION = 1;
const DOC_STORE = 'docs';
const FILE_STORE = 'files';
const ACTOR_INDEX = 'actorId';
const PATH_INDEX = 'actorPath';
const REQUEST_TIMEOUT_MS = 8_000;
const SEP = '\u0000';

export const OFFLINE_DOCS_CHANGED_EVENT = 'survey:offline-docs-changed';
// Fired when a document opened from its kept copy because there was no
// network (detail: { path, documentId }); the viewer shows "Offline copy".
export const OFFLINE_COPY_OPENED_EVENT = 'survey:offline-copy-opened';

/* The document fields the list and the viewer read. Nothing else is kept
   (no share tokens, no collaborator lists). */
const ROW_FIELDS = [
  'id', 'name', 'file_path', 'file_size', 'page_count', 'project_id', 'user_id',
  'created_at', 'updated_at', 'last_opened_at', 'thumbnail_url', 'content_sha256',
  'my_role', 'locked', 'sheet_number', 'sheet_revision',
];

export const offlineDocKey = (actorId, documentId) => (
  actorId && documentId ? `${actorId}${SEP}${documentId}` : null
);
const pathKey = (actorId, path) => (actorId && path ? `${actorId}${SEP}${path}` : null);

export function offlineRowSnapshot(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  const out = {};
  for (const field of ROW_FIELDS) {
    if (row[field] !== undefined) out[field] = row[field];
  }
  if (!out.file_path && typeof row.filePath === 'string') out.file_path = row.filePath;
  return out;
}

/**
 * True when an error means "the server could not be asked" (no network, a
 * dropped connection, a timeout), as opposed to "the server said no".
 * Only the first kind may open a kept copy.
 */
export function isNetworkFailure(error, { navigatorRef = globalThis.navigator } = {}) {
  if (navigatorRef && navigatorRef.onLine === false) return true;
  if (!error) return false;
  const status = Number(error.status ?? error.statusCode ?? error.originalError?.status);
  if (Number.isFinite(status) && status > 0) return status === 408 || status === 504 || status === 0;
  const name = String(error.name || '');
  const message = String(error.message || error || '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return /failed to fetch|network ?error|networkerror|load failed|fetch failed|internet|offline|timed? ?out|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(message);
}

function requestResult(request, transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* already closed */ }
      finish(reject, new Error('IndexedDB request timed out'));
    }, timeoutMs);
    request.onsuccess = () => finish(resolve, request.result);
    request.onerror = () => finish(reject, request.error || new Error('IndexedDB request failed'));
  });
}

// A successful request is not a committed write: quota/abort can follow it.
function transactionResult(transaction, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { transaction.abort(); } catch { /* already closed */ }
      reject(new Error('IndexedDB transaction timed out'));
    }, timeoutMs);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
    transaction.onabort = () => {
      clearTimeout(timer);
      reject(transaction.error || new Error('IndexedDB transaction aborted'));
    };
    transaction.onerror = () => { /* onabort reports the final outcome */ };
  });
}

function openDatabase(indexedDb, timeoutMs) {
  const request = indexedDb.open(DB_NAME, DB_VERSION);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('IndexedDB open timed out')), timeoutMs);
    request.onblocked = () => finish(reject, new Error('IndexedDB open blocked'));
    request.onerror = () => finish(reject, request.error || new Error('IndexedDB open failed'));
    request.onupgradeneeded = () => {
      const opened = request.result;
      if (!opened.objectStoreNames.contains(DOC_STORE)) {
        const docs = opened.createObjectStore(DOC_STORE, { keyPath: 'key' });
        docs.createIndex(ACTOR_INDEX, ACTOR_INDEX, { unique: false });
        docs.createIndex(PATH_INDEX, PATH_INDEX, { unique: false });
      }
      if (!opened.objectStoreNames.contains(FILE_STORE)) opened.createObjectStore(FILE_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      if (settled) {
        try { request.result?.close(); } catch { /* late result */ }
        return;
      }
      finish(resolve, request.result);
    };
  });
}

const toArrayBuffer = async (bytes) => {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return bytes;
  if (ArrayBuffer.isView(bytes)) {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (typeof bytes.arrayBuffer === 'function') return bytes.arrayBuffer();
  return null;
};

/**
 * The store. `onChange(actorId)` is called after every committed change so
 * lists can redraw (the app passes a window event).
 */
export function createOfflineDocuments({
  indexedDb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined),
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
  onChange = null,
} = {}) {
  let dbPromise = null;
  let disabled = !indexedDb?.open;
  // Bumped by clear()/retainOnly(): a pin that started before a sign-out must
  // not land after it.
  let generation = 0;
  // In-memory index of what is kept, per account, so the list and the open
  // path can ask synchronously: actorId -> Map(documentId -> { path, stamp, ... }).
  const index = new Map();
  const loadedActors = new Map();

  const db = async () => {
    if (disabled) return null;
    if (!dbPromise) {
      const stored = openDatabase(indexedDb, timeoutMs).then((database) => {
        database.onversionchange = () => {
          try { database.close(); } catch { /* already closed */ }
          if (dbPromise === stored) dbPromise = null;
        };
        return database;
      }).catch((error) => {
        disabled = true;
        if (dbPromise === stored) dbPromise = null;
        console.warn('[offlineDocuments] disabled:', error?.message || error);
        return null;
      });
      dbPromise = stored;
    }
    return dbPromise;
  };

  const notify = (actorId) => {
    try { onChange?.(actorId); } catch { /* listener */ }
  };

  const metaOf = (record) => ({
    documentId: record.documentId,
    path: record.path,
    stamp: record.stamp ?? null,
    size: record.size ?? 0,
    pinnedAt: record.pinnedAt,
    refreshedAt: record.refreshedAt ?? null,
    row: record.row,
  });

  /** Load this account's index once (cheap: no file bytes). */
  const load = (actorId) => {
    if (!actorId) return Promise.resolve(new Map());
    if (loadedActors.has(actorId)) return loadedActors.get(actorId);
    const loading = (async () => {
      const database = await db();
      const map = new Map();
      if (database) {
        try {
          const tx = database.transaction(DOC_STORE, 'readonly');
          const rows = await requestResult(tx.objectStore(DOC_STORE).index(ACTOR_INDEX).getAll(actorId), tx, timeoutMs);
          for (const record of rows || []) map.set(record.documentId, metaOf(record));
        } catch (error) {
          console.warn('[offlineDocuments] list failed:', error?.message || error);
        }
      }
      index.set(actorId, map);
      return map;
    })();
    loadedActors.set(actorId, loading);
    return loading;
  };

  const isPinned = (actorId, documentId) => Boolean(index.get(actorId)?.has(documentId));
  const pinnedPathEntry = (actorId, path) => {
    for (const meta of index.get(actorId)?.values() || []) {
      if (meta.path === path) return meta;
    }
    return null;
  };

  /**
   * Keep a document on this device. `bytes` are the PDF (ArrayBuffer, view or
   * Blob) and `stamp` the Storage version they came from (pdfCacheStamp).
   */
  const pin = async ({ actorId, row, bytes, stamp = null }) => {
    const snapshot = offlineRowSnapshot(row);
    const path = snapshot?.file_path;
    const key = offlineDocKey(actorId, snapshot?.id);
    if (!key || !path) return false;
    const since = generation;
    const buffer = await toArrayBuffer(bytes);
    if (!buffer || buffer.byteLength === 0) return false;
    const database = await db();
    if (!database || since !== generation) return false;
    const at = now();
    const previous = index.get(actorId)?.get(snapshot.id);
    const record = {
      key,
      actorId,
      documentId: snapshot.id,
      path,
      actorPath: pathKey(actorId, path),
      stamp,
      size: buffer.byteLength,
      pinnedAt: previous?.pinnedAt ?? at,
      refreshedAt: at,
      row: snapshot,
    };
    try {
      const tx = database.transaction([DOC_STORE, FILE_STORE], 'readwrite');
      const done = transactionResult(tx, timeoutMs);
      tx.objectStore(DOC_STORE).put(record);
      tx.objectStore(FILE_STORE).put({ key, bytes: buffer });
      await done;
    } catch (error) {
      console.warn('[offlineDocuments] keep failed:', error?.message || error);
      return false;
    }
    if (since !== generation) {
      await unpin(actorId, snapshot.id).catch(() => {});
      return false;
    }
    await load(actorId);
    index.get(actorId)?.set(snapshot.id, metaOf(record));
    notify(actorId);
    return true;
  };

  /** Update only the kept row (a rename, a move) without touching the bytes. */
  const updateRow = async (actorId, documentId, patch) => {
    const key = offlineDocKey(actorId, documentId);
    const meta = index.get(actorId)?.get(documentId);
    if (!key || !meta || !patch) return false;
    const database = await db();
    if (!database) return false;
    try {
      const tx = database.transaction(DOC_STORE, 'readwrite');
      const done = transactionResult(tx, timeoutMs);
      const store = tx.objectStore(DOC_STORE);
      const record = await requestResult(store.get(key), tx, timeoutMs);
      if (!record) { tx.abort(); return false; }
      record.row = { ...record.row, ...offlineRowSnapshot({ ...record.row, ...patch }) };
      store.put(record);
      await done;
      index.get(actorId)?.set(documentId, metaOf(record));
    } catch {
      return false;
    }
    notify(actorId);
    return true;
  };

  const unpin = async (actorId, documentId) => {
    const key = offlineDocKey(actorId, documentId);
    if (!key) return false;
    index.get(actorId)?.delete(documentId);
    const database = await db();
    if (!database) return false;
    try {
      const tx = database.transaction([DOC_STORE, FILE_STORE], 'readwrite');
      const done = transactionResult(tx, timeoutMs);
      tx.objectStore(DOC_STORE).delete(key);
      tx.objectStore(FILE_STORE).delete(key);
      await done;
    } catch {
      return false;
    }
    notify(actorId);
    return true;
  };

  /** The kept bytes for a storage path, or null. */
  const readByPath = async (actorId, path) => {
    await load(actorId);
    const meta = pinnedPathEntry(actorId, path);
    if (!meta) return null;
    const database = await db();
    if (!database) return null;
    try {
      const tx = database.transaction(FILE_STORE, 'readonly');
      const record = await requestResult(tx.objectStore(FILE_STORE).get(offlineDocKey(actorId, meta.documentId)), tx, timeoutMs);
      if (!record?.bytes) return null;
      return { bytes: record.bytes, stamp: meta.stamp, documentId: meta.documentId };
    } catch {
      return null;
    }
  };

  /** Rows of every kept document for this account (for the offline list). */
  const list = async (actorId) => {
    const map = await load(actorId);
    return [...map.values()]
      .sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0))
      .map((meta) => ({ ...meta.row, offline_available: true }));
  };

  const removeWhere = async (predicate) => {
    const database = await db();
    if (!database) return;
    try {
      const tx = database.transaction([DOC_STORE, FILE_STORE], 'readwrite');
      const done = transactionResult(tx, timeoutMs);
      const docs = tx.objectStore(DOC_STORE);
      const files = tx.objectStore(FILE_STORE);
      const all = await requestResult(docs.getAll(), tx, timeoutMs);
      for (const record of all || []) {
        if (predicate(record)) {
          docs.delete(record.key);
          files.delete(record.key);
        }
      }
      await done;
    } catch (error) {
      console.warn('[offlineDocuments] clear failed:', error?.message || error);
    }
  };

  /** Sign-out: nothing of any account stays on the device. */
  const clear = async () => {
    generation += 1;
    const actors = [...index.keys()];
    index.clear();
    loadedActors.clear();
    await removeWhere(() => true);
    for (const actorId of actors) notify(actorId);
  };

  /** Another account signed in: keep only that account's documents. */
  const retainOnly = async (actorId) => {
    generation += 1;
    for (const key of [...index.keys()]) {
      if (key !== actorId) { index.delete(key); loadedActors.delete(key); }
    }
    await removeWhere((record) => record.actorId !== actorId);
  };

  return {
    load,
    isPinned,
    pinnedPathEntry,
    pin,
    updateRow,
    unpin,
    readByPath,
    list,
    clear,
    retainOnly,
    get isDisabled() { return disabled; },
  };
}

/**
 * One cloud PDF read that may fall back to the kept offline copy.
 *
 *   read(): Promise<Blob>   the normal read (access check + cache + download)
 *   refusal(error): bool    the server said no (pdfByteCache.isStorageRefusal)
 *
 * Online: the normal read wins, and a kept document's copy is refreshed when
 * its bytes changed. No network: a kept document opens from its copy and
 * `onOfflineCopy` is told so (the viewer shows "Offline copy"). A refusal
 * drops the copy and rethrows, so a kept copy can never open a document the
 * server now refuses.
 *
 * The file read failed but the device has a network: the database may still
 * answer while Storage does not, and the marks then load from the server.
 * `currentSha(documentId)` asks the database which file the document has now
 * (content_sha256, or null when it can't say); a kept copy of an older file is
 * not opened, so new marks never land on an old PDF.
 */
export const CURRENT_SHA_TIMEOUT = 'CURRENT_SHA_TIMEOUT';
// Documents whose PDF opened from a kept copy the database could not vouch
// for in time (CURRENT_SHA_TIMEOUT). Their marks stay on the device copy
// until the server answers again.
// Each keeps the copy's own SHA-256, so the reconnect can tell whether the
// server still has that file before any server mark is loaded onto it.
const unverifiedCopies = new Map();
export function openedFromUnverifiedCopy(documentId) {
  return Boolean(documentId) && unverifiedCopies.has(documentId);
}
export function unverifiedCopySha(documentId) {
  return unverifiedCopies.get(documentId) || null;
}
export function forgetUnverifiedCopy(documentId) {
  unverifiedCopies.delete(documentId);
}
async function bytesSha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : await bytes.arrayBuffer());
  const digest = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readPdfWithOfflineCopy({
  store, actorId, path, read, refusal, fetchStamp = null, onOfflineCopy = null,
  currentSha = null, navigatorRef = globalThis.navigator,
}) {
  if (!store || store.isDisabled || !actorId || !path) return read();
  await store.load(actorId);
  const kept = store.pinnedPathEntry(actorId, path);
  if (!kept) return read();
  const openCopy = async (fallbackError, { checkCurrent = false } = {}) => {
    const copy = await store.readByPath(actorId, path);
    if (!copy) throw fallbackError;
    let unverified = false;
    if (checkCurrent && typeof currentSha === 'function') {
      // No answer in time: the copy opens (a server out of reach often hangs
      // rather than fails), but it is marked unverified so the marks open
      // from the device copy too and never load from the database onto what
      // may be an old PDF (useAnnotationDoc reads openedFromUnverifiedCopy).
      const now = await Promise.resolve().then(() => currentSha(copy.documentId ?? kept.documentId)).catch((err) => {
        if (err?.code === CURRENT_SHA_TIMEOUT) unverified = true;
        return null;
      });
      if (now) {
        const mine = await bytesSha256(copy.bytes).catch(() => null);
        if (mine && mine !== String(now).toLowerCase()) throw fallbackError;
      }
    }
    const docId = copy.documentId ?? kept.documentId;
    if (unverified) unverifiedCopies.set(docId, await bytesSha256(copy.bytes).catch(() => null));
    else unverifiedCopies.delete(docId);
    try { onOfflineCopy?.({ path, documentId: copy.documentId, ...(unverified ? { unverified: true } : {}) }); } catch { /* listener */ }
    return new Blob([copy.bytes], { type: 'application/pdf' });
  };
  // The device says it has no network: don't wait out request timeouts.
  if (navigatorRef?.onLine === false) return openCopy(new TypeError('Failed to fetch'));
  let blob;
  try {
    blob = await read();
  } catch (error) {
    if (refusal?.(error)) {
      await store.unpin(actorId, kept.documentId).catch(() => {});
      throw error;
    }
    if (!isNetworkFailure(error, { navigatorRef })) throw error;
    return openCopy(error, { checkCurrent: true });
  }
  // Online and read: keep the copy current (a page edit or a new version
  // elsewhere replaced the file). In the background; the open never waits.
  unverifiedCopies.delete(kept.documentId);
  if (blob && typeof blob.arrayBuffer === 'function') {
    Promise.resolve()
      .then(async () => {
        const stamp = typeof fetchStamp === 'function' ? await fetchStamp() : null;
        if (stamp && stamp === kept.stamp) return;
        if (!stamp && blob.size === kept.size) return;
        await store.pin({ actorId, row: kept.row, bytes: blob, stamp });
      })
      .catch(() => {});
  }
  return blob;
}

/**
 * Same sign-out rule as pdfByteCache.bindPdfCacheToAuth: signing out empties
 * the store; a different account signing in keeps only its own documents. An
 * offline start (session still stored, no user yet) keeps everything, since
 * that is exactly when the kept copies are needed.
 */
export function bindOfflineDocumentsToAuth(client, store, { storage = globalThis.localStorage } = {}) {
  if (!client?.auth?.onAuthStateChange || !store) return;
  let lastActor;
  const sessionStored = () => {
    try {
      const own = client.auth.storageKey;
      if (own) return Boolean(storage?.getItem(own));
      for (let i = 0; i < (storage?.length || 0); i += 1) {
        const key = storage.key(i);
        if (key && /^sb-.*-auth-token$/.test(key) && storage.getItem(key)) return true;
      }
    } catch { /* storage unavailable: treat as signed out */ }
    return false;
  };
  client.auth.onAuthStateChange((event, session) => {
    const actor = session?.user?.id ?? null;
    if (event === 'SIGNED_OUT' || (!actor && !sessionStored())) {
      lastActor = null;
      store.clear().catch(() => {});
      return;
    }
    if (!actor) return;
    if (actor !== lastActor) {
      lastActor = actor;
      store.retainOnly(actor).catch(() => {});
    }
  });
}

/* The one store the app uses; lazy so Node imports cost nothing. */
let shared = null;
export function offlineDocuments() {
  if (!shared) {
    shared = createOfflineDocuments({
      onChange: (actorId) => {
        try {
          globalThis.dispatchEvent?.(new CustomEvent(OFFLINE_DOCS_CHANGED_EVENT, { detail: { actorId } }));
        } catch { /* no DOM events (tests, workers) */ }
      },
    });
  }
  return shared;
}
