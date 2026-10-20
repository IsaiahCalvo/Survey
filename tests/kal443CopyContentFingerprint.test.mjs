// KAL-443: copying a document into a project must write the REAL content
// fingerprint of the copied bytes and go through the same duplicate check as
// a normal upload (KAL-267). Driven against the in-memory Supabase stand-in
// the test-plan specs use (debug/scenarios/test-plan/tp-fake-backend.mjs),
// which mirrors the documents unique content-hash index and the storage
// own-folder rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FakeBackend } from '../debug/scenarios/test-plan/tp-fake-backend.mjs';
import { createFakeSupabaseClient } from '../debug/scenarios/test-plan/tp-node-client.mjs';
import {
  cloneDocumentIntoProject,
  copyNameFor,
  copyObjectPath,
  describeReusedCopies,
  isReusedCopy,
} from '../src/home/cloneDocument.js';
import { createOrReuseDocumentRow } from '../src/services/documentRowDedupe.js';
import { computeContentSha256 } from '../src/services/contentHash.js';
import { moveOrCopyDocumentsAtomically } from '../src/home/documentBatchOperations.js';

const OWNER = 'user-owner-a';
const EDITOR = 'user-editor-b';
const PROJECT_1 = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const PDF = Buffer.from('%PDF-1.7\n% KAL-443 fixture bytes\n%%EOF\n');
const PDF_EDITED = Buffer.from('%PDF-1.7\n% KAL-443 fixture bytes, a page added\n%%EOF\n');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

let opCounter = 0;
const nextOp = () => {
  opCounter += 1;
  return `44444444-4444-4444-8444-${String(opCounter).padStart(12, '0')}`;
};

// The app's own pieces, wired to the stand-in: download/upload the way
// useStorage does (content path, idempotent upsert), rows through the SAME
// dedupe function the useDocuments hook uses for uploads.
function appFor(backend, userId) {
  const client = createFakeSupabaseClient(backend, { userId });
  const uploads = [];
  return {
    client,
    uploads,
    copy: (source, projectId, operationId = nextOp()) => cloneDocumentIntoProject({
      source,
      projectId,
      operationId,
      userId,
      download: async (path) => {
        const { data, error } = await client.storage.from('documents').download(path);
        if (error) throw error;
        return data;
      },
      upload: async (file, path) => {
        const { error } = await client.storage.from('documents').upload(path, file, { upsert: true });
        if (error) throw error;
        uploads.push(path);
        return path;
      },
      removeObject: async (path) => {
        const { error } = await client.storage.from('documents').remove([path]);
        if (error) throw error;
      },
      createDocument: async (row) => (
        await createOrReuseDocumentRow({ supabase: client, userId, documentData: row })
      ).row,
      computeSha: computeContentSha256,
    }),
  };
}

function seedSource(backend, { bytes = PDF, path, contentSha = sha(bytes), projectId = PROJECT_1, ownerId = OWNER, id = SOURCE_ID } = {}) {
  const filePath = path || `${ownerId}/${sha(bytes)}.pdf`;
  backend.seedStorageObject(filePath, bytes);
  const row = {
    id, user_id: ownerId, name: 'Site plan.pdf', file_path: filePath, file_size: bytes.length,
    page_count: 3, project_id: projectId, content_sha256: contentSha, archived: false,
    created_at: '2026-10-01T00:00:00.000Z',
  };
  backend.table('documents').push(row);
  return row;
}

const rowsIn = (backend, projectId) => backend.table('documents').filter((d) => d.project_id === projectId);
const storedBytes = (backend, path) => backend.objectBytes(path);

test('a copy into another project carries the real fingerprint of its bytes (no fake path)', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const app = appFor(backend, OWNER);

  const copy = await app.copy(source, PROJECT_2, 'op-first');

  assert.equal(copy.content_sha256, sha(PDF), 'content_sha256 is the hash of the copied bytes');
  assert.equal(copy.file_path, copyObjectPath(OWNER, 'op-first'));
  assert.equal(copy.file_path, `${OWNER}/op-first.pdf`, 'its own object, named by its row id (not a content address)');
  assert.equal(copy.project_id, PROJECT_2);
  assert.equal(copy.name, 'Site plan (Copy).pdf');
  assert.equal(isReusedCopy(copy), false);
  assert.deepEqual(storedBytes(backend, copy.file_path), PDF);
});

test('editing the original in place never changes the copy (they do not share a stored file)', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const app = appFor(backend, OWNER);
  const copy = await app.copy(source, PROJECT_2);
  // Page edits rewrite the original's own object (AppShell.handleUpdatePDFFile).
  backend.seedStorageObject(source.file_path, PDF_EDITED);
  assert.deepEqual(storedBytes(backend, copy.file_path), PDF);
});

test('copying the same PDF twice into a project is recognised as a duplicate (same rule as upload)', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const app = appFor(backend, OWNER);

  const first = await app.copy(source, PROJECT_2);
  const second = await app.copy(source, PROJECT_2);

  assert.equal(second.id, first.id, 'the second copy reuses the first');
  assert.equal(isReusedCopy(second), true);
  assert.equal(rowsIn(backend, PROJECT_2).length, 1, 'no pile-up in the destination');
  assert.equal(app.uploads.length, 2);
  assert.equal(storedBytes(backend, app.uploads[1]), null, "the repeat's unused bytes are removed again");
  assert.equal(backend.storageObjects.size, 2, 'the original and the one copy');

  // ...and an UPLOAD of the same bytes into that project lands on the same row.
  const uploaded = await createOrReuseDocumentRow({
    supabase: app.client,
    userId: OWNER,
    documentData: {
      name: 'Site plan.pdf', file_path: `${OWNER}/${sha(PDF)}.pdf`, project_id: PROJECT_2, content_sha256: sha(PDF),
    },
  });
  assert.equal(uploaded.reused, true);
  assert.equal(uploaded.row.id, first.id);
});

test('Duplicate inside the same project still makes a real second copy (own object, outside the duplicate check)', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const app = appFor(backend, OWNER);

  const copy = await app.copy(source, PROJECT_1, 'op-dup');
  assert.notEqual(copy.id, source.id, 'a new document, not the original');
  assert.equal(isReusedCopy(copy), false);
  assert.equal(copy.name, 'Site plan (Copy).pdf');
  assert.equal(copy.content_sha256 ?? null, null, 'the one fingerprinted row per file per project stays the original');
  assert.equal(copy.file_path, `${OWNER}/op-dup.pdf`, 'its own object, not a fake content address');
  assert.deepEqual(storedBytes(backend, copy.file_path), PDF);
  assert.equal(rowsIn(backend, PROJECT_1).length, 2);

  // A second Duplicate makes a third document; an upload of the same file
  // still lands on the original.
  const again = await app.copy(source, PROJECT_1, 'op-dup-2');
  assert.notEqual(again.id, copy.id);
  assert.equal(rowsIn(backend, PROJECT_1).length, 3);
  const uploaded = await createOrReuseDocumentRow({
    supabase: app.client,
    userId: OWNER,
    documentData: { name: 'Site plan.pdf', file_path: source.file_path, project_id: PROJECT_1, content_sha256: sha(PDF) },
  });
  assert.equal(uploaded.reused, true);
  assert.equal(uploaded.row.id, source.id);
});

test('a legacy source without a fingerprint gives a copy with its real fingerprint', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend, { path: `${OWNER}/general/1779028738489.pdf`, contentSha: null });
  const app = appFor(backend, OWNER);

  const copy = await app.copy(source, PROJECT_2);
  assert.equal(copy.content_sha256, sha(PDF));
  assert.deepEqual(storedBytes(backend, copy.file_path), PDF);
});

test('a file changed in place after upload (page edits) is fingerprinted from its CURRENT bytes', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  // The row still names the original hash, but the stored object holds edited bytes.
  const source = seedSource(backend, { bytes: PDF_EDITED, path: `${OWNER}/${sha(PDF)}.pdf`, contentSha: sha(PDF) });
  const app = appFor(backend, OWNER);

  const copy = await app.copy(source, PROJECT_2);
  assert.equal(copy.content_sha256, sha(PDF_EDITED));
  assert.deepEqual(storedBytes(backend, copy.file_path), PDF_EDITED);
});

test("an editor copying a teammate's shared document gets their own copy in their own folder", async () => {
  const backend = new FakeBackend({ documentId: SOURCE_ID, ownerId: OWNER, storage: true });
  backend.tables.set('documents', []);
  const source = seedSource(backend);
  backend.seedDocumentCollaborator({ userId: EDITOR, role: 'editor' });
  const app = appFor(backend, EDITOR);

  const copy = await app.copy(source, PROJECT_2, 'op-editor');
  assert.equal(copy.user_id, EDITOR);
  assert.equal(copy.file_path, `${EDITOR}/op-editor.pdf`);
  assert.equal(copy.content_sha256, sha(PDF));
});

test("a failed row create hands the copy's own bytes to cleanup, keyed by the stable id", async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const error = await cloneDocumentIntoProject({
    source,
    projectId: PROJECT_2,
    operationId: 'op-lost',
    userId: OWNER,
    download: async () => new Blob([storedBytes(backend, source.file_path)]),
    upload: async (_file, path) => path,
    createDocument: async () => { throw new Error('reply lost'); },
    computeSha: computeContentSha256,
  }).catch((e) => e);
  assert.deepEqual(error.recoveryValue, { id: 'op-lost', file_path: `${OWNER}/op-lost.pdf` });
  assert.notEqual(error.recoveryValue.file_path, source.file_path, "the original's object is never offered for deletion");
});

test('rolling back a copy batch never deletes a document the copy only landed on', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const other = seedSource(backend, { id: 'other-source', bytes: PDF_EDITED });
  const app = appFor(backend, OWNER);
  // Project 2 already holds the first file.
  const existing = await app.copy(source, PROJECT_2);

  const deleted = [];
  const rollbackCopy = async (created) => {
    // Dashboard.rollbackClonedDocument's rule.
    if (isReusedCopy(created)) return;
    deleted.push(created.id);
  };
  let calls = 0;
  await assert.rejects(moveOrCopyDocumentsAtomically({
    documents: [source, other],
    projectId: PROJECT_2,
    mode: 'copy',
    copyDocument: async (document, projectId, item) => {
      calls += 1;
      if (calls === 2) throw new Error('second copy failed');
      return app.copy(document, projectId, item.operationId);
    },
    rollbackCopy,
    readDocument: async () => null,
  }));
  assert.deepEqual(deleted, [], 'the pre-existing document survives the rollback');
  assert.ok(backend.table('documents').some((d) => d.id === existing.id));

  const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const rollback = dashboard.slice(dashboard.indexOf('const rollbackClonedDocument = async'));
  assert.match(rollback.slice(0, 400), /if \(isReusedCopy\(created\)\) return;/);
});

test('the dashboard copy path no longer invents a fingerprint', () => {
  const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const clone = dashboard.slice(
    dashboard.indexOf('const cloneDocumentToProject = async'),
    dashboard.indexOf('const rollbackClonedDocument = async'),
  );
  assert.match(clone, /cloneDocumentIntoProject\(/);
  assert.match(clone, /computeSha: computeContentSha256/);
  assert.doesNotMatch(clone, /randomUUID/);
});

test('copy names and the plain-English note', () => {
  assert.equal(copyNameFor('Plan.PDF'), 'Plan (Copy).PDF');
  assert.equal(copyNameFor('notes'), 'notes (Copy)');
  assert.equal(describeReusedCopies([{ id: 'a' }]), null);
  assert.equal(
    describeReusedCopies([{ id: 'a', name: 'A.pdf', reusedExisting: true }]),
    '“A.pdf” is already in that project, so no second copy was made.',
  );
  assert.equal(
    describeReusedCopies([{ reusedExisting: true }, { reusedExisting: true }], { projectName: 'P' }),
    '2 of these files are already in “P”, so no second copies were made.',
  );
});

// Bugbot on #817: a dedupe hit on a row the person moved to Archive
// (user_archived_at) must bring that document back to Documents, not land
// silently on the hidden row. The unique content-hash index covers archived
// rows too, so a second row cannot be made beside it; restore is the answer.
const archiveRow = (row, extra = {}) => Object.assign(row, {
  user_archived_at: '2026-10-10T00:00:00.000Z',
  user_archive_expires_at: '2026-11-09T00:00:00.000Z',
  user_archived_by: row.user_id,
  archive_group_id: null,
  ...extra,
});

test('an upload of a PDF that sits in Archive restores that document to Documents', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  archiveRow(source);
  const app = appFor(backend, OWNER);

  const uploaded = await createOrReuseDocumentRow({
    supabase: app.client,
    userId: OWNER,
    documentData: { name: 'Site plan.pdf', file_path: source.file_path, project_id: PROJECT_1, content_sha256: sha(PDF) },
  });
  assert.equal(uploaded.reused, true);
  assert.equal(uploaded.row.id, source.id, 'still one document per file per project');
  assert.equal(uploaded.row.user_archived_at, null, 'the returned row is live');
  const stored = backend.table('documents').find((d) => d.id === source.id);
  assert.equal(stored.user_archived_at, null, 'out of Archive in the database');
  assert.equal(stored.user_archive_expires_at, null, 'and off the purge schedule');
  assert.equal(rowsIn(backend, PROJECT_1).length, 1);
});

test('a copy onto a PDF that sits in Archive in the destination restores it there', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  const app = appFor(backend, OWNER);
  const first = await app.copy(source, PROJECT_2);
  archiveRow(backend.table('documents').find((d) => d.id === first.id));

  const second = await app.copy(source, PROJECT_2);
  assert.equal(second.id, first.id);
  assert.equal(isReusedCopy(second), true);
  assert.equal(second.user_archived_at, null);
  assert.equal(backend.table('documents').find((d) => d.id === first.id).user_archived_at, null,
    'the copy shows up in the project again');
  assert.equal(rowsIn(backend, PROJECT_2).length, 1);
});

test('a dedupe hit inside an archived project is refused, never landed on silently', async () => {
  const backend = new FakeBackend({ documentId: 'unused-doc', ownerId: OWNER, storage: true });
  const source = seedSource(backend);
  archiveRow(source, { archive_group_id: 'group-1' });
  const app = appFor(backend, OWNER);
  await assert.rejects(
    createOrReuseDocumentRow({
      supabase: app.client,
      userId: OWNER,
      documentData: { name: 'Site plan.pdf', file_path: source.file_path, project_id: PROJECT_1, content_sha256: sha(PDF) },
    }),
    (error) => error.reason === 'project_child',
  );
  assert.ok(backend.table('documents').find((d) => d.id === source.id).user_archived_at, 'left in Archive');
});
