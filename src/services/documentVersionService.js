// src/services/documentVersionService.js
//
// Version history (Nightly, flag 'document-versions'; migration
// 20261028010000_document_versions.sql). "Upload as new version" points the
// old copy at the new one (supersede_document) instead of archiving it, so
// the old copy leaves the lists but stays openable as an older version.

export const SUPERSEDE_DOCUMENT_RPC = 'supersede_document';
export const DOCUMENT_VERSIONS_RPC = 'document_versions';
// Fired on window after a supersede, so an open viewer re-reads its versions.
export const DOCUMENT_VERSIONS_CHANGED_EVENT = 'survey:document-versions-changed';

// PostgREST answers PGRST202 when the function is not in its schema cache;
// Postgres itself says 42883 (undefined_function).
export function isMissingFunctionError(error) {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883';
}

/**
 * Mark `oldDocumentId` as replaced by `newDocumentId`. Resolves to
 * 'superseded', or 'unsupported' on a server without the function (the
 * caller then archives the old copy as before). Throws on any other error.
 */
export async function supersedeDocument(client, oldDocumentId, newDocumentId) {
  const { error } = await client.rpc(SUPERSEDE_DOCUMENT_RPC, {
    p_old_document_id: oldDocumentId,
    p_new_document_id: newDocumentId,
  });
  if (!error) {
    try {
      globalThis.dispatchEvent?.(new CustomEvent(DOCUMENT_VERSIONS_CHANGED_EVENT, { detail: { oldDocumentId, newDocumentId } }));
    } catch {
      // No DOM events here (tests).
    }
    return 'superseded';
  }
  if (isMissingFunctionError(error)) return 'unsupported';
  throw new Error(error.message || 'Could not keep the old version');
}

/** The version chain a document belongs to, oldest first: [{ id, name, createdAt, pageCount, versionNumber, isCurrent }]. */
export async function listDocumentVersions(client, documentId) {
  if (!documentId) return [];
  const { data, error } = await client.rpc(DOCUMENT_VERSIONS_RPC, { p_document_id: documentId });
  if (error) {
    if (isMissingFunctionError(error)) return [];
    const err = new Error(error.message || 'Could not read the versions');
    err.code = error.code;
    throw err;
  }
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    pageCount: row.page_count,
    versionNumber: row.version_number,
    isCurrent: row.is_current === true,
  }));
}

/** The version just before `documentId` in its chain, or null. */
export function previousVersion(versions, documentId) {
  const index = (versions || []).findIndex((v) => v.id === documentId);
  return index > 0 ? versions[index - 1] : null;
}

// Delete one version (Nightly, flag 'version-delete'; migration
// 20261112140000_version_delete.sql). The version goes to the Archive and
// the chain closes over the gap; the receipt lets Undo put it back.
export const REMOVE_DOCUMENT_VERSION_RPC = 'remove_document_version';
export const RESTORE_DOCUMENT_VERSION_RPC = 'restore_document_version';

function versionsChanged(detail) {
  try {
    globalThis.dispatchEvent?.(new CustomEvent(DOCUMENT_VERSIONS_CHANGED_EVENT, { detail }));
  } catch {
    // No DOM events here (tests).
  }
}

/** The server's words for the person, else a plain fallback. */
export function versionDeleteErrorText(error) {
  if (String(error?.code || '') === '42501') return 'Only the uploader or the project owner can delete this version.';
  const text = String(error?.message || '');
  if (/only version|already deleted|changed since/i.test(text)) return text;
  return 'That version couldn’t be deleted. Check your connection and try again.';
}

/**
 * Take one version out of its chain. Resolves to the receipt
 * { documentId, previous: [ids], next: id | null, current: id | null }:
 * `current` is the copy that is current again when the latest was removed.
 */
export async function removeDocumentVersion(client, documentId) {
  const { data, error } = await client.rpc(REMOVE_DOCUMENT_VERSION_RPC, { p_document_id: documentId });
  if (error) {
    const err = new Error(versionDeleteErrorText(error));
    err.code = error.code;
    throw err;
  }
  const receipt = {
    documentId,
    previous: Array.isArray(data?.previous) ? data.previous : [],
    next: data?.next || null,
    current: data?.current || null,
  };
  versionsChanged({ oldDocumentId: documentId, newDocumentId: receipt.current || receipt.next || receipt.previous[0] || null, removed: receipt });
  return receipt;
}

/** Undo: put the version back where the receipt says it was. */
export async function restoreDocumentVersion(client, receipt) {
  // The server puts back what it recorded at the delete; the receipt's chain
  // ids are only for this screen.
  const { error } = await client.rpc(RESTORE_DOCUMENT_VERSION_RPC, { p_document_id: receipt.documentId });
  if (error) {
    const err = new Error(versionDeleteErrorText(error));
    err.code = error.code;
    throw err;
  }
  versionsChanged({ oldDocumentId: receipt.current || receipt.previous[0] || null, newDocumentId: receipt.documentId, restored: receipt });
}

/** The toast after a delete: "Deleted v3. v2 is current again." */
export function versionDeletedText(versions, receipt) {
  const number = (id) => (versions || []).find((v) => v.id === id)?.versionNumber;
  const gone = number(receipt?.documentId);
  const back = receipt?.current ? number(receipt.current) : null;
  const head = gone ? `Deleted v${gone}.` : 'Deleted that version.';
  return back ? `${head} v${back} is current again.` : head;
}

/** Stands for "deleted" where a chain link would name the newer copy. */
export const DELETED_VERSION = 'deleted';

/**
 * Where each copy points after a version change, from the changed-event
 * detail: { [documentId]: supersededBy | null }. A delete, its Undo and an
 * upload as a new version all say. An open tab keeps the superseded_by its
 * file was opened with, so the shell reads these first.
 */
export function chainLinksAfter(detail) {
  const links = {};
  const removed = detail?.removed;
  const restored = detail?.restored;
  if (removed?.documentId) {
    for (const id of removed.previous || []) links[id] = removed.next || null;
    // The deleted copy is in the Archive: a tab still showing it stays read-only.
    links[removed.documentId] = DELETED_VERSION;
  } else if (restored?.documentId) {
    for (const id of restored.previous || []) links[id] = restored.documentId;
    links[restored.documentId] = restored.next || null;
  } else if (detail?.oldDocumentId && detail?.newDocumentId && detail.oldDocumentId !== detail.newDocumentId) {
    links[detail.oldDocumentId] = detail.newDocumentId;
    links[detail.newDocumentId] = null;
  }
  return links;
}

/**
 * The shell's record of which open copies a newer one replaced (or that were
 * deleted): the latest word wins, whether it came from a version change or a
 * fresh versions list (`fromList`), except that a list never makes a deleted
 * copy writable again.
 * Returns `chain` unchanged when nothing differs.
 */
export function withChainLinks(chain, links, { fromList = false } = {}) {
  let next = chain;
  for (const [id, supersededBy] of Object.entries(links || {})) {
    const value = supersededBy === DELETED_VERSION ? DELETED_VERSION : Boolean(supersededBy);
    // A versions list can't bring a deleted copy back; only its Undo can.
    if (fromList && next[id] === DELETED_VERSION && value === false) continue;
    if (next[id] === value) continue;
    if (next === chain) next = { ...chain };
    next[id] = value;
  }
  return next;
}

/** A newer copy replaced this file: read-only with the older-version bar. */
export function isFileSuperseded(file, chain) {
  const id = file?.id;
  if (!id) return false;
  if (chain && Object.prototype.hasOwnProperty.call(chain, id)) return chain[id] === true || chain[id] === DELETED_VERSION;
  return Boolean(file.superseded_by);
}
