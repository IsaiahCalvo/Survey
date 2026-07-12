import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sortPdfjsPagesByDistance,
  hasValidRegionAreas,
  resolvePageContentElement,
  getBoundsCenter,
} from '../src/utils/regionGeometry.js';

test('sortPdfjsPagesByDistance sorts by distance then page number', () => {
  assert.deepEqual(sortPdfjsPagesByDistance([5, 1, 3, 0, 'x', 4], 3), [3, 4, 1, 5]);
});

test('hasValidRegionAreas requires rectangular/polygon coordinate counts', () => {
  assert.equal(hasValidRegionAreas(null), false);
  assert.equal(hasValidRegionAreas({ regions: [] }), false);
  assert.equal(hasValidRegionAreas({
    regions: [{ shapeType: 'rectangular', coordinates: [0, 0, 1, 0, 1, 1, 0, 1] }],
  }), true);
  assert.equal(hasValidRegionAreas({
    regions: [{ shapeType: 'polygon', coordinates: [0, 0, 1, 0, 0.5, 1] }],
  }), true);
  assert.equal(hasValidRegionAreas({
    regions: [{ shapeType: 'rectangular', coordinates: [0, 0, 1, 1] }],
  }), false);
  assert.equal(hasValidRegionAreas({
    regions: [null, { shapeType: 'rectangular' }, { shapeType: 'polygon', coordinates: [0, 0] }],
  }), false);
});

test('resolvePageContentElement prefers pdfjs canvas then largest canvas', () => {
  assert.equal(resolvePageContentElement(null), null);
  const container = {
    querySelector(sel) {
      if (sel === '.survey-pdfjs-page-canvas') return { id: 'pdfjs' };
      return null;
    },
    querySelectorAll() { return []; },
  };
  assert.equal(resolvePageContentElement(container).id, 'pdfjs');

  const multi = {
    querySelector() { return null; },
    querySelectorAll() {
      return [
        { clientWidth: 10, clientHeight: 10, width: 10, height: 10, id: 'small' },
        { clientWidth: 40, clientHeight: 40, width: 40, height: 40, id: 'big' },
      ];
    },
  };
  assert.equal(resolvePageContentElement(multi).id, 'big');
});

test('getBoundsCenter supports x/y and left/top/right/bottom shapes', () => {
  assert.equal(getBoundsCenter(null), null);
  assert.deepEqual(getBoundsCenter({ x: 10, y: 20, width: 40, height: 10 }), {
    centerX: 30,
    centerY: 25,
    width: 40,
    height: 10,
  });
  assert.deepEqual(getBoundsCenter({ left: 0, top: 0, right: 10, bottom: 4 }), {
    centerX: 5,
    centerY: 2,
    width: 10,
    height: 4,
  });
});
