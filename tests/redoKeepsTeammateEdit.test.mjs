import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAnnotationHistoryAction,
  invertAnnotationHistoryAction,
  refreshCreatedSnapshots,
} from '../src/utils/annotationLocalHistory.js';

const drawn = { type: 'rect', width: 100, height: 50, data: { id: 'r1' } };

test('Undo then Redo of my mark brings back a teammate\'s later resize', () => {
  const create = { type: 'fabric:create', pageNumber: 1, annotationId: 'r1', storageKey: 'r1', annotation: drawn, index: 0 };
  // A teammate resized it after I drew it.
  const resized = { ...drawn, width: 240, height: 120 };
  const page = { 1: { objects: [resized] } };
  const redo = refreshCreatedSnapshots(create, page);
  const afterUndo = applyAnnotationHistoryAction(page, invertAnnotationHistoryAction(create));
  assert.equal(afterUndo[1].objects.length, 0);
  const afterRedo = applyAnnotationHistoryAction(afterUndo, redo);
  assert.equal(afterRedo[1].objects[0].width, 240);
  assert.equal(afterRedo[1].objects[0].height, 120);
  // The step itself is left as it was.
  assert.equal(create.annotation.width, 100);
});

test('a batch and a document batch refresh their created marks too; a missing mark keeps its copy', () => {
  const page = { 2: { objects: [{ ...drawn, width: 7 }] } };
  const batch = { type: 'fabric:batch', pageNumber: 2, created: [{ id: 'r1', annotationId: 'r1', storageKey: 'r1', annotation: drawn }], deleted: [], updated: [] };
  assert.equal(refreshCreatedSnapshots(batch, page).created[0].annotation.width, 7);
  const docBatch = { type: 'fabric:document-batch', actions: [batch] };
  assert.equal(refreshCreatedSnapshots(docBatch, page).actions[0].created[0].annotation.width, 7);
  const gone = { type: 'fabric:create', pageNumber: 2, annotationId: 'zz', storageKey: 'zz', annotation: drawn };
  assert.equal(refreshCreatedSnapshots(gone, page), gone);
});

test('the viewer stores the refreshed step for Redo', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const redoAction = refreshCreatedSnapshots\(localAction, annotationsByPageRef\.current\);[\s\S]{0,400}localAnnotationRedoRef\.current = \[\.\.\.localAnnotationRedoRef\.current, redoAction\]/);
});
