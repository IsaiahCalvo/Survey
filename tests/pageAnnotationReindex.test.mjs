import test from 'node:test';
import assert from 'node:assert/strict';

import { reindexAnnotationModel } from '../src/utils/pageAnnotationReindex.js';

const model = {
  annotationsByPage: {
    1: { objects: [{ id: 'a1' }] },
    2: { objects: [{ id: 'a2' }] },
    3: { objects: [{ id: 'a3' }] },
  },
  surveyMarkers: {
    m2: { id: 'm2', pageNumber: 2 },
    m3: { id: 'm3', pageNumber: 3 },
  },
  callouts: [
    { id: 'c1', pageNumber: 1 },
    { id: 'c3', pageNumber: 3 },
  ],
  pageNames: { 1: 'One', 2: 'Two', 3: 'Three' },
  pageTransformations: { 2: { rotate: 90 } },
};

test('reindexAnnotationModel delete shifts later pages down', () => {
  const next = reindexAnnotationModel(model, { type: 'delete', page: 2 });
  assert.deepEqual(Object.keys(next.annotationsByPage).map(Number).sort(), [1, 2]);
  assert.equal(next.annotationsByPage[2].objects[0].id, 'a3');
  assert.equal(next.surveyMarkers.m3.pageNumber, 2);
  assert.equal('m2' in next.surveyMarkers, false);
  assert.deepEqual(next.callouts.map((c) => c.pageNumber), [1, 2]);
});

test('reindexAnnotationModel insert and duplicate shift later pages up', () => {
  const inserted = reindexAnnotationModel(model, { type: 'insert', afterPage: 1 });
  assert.equal(inserted.annotationsByPage[3].objects[0].id, 'a2');
  assert.equal(inserted.surveyMarkers.m2.pageNumber, 3);

  const duplicated = reindexAnnotationModel(model, { type: 'duplicate', page: 1 });
  assert.equal(duplicated.annotationsByPage[3].objects[0].id, 'a2');
});

test('reindexAnnotationModel reorder moves a page and shifts the range', () => {
  const forward = reindexAnnotationModel(model, { type: 'reorder', from: 1, to: 3 });
  assert.equal(forward.annotationsByPage[3].objects[0].id, 'a1');
  assert.equal(forward.annotationsByPage[1].objects[0].id, 'a2');

  const backward = reindexAnnotationModel(model, { type: 'reorder', from: 3, to: 1 });
  assert.equal(backward.annotationsByPage[1].objects[0].id, 'a3');
  assert.equal(backward.annotationsByPage[3].objects[0].id, 'a2');

  // from === to is a no-op identity map (covers the final return p branch).
  const same = reindexAnnotationModel(model, { type: 'reorder', from: 2, to: 2 });
  assert.equal(same.annotationsByPage[2].objects[0].id, 'a2');
});

test('reindexAnnotationModel rejects unknown ops', () => {
  assert.throws(() => reindexAnnotationModel(model, { type: 'nope' }), /unknown op/);
});
