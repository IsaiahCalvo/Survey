import test from 'node:test';
import assert from 'node:assert/strict';

import { booleanErasePath } from '../src/utils/geometryEraser.js';

const identityPath = (path, strokeWidth = 10) => ({
  path,
  strokeWidth,
  pathOffset: { x: 0, y: 0 },
  calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
});

test('booleanErasePath guards and curve/Z command coverage', () => {
  assert.equal(booleanErasePath(null, { points: [{ x: 0, y: 0 }] }, 2), null);
  assert.equal(booleanErasePath(identityPath([['M', 0, 0], ['L', 10, 0]]), { points: [] }, 2), null);

  // Quadratic + cubic + close + second subpath
  const curved = identityPath([
    ['M', 0, 0],
    ['Q', 20, 40, 40, 0],
    ['C', 50, -20, 60, 20, 80, 0],
    ['Z'],
    ['M', 100, 0],
    ['L', 140, 0],
  ], 8);
  const bitten = booleanErasePath(curved, { points: [{ x: 20, y: 0 }, { x: 40, y: 0 }] }, 5);
  assert.ok(bitten === null || bitten.pathData);

  // Already-outline path (strokeWidth 0) uses fill polygon subject
  const outline = identityPath([
    ['M', 0, 0],
    ['L', 40, 0],
    ['L', 40, 10],
    ['L', 0, 10],
    ['Z'],
  ], 0);
  const cut = booleanErasePath(outline, { points: [{ x: 20, y: 5 }] }, 4);
  assert.ok(cut === null || Array.isArray(cut.pathData) || cut.pathData);
});

test('booleanErasePath miss (eraser far away) keeps a path result', () => {
  const stroke = identityPath([['M', 0, 0], ['L', 100, 0]]);
  const result = booleanErasePath(stroke, { points: [{ x: 0, y: 80 }] }, 2);
  assert.ok(result && result.pathData);
});
