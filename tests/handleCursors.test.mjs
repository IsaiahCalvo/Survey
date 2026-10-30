// Drawboard-style grabber cursors (owner 2026-10-26, utils/handleCursors.js):
// resize grabbers show a double arrow turned to the exact way they pull on
// screen, point and turn grabbers show the pointing hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAB_HANDLE_CURSOR,
  ROTATE_HANDLE_CURSOR,
  resizeArrowCursor,
  resizeHandleCursor,
} from '../src/utils/handleCursors.js';

const turnOf = (cursor) => {
  const svg = decodeURIComponent(cursor.match(/data:image\/svg\+xml,(.*?)"\)/)[1]);
  return Number(svg.match(/rotate\((-?[\d.]+) 15 15\)/)[1]);
};
const fallbackOf = (cursor) => cursor.split(',').pop().trim();

test('an upright box: each resize grabber points the way it pulls', () => {
  assert.equal(turnOf(resizeHandleCursor('mr', 0)), 0);
  assert.equal(turnOf(resizeHandleCursor('ml', 0)), 0);
  assert.equal(turnOf(resizeHandleCursor('mt', 0)), 90);
  assert.equal(turnOf(resizeHandleCursor('mb', 0)), 90);
  assert.equal(turnOf(resizeHandleCursor('br', 0)), 45);
  assert.equal(turnOf(resizeHandleCursor('tl', 0)), 45);
  assert.equal(turnOf(resizeHandleCursor('tr', 0)), 135);
  assert.equal(turnOf(resizeHandleCursor('bl', 0)), 135);
});

test('a turned box turns the arrows by the same exact angle', () => {
  assert.equal(turnOf(resizeHandleCursor('mr', 30)), 30);
  assert.equal(turnOf(resizeHandleCursor('tl', 30)), 75);
  assert.equal(turnOf(resizeHandleCursor('mt', -20)), 70);
  // Half a turn looks the same, so it folds back into [0, 180).
  assert.equal(turnOf(resizeHandleCursor('mr', 200)), 20);
});

test('the browser keyword stays behind the image as the fallback', () => {
  assert.equal(fallbackOf(resizeHandleCursor('tl', 0)), 'nwse-resize');
  assert.equal(fallbackOf(resizeHandleCursor('mr', 0)), 'ew-resize');
  assert.equal(fallbackOf(resizeHandleCursor('mr', 90)), 'ns-resize');
  assert.match(resizeHandleCursor('br', 0), /^url\("data:image\/svg\+xml,.*"\) 9 9, nwse-resize$/);
});

test('compass names (area tool) match the frame grabber names', () => {
  assert.equal(resizeHandleCursor('nw', 15), resizeHandleCursor('tl', 15));
  assert.equal(resizeHandleCursor('e', 15), resizeHandleCursor('mr', 15));
  assert.equal(resizeHandleCursor('s', 15), resizeHandleCursor('mb', 15));
});

test('turn and point grabbers show the pointing hand; unknown ids the arrow', () => {
  assert.equal(resizeHandleCursor('mtr', 30), ROTATE_HANDLE_CURSOR);
  assert.equal(ROTATE_HANDLE_CURSOR, 'pointer');
  assert.equal(GRAB_HANDLE_CURSOR, 'pointer');
  assert.equal(resizeHandleCursor('vertex-2', 0), 'default');
});

test('one cached string per whole degree', () => {
  assert.equal(resizeArrowCursor(44.6), resizeArrowCursor(45.2));
  assert.equal(resizeArrowCursor(Number.NaN), resizeArrowCursor(0));
});
