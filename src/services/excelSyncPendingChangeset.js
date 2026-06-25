// src/services/excelSyncPendingChangeset.js
//
// KAL-309 (Codex round-3 finding #2): a durable, per-(document, workbook) record of the
// client_change_set_id of an Excel sync whose server-created Row-ID token writeback was left
// INCOMPLETE (the Edge committed the apply but could not durably persist every created-row
// token, so it withheld the writeback jobs + did not broadcast). The import handler RETURNS
// early in that case, which loses the in-memory clientChangeSetId — so a later "sync again"
// would mint a NEW id and submit a FRESH change-set instead of the idempotent REPLAY that
// completes the pending token persist.
//
// This store fixes that: on an incomplete writeback we persist { documentId, templateId,
// workbookId, clientChangeSetId }; on the next sync of the SAME workbook we REUSE the stored
// clientChangeSetId (so the Edge replays — F7 — and finishes the token persist); on a fully
// successful sync we clear it.
//
// Storage mirrors rowIdWritebackQueue / rowIdSecretStore: localStorage-backed, fail-safe,
// keyed per document. Keyed by documentId so a doc only ever has ONE pending descriptor;
// workbookId is stored + matched so a re-export (new workbook) never reuses a stale id.

const KEY_PREFIX = 'excelSyncPendingChangeset:';

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    return null; // privacy mode / sandboxed
  }
}

export function pendingKey(documentId) {
  if (!documentId) return null;
  return `${KEY_PREFIX}${documentId}`;
}

/**
 * Read the pending descriptor for a document, but ONLY when it matches the given workbook
 * (and template). A descriptor for a different/older workbook generation is ignored (and is
 * effectively stale — the caller should mint a fresh id). Returns null when absent/mismatched.
 *
 * @returns {{documentId, templateId, workbookId, clientChangeSetId, at} | null}
 */
export function readPendingChangeset({ documentId, templateId, workbookId }, storage) {
  const key = pendingKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.clientChangeSetId) return null;
    // A descriptor only applies to the SAME workbook (and template) — a re-export mints a new
    // workbook_id, and reusing a stale change-set id against it would be a fresh-vs-replay mix-up.
    if (workbookId != null && parsed.workbookId !== workbookId) return null;
    if (templateId != null && parsed.templateId != null && parsed.templateId !== templateId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist the pending descriptor for a document (overwrites any prior one — a doc has at most
 * one in-flight incomplete change-set). Best-effort: returns false on quota/unavailable.
 */
export function writePendingChangeset({ documentId, templateId, workbookId, clientChangeSetId }, storage) {
  const key = pendingKey(documentId);
  const store = getStorage(storage);
  if (!key || !store || !documentId || !clientChangeSetId) return false;
  try {
    store.setItem(key, JSON.stringify({
      documentId,
      templateId: templateId ?? null,
      workbookId: workbookId ?? null,
      clientChangeSetId,
      at: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Clear the pending descriptor for a document (call once the sync completes successfully). */
export function clearPendingChangeset(documentId, storage) {
  const key = pendingKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const __testing = { KEY_PREFIX };
