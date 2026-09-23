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
const DB_VERSION = 2;
const THUMB_STORE = 'thumbs';
const META_STORE = 'metadata';
const STATE_STORE = 'state';
const ALL_STORES = [THUMB_STORE, META_STORE, STATE_STORE];
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
      if (!opened.objectStoreNames.contains(META_STORE)) {
        const metadata = opened.createObjectStore(META_STORE, { keyPath: 'key' });
        metadata.createIndex(SAVED_AT_INDEX, SAVED_AT_INDEX, { unique: false });
        const state = opened.createObjectStore(STATE_STORE);
        // One streaming upgrade of v1. Normal writes never deserialize all
        // cached JPEGs just to total their sizes (up to 40MB per row before).
        let bytes = 0;
        const cursor = request.transaction.objectStore(THUMB_STORE).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) { state.put(bytes, 'bytes'); return; }
          const size = typeof row.value.url === 'string' ? row.value.url.length : 0;
          metadata.put({ key: row.primaryKey, bytes: size, savedAt: row.value.savedAt || 0 });
          bytes += size;
          row.continue();
        };
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
    // signature/source (2026-09-23): which content the image was made from —
    // see services/thumbnailSignature.js. Older rows carry neither and read
    // as "page-only, signature unknown", which the viewer refreshes on open.
    return {
      url: record.url,
      aspect: record.aspect,
      signature: record.signature || null,
      source: record.source || null,
      savedAt: record.savedAt || 0,
    };
  };

  const write = async (key, value) => {
    if (!key || !value || typeof value.url !== 'string') return false;
    if (value.url.length > budgetBytes) return false;
    const database = await db();
    if (!database) return false;
    try {
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      const store = tx.objectStore(THUMB_STORE);
      const metadata = tx.objectStore(META_STORE);
      const state = tx.objectStore(STATE_STORE);
      // IDB serializes overlapping readwrite transactions, including other
      // tabs: replacing, pruning and updating the byte count commit together.
      const previous = metadata.get(key);
      previous.onsuccess = () => {
        const usage = state.get('bytes');
        usage.onsuccess = () => {
          let total = (usage.result || 0) - (previous.result?.bytes || 0);
          const save = () => {
            const info = { key, bytes: value.url.length, savedAt: Date.now() };
            store.put({
              ...info,
              url: value.url,
              aspect: value.aspect,
              signature: value.signature || null,
              source: value.source || null,
            });
            metadata.put(info);
            state.put(total + info.bytes, 'bytes');
          };
          if (total + value.url.length <= budgetBytes) { save(); return; }
          const cursor = metadata.index(SAVED_AT_INDEX).openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row || total + value.url.length <= budgetBytes) { save(); return; }
            if (row.primaryKey !== key) {
              total -= row.value.bytes || 0;
              store.delete(row.primaryKey);
              row.delete();
            }
            row.continue();
          };
        };
      };
      await committed;
      return true;
    } catch (error) {
      // QuotaExceededError is the expected one here. Losing the cache entry is
      // strictly better than losing the thumbnail, so this stays a warning.
      console.warn('[thumbnailStore] write failed:', error?.message || error);
      return false;
    }
  };

  /* "Do not try this one again" markers for the idle backfill — a PDF too big
     to preview cheaply, or one pdf.js cannot open. Keyed by the same file-stamped
     key, so a re-upload (new key) is retried automatically. Kept in the small
     state store, outside the byte budget: each marker is a few dozen bytes. */
  const readSkip = async (key) => {
    if (!key) return null;
    const database = await db();
    if (!database) return null;
    const tx = database.transaction(STATE_STORE, 'readonly');
    const value = await requestResult(tx.objectStore(STATE_STORE).get(`skip:${key}`), tx, timeoutMs);
    return value && typeof value === 'object' ? value : null;
  };
  const writeSkip = async (key, reason) => {
    if (!key) return false;
    const database = await db();
    if (!database) return false;
    const tx = database.transaction(STATE_STORE, 'readwrite');
    const committed = transactionResult(tx, timeoutMs);
    tx.objectStore(STATE_STORE).put({ reason: String(reason || 'skipped'), at: Date.now() }, `skip:${key}`);
    await committed;
    return true;
  };

  return {
    getSkip: async (key) => {
      try { return await readSkip(key); } catch { return null; }
    },
    putSkip: async (key, reason) => {
      try { return await writeSkip(key, reason); } catch { return false; }
    },
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
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      for (const name of ALL_STORES) tx.objectStore(name).clear();
      await committed;
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
