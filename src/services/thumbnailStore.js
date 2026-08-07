/**
 * Durable cache for rendered PDF first-page thumbnails (owner call 2026-08-07:
 * "they should be basically instant").
 *
 * Why this exists
 * ---------------
 * PdfPageThumb kept its renders in a module-level Map, so every reload paid the
 * full cost again for every visible row: download the WHOLE PDF from private
 * Supabase storage, then rasterize page 1 with pdf.js. Measured on the real
 * account, the download alone is 517ms for a 548KB file and 6.3 SECONDS for a
 * 25MB drawing — before any rasterizing. Nothing about that work changes
 * between visits, so it should be paid once, not once per page load.
 *
 * A first-page thumbnail is stable until the file's bytes change, so it is
 * exactly the kind of thing that belongs in durable local storage.
 *
 * Design notes
 * ------------
 * - Hand-rolled against the bare IndexedDB API, copying the shape of
 *   services/annotationDocOutbox.js (promisified requests with timeouts,
 *   idempotent upgrade, injectable `indexedDb` so Node tests can drive it with
 *   fake-indexeddb). Deliberately NOT a new dependency.
 * - EVERY failure degrades to "no cache". A thumbnail is decoration; it must
 *   never be able to break a screen. Callers get null and re-render.
 * - Bounded by a byte budget, pruned oldest-first, so a long-lived browser
 *   profile cannot grow this without limit or trip a quota error.
 */

const DB_NAME = 'survey-thumbnail-cache-v1';
const DB_VERSION = 1;
const THUMB_STORE = 'thumbs';
const SAVED_AT_INDEX = 'savedAt';
const REQUEST_TIMEOUT_MS = 5_000;

/* Roughly 40MB of JPEG data URLs. Big enough to hold every document a real
   account browses in a session, small enough to stay well clear of the origin
   quota (browsers typically allow hundreds of MB). */
export const THUMB_CACHE_BUDGET_BYTES = 40 * 1024 * 1024;

/**
 * Cache key for a document's thumbnail.
 *
 * The key must change when the underlying bytes change, or a re-uploaded file
 * would show its predecessor's page forever. Both of this app's storage paths
 * give us that for free:
 *   content-addressed uploads → `<userId>/<sha256>.pdf`   (path contains the hash)
 *   legacy uploads           → `<userId>/<projectId>/<epochMs>.pdf` (new path per upload)
 * so file_path alone is already a sound invalidation stamp. content_sha256 is
 * preferred when the caller has it, but most rows in the wild predate that
 * column and carry null — hence the fallback rather than a hard requirement.
 *
 * Returns null when there is nothing stable to key on; callers then skip the
 * cache entirely rather than risk serving one document's page for another.
 */
export function thumbCacheKey(doc) {
  if (!doc) return null;
  const id = doc.id;
  if (!id) return null;
  const stamp = doc.content_sha256 || doc.contentSha256 || doc.file_path || doc.filePath;
  if (!stamp) return null;
  return `${id}::${stamp}`;
}

function requestResult(request, transaction, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      try { transaction?.abort(); } catch { /* transaction already closed */ }
      const error = new Error('IndexedDB request timed out');
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
    request.onsuccess = () => finish(resolve, request.result);
    request.onerror = () => finish(
      reject,
      request.error || new Error('IndexedDB request failed'),
    );
  });
}

async function openDatabase(indexedDb, timeoutMs) {
  const request = indexedDb.open(DB_NAME, DB_VERSION);
  const db = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      const error = new Error('IndexedDB open timed out');
      error.code = 'ETIMEDOUT';
      finish(reject, error);
    }, timeoutMs);
    request.onblocked = () => {
      const error = new Error('IndexedDB open blocked');
      error.code = 'IDB_BLOCKED';
      finish(reject, error);
    };
    request.onerror = () => finish(
      reject,
      request.error || new Error('IndexedDB open failed'),
    );
    request.onupgradeneeded = () => {
      const opened = request.result;
      if (!opened.objectStoreNames.contains(THUMB_STORE)) {
        const store = opened.createObjectStore(THUMB_STORE, { keyPath: 'key' });
        store.createIndex(SAVED_AT_INDEX, SAVED_AT_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        try { request.result?.close(); } catch { /* late blocked/open result */ }
        return;
      }
      finish(resolve, request.result);
    };
  });
  db.onversionchange = () => db.close();
  return db;
}

/**
 * A thumbnail store bound to one IndexedDB database.
 *
 * `indexedDb` is injectable purely so the Node suite can drive the real code
 * with fake-indexeddb; production callers use the shared singleton below.
 */
export function createThumbnailStore({
  indexedDb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined),
  timeoutMs = REQUEST_TIMEOUT_MS,
  budgetBytes = THUMB_CACHE_BUDGET_BYTES,
} = {}) {
  let dbPromise = null;
  let disabled = !indexedDb?.open;

  const db = async () => {
    if (disabled) return null;
    if (!dbPromise) {
      dbPromise = openDatabase(indexedDb, timeoutMs).catch((error) => {
        // One failed open disables the cache for this page rather than
        // retrying on every row — private-mode and blocked upgrades do not
        // recover within a session.
        disabled = true;
        dbPromise = null;
        console.warn('[thumbnailStore] disabled:', error?.message || error);
        return null;
      });
    }
    return dbPromise;
  };

  const read = async (key) => {
    if (!key) return null;
    const database = await db();
    if (!database) return null;
    const tx = database.transaction(THUMB_STORE, 'readonly');
    const record = await requestResult(tx.objectStore(THUMB_STORE).get(key), tx, timeoutMs);
    if (!record || typeof record.url !== 'string') return null;
    return { url: record.url, aspect: record.aspect };
  };

  /* Oldest-first prune down to the byte budget. Runs after a write, and a
     failure here is silent: a slightly oversized cache is not worth surfacing. */
  const prune = async (database) => {
    const tx = database.transaction(THUMB_STORE, 'readwrite');
    const store = tx.objectStore(THUMB_STORE);
    const all = await requestResult(store.getAll(), tx, timeoutMs);
    let total = 0;
    for (const row of all) total += row.bytes || 0;
    if (total <= budgetBytes) return;
    const oldestFirst = [...all].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
    for (const row of oldestFirst) {
      if (total <= budgetBytes) break;
      store.delete(row.key);
      total -= row.bytes || 0;
    }
  };

  const write = async (key, value) => {
    if (!key || !value || typeof value.url !== 'string') return false;
    const database = await db();
    if (!database) return false;
    try {
      const tx = database.transaction(THUMB_STORE, 'readwrite');
      await requestResult(tx.objectStore(THUMB_STORE).put({
        key,
        url: value.url,
        aspect: value.aspect,
        bytes: value.url.length,
        savedAt: Date.now(),
      }), tx, timeoutMs);
      await prune(database);
      return true;
    } catch (error) {
      // QuotaExceededError is the expected one here. Losing the cache entry is
      // strictly better than losing the thumbnail, so this stays a warning.
      console.warn('[thumbnailStore] write failed:', error?.message || error);
      return false;
    }
  };

  return {
    get: async (key) => {
      try { return await read(key); } catch (error) {
        console.warn('[thumbnailStore] read failed:', error?.message || error);
        return null;
      }
    },
    put: write,
    clear: async () => {
      const database = await db();
      if (!database) return;
      const tx = database.transaction(THUMB_STORE, 'readwrite');
      await requestResult(tx.objectStore(THUMB_STORE).clear(), tx, timeoutMs);
    },
    close: async () => {
      const database = await db();
      try { database?.close(); } catch { /* already closed */ }
      dbPromise = null;
    },
    get isDisabled() { return disabled; },
  };
}

/* The one store the app uses. Created lazily so importing this module in a
   non-browser context (the Node test runner) costs nothing. */
let shared = null;
export function thumbnailStore() {
  if (!shared) shared = createThumbnailStore();
  return shared;
}
