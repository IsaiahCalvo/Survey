// Page edits on a document whose storage object another document shares.
//
// Uploads used to be stored at `<user>/<sha256>.pdf`, so the same file uploaded
// into two projects gave two documents rows on ONE object, and a page edit
// (duplicate / delete / paste / reorder) overwrote that object in place: the
// other document silently got the edited pages, and the edited row's
// content_sha256 went stale. These tests run the app's save path
// (src/services/documentFileReplace.js, what useStorage().replaceDocument
// calls) through real supabase-js against the in-memory backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

import { FakeBackend } from '../debug/scenarios/test-plan/tp-fake-backend.mjs';
import { createNodeClient } from '../debug/scenarios/test-plan/tp-node-client.mjs';
import { replaceDocumentFile, ownDocumentObjectPath } from '../src/services/documentFileReplace.js';
import { mutatePdfPages } from '../src/utils/pdfPageMutation.js';
import { computeContentSha256 } from '../src/services/contentHash.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DOC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROJECT_1 = '00000000-0000-4000-8000-000000000001';
const PROJECT_2 = '00000000-0000-4000-8000-000000000002';

async function pdfWithPages(count) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) pdf.addPage([200 + i, 300]);
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function pageCount(bytes) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

const sha = (bytes) => computeContentSha256(new Uint8Array(bytes));
const pdfFile = (bytes, name = 'plan.pdf') => new File([bytes], name, { type: 'application/pdf' });

async function downloadBytes(client, path) {
  const { data, error } = await client.storage.from('documents').download(path);
  assert.equal(error, null, `download ${path}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function row(client, id) {
  const { data, error } = await client.from('documents').select('*').eq('id', id).single();
  assert.equal(error, null);
  return data;
}

// The same 3-page file uploaded into two projects the old way: two rows, one object.
async function sharedSetup(options = {}) {
  const backend = new FakeBackend({ documentId: DOC_A, ownerId: OWNER, storage: true, ...options });
  backend.tables.set('documents', []);
  const original = await pdfWithPages(3);
  const originalSha = await sha(original);
  const sharedPath = `${OWNER}/${originalSha}.pdf`;
  backend.putObject(sharedPath, original);
  backend.table('documents').push(
    { id: DOC_A, user_id: OWNER, project_id: PROJECT_1, name: 'plan.pdf', file_path: sharedPath, content_sha256: originalSha },
    { id: DOC_B, user_id: OWNER, project_id: PROJECT_2, name: 'plan.pdf', file_path: sharedPath, content_sha256: originalSha },
  );
  return { backend, client: createNodeClient(backend), original, originalSha, sharedPath };
}

test('a page edit on one document leaves the other document sharing its object alone', async () => {
  const { backend, client, original, originalSha, sharedPath } = await sharedSetup();
  const edited = await mutatePdfPages(original, { type: 'delete', page: 2 });
  assert.equal(await pageCount(edited), 2);

  const saved = await replaceDocumentFile({
    client, userId: OWNER, documentId: DOC_A, filePath: sharedPath, file: pdfFile(edited),
  });

  // Document B: same object, same bytes, same fingerprint as before the edit.
  const b = await row(client, DOC_B);
  assert.equal(b.file_path, sharedPath);
  assert.equal(b.content_sha256, originalSha);
  const bBytes = await downloadBytes(client, b.file_path);
  assert.deepEqual(bBytes, original);
  assert.equal(await pageCount(bBytes), 3);

  // Document A: moved onto its own object, which holds the edit, and its
  // fingerprint matches what is stored.
  const a = await row(client, DOC_A);
  assert.equal(saved.forked, true);
  assert.equal(a.file_path, ownDocumentObjectPath(OWNER, DOC_A));
  assert.equal(saved.filePath, a.file_path);
  const aBytes = await downloadBytes(client, a.file_path);
  assert.equal(await pageCount(aBytes), 2);
  assert.equal(a.content_sha256, await sha(aBytes));
  assert.equal(saved.contentSha256, a.content_sha256);
  assert.ok(backend.objectBytes(sharedPath), 'the shared object stays for B');
});

test('a second edit after the fork writes in place on the document\'s own object', async () => {
  const { client, original, sharedPath } = await sharedSetup();
  const first = await mutatePdfPages(original, { type: 'delete', page: 3 });
  const saved1 = await replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: sharedPath, file: pdfFile(first) });
  const second = await mutatePdfPages(first, { type: 'duplicate', page: 1 });
  const saved2 = await replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: saved1.filePath, file: pdfFile(second) });

  assert.equal(saved2.forked, false);
  assert.equal(saved2.filePath, saved1.filePath);
  const a = await row(client, DOC_A);
  const aBytes = await downloadBytes(client, a.file_path);
  assert.equal(await pageCount(aBytes), 3);
  assert.equal(a.content_sha256, await sha(aBytes));
  assert.deepEqual(await downloadBytes(client, sharedPath), original, 'B still reads the untouched original');
});

test('an unshared document is edited in place and its fingerprint follows the bytes', async () => {
  const backend = new FakeBackend({ documentId: DOC_A, ownerId: OWNER, storage: true });
  backend.tables.set('documents', []);
  const client = createNodeClient(backend);
  const original = await pdfWithPages(2);
  const path = ownDocumentObjectPath(OWNER, DOC_A);
  backend.putObject(path, original);
  backend.table('documents').push({ id: DOC_A, user_id: OWNER, project_id: PROJECT_1, file_path: path, content_sha256: await sha(original) });

  const edited = await mutatePdfPages(original, { type: 'insert', afterPage: 1 });
  const saved = await replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: path, file: pdfFile(edited) });

  assert.equal(saved.forked, false);
  const a = await row(client, DOC_A);
  assert.equal(a.file_path, path);
  const stored = await downloadBytes(client, path);
  assert.equal(await pageCount(stored), 3);
  assert.equal(a.content_sha256, await sha(stored));
  assert.equal(saved.contentSha256, a.content_sha256);
});

test('an edit that turns a document into a copy of another in the same project clears its fingerprint instead of failing', async () => {
  const backend = new FakeBackend({ documentId: DOC_A, ownerId: OWNER, storage: true });
  backend.tables.set('documents', []);
  const client = createNodeClient(backend);
  const threePages = await pdfWithPages(3);
  const twoPages = await mutatePdfPages(threePages, { type: 'delete', page: 3 });
  const pathA = ownDocumentObjectPath(OWNER, DOC_A);
  const pathC = ownDocumentObjectPath(OWNER, DOC_C);
  backend.putObject(pathA, threePages);
  backend.putObject(pathC, twoPages);
  backend.table('documents').push(
    { id: DOC_A, user_id: OWNER, project_id: PROJECT_1, file_path: pathA, content_sha256: await sha(threePages) },
    { id: DOC_C, user_id: OWNER, project_id: PROJECT_1, file_path: pathC, content_sha256: await sha(twoPages) },
  );

  const saved = await replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: pathA, file: pdfFile(twoPages) });

  assert.equal(saved.contentSha256, null);
  assert.equal((await row(client, DOC_A)).content_sha256, null);
  assert.equal((await row(client, DOC_C)).content_sha256, await sha(twoPages));
  assert.deepEqual(await downloadBytes(client, pathA), twoPages);
});

test('the fake keeps documents.file_path immutable for a plain client update', async () => {
  const { client } = await sharedSetup();
  const { error } = await client.from('documents').update({ file_path: `${OWNER}/elsewhere.pdf` }).eq('id', DOC_A);
  assert.match(error?.message || '', /immutable/);
});

test('before the server function exists the edit still saves (old in-place behaviour) and leaves no stray copy', async () => {
  const { backend, client, original, sharedPath } = await sharedSetup({ forkDocumentFile: false });
  const edited = await mutatePdfPages(original, { type: 'delete', page: 1 });
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  let saved;
  try {
    saved = await replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: sharedPath, file: pdfFile(edited) });
  } finally {
    console.warn = warn;
  }

  assert.equal(saved.forked, false);
  assert.equal(saved.filePath, sharedPath);
  assert.equal(backend.objectBytes(ownDocumentObjectPath(OWNER, DOC_A)), null, 'the unused copy is removed');
  const a = await row(client, DOC_A);
  assert.equal(a.content_sha256, await sha(await downloadBytes(client, sharedPath)));
  assert.ok(warnings.some((w) => /fork_document_file is not on the server yet/.test(w)));
});

test('a refused fork fails the save and removes the copy it uploaded', async () => {
  const { backend, client, original, sharedPath } = await sharedSetup();
  // Another row already reads the path the fork would take.
  const cBytes = await pdfWithPages(5);
  backend.putObject(ownDocumentObjectPath(OWNER, DOC_A), cBytes);
  backend.table('documents').push({ id: DOC_C, user_id: OWNER, project_id: null, file_path: ownDocumentObjectPath(OWNER, DOC_A), content_sha256: null });
  const edited = await mutatePdfPages(original, { type: 'delete', page: 1 });

  await assert.rejects(
    replaceDocumentFile({ client, userId: OWNER, documentId: DOC_A, filePath: sharedPath, file: pdfFile(edited) }),
    /belongs to another document/,
  );
  assert.deepEqual(await downloadBytes(client, sharedPath), original, 'nothing written over the shared object');
  assert.deepEqual(new Uint8Array(backend.objectBytes(ownDocumentObjectPath(OWNER, DOC_A))), cBytes, 'C\'s object is never overwritten');
});

test('the server refuses a fork whose object was never uploaded, and the fake models it', async () => {
  const { backend, client, sharedPath } = await sharedSetup();
  const { error } = await client.rpc('fork_document_file', { p_document_id: DOC_A, p_content_sha256: null });
  assert.match(error?.message || '', /Upload the document's own copy/);
  assert.equal((await row(client, DOC_A)).file_path, sharedPath);
  const other = createNodeClient(backend, { userId: '99999999-9999-4999-8999-999999999999' });
  const { error: notOwner } = await other.rpc('fork_document_file', { p_document_id: DOC_A, p_content_sha256: null });
  assert.equal(notOwner?.code, '42501');
});

test('uploads give each new document its own object instead of <user>/<sha>.pdf', () => {
  const source = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /file_path:\s*`\$\{user\.id\}\/\$\{contentSha\}\.pdf`/);
  assert.doesNotMatch(source, /uploadToStorage\([^)]*,\s*contentSha\)/);
  assert.equal((source.match(/file_path: `\$\{user\.id\}\/\$\{newDocId\}\.pdf`/g) || []).length, 2);
  assert.equal((source.match(/\{ filePath: resolvedDoc\.file_path \}/g) || []).length, 2);
});
