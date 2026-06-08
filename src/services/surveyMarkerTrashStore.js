// src/services/surveyMarkerTrashStore.js
//
// Durable persistence for the Survey Marker trash (Stage 2 recovery net). Holds
// a per-document map of tombstones so a deleted marker is recoverable across
// reloads. Mirrors excelSyncBaselineStore.js: localStorage-backed, graceful when
// storage is unavailable, and accepts an injected storage object for tests.
//
// NOTE: this is a per-device store — it is the deleting user's recovery net.
// Promoting the tombstone map into the Y.Doc or a Supabase table for shared,
// cross-device trash is a follow-up upgrade; this module's small surface
// (load/save/clear a tombstone map) is what that upgrade would re-implement.

const KEY_PREFIX = 'surveyMarkerTrash:';

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    return null;
  }
}

export function trashKey(pdfId) {
  if (!pdfId) return null;
  return `${KEY_PREFIX}${pdfId}`;
}

/** Load the tombstone map for a document, or {} when absent/unavailable. */
export function loadTrash(pdfId, storage) {
  const key = trashKey(pdfId);
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

/** Persist the tombstone map. No-op when key/storage unavailable. */
export function saveTrash(pdfId, tombstones, storage) {
  const key = trashKey(pdfId);
  const store = getStorage(storage);
  if (!key || !store) return;
  try {
    store.setItem(key, JSON.stringify(tombstones || {}));
  } catch {
    // quota / unavailable — non-fatal
  }
}

/** Remove the whole trash map for a document. */
export function clearTrash(pdfId, storage) {
  const key = trashKey(pdfId);
  const store = getStorage(storage);
  if (!key || !store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}
