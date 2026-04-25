import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appRectToPdfPoints,
  pdfPointsToAppRect,
} from '../../src/utils/pdfNativeExport/coordinateSpace.js';

const PAGE_HEIGHT_PT = 792;

test('app rect (top-left origin) → PDF points (bottom-left origin)', () => {
  const rect = { left: 75, top: 75, width: 150, height: 37.5 };
  const pts = appRectToPdfPoints(rect, PAGE_HEIGHT_PT);
  assert.equal(pts.x1, 75);
  assert.equal(pts.x2, 225);
  assert.equal(pts.y2, 792 - 75);
  assert.equal(pts.y1, (792 - 75) - 37.5);
});

test('round-trip app rect ↔ PDF points is lossless', () => {
  const original = { left: 100, top: 200, width: 50, height: 25 };
  const pts = appRectToPdfPoints(original, PAGE_HEIGHT_PT);
  const back = pdfPointsToAppRect(pts, PAGE_HEIGHT_PT);
  assert.equal(back.left, original.left);
  assert.equal(back.top, original.top);
  assert.equal(back.width, original.width);
  assert.equal(back.height, original.height);
});
