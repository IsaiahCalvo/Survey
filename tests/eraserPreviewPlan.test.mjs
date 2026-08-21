import test from 'node:test';
import assert from 'node:assert/strict';

import { planPageEraserPreview } from '../src/utils/eraserPreviewPlan.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { getEraserOperation } from '../src/utils/eraserPolicy.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

const ink = () => createProductionPaperInk({
  id: 'preview-ink',
  tool: 'pen',
  points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
  color: '#d11b2d',
  width: 20,
});

test('a blocked target never produces a destructive live preview', () => {
  const page = { objects: [ink()] };
  const plan = planPageEraserPreview({
    pageAnnotations: page,
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 7,
    mode: 'partial',
    canErase: () => false,
  });

  assert.equal(plan.shouldPreview, false);
  assert.equal(plan.result.didChange, false);
  assert.equal(plan.result.pageAnnotations, page);
});

test('partial ink preview reports geometry changes while full mode reports deletion', () => {
  const page = { objects: [ink()] };
  const partial = planPageEraserPreview({
    pageAnnotations: page,
    eraserPoints: [{ x: 50, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  });
  const full = planPageEraserPreview({
    pageAnnotations: page,
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 7,
    mode: 'full',
  });

  assert.equal(partial.shouldPreview, true);
  assert.deepEqual(partial.partialIds, ['preview-ink']);
  assert.deepEqual(partial.atomicIds, []);
  assert.equal(full.shouldPreview, true);
  assert.deepEqual(full.partialIds, []);
  assert.deepEqual(full.atomicIds, ['preview-ink']);
});

test('a geometric miss leaves the source bitmap visible and unchanged', () => {
  const page = { objects: [ink()] };
  const plan = planPageEraserPreview({
    pageAnnotations: page,
    eraserPoints: [{ x: 500, y: 500 }],
    eraserRadius: 7,
    mode: 'partial',
  });

  assert.equal(plan.shouldPreview, false);
  assert.deepEqual(plan.partialIds, []);
  assert.deepEqual(plan.atomicIds, []);
});

const rect = (id, overrides = {}) => ({
  type: 'rect',
  id,
  annotationId: id,
  tool: 'rect',
  left: 20,
  top: 30,
  width: 60,
  height: 40,
  fill: '#2563eb',
  stroke: '#111111',
  strokeWidth: 2,
  data: { id },
  ...overrides,
});

const commitAndPreview = (objects, points, overrides = {}) => {
  const options = {
    pageAnnotations: { objects },
    eraserPoints: points,
    eraserRadius: 8,
    mode: 'partial',
    ...overrides,
  };
  return {
    preview: planPageEraserPreview(options),
    commit: erasePageAnnotations(options),
  };
};

test('intended use: preview plan matches commit for a mid-stroke ink carve', () => {
  const { preview, commit } = commitAndPreview(
    [ink()],
    [{ x: 50, y: 50 }],
  );

  assert.equal(preview.shouldPreview, true);
  assert.deepEqual(preview.partialIds, commit.changedIds);
  assert.deepEqual(preview.atomicIds, commit.deletedIds);
  assert.deepEqual(preview.atomicIds, []);
  assert.equal(preview.result.didChange, commit.didChange);
});

test('shape-under-ink: preview does not ghost a skip target the commit leaves', () => {
  const shape = rect('shape-under');
  const stroke = createProductionPaperInk({
    id: 'ink-over',
    tool: 'pen',
    points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
    color: '#d11b2d',
    width: 20,
  });
  const { preview, commit } = commitAndPreview(
    [shape, stroke],
    [{ x: 50, y: 50 }],
    { canErase: (object) => getEraserOperation(object, 'partial') === 'partial' },
  );

  assert.equal(preview.shouldPreview, true);
  assert.deepEqual(preview.atomicIds, []);
  assert.deepEqual(commit.deletedIds, []);
  assert.deepEqual(preview.partialIds, commit.changedIds);
  assert.equal(commit.pageAnnotations.objects[0], shape);
});

test('overlapping ink: preview and commit carve every intersecting stroke', () => {
  const lower = createProductionPaperInk({
    id: 'ink-lower',
    tool: 'pen',
    points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
    color: '#111111',
    width: 20,
  });
  const upper = createProductionPaperInk({
    id: 'ink-upper',
    tool: 'pen',
    points: [{ x: 0, y: 52 }, { x: 100, y: 52 }],
    color: '#e11d48',
    width: 20,
  });
  const far = createProductionPaperInk({
    id: 'ink-far',
    tool: 'pen',
    points: [{ x: 0, y: 200 }, { x: 100, y: 200 }],
    color: '#111111',
    width: 20,
  });
  const { preview, commit } = commitAndPreview(
    [lower, upper, far],
    [{ x: 50, y: 51 }],
  );

  assert.deepEqual(preview.partialIds.sort(), commit.changedIds.sort());
  assert.deepEqual(preview.atomicIds, []);
  assert.deepEqual(commit.deletedIds, []);
  assert.equal(commit.pageAnnotations.objects[2], far);
});

test('empty stroke and locked objects: preview agrees with a no-op commit', () => {
  const page = { objects: [ink(), rect('locked-shape')] };

  const empty = commitAndPreview(page.objects, [], {});
  assert.equal(empty.preview.shouldPreview, false);
  assert.equal(empty.commit.didChange, false);

  const locked = commitAndPreview([ink(), rect('locked-shape')], [{ x: 50, y: 50 }], {
    canErase: () => false,
  });
  assert.equal(locked.preview.shouldPreview, false);
  assert.equal(locked.commit.didChange, false);
  assert.deepEqual(locked.preview.partialIds, []);
  assert.deepEqual(locked.preview.atomicIds, []);
});
