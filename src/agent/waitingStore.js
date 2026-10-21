// Survey agent messages said or typed with no signal, kept on the device so
// they survive closing the chat or reloading the page, and sent once the
// signal is back. One IndexedDB store; recorded clips and attached files are
// kept as Blobs. Where IndexedDB is missing or blocked (private windows,
// tests) everything still works for the session, only without surviving a
// reload.

const DB_NAME = 'survey-agent';
const STORE = 'waiting';
// Old enough that sending it now would surprise the person.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let opening = null;

function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('docKey', 'docKey');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function withStore(mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? true);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Keeps one waiting message: { id, docKey, said?, clip?, durationMs?, files?, createdAt }. */
export function keepWaiting(item) {
  if (!item?.id || !item?.docKey) return Promise.resolve(null);
  return withStore('readwrite', (store) => store.put({ createdAt: Date.now(), ...item }));
}

export function dropWaiting(id) {
  if (!id) return Promise.resolve(null);
  return withStore('readwrite', (store) => store.delete(id));
}

/** This document's waiting messages, oldest first; ones older than a week are dropped. */
export async function loadWaiting(docKey) {
  if (!docKey) return [];
  const rows = await withStore('readonly', (store) => store.index('docKey').getAll(docKey));
  if (!Array.isArray(rows)) return [];
  const now = Date.now();
  const stale = rows.filter((r) => now - (r.createdAt || 0) > MAX_AGE_MS);
  for (const r of stale) dropWaiting(r.id);
  return rows.filter((r) => !stale.includes(r)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
