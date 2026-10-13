// KAL-443: copying a document into a project must write the REAL content
// fingerprint and give the copy its own stored object, so the copy is
// seen by the same duplicate check as a normal upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { copyDocumentToProject, copyNameFor, isReusedCopy } from '../src/home/copyDocumentToProject.js';
import { moveOrCopyDocumentsAtomically } from '../src/home/documentBatchOperations.js';

const USER = 'user-1';
const PDF = new TextEncoder().encode('%PDF-1.7 riser diagram bytes');
const OTHER_PDF = new TextEncoder().encode('%PDF-1.7 a different drawing');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// In-memory stand-in for the documents table + storage bucket. createDocument
// copies useDatabase.createDocument: look up the same bytes in the same
// (user, project) first and reuse that row; otherwise insert, and the unique
// (user, project, content_sha256) index refuses a second row.
function makeBackend() {
  const rows = [];
  const objects = new Map();
  const sameKey = (row, data) => row.user_id === USER
    && (row.project_id ?? null) === (data.project_id ?? null)
    && row.content_sha256 === data.content_sha256;
  const createDocument = async (data) => {
    if (data.content_sha256) {
      const existing = rows.find((row) => sameKey(row, data));
      if (existing) return existing;
    }
    if (data.content_sha256 && rows.some((row) => sameKey(row, data))) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    const row = { user_id: USER, ...data, id: data.id || `row-${rows.length + 1}` };
    rows.push(row);
    return row;
  };
  const upload = async (file, projectId, objectId) => {
    const path = `${USER}/${objectId}.pdf`;
    objects.set(path, new Uint8Array(await file.arrayBuffer()));
    return path;
  };
  const download = async (path) => new Blob([objects.get(path)], { type: 'application/pdf' });
  const hasSameBytesInProject = async (contentSha, projectId) => rows.some(
    (row) => sameKey(row, { project_id: projectId, content_sha256: contentSha }),
  );
  // A normal upload, the way Dashboard's upload path does it.
  const normalUpload = async (name, bytes, projectId) => {
    const contentSha = sha(bytes);
    const row = await createDocument({
      name, file_path: `${USER}/${contentSha}.pdf`, project_id: projectId, content_sha256: contentSha,
    });
    objects.set(row.file_path, bytes);
    return row;
  };
  let nextId = 0;
  const removeUpload = async (path) => { objects.delete(path); };
  const deps = {
    download, upload, createDocument, hasSameBytesInProject, removeUpload,
    makeId: () => `copy-${++nextId}`,
  };
  return { rows, objects, deps, normalUpload };
}

test('a copy into another project carries the real fingerprint and the real content path', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const copy = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-b' });

  assert.equal(copy.content_sha256, sha(PDF));
  assert.equal(copy.file_path, `${USER}/${copy.id}.pdf`, 'the copy has its own object');
  assert.notEqual(copy.file_path, source.file_path);
  assert.equal(copy.project_id, 'project-b');
  assert.equal(copy.name, 'Riser (Copy).pdf');
  // A page edit overwrites a document's own object in place; it must not
  // reach the original (PR #812's shared-object bug).
  backend.objects.set(copy.file_path, OTHER_PDF);
  assert.equal(sha(backend.objects.get(source.file_path)), sha(PDF));
  assert.equal(isReusedCopy(copy), false);
});

test('copying the same PDF twice into a project is caught by the normal duplicate check', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const first = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-b' });
  const second = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-b' });

  assert.equal(second.id, first.id);
  assert.equal(isReusedCopy(second), true);
  assert.equal(backend.rows.filter((row) => row.project_id === 'project-b').length, 1);
  assert.equal(backend.objects.has(`${USER}/${second.id}.pdf`), true, 'the first copy keeps its object');
  assert.equal(backend.objects.size, 2, 'the second copy left no orphan object behind');
});

test('a normal upload of the same bytes finds the copy, and a copy finds an upload', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const copy = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-b' });
  const upload = await backend.normalUpload('Riser again.pdf', PDF, 'project-b');
  assert.equal(upload.id, copy.id, 'the upload resolves to the copied document');

  const uploaded = await backend.normalUpload('Other.pdf', OTHER_PDF, 'project-c');
  const other = await backend.normalUpload('Other.pdf', OTHER_PDF, 'project-a');
  const copyIntoC = await copyDocumentToProject({ ...backend.deps, source: other, projectId: 'project-c' });
  assert.equal(copyIntoC.id, uploaded.id, 'the copy resolves to the uploaded document');
  assert.equal(isReusedCopy(copyIntoC), true);
});

test('an explicit Duplicate in the same project still makes a second document', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const dup = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-a', keepBoth: true });

  assert.notEqual(dup.id, source.id);
  assert.equal(isReusedCopy(dup), false);
  assert.equal(dup.file_path, `${USER}/${dup.id}.pdf`, 'its own object');
  assert.equal(dup.content_sha256, null, 'the database allows one fingerprint per project; the original holds it');
  assert.equal(backend.rows.filter((row) => row.project_id === 'project-a').length, 2);
});

test('a plain copy into the project the source lives in also makes a second document', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const copy = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-a' });
  assert.notEqual(copy.id, source.id);
  assert.equal(isReusedCopy(copy), false);
  assert.equal(copy.content_sha256, null);
  assert.equal(copy.file_path, `${USER}/${copy.id}.pdf`);
});

test('an explicit Duplicate into a project without those bytes gets the real fingerprint', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const dup = await copyDocumentToProject({ ...backend.deps, source, projectId: 'project-b', keepBoth: true });
  assert.equal(dup.content_sha256, sha(PDF));
});

test('a copy of a legacy document (fake path, no fingerprint) gets the real fingerprint', async () => {
  const backend = makeBackend();
  backend.objects.set(`${USER}/3f1c-random-uuid.pdf`, PDF);
  const legacy = { id: 'legacy', name: 'Old.pdf', file_path: `${USER}/3f1c-random-uuid.pdf`, project_id: 'project-a' };
  const copy = await copyDocumentToProject({ ...backend.deps, source: legacy, projectId: 'project-b' });
  assert.equal(copy.content_sha256, sha(PDF));
  assert.equal(copy.file_path, `${USER}/${copy.id}.pdf`);
});

test('a batch id stays the row id, and a lost reply leaves a recovery value on the real path', async () => {
  const backend = makeBackend();
  const source = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const copy = await copyDocumentToProject({
    ...backend.deps, source, projectId: 'project-b', operationId: 'op-1',
  });
  assert.equal(copy.id, 'op-1');

  const lost = Object.assign(new Error('network'), {});
  await assert.rejects(copyDocumentToProject({
    ...backend.deps, source, projectId: 'project-c', operationId: 'op-2',
    createDocument: async () => { throw lost; },
  }), (error) => {
    assert.deepEqual(error.recoveryValue, { id: 'op-2', file_path: `${USER}/op-2.pdf` });
    return true;
  });
});

test('undoing a failed batch never deletes a document that was already there', async () => {
  const backend = makeBackend();
  const kept = await backend.normalUpload('Riser.pdf', PDF, 'dest');
  const a = await backend.normalUpload('Riser.pdf', PDF, 'project-a');
  const b = await backend.normalUpload('Other.pdf', OTHER_PDF, 'project-a');
  let calls = 0;
  const copyDocument = async (document, projectId, item) => {
    calls += 1;
    if (calls === 2) throw new Error('copy failed');
    return copyDocumentToProject({ ...backend.deps, source: document, projectId, operationId: item.operationId });
  };
  const removed = [];
  // Mirrors Dashboard.rollbackClonedDocument.
  const rollbackCopy = async (created) => {
    if (!created?.id || isReusedCopy(created)) return;
    removed.push(created.id);
  };
  await assert.rejects(moveOrCopyDocumentsAtomically({
    documents: [a, b], projectId: 'dest', mode: 'copy', copyDocument, rollbackCopy,
    moveDocument: async () => {}, rollbackMove: async () => {},
    readDocument: async () => null, makeOperationId: () => `op-${calls}-${Math.random()}`,
  }), /copy failed/);
  assert.equal(removed.includes(kept.id), false, 'the document already in dest survives the undo');
});

test('copy names keep the .pdf ending', () => {
  assert.equal(copyNameFor('Riser.PDF'), 'Riser (Copy).PDF');
  assert.equal(copyNameFor('notes'), 'notes (Copy)');
  assert.equal(copyNameFor(''), 'Untitled (Copy).pdf');
});

test('Dashboard copies through the real-fingerprint helper, never a random fingerprint', () => {
  const dashboard = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const start = dashboard.indexOf('const cloneDocumentToProject');
  const end = dashboard.indexOf('const rollbackClonedDocuments');
  const body = dashboard.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(body, /copyDocumentToProject\(/);
  assert.doesNotMatch(body, /randomUUID/);
  assert.match(body, /isReusedCopy\(created\)/, 'rollback skips a copy that resolved to an existing document');
});
