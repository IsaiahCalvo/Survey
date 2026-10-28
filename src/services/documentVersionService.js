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
    throw new Error(error.message || 'Could not read the versions');
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
