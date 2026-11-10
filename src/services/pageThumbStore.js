/**
 * Page previews kept on the device, per file (2026-11-09).
 *
 * Why: opening a heavy drawing set drew every page's small preview again,
 * each costing about as much as a full page draw (se011: 0.9-2.8 s a sheet),
 * so pages scrolled into view in the first seconds stayed white. A preview
 * only changes when the file's bytes change, so it is kept here, keyed by the
 * SHA-256 of the bytes (`stamp`), and a reopened file shows every page's
 * preview at once.
 *
 * Rules (the same as services/pdfByteCache.js and services/thumbnailStore.js):
 *   - Bare IndexedDB, injectable `indexedDb` for Node tests.
 *   - Every failure is "no previews", never a broken open.
 *   - A byte budget, pruned a whole file at a time, least recently opened first.
 *   - Previews are only ever shown for a file that is already open (the key is
 *     its bytes' hash), so a preview never gets past the server's access check.
 *     Still, they are pictures of the account's drawings: signing out, or a
 *     different account signing in, empties the store (bindPdfCacheToAuth calls
 *     clear / retainOnly).
 */

const DB_NAME = 'survey-page-thumbs-v1';
const DB_VERSION = 1;
const PAGE_STORE = 'pages';
const DOC_STORE = 'docs';
const STATE_STORE = 'state';
const ALL_STORES = [PAGE_STORE, DOC_STORE, STATE_STORE];
const STAMP_INDEX = 'stamp';
const USED_AT_INDEX = 'usedAt';
const REQUEST_TIMEOUT_MS = 5_000;

/* ~64 MB: a 99-sheet set's previews are ~2-3 MB as WebP. */
export const PAGE_THUMB_STORE_BUDGET_BYTES = 64 * 1024 * 1024;

/** SHA-256 of the file's bytes, hex. Null when it cannot be computed. */
export async function pageThumbStamp(bytes, subtle = globalThis.crypto?.subtle) {
  if (!bytes || !subtle?.digest) return null;
  try {
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
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
    transaction.onerror = () => { /* onabort reports the outcome */ };
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
      if (!opened.objectStoreNames.contains(PAGE_STORE)) {
        const pages = opened.createObjectStore(PAGE_STORE, { keyPath: ['stamp', 'pageKey'] });
        pages.createIndex(STAMP_INDEX, STAMP_INDEX, { unique: false });
      }
      if (!opened.objectStoreNames.contains(DOC_STORE)) {
        const docs = opened.createObjectStore(DOC_STORE, { keyPath: 'stamp' });
        docs.createIndex(USED_AT_INDEX, USED_AT_INDEX, { unique: false });
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

export function createPageThumbStore({
  indexedDb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined),
  timeoutMs = REQUEST_TIMEOUT_MS,
  budgetBytes = PAGE_THUMB_STORE_BUDGET_BYTES,
  now = () => Date.now(),
} = {}) {
  let dbPromise = null;
  let disabled = !indexedDb?.open;
  // Bumped by clear(): a save that started before a sign-out must not land.
  let generation = 0;

  const db = async () => {
    if (disabled) return null;
    if (!dbPromise) {
      dbPromise = openDatabase(indexedDb, timeoutMs).catch((error) => {
        disabled = true;
        dbPromise = null;
        console.warn('[pageThumbStore] disabled:', error?.message || error);
        return null;
      });
    }
    return dbPromise;
  };

  /** Every kept preview of the file: [{ pageKey, scale, type, data }]. */
  async function loadDoc(stamp) {
    if (!stamp) return [];
    try {
      const database = await db();
      if (!database) return [];
      const tx = database.transaction([PAGE_STORE, DOC_STORE], 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      const rows = await requestResult(tx.objectStore(PAGE_STORE).index(STAMP_INDEX).getAll(stamp), tx, timeoutMs);
      const docs = tx.objectStore(DOC_STORE);
      const doc = await requestResult(docs.get(stamp), tx, timeoutMs);
      if (doc) docs.put({ ...doc, usedAt: now() });
      await committed;
      return (rows || [])
        .filter((row) => row && row.data && row.pageKey)
        .map((row) => ({ pageKey: row.pageKey, scale: row.scale, type: row.type || 'image/webp', data: row.data }));
    } catch (error) {
      console.warn('[pageThumbStore] read failed:', error?.message || error);
      return [];
    }
  }

  /**
   * Keep previews of the file: rows [{ pageKey, scale, type, data }] (data:
   * ArrayBuffer). A page already kept for this file is left as it is.
   */
  async function putPages(stamp, rows) {
    const list = (Array.isArray(rows) ? rows : []).filter((row) => row?.pageKey && row.data?.byteLength > 0);
    if (!stamp || !list.length) return false;
    const since = generation;
    try {
      const database = await db();
      if (!database || since !== generation) return false;
      const tx = database.transaction(ALL_STORES, 'readwrite');
      const committed = transactionResult(tx, timeoutMs);
      const pages = tx.objectStore(PAGE_STORE);
      const docs = tx.objectStore(DOC_STORE);
      const state = tx.objectStore(STATE_STORE);
      let total = (await requestResult(state.get('bytes'), tx, timeoutMs)) || 0;
      const doc = (await requestResult(docs.get(stamp), tx, timeoutMs)) || { stamp, bytes: 0, usedAt: now() };
      for (const row of list) {
        const existing = await requestResult(pages.getKey([stamp, row.pageKey]), tx, timeoutMs);
        if (existing !== undefined) continue;
        const bytes = row.data.byteLength;
        pages.put({ stamp, pageKey: row.pageKey, scale: Number(row.scale) || 0, type: row.type || 'image/webp', data: row.data, bytes });
        doc.bytes += bytes;
        total += bytes;
      }
      doc.usedAt = now();
      docs.put(doc);
      // Over budget: drop whole files, least recently opened first (never this one).
      if (total > budgetBytes) {
        const oldest = await requestResult(docs.index(USED_AT_INDEX).getAll(), tx, timeoutMs);
        for (const old of oldest || []) {
          if (total <= budgetBytes) break;
          if (old.stamp === stamp) continue;
          const keys = await requestResult(pages.index(STAMP_INDEX).getAllKeys(old.stamp), tx, timeoutMs);
          for (const key of keys || []) pages.delete(key);
          docs.delete(old.stamp);
          total -= old.bytes || 0;
        }
      }
      state.put(Math.max(0, total), 'bytes');
      await committed;
      return true;
    } catch (error) {
      console.warn('[pageThumbStore] write failed:', error?.message || error);
      return false;
    }
  }

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
      console.warn('[pageThumbStore] clear failed:', error?.message || error);
    }
  }

  /** Keep previews only for `actorId`: another account's are dropped. */
  async function retainOnly(actorId) {
    if (!actorId) return;
    try {
      const database = await db();
      if (!database) return;
      const tx = database.transaction(STATE_STORE, 'readonly');
      const kept = await requestResult(tx.objectStore(STATE_STORE).get('actor'), tx, timeoutMs);
      if (kept === actorId) return;
      if (kept !== undefined) await clear();
      const write = database.transaction(STATE_STORE, 'readwrite');
      const committed = transactionResult(write, timeoutMs);
      write.objectStore(STATE_STORE).put(actorId, 'actor');
      await committed;
    } catch (error) {
      console.warn('[pageThumbStore] retain failed:', error?.message || error);
    }
  }

  return {
    loadDoc,
    putPages,
    clear,
    retainOnly,
    close: async () => {
      const database = await db();
      try { database?.close(); } catch { /* already closed */ }
      dbPromise = null;
    },
    get isDisabled() { return disabled; },
  };
}

let shared = null;
export function pageThumbStore() {
  if (!shared) shared = createPageThumbStore();
  return shared;
}
