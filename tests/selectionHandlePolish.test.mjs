// Drawboard canvas audit 2026-10-13 (chunk 5): rotate-grabber click and the
// move cursor over a selected mark — the pure decisions behind the two hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isRotateHandleClick } from '../src/hooks/useRotateHandleClick.js';
import { shouldShowSelectionMoveCursor } from '../src/hooks/useSelectionMoveCursor.js';

test('rotate grabber: a press and release in place is a click', () => {
  const press = { pointerId: 1, pointerType: 'mouse', x: 100, y: 100, dragged: false };
  assert.equal(isRotateHandleClick(press, { pointerId: 1, x: 103, y: 98 }), true);
  assert.equal(isRotateHandleClick(press, { pointerId: 1, x: 106, y: 100 }), true, '6 px is still a click (Drawboard minDelta 6)');
  assert.equal(isRotateHandleClick(press, { pointerId: 1, x: 107, y: 100 }), false, 'past 6 px it was a rotate drag');
});

test('rotate grabber: a finger gets 10 px of wobble', () => {
  const press = { pointerId: 4, pointerType: 'touch', x: 50, y: 50, dragged: false };
  assert.equal(isRotateHandleClick(press, { pointerId: 4, x: 59, y: 41 }), true);
  assert.equal(isRotateHandleClick(press, { pointerId: 4, x: 61, y: 50 }), false);
});

test('rotate grabber: a drag that came back to its start is not a click', () => {
  const press = { pointerId: 1, pointerType: 'mouse', x: 100, y: 100, dragged: true };
  assert.equal(isRotateHandleClick(press, { pointerId: 1, x: 100, y: 100 }), false);
});

test('rotate grabber: another pointer, or no press, is not a click', () => {
  const press = { pointerId: 1, pointerType: 'mouse', x: 0, y: 0, dragged: false };
  assert.equal(isRotateHandleClick(press, { pointerId: 2, x: 0, y: 0 }), false);
  assert.equal(isRotateHandleClick(null, { pointerId: 1, x: 0, y: 0 }), false);
});

test('move cursor: only over a selected mark, only on the bare layer', () => {
  const svg = { id: 'svg' };
  const handle = { id: 'handle' };
  const selected = new Set([3]);
  const isSelectedHit = (hit) => selected.has(hit.annotationIndex);
  const onSelected = { kind: 'annotation', annotationIndex: 3 };
  const onOther = { kind: 'annotation', annotationIndex: 7 };
  assert.equal(shouldShowSelectionMoveCursor(svg, svg, onSelected, isSelectedHit), true);
  assert.equal(shouldShowSelectionMoveCursor(svg, svg, onOther, isSelectedHit), false, 'another mark: the tool works there');
  assert.equal(shouldShowSelectionMoveCursor(svg, svg, { kind: 'page' }, isSelectedHit), false, 'empty page (or a hollow middle) keeps the crosshair');
  assert.equal(shouldShowSelectionMoveCursor(svg, svg, null, isSelectedHit), false);
  assert.equal(shouldShowSelectionMoveCursor(handle, svg, onSelected, isSelectedHit), false, 'a handle keeps its own resize cursor');
});

test('styles: grabbers grow 1.1x over 100 ms, and the move-hover attribute sets cursor move', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /transition: transform 100ms ease-in-out;/);
  assert.match(css, /transform: scale\(1\.1\);/);
  for (const id of ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']) {
    assert.ok(css.includes(`[data-handle-hit-pad="${id}"]:is(:hover, :active) ~`), `pad ${id} grows its dot`);
  }
  assert.match(css, /svg\[data-svg-annotation-layer\]\[data-selection-hover="move"\] \{\s*cursor: move;/);
});
