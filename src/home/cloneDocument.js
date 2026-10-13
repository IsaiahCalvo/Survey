// src/home/cloneDocument.js
//
// KAL-443: copying a document into a project (Duplicate, Copy to project,
// Duplicate project) used to store the copy under a random id that only LOOKED
// like a content fingerprint (`{user}/{randomUUID}.pdf`) and left
// content_sha256 empty, so copies were invisible to duplicate detection
// (KAL-267) and mislabelled for the storage conversion tooling (KAL-281).
//
// A copy now carries the real fingerprint of its bytes, like every upload:
//   * the fingerprint is computed from the bytes actually copied (never trusted
//     from the source row — page edits change a stored file in place);
//   * the row goes through the same dedupe as a normal upload
//     (services/documentRowDedupe.js via the caller's createDocument). When the
//     destination already holds the same file, that document is reused and the
//     result is flagged `reusedExisting` — a rollback must never delete a
//     document the copy did not create;
//   * the bytes get the copy's OWN object, at a path that does not pretend to
//     be a content address: `{me}/{project|general}/copy-{copyId}.pdf` (the
//     conversion tooling reads this shape as "not converted yet", which is
//     true). The copy deliberately does not share the source's
//     `{owner}/{sha}.pdf` object: page edits (insert / delete / rotate) rewrite
//     a document's stored file IN PLACE, so a shared object would let editing
//     the original silently change the copy. The path is keyed by the copy's
//     stable id, so a retried batch overwrites the same object.
//
// Pure: storage, row creation and hashing are injected.

export const REUSED_EXISTING_FLAG = 'reusedExisting';

export function copyNameFor(sourceName) {
  const name = sourceName || 'Untitled.pdf';
  const dot = name.toLowerCase().lastIndexOf('.pdf');
  return dot >= 0
    ? `${name.slice(0, dot)} (Copy)${name.slice(dot)}`
    : `${name} (Copy)`;
}

/** The copy's own storage object (not a content address — see above). */
export const copyObjectPath = (userId, projectId, copyId) => (
  `${userId}/${projectId || 'general'}/copy-${copyId}.pdf`
);

/** True for a copy result that is an already-existing document (dedupe hit). */
export const isReusedCopy = (value) => value?.[REUSED_EXISTING_FLAG] === true;

/**
 * @param {{
 *   source: object,                 // the documents row being copied
 *   projectId: string|null,         // destination project
 *   operationId?: string|null,      // stable id from a batch (idempotent retry)
 *   userId: string,                 // the signed-in person (owner of the copy)
 *   download: (filePath: string) => Promise<Blob>,
 *   upload: (file: File, objectPath: string) => Promise<string>,  // upsert into own folder
 *   removeObject?: (objectPath: string) => Promise<void>,         // best-effort cleanup
 *   createDocument: (row: object) => Promise<object>,             // dedupe-aware create
 *   computeSha: (bytes: Uint8Array) => Promise<string>,
 *   makeId?: () => string,
 * }} args
 * @returns {Promise<object>} the copy's row; `reusedExisting: true` when the
 *   destination already had this file and that document was reused.
 */
export async function cloneDocumentIntoProject({
  source,
  projectId = null,
  operationId = null,
  userId,
  download,
  upload,
  removeObject = null,
  createDocument,
  computeSha,
  makeId = () => globalThis.crypto.randomUUID(),
}) {
  if (!userId) throw new Error('Please sign in to copy documents.');
  const sourcePath = source?.file_path || source?.filePath;
  if (!sourcePath) throw new Error(`Document "${source?.name || 'Untitled'}" has no stored PDF.`);

  const blob = await download(sourcePath);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentSha = await computeSha(bytes);
  const copyName = copyNameFor(source.name);

  // A batch copy supplies a stable UUID. The same key makes both the storage
  // upload and the documents insert idempotent after a committed-but-lost reply.
  const stableCopyId = operationId || makeId();
  const copyFile = new File([blob], copyName, { type: blob.type || 'application/pdf' });
  const uploadedPath = await upload(copyFile, copyObjectPath(userId, projectId, stableCopyId));

  let row;
  try {
    row = await createDocument({
      id: stableCopyId,
      name: copyName,
      file_path: uploadedPath,
      file_size: blob.size,
      page_count: source.page_count ?? null,
      project_id: projectId,
      archived: false,
      content_sha256: contentSha,
    });
  } catch (error) {
    // The row may have committed even though the response was lost. The batch
    // compensator reconciles this stable candidate by id; never remove its
    // bytes here based on the response alone.
    error.recoveryValue = { id: stableCopyId, file_path: uploadedPath };
    throw error;
  }
  if (!row?.id) throw new Error(`Could not copy "${source?.name || 'Untitled'}".`);
  if (row.id !== stableCopyId) {
    // The destination already had this file: the bytes just uploaded belong to
    // no row. Remove them (best effort — an orphan only costs space).
    if (typeof removeObject === 'function' && row.file_path !== uploadedPath) {
      try { await removeObject(uploadedPath); } catch { /* orphan only */ }
    }
    return { ...row, [REUSED_EXISTING_FLAG]: true };
  }
  return row;
}

/** Plain-English note for copies that landed on a document already there. */
export function describeReusedCopies(results, { projectName = null } = {}) {
  const reused = (Array.isArray(results) ? results : []).filter(isReusedCopy);
  if (reused.length === 0) return null;
  const where = projectName ? `“${projectName}”` : 'that project';
  if (reused.length === 1) {
    return `“${reused[0].name || 'This document'}” is already in ${where}, so no second copy was made.`;
  }
  return `${reused.length} of these files are already in ${where}, so no second copies were made.`;
}
