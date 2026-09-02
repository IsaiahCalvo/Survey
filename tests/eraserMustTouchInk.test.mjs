import test from 'node:test';
import assert from 'node:assert/strict';
import { eraserStrokeTouchesObject } from '../src/utils/eraserHitTest.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

// Owner ruling 2026-09-02: erasing counts only when the stroke touches painted
// ink — an outline, a fill, or the text itself. The hollow middle of a shape
// and the empty padding around a text box are not ink.

const stroke = (object, points, radius = 4) => eraserStrokeTouchesObject({
  eraserPoints: points,
  eraserRadius: radius,
  object,
});

const hollowEllipse = { type: 'ellipse', left: 100, top: 100, rx: 60, ry: 30, fill: 'transparent', stroke: '#0da67f', strokeWidth: 3 };
const filledEllipse = { ...hollowEllipse, fill: 'rgba(204,250,235,0.55)' };
const hollowRect = { type: 'rect', left: 300, top: 100, width: 120, height: 80, fill: 'transparent', stroke: '#111', strokeWidth: 2 };
const filledRect = { ...hollowRect, fill: '#dbeafe' };
const textBox = { type: 'Textbox', left: 100, top: 300, width: 160, height: 40, text: 'Site note', fontSize: 16, fill: '#111' };

test('a stroke through the hollow middle of an ellipse does not hit it; its outline does', () => {
  // centre (160, 130) — well inside, nowhere near the 3px outline
  assert.equal(stroke(hollowEllipse, [{ x: 150, y: 130 }, { x: 170, y: 130 }]), false);
  // on the right edge of the outline (cx + rx)
  assert.equal(stroke(hollowEllipse, [{ x: 219, y: 130 }, { x: 221, y: 130 }]), true);
});

test('a filled ellipse is hit anywhere on its fill', () => {
  assert.equal(stroke(filledEllipse, [{ x: 150, y: 130 }, { x: 170, y: 130 }]), true);
});

test('a stroke through the hollow middle of a rectangle does not hit it; a filled one is hit', () => {
  assert.equal(stroke(hollowRect, [{ x: 350, y: 140 }, { x: 370, y: 140 }]), false);
  assert.equal(stroke(hollowRect, [{ x: 300, y: 120 }, { x: 301, y: 150 }]), true);
  assert.equal(stroke(filledRect, [{ x: 350, y: 140 }, { x: 370, y: 140 }]), true);
});

test('a stroke beside a text box (in its padding) does not hit the text; one through the text does', () => {
  // 2px inside the box's left edge, left of the 6px text padding
  assert.equal(stroke(textBox, [{ x: 102, y: 305 }, { x: 102, y: 335 }], 2), false);
  // just outside the box, where the old rule's radius slack used to hit
  assert.equal(stroke(textBox, [{ x: 96, y: 320 }, { x: 96, y: 330 }], 3), false);
  // through the first line of glyphs
  assert.equal(stroke(textBox, [{ x: 110, y: 314 }, { x: 140, y: 314 }], 2), true);
});

test('one short stroke inside a hollow shape and beside a text box leaves both intact (the E2E case)', () => {
  // The text box overlaps the ellipse's hollow interior; the stroke runs
  // vertically at x=177, inside the ellipse (never crossing its outline) and
  // inside the text box's 6px left padding, 4px short of the first glyph.
  const beside = { type: 'Textbox', left: 175, top: 110, width: 160, height: 40, text: 'Beside me', fontSize: 16, fill: '#111', data: { id: 'text' } };
  for (const mode of ['partial', 'full']) {
    const result = erasePageAnnotations({
      pageAnnotations: { objects: [{ ...hollowEllipse, data: { id: 'ellipse' } }, beside] },
      eraserPoints: [{ x: 177, y: 115 }, { x: 177, y: 145 }],
      eraserRadius: 2,
      mode,
    });
    assert.equal(result.didChange, false, `${mode}: nothing was touched, nothing changes`);
    assert.equal(result.pageAnnotations.objects.length, 2, `${mode}: both objects intact`);
  }
  // Sanity: the same stroke one step further right does reach the glyphs.
  assert.equal(stroke(beside, [{ x: 181, y: 118 }, { x: 181, y: 128 }], 2), true);
});
