// KAL-443 / KAL-440 reproduction on the in-memory Supabase stand-in.
// Runs the OLD code shape (copied from 6ccd16b9) next to the fixed helpers and
// prints what each leaves behind. No browser, no network, no real database.
//
//   node debug/scenarios/test-plan/kal443-440-repro.mjs
import { createHash } from 'node:crypto';

import { FakeBackend } from './tp-fake-backend.mjs';
import { createFakeSupabaseClient } from './tp-node-client.mjs';
import { cloneDocumentIntoProject } from '../../../src/home/cloneDocument.js';
import { createOrReuseDocumentRow } from '../../../src/services/documentRowDedupe.js';
import { computeContentSha256 } from '../../../src/services/contentHash.js';
import { deleteAnnotationRowsVerified } from '../../../src/services/annotationDeleteOutcome.js';

const OWNER = 'user-owner-a';
const EDITOR = 'user-editor-b';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const PDF = Buffer.from('%PDF-1.7\n% repro bytes\n%%EOF\n');
const sha = createHash('sha256').update(PDF).digest('hex');

function storageDeps(client, userId) {
  return {
    download: async (path) => {
      const { data, error } = await client.storage.from('documents').download(path);
      if (error) throw error;
      return data;
    },
    // useStorage.uploadDocument: `${user}/${contentSha}.pdf`, upsert.
    upload: async (file, _projectId, contentSha) => {
      const path = `${userId}/${contentSha}.pdf`;
      const { error } = await client.storage.from('documents').upload(path, file, { upsert: true });
      if (error) throw error;
      return path;
    },
    createDocument: async (row) => (await createOrReuseDocumentRow({ supabase: client, userId, documentData: row })).row,
  };
}

// The fixed copy's storage deps (Dashboard: uploadDocument with objectPath, deleteDocumentFile).
function fixedDeps(client, userId) {
  const { download, createDocument } = storageDeps(client, userId);
  return {
    download,
    createDocument,
    upload: async (file, path) => {
      const { error } = await client.storage.from('documents').upload(path, file, { upsert: true });
      if (error) throw error;
      return path;
    },
    removeObject: async (path) => { await client.storage.from('documents').remove([path]); },
  };
}

// src/Dashboard.jsx cloneDocumentToProject at 6ccd16b9 (inline, verbatim logic).
async function oldClone(deps, actualDoc, projectId) {
  const blob = await deps.download(actualDoc.file_path);
  const copyName = 'Site plan (Copy).pdf';
  const copyFile = new File([blob], copyName, { type: blob.type || 'application/pdf' });
  const stableCopyId = crypto.randomUUID();
  const uploadedPath = await deps.upload(copyFile, projectId, stableCopyId); // contentSha := random uuid
  return deps.createDocument({
    id: stableCopyId, name: copyName, file_path: uploadedPath, file_size: blob.size,
    page_count: actualDoc.page_count ?? null, project_id: projectId, archived: false,
  });
}

function freshBackend() {
  const backend = new FakeBackend({ documentId: DOC, ownerId: OWNER, storage: true });
  backend.tables.set('documents', []);
  backend.seedStorageObject(`${OWNER}/${sha}.pdf`, PDF);
  const source = {
    id: DOC, user_id: OWNER, name: 'Site plan.pdf', file_path: `${OWNER}/${sha}.pdf`,
    file_size: PDF.length, page_count: 2, project_id: P1, content_sha256: sha, archived: false,
  };
  backend.table('documents').push(source);
  return { backend, source };
}

const show = (label, rows) => console.log(label, JSON.stringify(rows.map((r) => ({
  id: r.id.slice(0, 8), project: r.project_id?.slice(0, 8), file_path: r.file_path.replace(OWNER, '<owner>'), content_sha256: r.content_sha256 ? `${r.content_sha256.slice(0, 12)}…` : null,
})), null, 1));

console.log('=== KAL-443: copy the same PDF into project 2, twice ===');
console.log('real sha256 of the bytes:', sha.slice(0, 12) + '…');
{
  const { backend, source } = freshBackend();
  const client = createFakeSupabaseClient(backend, { userId: OWNER });
  const deps = storageDeps(client, OWNER);
  await oldClone(deps, source, P2);
  await oldClone(deps, source, P2);
  show('BEFORE (6ccd16b9) rows in project 2:', backend.table('documents').filter((d) => d.project_id === P2));
  console.log('BEFORE storage objects:', [...backend.storageObjects.keys()].map((k) => k.replace(OWNER, '<owner>')));
}
{
  const { backend, source } = freshBackend();
  const client = createFakeSupabaseClient(backend, { userId: OWNER });
  const deps = fixedDeps(client, OWNER);
  const args = { source, projectId: P2, userId: OWNER, computeSha: computeContentSha256, ...deps };
  const a = await cloneDocumentIntoProject(args);
  const b = await cloneDocumentIntoProject(args);
  show('AFTER rows in project 2:', backend.table('documents').filter((d) => d.project_id === P2));
  console.log('AFTER second copy reusedExisting:', b.reusedExisting === true, '(same id as first:', a.id === b.id, ')');
  console.log('AFTER storage objects:', [...backend.storageObjects.keys()].map((k) => k.replace(OWNER, '<owner>')));
}

console.log('\n=== KAL-440: an editor deletes the owner\'s saved mark row ===');
for (const policy of ['author', 'role']) {
  const backend = new FakeBackend({ documentId: DOC, ownerId: OWNER, annotationWritePolicy: policy });
  backend.seedDocumentCollaborator({ userId: EDITOR, role: 'editor' });
  const seed = () => backend.table('document_annotations').push({
    id: crypto.randomUUID(), document_id: DOC, annotation_id: 'marker-by-owner', user_id: OWNER, annotation_type: 'survey-marker',
  });
  const editor = createFakeSupabaseClient(backend, { userId: EDITOR });
  seed();
  // documentAnnotationService.deleteAnnotations at 6ccd16b9.
  const { error } = await editor.from('document_annotations').delete().eq('document_id', DOC).in('annotation_id', ['marker-by-owner']);
  const oldSaysSuccess = !error;
  const leftAfterOld = backend.table('document_annotations').length;
  backend.tables.set('document_annotations', []);
  seed();
  const outcome = await deleteAnnotationRowsVerified({ supabase: editor, documentId: DOC, annotationIds: ['marker-by-owner'] });
  console.log(`policy=${policy === 'author' ? 'CURRENT (author match)' : 'PROPOSED (any editor)'}:`,
    `old helper reports success=${oldSaysSuccess}, rows left=${leftAfterOld};`,
    `new helper reports success=${outcome.success}, refused=${JSON.stringify(outcome.refusedIds)}, rows left=${backend.table('document_annotations').length}`);
}
