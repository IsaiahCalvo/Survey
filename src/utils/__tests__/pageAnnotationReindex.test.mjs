// Tests for the page-annotation reindex helper — the fix for the page-operation
// data-loss bug where deleting/inserting/reordering pages mis-pins or drops the
// per-page annotation model. Pure function, fully offline-verifiable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reindexAnnotationModel } from '../pageAnnotationReindex.js';

// A 4-page model with one annotation of each kind on several pages.
const make = () => ({
  annotationsByPage: {
    1: { objects: ['a1'] },
    2: { objects: ['a2'] },
    3: { objects: ['a3'] },
    4: { objects: ['a4'] },
  },
  surveyMarkers: {
    m1: { pageNumber: 1, label: 'm1' },
    m2: { pageNumber: 2, label: 'm2' },
    m3: { pageNumber: 3, label: 'm3' },
  },
  callouts: [
    { id: 'c1', pageNumber: 1 },
    { id: 'c2', pageNumber: 2 },
    { id: 'c4', pageNumber: 4 },
  ],
  pageNames: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' },
  pageTransformations: { 2: { rotation: 90 }, 3: { rotation: 180 } },
});

test('delete: removes the deleted page and shifts everything above it down by one', () => {
  const out = reindexAnnotationModel(make(), { type: 'delete', page: 2 });

  // page-keyed objects: page 2 gone, 3→2, 4→3
  assert.deepEqual(out.annotationsByPage, {
    1: { objects: ['a1'] },
    2: { objects: ['a3'] },
    3: { objects: ['a4'] },
  });
  assert.deepEqual(out.pageNames, { 1: 'A', 2: 'C', 3: 'D' });
  assert.deepEqual(out.pageTransformations, { 2: { rotation: 180 } });

  // id-keyed markers: m2 (on page 2) dropped, m3 shifts 3→2
  assert.deepEqual(out.surveyMarkers, {
    m1: { pageNumber: 1, label: 'm1' },
    m3: { pageNumber: 2, label: 'm3' },
  });

  // callout list: c2 (page 2) dropped, c4 shifts 4→3
  assert.deepEqual(out.callouts, [
    { id: 'c1', pageNumber: 1 },
    { id: 'c4', pageNumber: 3 },
  ]);
});

test('delete: does not mutate the input model', () => {
  const model = make();
  const snapshot = JSON.stringify(model);
  reindexAnnotationModel(model, { type: 'delete', page: 2 });
  assert.equal(JSON.stringify(model), snapshot);
});

test('insert: opens a gap after the target page; the new page starts empty', () => {
  const out = reindexAnnotationModel(make(), { type: 'insert', afterPage: 1 });

  // pages > 1 shift up by 1; new page 2 has no entry (empty)
  assert.deepEqual(out.annotationsByPage, {
    1: { objects: ['a1'] },
    3: { objects: ['a2'] },
    4: { objects: ['a3'] },
    5: { objects: ['a4'] },
  });
  assert.deepEqual(out.pageNames, { 1: 'A', 3: 'B', 4: 'C', 5: 'D' });
  assert.deepEqual(out.pageTransformations, { 3: { rotation: 90 }, 4: { rotation: 180 } });
  assert.deepEqual(out.surveyMarkers, {
    m1: { pageNumber: 1, label: 'm1' },
    m2: { pageNumber: 3, label: 'm2' },
    m3: { pageNumber: 4, label: 'm3' },
  });
  assert.deepEqual(out.callouts, [
    { id: 'c1', pageNumber: 1 },
    { id: 'c2', pageNumber: 3 },
    { id: 'c4', pageNumber: 5 },
  ]);
});

test('duplicate: shifts existing annotations up like an insert (duplicated page starts empty in v1)', () => {
  const out = reindexAnnotationModel(make(), { type: 'duplicate', page: 2 });
  // new page at 3; old pages 3,4 -> 4,5; page 2 keeps its own annotations
  assert.deepEqual(out.annotationsByPage, {
    1: { objects: ['a1'] },
    2: { objects: ['a2'] },
    4: { objects: ['a3'] },
    5: { objects: ['a4'] },
  });
  assert.deepEqual(out.callouts, [
    { id: 'c1', pageNumber: 1 },
    { id: 'c2', pageNumber: 2 },
    { id: 'c4', pageNumber: 5 },
  ]);
});

test('reorder: moving a page forward shifts the pages it passes back by one', () => {
  // pages [1,2,3,4]; move page 2 to position 4 -> order becomes [1,3,4,2]
  const out = reindexAnnotationModel(make(), { type: 'reorder', from: 2, to: 4 });
  assert.deepEqual(out.annotationsByPage, {
    1: { objects: ['a1'] }, // 1 stays
    4: { objects: ['a2'] }, // old page 2 -> 4
    2: { objects: ['a3'] }, // old page 3 -> 2
    3: { objects: ['a4'] }, // old page 4 -> 3
  });
  assert.deepEqual(out.surveyMarkers, {
    m1: { pageNumber: 1, label: 'm1' },
    m2: { pageNumber: 4, label: 'm2' },
    m3: { pageNumber: 2, label: 'm3' },
  });
});

test('reorder: moving a page backward shifts the pages it passes forward by one', () => {
  // move page 4 to position 1 -> order [4,1,2,3]
  const out = reindexAnnotationModel(make(), { type: 'reorder', from: 4, to: 1 });
  assert.deepEqual(out.annotationsByPage, {
    1: { objects: ['a4'] }, // old 4 -> 1
    2: { objects: ['a1'] }, // old 1 -> 2
    3: { objects: ['a2'] }, // old 2 -> 3
    4: { objects: ['a3'] }, // old 3 -> 4
  });
});
