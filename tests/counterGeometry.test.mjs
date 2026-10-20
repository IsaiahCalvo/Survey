import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCounterRenderGeometry,
  removeCounterDragPreview,
  updateCounterDragPreview,
  createCounterDragPreview,
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
