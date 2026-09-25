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
// Persist { documentId, templateId, workbookId, clientChangeSetId } BEFORE sending;
// on the next sync of the SAME workbook we REUSE the stored
// clientChangeSetId (so the Edge replays — F7 — and finishes the token persist); on a fully
// successful sync we clear it.
//
// Storage mirrors rowIdWritebackQueue / rowIdSecretStore: localStorage-backed, fail-safe,
// keyed per document/template/workbook so separate workbook retries cannot overwrite
// each other. Legacy per-document descriptors remain readable for their exact scope.

import { computeContentSha256 } from './contentHash.js';

const KEY_PREFIX = 'excelSyncPendingChangeset:';

// Row-ID replay jobs carry indices from the original worksheet snapshot.
// Include physical row numbers too: these are custom array properties that
// ordinary JSON serialization would otherwise silently omit.
export async function fingerprintPendingWorksheets(worksheets = []) {
  const payload = worksheets.map(worksheet => ({
    ...worksheet,
    jsonData: Array.isArray(worksheet?.jsonData)
      ? worksheet.jsonData.map(row => ({ cells: row, sheetRowNumber: row?.sheetRowNumber ?? null }))
      : worksheet?.jsonData,
  }));
  const canonical = JSON.stringify(payload, (_key, value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
      : value
  ));
  return computeContentSha256(new TextEncoder().encode(canonical));
}

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    return null; // privacy mode / sandboxed
  }
}

export function pendingKey(documentId, templateId, workbookId) {
  if (!documentId) return null;
  if (templateId && workbookId) return `${KEY_PREFIX}v2:${JSON.stringify([documentId, templateId, workbookId])}`;
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
  const key = pendingKey(documentId, templateId, workbookId);
  const store = getStorage(storage);
  if (!key || !store) return null;
  try {
    const raw = store.getItem(key) || store.getItem(pendingKey(documentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.clientChangeSetId) return null;
    if (parsed.documentId !== documentId) return null;
    // A descriptor only applies to the SAME workbook (and template) — a re-export mints a new
    // workbook_id, and reusing a stale change-set id against it would be a fresh-vs-replay mix-up.
    if (workbookId != null && parsed.workbookId !== workbookId) return null;
    if (templateId != null && parsed.templateId !== templateId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist one pending attempt for this document/template/workbook.
 * Returns false on quota/unavailable; callers must stop before network writes.
 */
export function writePendingChangeset({ documentId, templateId, workbookId, clientChangeSetId, worksheetFingerprint = null }, storage) {
  const key = pendingKey(documentId, templateId, workbookId);
  const store = getStorage(storage);
  if (!key || !store || !documentId || !clientChangeSetId) return false;
  try {
    store.setItem(key, JSON.stringify({
      documentId,
      templateId: templateId ?? null,
      workbookId: workbookId ?? null,
      clientChangeSetId,
      worksheetFingerprint,
      at: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

/** Clear only this completed attempt; a late success cannot erase a newer retry. */
export function clearPendingChangeset(descriptor, storage) {
  const { documentId, templateId, workbookId, clientChangeSetId } = descriptor || {};
  const key = pendingKey(documentId, templateId, workbookId);
  const store = getStorage(storage);
  if (!key || !store) return false;
  try {
    for (const candidate of new Set([key, pendingKey(documentId)])) {
      const raw = store.getItem(candidate);
      if (!raw) continue;
      const pending = JSON.parse(raw);
      if (pending.documentId === documentId && pending.templateId === templateId
          && pending.workbookId === workbookId && pending.clientChangeSetId === clientChangeSetId) {
        store.removeItem(candidate);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const __testing = { KEY_PREFIX };
