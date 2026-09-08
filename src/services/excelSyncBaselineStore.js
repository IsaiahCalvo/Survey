// src/services/excelSyncBaselineStore.js
//
// Durable persistence for the Excel-sync baseline fingerprint. The baseline is
// the hash captured the last time a survey was successfully synced to / imported
// from Excel; comparing the live fingerprint against it is how we know whether a
// survey has unsynced changes.
//
// Previously the baseline lived only in an in-memory ref, so every reload reset
// it to null and (fail-closed) every survey read as "not synced yet" even right
// after a successful sync. Persisting it per document + template keeps the
// synced/not-synced signal honest across reloads. We still FAIL CLOSED: if no
// baseline is stored, the survey is treated as having pending changes.

const KEY_PREFIX = 'excelSyncBaseline:';

export function excelBaselineScope(documentId, localId, userId) {
  const id = documentId || localId;
  return id ? JSON.stringify([userId || null, documentId ? 'cloud' : 'local', id]) : null;
}

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    // Accessing localStorage can throw (privacy mode, sandboxed iframe).
    return null;
  }
}

/**
 * Stable storage key for a (document, template) pair. Returns null when either
 * id is missing — callers must treat a null key as "no durable baseline".
 */
export function baselineKey(pdfId, templateId) {
  if (!pdfId || !templateId) return null;
  return `${KEY_PREFIX}${pdfId}::${templateId}`;
}

/** Load the stored baseline hash, or null when absent/unavailable. */
export function loadBaseline(pdfId, templateId, storage) {
  const key = baselineKey(pdfId, templateId);
  const store = getStorage(storage);
  if (!key || !store) return null;
  try {
    return store.getItem(key) || null;
  } catch {
    return null;
  }
}

/** Persist the baseline hash. No-op when the key or storage is unavailable. */
export function saveBaseline(pdfId, templateId, hash, storage) {
  const key = baselineKey(pdfId, templateId);
  const store = getStorage(storage);
  if (!key || !store || !hash) return;
  try {
    store.setItem(key, hash);
  } catch {
    // Quota / unavailable — non-fatal; we simply fail closed on next load.
  }
}

/** Remove the stored baseline (e.g. when an Excel link is cleared). */
export function clearBaseline(pdfId, templateId, storage) {
  const key = baselineKey(pdfId, templateId);
  const store = getStorage(storage);
  if (!key || !store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}
