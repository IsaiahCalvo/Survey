// src/services/documentFileReplace.js
//
// Saves a document's edited PDF bytes (page duplicate / delete / paste /
// reorder) without touching any OTHER document.
//
// Before this, uploads were stored at `<user>/<sha256>.pdf`, so the same file
// uploaded into two projects gave two `documents` rows on ONE storage object,
// and a page edit overwrote that object in place: the other document silently
// got the edited pages, and the edited row's content_sha256 no longer matched
// its bytes (stale KAL-267 dedup + thumbnail keys).
//
// Now:
//   * the object belongs to this row alone -> overwrite it in place;
//   * another row still uses it -> write the edited bytes to the row's own
//     object `<user>/<document id>.pdf` and move the row onto it with the
//     `fork_document_file` server function (documents.file_path is immutable
//     for clients). Until that function exists on the server (proposal:
//     supabase/proposed/20261013_fork_document_file.sql) the save falls back
//     to the old in-place write so page edits keep working;
//   * either way the row's content_sha256 is refreshed to the new bytes. If
//     another document in the same project already holds those exact bytes
//     (unique index documents_user_project_sha_uidx) the fingerprint is
//     cleared instead of left stale.
//
// Returns { filePath, contentSha256, forked }: the path the row now reads and
// the fingerprint of the saved bytes.

import { computeContentSha256 } from './contentHash.js';

const BUCKET = 'documents';
export const FORK_DOCUMENT_FILE_RPC = 'fork_document_file';

/** The object a document owns outright: named by its row id, not its bytes. */
export function ownDocumentObjectPath(userId, documentId) {
  return `${userId}/${documentId}.pdf`;
}

// PostgREST answers PGRST202 when the function is not in its schema cache;
// Postgres itself says 42883 (undefined_function).
function isMissingFunctionError(error) {
  const code = String(error?.code || '');
  return code === 'PGRST202' || code === '42883';
}

async function uploadPdf(client, path, file, onProgress) {
  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: 'application/pdf',
    onUploadProgress: onProgress,
  });
  if (error) throw error;
}

// Is any other row reading this object? A failed lookup counts as shared: an
// unneeded fork costs one extra object, a wrong "not shared" costs another
// document its pages.
async function objectIsShared(client, filePath, documentId) {
  const { data, error } = await client
    .from('documents')
    .select('id')
    .eq('file_path', filePath)
    .neq('id', documentId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[replaceDocumentFile] sharer check failed - treating the object as shared', error.message);
    return true;
  }
  return Boolean(data);
}

async function refreshFingerprint(client, documentId, sha) {
  const { error } = await client.from('documents').update({ content_sha256: sha }).eq('id', documentId);
  if (!error) return sha;
  if (error.code === '23505') {
    // These bytes are already another document in the same project.
    const { error: clearError } = await client.from('documents').update({ content_sha256: null }).eq('id', documentId);
    if (!clearError) return null;
    console.warn('[replaceDocumentFile] could not clear the fingerprint', clearError.message);
    return sha;
  }
  // The bytes are saved; a missed fingerprint only weakens dedup until the
  // next edit. Report the bytes' own hash so thumbnails still follow them.
  console.warn('[replaceDocumentFile] could not refresh the fingerprint', error.message);
  return sha;
}

export async function replaceDocumentFile({ client, userId, documentId, filePath, file, onProgress }) {
  if (!filePath) throw new Error('Document storage path is required');
  const sha = await computeContentSha256(new Uint8Array(await file.arrayBuffer()));

  const writeInPlace = async () => {
    await uploadPdf(client, filePath, file, onProgress);
    const contentSha256 = documentId ? await refreshFingerprint(client, documentId, sha) : sha;
    return { filePath, contentSha256, forked: false };
  };

  if (!documentId || !userId) return writeInPlace();
  const ownPath = ownDocumentObjectPath(userId, documentId);
  if (ownPath === filePath || !(await objectIsShared(client, filePath, documentId))) {
    return writeInPlace();
  }

  // Never write over an object some other row reads (the server refuses the
  // move then too, but only after the upload).
  if (await objectIsShared(client, ownPath, documentId)) {
    throw new Error('That storage object belongs to another document');
  }
  await uploadPdf(client, ownPath, file, onProgress);
  const { data, error } = await client.rpc(FORK_DOCUMENT_FILE_RPC, {
    p_document_id: documentId,
    p_content_sha256: sha,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return {
      filePath: row?.file_path || ownPath,
      contentSha256: row && 'content_sha256' in row ? row.content_sha256 : sha,
      forked: true,
    };
  }

  // Nothing reads the new object yet; don't leave it behind.
  const { error: removeError } = await client.storage.from(BUCKET).remove([ownPath]);
  if (removeError) console.warn('[replaceDocumentFile] could not remove the unused copy', removeError.message);
  if (isMissingFunctionError(error)) {
    console.warn(`[replaceDocumentFile] ${FORK_DOCUMENT_FILE_RPC} is not on the server yet - saving in place; documents sharing ${filePath} see this edit too`);
    return writeInPlace();
  }
  throw Object.assign(new Error(error.message || 'Could not move the document onto its own copy'), { code: error.code });
}
