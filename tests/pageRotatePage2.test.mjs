import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts: rotate page 2 only. Page 1 objects must not remap.
// Live proof: debug/scenarios/e2e-page-rotate-page2.spec.mjs
// Fixture: debug/fixtures/spike-120-pages.pdf (already used by bookmark-jump).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function twoPageModel(page1Objects, page2Objects) {
  return {
    annotationsByPage: {
      1: { width: 612, height: 792, objects: page1Objects },
      2: { width: 612, height: 792, objects: page2Objects },
    },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

test('rotate page 2 remaps page 2 only; page 1 stays identity', () => {
  const p1 = {
    type: 'rect',
    left: 122.4,
    top: 205.92,
    width: 122.4,
    height: 142.56,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'p1-rect', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
  const p2 = {
    type: 'rect',
    left: 122.4,
    top: 205.92,
    width: 122.4,
    height: 142.56,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'p2-rect', type: 'rect', tool: 'rect', pageNumber: 2 },
  };
  const after = transformPageState(twoPageModel([p1], [p2]), {
    type: 'rotate', page: 2, delta: 90, pageWidth: 612, pageHeight: 792,
  });
  const page1 = after.annotationsByPage[1].objects[0];
  const page2 = after.annotationsByPage[2].objects[0];
  assert.equal(after.annotationsByPage[1].width, 612);
  assert.equal(after.annotationsByPage[1].height, 792);
  assert.equal(after.annotationsByPage[2].width, 792);
  assert.equal(after.annotationsByPage[2].height, 612);
  assert.equal(page1.left, 122.4);
  assert.equal(page1.top, 205.92);
  assert.equal(page1.angle, 0);
  assert.equal(page1.data.pageNumber, 1);
  const expected = rotateDisplayedPoint(122.4 + 61.2, 205.92 + 71.28, 612, 792, 90);
  assert.equal(page2.angle, 90);
  assert.ok(Math.abs((page2.left + 61.2) - expected.x) < 1e-6);
  assert.ok(Math.abs((page2.top + 71.28) - expected.y) < 1e-6);
  assert.notEqual(page2.left, 122.4);
  assert.equal(page2.data.pageNumber, 2);
});

test('live spec uses spike-120-pages and asserts page-1 hold', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-page2.spec.mjs');
  assert.match(spec, /testPdf=spike-120-pages\.pdf/);
  assert.match(spec, /page 1 objects do not remap/);
  assert.match(spec, /page 1 center must not remap/);
  assert.match(spec, /empty page-2 CW invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
