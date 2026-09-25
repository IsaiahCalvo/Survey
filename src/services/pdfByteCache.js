/**
 * Device cache for cloud PDF bytes (w36, 2026-09-25: stay inside Supabase Free).
 *
 * Why this exists
 * ---------------
 * Every open of a cloud document downloaded the WHOLE PDF from Supabase
 * Storage again, even when this device had opened the same unchanged file a
 * minute earlier. Storage downloads are the one Supabase quota real use
 * burns fastest (Free: 5 GB of egress a month): the w34 audit put ~4.5 GB of
 * a month's 5-user estimate on PDF re-downloads alone.
 *
 * Why there was no cache before, and how this keeps that rule
 * -----------------------------------------------------------
 * The 2026-09-07 data pass (services/storageDownloads.js, #802) deliberately
 * kept no settled copy of private PDF bytes: "later opens must still pass the
 * server's current access checks". A plain byte cache would let someone whose
 * access was revoked, or the next person on a shared computer, keep opening
 * the file. This cache keeps that rule:
 *   - Every open still asks Storage first (`info`: the object's metadata, a
 *     few hundred bytes, under the same Storage access rules as a download).
 *     Cached bytes are used only after that answer arrives AND names exactly
 *     the version cached. No answer (offline, error) = no cached bytes; a
 *     "not found / not allowed" answer also drops the cached copy.
 *   - Entries are per signed-in account; signing out (or a different account
 *     signing in) empties the cache on this device.
 *   - A local write of a path (upload, replace, delete) drops its entry.
 *
 * Everything else follows services/thumbnailStore.js: bare IndexedDB (works in
 * the browser, Electron's file:// renderer and the Capacitor web view, which all
 * run this same code), injectable `indexedDb` for Node tests, a byte budget
 * pruned least-recently-used first, and every failure degrading to "no cache"
 * (a download), never to a broken open.
 */

const DB_NAME = 'survey-pdf-cache-v1';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const META_STORE = 'meta';
const STATE_STORE = 'state';
const ALL_STORES = [FILE_STORE, META_STORE, STATE_STORE];
const USED_AT_INDEX = 'usedAt';
const PATH_INDEX = 'path';
const REQUEST_TIMEOUT_MS = 8_000;

/* 256 MB: a working set of a few dozen drawings (the owner's library averages
   well under 5 MB a file; the largest is ~25 MB). Capped further to a fifth of
   what the browser grants this origin, so a phone web view is never pushed to
   its quota by a cache. */
export const PDF_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
/* A single file bigger than this is not kept: one giant drawing would evict
   everything else and still cost a full write each open. */
export const PDF_CACHE_MAX_ENTRY_BYTES = 96 * 1024 * 1024;

const SEP = '\u0000';
export const pdfCacheKey = (actorId, path) => (actorId && path ? `${actorId}${SEP}${path}` : null);

/**
 * The version stamp of a stored object, from Storage's `info` answer. It must
 * change whenever the bytes change: `version` is a fresh id per upload (an
 * upsert of the same path gets a new one), `etag` is the content hash, `size`
 * and `lastModified` are belt and braces. With neither version nor etag there
 * is nothing trustworthy to compare, so the file is not cached.
 */
export function pdfCacheStamp(info) {
  if (!info || typeof info !== 'object') return null;
  const version = info.version ?? null;
  const etag = info.etag ?? info.eTag ?? info.metadata?.eTag ?? null;
  const size = Number(info.size ?? info.metadata?.size);
  if (!version && !etag) return null;
  if (!Number.isFinite(size) || size <= 0) return null;
  const modified = info.lastModified ?? info.last_modified ?? info.updatedAt ?? info.updated_at ?? '';
  return JSON.stringify([version || '', etag || '', size, String(modified || '')]);
}

export const pdfCacheInfoSize = (info) => Number(info?.size ?? info?.metadata?.size);

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
      if (!opened.objectStoreNames.contains(FILE_STORE)) opened.createObjectStore(FILE_STORE, { keyPath: 'key' });
      if (!opened.objectStoreNames.contains(META_STORE)) {
        const meta = opened.createObjectStore(META_STORE, { keyPath: 'key' });
        meta.createIndex(USED_AT_INDEX, USED_AT_INDEX, { unique: false });
        meta.createIndex(PATH_INDEX, PATH_INDEX, { unique: false });
      }
      if (!opened.objectStoreNames.contains(STATE_STORE)) opened.createObjectStore(STATE_STORE);
    };
    request.onsuccess = () => {
      if (settled) {
        try { request.result?.close(); } catch { /* late result */ }
        return;
      }
      const db = request.result;
      db.onversionchange = () => db.close();
      finish(resolve, db);
    };
  });
}

/**
 * A PDF byte cache bound to one IndexedDB database. `budgetBytes` may be a
 * number or an async function (the shared cache sizes itself from the
 * browser's storage estimate); `now` is injectable for LRU tests.
 */
export function createPdfByteCache({
  indexedDb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined),
  timeoutMs = REQUEST_TIMEOUT_MS,
  budgetBytes = PDF_CACHE_BUDGET_BYTES,
  maxEntryBytes = PDF_CACHE_MAX_ENTRY_BYTES,
  now = () => Date.now(),
} = {}) {
  let dbPromise = null;
  let disabled = !indexedDb?.open;
  // Bumped by clear(): a write that started before a sign-out must not land
  // after it (the account's bytes would outlive the sign-out).
  let generation = 0;
  let budgetPromise = null;
  const budget = () => {
    if (typeof budgetBytes !== 'function') return Promise.resolve(budgetBytes);
    budgetPromise ||= Promise.resolve().then(budgetBytes).catch(() => PDF_CACHE_BUDGET_BYTES);
    return budgetPromise;
  };

  const db = async () => {
    if (disabled) return null;
    if (!dbPromise) {
      dbPromise = openDatabase(indexedDb, timeoutMs).catch((error) => {
        // Private mode / blocked upgrade: no cache for this page, downloads as before.
        disabled = true;
        dbPromise = null;
        console.warn('[pdfByteCache] disabled:', error?.message || error);
        return null;
      });
    }
    return dbPromise;
  };

  const touch = async (key) => {
    const database = await db();
    if (!database) return;
    const tx = database.transaction(META_STORE, 'readwrite');
    const committed = transactionResult(tx, timeoutMs);
    const meta = tx.objectStore(META_STORE);
    const row = meta.get(key);
    row.onsuccess = () => {
      if (row.result) meta.put({ ...row.result, usedAt: now() });
    };
    await committed;
  };

  /** Cached bytes for `key` if they are exactly the version `stamp` names. */
  const get = async (key, stamp) => {
    if (!key || !stamp) return null;
    try {
      const database = await db();
      if (!database) return null;
      const tx = database.transaction([META_STORE, FILE_STORE], 'readonly');
      const info = await requestResult(tx.objectStore(META_STORE).get(key), tx, timeoutMs);
      if (!info || info.stamp !== stamp) return null;
      const file = await requestResult(tx.objectStore(FILE_STORE).get(key), tx, timeoutMs);
      const bytes = file?.bytes;
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== info.size) return null;
      touch(key).catch(() => {});
      return bytes;
    } catch (error) {
      console.warn('[pdfByteCache] read failed:', error?.message || error);
      return null;
    }
  };

  /** Keep `bytes` (an ArrayBuffer) as version `stamp` of `path` for `actorId`. */
  const put = async ({ actorId, path, stamp, bytes }) => {
    const startedIn = generation; // before any await: a clear() racing this write wins
    const key = pdfCacheKey(actorId, path);
    if (!key || !stamp || !(bytes instanceof ArrayBuffer)) return false;
    const size = bytes.byteLength;
    const limit = await budget();
    if (!size || size > maxEntryBytes || size > limit) return false;
    try {
      const database = await db();
      if (!database || startedIn !== generation) return false;
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      const files = tx.objectStore(FILE_STORE);
      const meta = tx.objectStore(META_STORE);
      const state = tx.objectStore(STATE_STORE);
      // IDB serializes overlapping readwrite transactions (other tabs too):
      // replacing, evicting and the byte total commit together.
      const previous = meta.get(key);
      previous.onsuccess = () => {
        const usage = state.get('bytes');
        usage.onsuccess = () => {
          let total = Math.max(0, (usage.result || 0) - (previous.result?.size || 0));
          const save = () => {
            const at = now();
            files.put({ key, bytes });
            meta.put({ key, actorId, path, stamp, size, usedAt: at, savedAt: at });
            state.put(total + size, 'bytes');
          };
          if (total + size <= limit) { save(); return; }
          const cursor = meta.index(USED_AT_INDEX).openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row || total + size <= limit) { save(); return; }
            if (row.primaryKey !== key) {
              total -= row.value.size || 0;
              files.delete(row.primaryKey);
              row.delete();
            }
            row.continue();
          };
        };
      };
      await committed;
      if (startedIn !== generation) {
        // A sign-out cleared the cache while this write was in flight.
        await clear();
        return false;
      }
      return true;
    } catch (error) {
      // QuotaExceededError is the expected one: losing a cache entry only
      // costs a download next time.
      console.warn('[pdfByteCache] write failed:', error?.message || error);
      return false;
    }
  };

  const removeWhere = async (indexName, value) => {
    const database = await db();
    if (!database) return;
    const tx = database.transaction(ALL_STORES, 'readwrite');
    const committed = transactionResult(tx, timeoutMs);
    const files = tx.objectStore(FILE_STORE);
    const meta = tx.objectStore(META_STORE);
    const state = tx.objectStore(STATE_STORE);
    const usage = state.get('bytes');
    usage.onsuccess = () => {
      let total = usage.result || 0;
      const source = indexName ? meta.index(indexName).openCursor(value) : meta.openCursor();
      source.onsuccess = () => {
        const row = source.result;
        if (!row) { state.put(Math.max(0, total), 'bytes'); return; }
        const drop = indexName ? true : value(row.value);
        if (drop) {
          total -= row.value.size || 0;
          files.delete(row.primaryKey);
          row.delete();
        }
        row.continue();
      };
    };
    await committed;
  };

  /** Drop one account's copy of one path (access refused for it). */
  const remove = async (key) => {
    if (!key) return;
    try {
      const database = await db();
      if (!database) return;
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      const meta = tx.objectStore(META_STORE);
      const state = tx.objectStore(STATE_STORE);
      const previous = meta.get(key);
      previous.onsuccess = () => {
        if (!previous.result) return;
        const usage = state.get('bytes');
        usage.onsuccess = () => {
          state.put(Math.max(0, (usage.result || 0) - (previous.result.size || 0)), 'bytes');
          tx.objectStore(FILE_STORE).delete(key);
          meta.delete(key);
        };
      };
      await committed;
    } catch (error) {
      console.warn('[pdfByteCache] remove failed:', error?.message || error);
    }
  };

  /** Every account's copy of `path` (it was just written or deleted here). */
  const removePath = async (path) => {
    if (!path) return;
    try { await removeWhere(PATH_INDEX, path); } catch (error) {
      console.warn('[pdfByteCache] remove failed:', error?.message || error);
    }
  };

  /** Keep only `actorId`'s entries (another account's must not stay on disk). */
  const retainOnly = async (actorId) => {
    try { await removeWhere(null, (row) => row.actorId !== actorId); } catch (error) {
      console.warn('[pdfByteCache] retain failed:', error?.message || error);
    }
  };

  async function clear() {
    generation += 1;
    try {
      const database = await db();
      if (!database) return;
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      for (const name of ALL_STORES) tx.objectStore(name).clear();
      await committed;
    } catch (error) {
      console.warn('[pdfByteCache] clear failed:', error?.message || error);
    }
  }

  const stats = async () => {
    const database = await db();
    if (!database) return { entries: 0, bytes: 0 };
    const tx = database.transaction([META_STORE, STATE_STORE], 'readonly');
    const entries = await requestResult(tx.objectStore(META_STORE).count(), tx, timeoutMs);
    const bytes = await requestResult(tx.objectStore(STATE_STORE).get('bytes'), tx, timeoutMs);
    return { entries, bytes: bytes || 0 };
  };

  return {
    get,
    put,
    remove,
    removePath,
    retainOnly,
    clear,
    stats,
    close: async () => {
      const database = await db();
      try { database?.close(); } catch { /* already closed */ }
      dbPromise = null;
    },
    get isDisabled() { return disabled; },
  };
}

// Storage answers "not found" for both a missing object and one the caller may
// not read (RLS), so both drop the cached copy.
const REFUSED_STATUSES = new Set([400, 401, 403, 404]);
export function isStorageRefusal(error) {
  if (!error) return false;
  const status = Number(error.status ?? error.statusCode ?? error.originalError?.status);
  if (REFUSED_STATUSES.has(status)) return true;
  return /not[\s_-]?found|not authorized|unauthorized|permission|denied|row-level security/i.test(String(error.message || ''));
}

const isPdfPath = (path) => typeof path === 'string' && /\.pdf$/i.test(path);

/**
 * One cloud PDF read through the device cache.
 *
 *   fetchInfo(): Promise<{ data, error }>  Storage's metadata for the object
 *   download():  Promise<Blob>             the normal full download
 *
 * The access check (`fetchInfo`) runs on EVERY read; cached bytes are returned
 * only when it succeeds and names the cached version. Anything else downloads
 * (and a refusal also drops the cached copy), so a cache can never make an
 * open succeed that the server would refuse.
 */
export async function readPdfThroughCache({ cache, actorId, path, fetchInfo, download }) {
  const key = pdfCacheKey(actorId, path);
  if (!cache || cache.isDisabled || !key || !isPdfPath(path) || typeof fetchInfo !== 'function') {
    return download();
  }
  let info = null;
  try {
    const result = await fetchInfo();
    if (result?.error) {
      if (isStorageRefusal(result.error)) await cache.remove(key);
      return download();
    }
    info = result?.data ?? null;
  } catch (error) {
    if (isStorageRefusal(error)) await cache.remove(key);
    return download();
  }
  const stamp = pdfCacheStamp(info);
  if (!stamp) return download();
  const cached = await cache.get(key, stamp);
  if (cached) return new Blob([cached], { type: 'application/pdf' });

  const blob = await download();
  // Only bytes whose length matches the version Storage just named are kept:
  // a replace racing this read (new version between info and download) makes
  // the lengths disagree or, at worst, stores the NEWER bytes under the older
  // stamp, which the next open's check then rejects (one extra download).
  if (blob && typeof blob.arrayBuffer === 'function' && blob.size === pdfCacheInfoSize(info)) {
    blob.arrayBuffer()
      .then((bytes) => cache.put({ actorId, path, stamp, bytes }))
      .catch(() => {});
  }
  return blob;
}

/**
 * Keep a just-uploaded PDF, so this device's first reopen downloads nothing.
 * Only for a path that names its bytes: a content-addressed upload
 * (`<user>/<sha256>.pdf`, re-uploads of the path are the same bytes) or a
 * fresh unique path. NOT for an in-place replace, where another device's
 * same-size replace could race ours and leave our bytes under its version.
 * One small metadata read; nothing is kept unless it names a version whose
 * size equals the uploaded bytes.
 */
export async function seedPdfCacheFromUpload({ cache, actorId, path, fetchInfo, file }) {
  if (!cache || cache.isDisabled || !pdfCacheKey(actorId, path) || !isPdfPath(path)) return false;
  if (!file || typeof file.arrayBuffer !== 'function' || typeof fetchInfo !== 'function') return false;
  try {
    const result = await fetchInfo();
    if (result?.error) return false;
    const stamp = pdfCacheStamp(result?.data);
    if (!stamp || Number(file.size) !== pdfCacheInfoSize(result.data)) return false;
    const bytes = await file.arrayBuffer();
    return cache.put({ actorId, path, stamp, bytes });
  } catch {
    return false;
  }
}

/**
 * Empty the cache on sign-out, and keep only the signed-in account's entries
 * when an account is present (covers a sign-out whose clear never committed,
 * e.g. the tab closed first). Supabase calls this synchronously: never await
 * auth methods here.
 */
export function bindPdfCacheToAuth(client, cache) {
  if (!client?.auth?.onAuthStateChange || !cache) return;
  let lastActor;
  client.auth.onAuthStateChange((event, session) => {
    const actor = session?.user?.id ?? null;
    if (!actor || event === 'SIGNED_OUT') {
      lastActor = null;
      cache.clear().catch(() => {});
      return;
    }
    if (actor !== lastActor) {
      lastActor = actor;
      cache.retainOnly(actor).catch(() => {});
    }
  });
}

async function storageEstimateBudget() {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    const quota = Number(estimate?.quota);
    if (Number.isFinite(quota) && quota > 0) return Math.min(PDF_CACHE_BUDGET_BYTES, Math.floor(quota / 5));
  } catch { /* no estimate: default budget */ }
  return PDF_CACHE_BUDGET_BYTES;
}

/* The one cache the app uses; lazy so Node imports cost nothing. */
let shared = null;
export function pdfByteCache() {
  if (!shared) shared = createPdfByteCache({ budgetBytes: storageEstimateBudget });
  return shared;
}
