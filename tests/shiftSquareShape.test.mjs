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

import { addPolyDraftPoint, createPolyDraft, removeLastPolyDraftPoint } from '../src/utils/polyDraft.js';

test('Backspace while placing takes the last vertex off, then ends the draft', () => {
  let draft = createPolyDraft('polygon', { x: 0, y: 0 });
  draft = addPolyDraftPoint(draft, { x: 10, y: 0 });
  draft = addPolyDraftPoint(draft, { x: 10, y: 10 });
  draft = removeLastPolyDraftPoint(draft);
  assert.deepEqual(draft.points, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  draft = removeLastPolyDraftPoint(draft);
  assert.equal(draft.points.length, 1);
  assert.equal(removeLastPolyDraftPoint(draft), null);
});
