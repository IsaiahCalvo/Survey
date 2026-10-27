// KAL-440: the client lets any editor delete any mark (owner ruling
// 2026-09-28, open editing), but the saved-mark table document_annotations
// still only lets a mark's AUTHOR (or the document owner) delete its row. The
// database refuses by matching zero rows — no error — and the old delete
// helpers reported that as success. These tests drive the in-memory stand-in
// (tp-fake-backend.mjs mirrors the kal49 policy, and the proposed one behind
// `annotationWritePolicy: 'role'`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FakeBackend } from '../debug/scenarios/test-plan/tp-fake-backend.mjs';
import { createFakeSupabaseClient } from '../debug/scenarios/test-plan/tp-node-client.mjs';
import {
  ANNOTATION_DELETE_REFUSED,
  deleteAnnotationRowsVerified,
  describeRefusedAnnotationDelete,
  isRefusedAnnotationDelete,
  reportAnnotationDeleteOutcome,
  resetAnnotationDeleteNotices,
} from '../src/services/annotationDeleteOutcome.js';
import {
  canCommitSurveyMarkerErase,
  canDelete,
} from '../src/lib/collab/permissionScope.js';

const DOC = '33333333-3333-4333-8333-333333333333';
const OWNER = 'user-owner-a';
const EDITOR = 'user-editor-b';
const VIEWER = 'user-viewer-c';

function setup({ annotationWritePolicy = 'author', locked = false } = {}) {
  const backend = new FakeBackend({ documentId: DOC, ownerId: OWNER, annotationWritePolicy });
  if (locked) backend.table('documents')[0].locked_at = '2026-10-01T00:00:00.000Z';
  backend.seedDocumentCollaborator({ userId: EDITOR, role: 'editor' });
  backend.seedDocumentCollaborator({ userId: VIEWER, role: 'viewer' });
  const row = (annotationId, userId) => backend.table('document_annotations').push({
    id: `${annotationId}-row`, document_id: DOC, annotation_id: annotationId, user_id: userId, annotation_type: 'survey-marker',
  });
  row('by-owner', OWNER);
  row('by-editor', EDITOR);
  const as = (userId) => createFakeSupabaseClient(backend, { userId });
  const remaining = () => backend.table('document_annotations').map((r) => r.annotation_id).sort();
  return { backend, as, remaining };
}

test('repro: the old plain delete reports success while the database keeps the row', async () => {
  const { as, remaining } = setup();
  // documentAnnotationService.deleteAnnotations / annotationCloudSync.deleteAnnotations before the fix.
  const { error } = await as(EDITOR)
    .from('document_annotations')
    .delete()
    .eq('document_id', DOC)
    .in('annotation_id', ['by-owner']);
  assert.equal(error, null, 'row-level security refuses silently: no error');
  assert.deepEqual(remaining(), ['by-editor', 'by-owner'], 'the row is still there');
});

test("an editor deleting the owner's mark row is reported as REFUSED, not success", async () => {
  const { as, remaining } = setup();
  const outcome = await deleteAnnotationRowsVerified({ supabase: as(EDITOR), documentId: DOC, annotationIds: ['by-owner'] });
  assert.equal(outcome.success, false);
  assert.equal(outcome.error.code, ANNOTATION_DELETE_REFUSED);
  assert.deepEqual(outcome.refusedIds, ['by-owner']);
  assert.deepEqual(outcome.deletedIds, []);
  assert.equal(isRefusedAnnotationDelete(outcome), true);
  assert.deepEqual(remaining(), ['by-editor', 'by-owner']);
});

test('own rows delete; missing rows count as already gone; foreign rows are refused (one call)', async () => {
  const { as, remaining } = setup();
  const outcome = await deleteAnnotationRowsVerified({
    supabase: as(EDITOR),
    documentId: DOC,
    annotationIds: ['by-editor', 'by-owner', 'never-synced', 'by-editor'],
  });
  assert.deepEqual(outcome.requestedIds, ['by-editor', 'by-owner', 'never-synced']);
  assert.deepEqual(outcome.deletedIds, ['by-editor']);
  assert.deepEqual(outcome.alreadyGoneIds, ['never-synced']);
  assert.deepEqual(outcome.refusedIds, ['by-owner']);
  assert.equal(outcome.success, false);
  assert.deepEqual(remaining(), ['by-owner']);
});

test('chunked deletes classify every chunk', async () => {
  const { backend, as } = setup();
  for (let i = 0; i < 5; i += 1) {
    backend.table('document_annotations').push({ id: `x${i}`, document_id: DOC, annotation_id: `owner-${i}`, user_id: OWNER });
  }
  const outcome = await deleteAnnotationRowsVerified({
    supabase: as(EDITOR), documentId: DOC, annotationIds: ['by-editor', 'owner-0', 'owner-1', 'owner-2', 'owner-3'], chunkSize: 2,
  });
  assert.deepEqual(outcome.deletedIds, ['by-editor']);
  assert.deepEqual(outcome.refusedIds, ['owner-0', 'owner-1', 'owner-2', 'owner-3']);
});

test("the document owner may delete anyone's row; a repeat delete is still a success", async () => {
  const { as, remaining } = setup();
  const first = await deleteAnnotationRowsVerified({ supabase: as(OWNER), documentId: DOC, annotationIds: ['by-editor'] });
  assert.equal(first.success, true);
  assert.deepEqual(first.deletedIds, ['by-editor']);
  const repeat = await deleteAnnotationRowsVerified({ supabase: as(OWNER), documentId: DOC, annotationIds: ['by-editor'] });
  assert.equal(repeat.success, true);
  assert.deepEqual(repeat.alreadyGoneIds, ['by-editor']);
  assert.deepEqual(remaining(), ['by-owner']);
});

test('a viewer and a locked document are refused too', async () => {
  const viewer = setup();
  const byViewer = await deleteAnnotationRowsVerified({ supabase: viewer.as(VIEWER), documentId: DOC, annotationIds: ['by-owner'] });
  assert.deepEqual(byViewer.refusedIds, ['by-owner']);

  const locked = setup({ locked: true });
  const byOwner = await deleteAnnotationRowsVerified({ supabase: locked.as(OWNER), documentId: DOC, annotationIds: ['by-editor'] });
  assert.deepEqual(byOwner.refusedIds, ['by-editor']);
  assert.deepEqual(locked.remaining(), ['by-editor', 'by-owner']);
});

test('client gate vs database: an editor may delete a teammate\'s mark in the app, the CURRENT table refuses, the PROPOSED rule agrees', async () => {
  const ownersMarker = { id: 'by-owner', userId: OWNER };
  const ownersShape = { id: 'by-owner', meta: { authorId: OWNER } };
  // Client gate (owner ruling 2026-09-28: any editor, any author).
  assert.equal(canDelete({ annotation: ownersShape, viewerId: EDITOR, documentOwnerId: OWNER }), true);
  assert.equal(canCommitSurveyMarkerErase({ surveyMarker: ownersMarker, viewerId: EDITOR, documentOwnerId: OWNER }), true);

  // Database today: refused (and now reported as refused).
  const current = setup();
  const refused = await deleteAnnotationRowsVerified({ supabase: current.as(EDITOR), documentId: DOC, annotationIds: ['by-owner'] });
  assert.deepEqual(refused.refusedIds, ['by-owner']);

  // Database with PROPOSED-DB-CHANGE.md applied: the row really goes.
  const proposed = setup({ annotationWritePolicy: 'role' });
  const done = await deleteAnnotationRowsVerified({ supabase: proposed.as(EDITOR), documentId: DOC, annotationIds: ['by-owner'] });
  assert.equal(done.success, true);
  assert.deepEqual(done.deletedIds, ['by-owner']);
  assert.deepEqual(proposed.remaining(), ['by-editor']);
  // ...and a viewer is still refused under the proposed rule.
  const viewerStill = await deleteAnnotationRowsVerified({ supabase: proposed.as(VIEWER), documentId: DOC, annotationIds: ['by-editor'] });
  assert.deepEqual(viewerStill.refusedIds, ['by-editor']);
});

test('a refusal is shown once per document and logged every time', async () => {
  resetAnnotationDeleteNotices();
  const { as } = setup();
  const outcome = await deleteAnnotationRowsVerified({ supabase: as(EDITOR), documentId: DOC, annotationIds: ['by-owner'] });
  const toasts = [];
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    assert.equal(reportAnnotationDeleteOutcome(outcome, { showToast: (m, t) => toasts.push([m, t]), onceKey: DOC }), true);
    assert.equal(reportAnnotationDeleteOutcome(outcome, { showToast: (m, t) => toasts.push([m, t]), onceKey: DOC }), true);
    assert.equal(reportAnnotationDeleteOutcome({ success: true }, { showToast: (m, t) => toasts.push([m, t]) }), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], 'warn');
  assert.equal(toasts[0][0], describeRefusedAnnotationDelete(outcome));
  assert.match(toasts[0][0], /kept a saved copy of 1 mark made by someone else/);
  assert.equal(errors.length, 2);
});

test('every delete helper and caller reports refusals instead of success', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const service = read('services/documentAnnotationService.js');
  const cloud = read('services/annotationCloudSync.js');
  const viewer = read('PDFViewer.jsx');
  assert.match(service, /deleteAnnotationRowsVerified\(\{ supabase, documentId, annotationIds \}\)/);
  assert.equal((cloud.match(/deleteAnnotationRowsVerified\(/g) || []).length, 2);
  assert.match(viewer, /source: 'space-cascade'/);
  assert.match(viewer, /source: 'survey-marker-delete'/);
  assert.match(viewer, /source: 'erase-legacy-marker'/);
  // The Survey rail no longer deletes rows itself: every rail delete (one
  // marker, several, a whole category) goes through the viewer's marker
  // delete ('survey-marker-delete' above), which reports a refusal.
  const rail = read('SurveySpacesRail.jsx');
  assert.doesNotMatch(rail, /source: 'rail-category-delete'|source: 'rail-selected-delete'/);
  const railDeletes = rail.match(/deleteAnnotations\([^)]*\)\s*\.?[a-z]+/g) || [];
  assert.equal(railDeletes.length, 0);
});
