import test from 'node:test';
import assert from 'node:assert/strict';

import { planPageEraserPreview } from '../src/utils/eraserPreviewPlan.js';
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
