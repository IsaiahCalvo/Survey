// Copy one stored PDF into a project (KAL-443).
//
// A copy has the same bytes as its source, so it gets the source's REAL
// content fingerprint (SHA-256 of the bytes) and lives at the same
// content-addressed storage object every normal upload uses
// ({user}/{sha}.pdf). It never invents a random "fingerprint".
//
// The database keeps one fingerprint per (user, project): the same bytes in
// the same project are one document. So when the destination already has
// these bytes there are two honest outcomes:
//   * a plain copy (keepBoth = false) is recognised as a duplicate exactly
//     like a normal upload: the existing document is returned, flagged
//     `reusedExisting`, and nothing new is made. Rollback must leave it alone
//     because this operation did not create it.
//   * an explicit Duplicate (keepBoth = true), or a copy into the project the
//     source already lives in, still makes the second document the person
//     asked for. It shares the real stored object but
//     carries no fingerprint, because the database allows only one per
//     project and the document already there holds it.
//
// Dependencies are passed in so this runs (and is tested) without Supabase.

import { computeContentSha256 } from '../services/contentHash.js';

export function copyNameFor(sourceName) {
  const name = sourceName || 'Untitled.pdf';
  const dot = name.toLowerCase().lastIndexOf('.pdf');
  return dot >= 0
    ? `${name.slice(0, dot)} (Copy)${name.slice(dot)}`
    : `${name} (Copy)`;
}

export async function copyDocumentToProject({
  source,
  projectId = null,
  operationId = null,
  keepBoth = false,
  download,
  upload,
  createDocument,
  hasSameBytesInProject,
  makeId = () => globalThis.crypto.randomUUID(),
}) {
  const filePath = source?.file_path || source?.filePath;
  if (!filePath) throw new Error(`Document "${source?.name || 'Untitled'}" has no stored PDF.`);
  const blob = await download(filePath);
  const contentSha = await computeContentSha256(new Uint8Array(await blob.arrayBuffer()));
  const copyName = copyNameFor(source.name);
  const copyFile = new File([blob], copyName, { type: blob.type || 'application/pdf' });

  // A batch copy supplies a stable id so a retry after a committed-but-lost
  // reply finds the same row. The storage object is idempotent on its own:
  // the same bytes always land at the same content-addressed path.
  const copyId = operationId || makeId();
  const uploadedPath = await upload(copyFile, projectId, contentSha);

  // Copying a document into the project it already lives in is a request
  // for a second document beside it, the same as Duplicate.
  const sameProject = (source.project_id ?? source.projectId ?? null) === (projectId ?? null);
  let fingerprint = contentSha;
  if ((keepBoth || sameProject) && await hasSameBytesInProject(contentSha, projectId)) fingerprint = null;

  let row;
  try {
    row = await createDocument({
      id: copyId,
      name: copyName,
      file_path: uploadedPath,
      file_size: blob.size,
      page_count: source.page_count ?? null,
      project_id: projectId,
      archived: false,
      content_sha256: fingerprint,
    });
  } catch (error) {
    // The row may have committed even though the response was lost. The batch
    // compensator reconciles this candidate by id; never remove its bytes here
    // based on the response alone.
    error.recoveryValue = { id: copyId, file_path: uploadedPath };
    throw error;
  }
  if (row && row.id !== copyId) return { ...row, reusedExisting: true };
  return row;
}

// Rollback guard: a copy that resolved to a document which already existed
// was not created by this operation, so undoing the operation must not
// delete it.
export const isReusedCopy = (value) => Boolean(value?.reusedExisting);
