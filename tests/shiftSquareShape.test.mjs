import test from 'node:test';
import assert from 'node:assert/strict';
import { squareShapeEnd } from '../src/utils/pageEdgeRules.js';

test('Shift squares the drag on the larger move, in its own direction', () => {
  assert.deepEqual(squareShapeEnd({ x: 100, y: 100 }, { x: 160, y: 120 }, 600, 800), { x: 160, y: 160 });
  assert.deepEqual(squareShapeEnd({ x: 100, y: 100 }, { x: 80, y: 20 }, 600, 800), { x: 20, y: 20 });
});

test('the square stops at the page edge', () => {
  assert.deepEqual(squareShapeEnd({ x: 550, y: 100 }, { x: 590, y: 300 }, 600, 800), { x: 600, y: 150 });
});
