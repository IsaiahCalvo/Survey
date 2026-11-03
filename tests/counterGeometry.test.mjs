import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCounterRenderGeometry,
  removeCounterDragPreview,
  updateCounterDragPreview,
  createCounterDragPreview,
  placeCounterInResizeBox,
} from '../src/utils/counterGeometry.js';

test('getCounterRenderGeometry builds a pin path and font size', () => {
  const geo = getCounterRenderGeometry(100, 50, 20, 0);
  assert.match(geo.pathD, /^M /);
  assert.ok(geo.fontSize >= 11);
});

test('removeCounterDragPreview detaches the preview svg when present', () => {
  const parent = { removeChild(node) { this.removed = node; } };
  const svg = { parentNode: parent };
  removeCounterDragPreview({ previewSvg: svg });
  assert.equal(parent.removed, svg);
  assert.doesNotThrow(() => removeCounterDragPreview(null));
});

test('updateCounterDragPreview writes geometry into path/text nodes', () => {
  const attrs = {};
  const drag = {
    bodyX: 10,
    bodyY: 20,
    radius: 12,
    angle: 90,
    color: '#123456',
    displayNumber: 7,
    previewPath: {
      setAttribute(k, v) { attrs[`path:${k}`] = v; },
    },
    previewText: {
      setAttribute(k, v) { attrs[`text:${k}`] = v; },
      textContent: '',
    },
  };
  updateCounterDragPreview(drag);
  assert.ok(attrs['path:d']);
  assert.equal(attrs['path:fill'], '#123456');
  assert.equal(attrs['text:x'], '10');
  assert.equal(attrs['text:y'], '20');
  assert.equal(drag.previewText.textContent, '7');
  assert.doesNotThrow(() => updateCounterDragPreview({}));
});

test('createCounterDragPreview mounts svg path+text under the overlay', () => {
  const prevDoc = globalThis.document;
  const created = [];
  globalThis.document = {
    createElementNS(_ns, tag) {
      const el = {
        tagName: tag,
        attrs: {},
        style: {},
        children: [],
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(child) { this.children.push(child); },
      };
      created.push(el);
      return el;
    },
  };
  try {
    const overlay = { children: [], appendChild(child) { this.children.push(child); } };
    const drag = {
      pageWidth: 200,
      pageHeight: 100,
      bodyX: 40,
      bodyY: 50,
      radius: 12,
      angle: 45,
      color: '#abcabc',
      numberColor: '#fff',
      displayNumber: 3,
    };
    createCounterDragPreview(overlay, drag);
    assert.equal(overlay.children.length, 1);
    assert.ok(drag.previewSvg);
    assert.ok(drag.previewPath.attrs.d);
    assert.equal(drag.previewText.textContent, '3');
    assert.doesNotThrow(() => createCounterDragPreview(null, drag));
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('placeCounterInResizeBox: a nub-up pin sits in the lower part of its box', () => {
  // pointerAngle 270 = nub straight up, box angle 0; box 2r x 2.5r around (100, 100).
  const placed = placeCounterInResizeBox({ centerX: 100, centerY: 100, radius: 20, boxAngleDeg: 0, pointerAngle: 270, flipY: false });
  assert.equal(placed.left, 80);
  assert.equal(placed.top, 85); // bubble centre 5 (= 0.25r) below the box centre
  assert.equal(placed.pointerAngle, 270);
});

test('placeCounterInResizeBox: flipped across its height the pin turns over (owner 2026-11-03)', () => {
  const placed = placeCounterInResizeBox({ centerX: 100, centerY: 100, radius: 20, boxAngleDeg: 0, pointerAngle: 270, flipY: true });
  assert.equal(placed.top, 75); // bubble centre 5 above the box centre
  assert.equal(placed.pointerAngle, 90); // nub now points down
  // A turned box: the offset follows the box's own turn.
  const turned = placeCounterInResizeBox({ centerX: 0, centerY: 0, radius: 20, boxAngleDeg: 90, pointerAngle: 0, flipY: false });
  assert.ok(Math.abs(turned.left - (-5 - 20)) < 1e-9);
  assert.ok(Math.abs(turned.top - (0 - 20)) < 1e-9);
  assert.equal(placeCounterInResizeBox({ centerX: 0, centerY: 0, radius: 20, boxAngleDeg: 315, pointerAngle: 225, flipY: true }).pointerAngle, 45);
});
