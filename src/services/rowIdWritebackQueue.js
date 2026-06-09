// src/services/rowIdWritebackQueue.js
//
// Durable per-document queue of Survey Markers whose freshly-assigned Row ID still
// needs to LAND in the linked Excel sheet (PLAN.md Amendment 2026-06-08(b), step 3).
//
// When the app imports a brand-new / blank / copied row it assigns identity in app
// memory immediately (so repeated saves never duplicate — see excelIdentityRecord),
// but the real signed Row ID can only be written back into the workbook through a
// SAFE path: a business-Graph single-cell PATCH (live), or a local/personal write
// only once Excel is closed. Until that safe write happens, the marker sits in this
// queue. The queue is the durable thing; the flush is opportunistic.
//
// Storage mirrors rowIdSecretStore / excelSyncBaselineStore: localStorage-backed,
// fail-safe, keyed per document. (Cloud/business workbooks will mirror the queue into
// the shared app store in a later slice so a second device doesn't re-create pending
// rows — Codex R3; this module is the local/per-device store.)
//
// An entry never blocks the user and never deletes anything. Clearing an entry is
// gated on a READ-BACK verification at flush time (Codex R1), handled by the flusher,
// not here.

const KEY_PREFIX = 'rowIdWritebackQueue:';

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    return null; // privacy mode / sandboxed
  }
}

export function queueKey(documentId) {
  if (!documentId) return null;
  return `${KEY_PREFIX}${documentId}`;
}

function read(documentId, storage) {
  const key = queueKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return {};
  try {
    const raw = store.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(documentId, entries, storage) {
  const key = queueKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return false;
  try {
    store.setItem(key, JSON.stringify(entries));
    return true;
  } catch {
    return false; // quota / unavailable — non-fatal
  }
}

/**
 * Add or refresh one marker's pending-writeback entry (keyed by markerId, so
 * re-enqueuing the same marker is idempotent — it updates in place, never piles up).
 * @param {string} documentId
 * @param {object} entry  { markerId, scope, sheetName, rowLocator, expectedOldCellValue,
 *                          newToken?, createdAt }
 * @returns {boolean} persisted
 */
export function enqueueWriteback(documentId, entry, storage) {
  if (!documentId || !entry || !entry.markerId) return false;
  const entries = read(documentId, storage);
  entries[entry.markerId] = {
    retryState: 'pending',
    ...entries[entry.markerId],
    ...entry,
    markerId: entry.markerId
  };
  return write(documentId, entries, storage);
}

/** All pending entries for a document, as an array. */
export function listWriteback(documentId, storage) {
  return Object.values(read(documentId, storage));
}

/** Count of pending entries — drives the "pending writeback (N)" sync state. */
export function countWriteback(documentId, storage) {
  return Object.keys(read(documentId, storage)).length;
}

/**
 * Remove one marker's entry. Callers MUST only call this after a read-back of the
 * target cell confirms it now equals the assigned token (Codex R1) — this module does
 * not verify; it only records.
 */
export function clearWriteback(documentId, markerId, storage) {
  if (!documentId || !markerId) return false;
  const entries = read(documentId, storage);
  if (!(markerId in entries)) return true;
  delete entries[markerId];
  return write(documentId, entries, storage);
}

// Exposed for tests.
export const __testing = { KEY_PREFIX, read };
