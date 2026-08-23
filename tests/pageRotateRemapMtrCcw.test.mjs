import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';
import { placeRotationHandle, clampHandleToPage } from '../src/utils/svgBoundingBox.js';

// Source contracts for object-level mtr after page CCW (angle -90 / 270
// on viewBox 0 0 792 612). Named remapped mtr is CW-only.
// Live proof: debug/scenarios/e2e-page-rotate-remap-mtr-ccw.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = []) {
  return {
    annotationsByPage: { 1: { width: 612, height: 792, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

test('CCW remapper hands mtr a -90deg object on swapped 792x612', () => {
  const rect = {
    type: 'rect',
    left: 122.4,
    top: 205.92,
    width: 122.4,
    height: 142.56,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'mtr-ccw', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
  const after = transformPageState(emptyModel([rect]), {
    type: 'rotate', page: 1, delta: -90, pageWidth: 612, pageHeight: 792,
  }).annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 61.2, 205.92 + 71.28, 612, 792, -90);
  assert.equal(after.angle, -90);
  assert.equal((((after.angle % 360) + 360) % 360), 270);
  assert.ok(Math.abs((after.left + 61.2) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.top + 71.28) - expected.y) < 1e-6);
  assert.notEqual(after.left, 122.4);
});

test('placeRotationHandle + clamp stay on swapped page at CCW -90', () => {
  const bbox = { left: 205.92, top: 367.2, width: 122.4, height: 142.56, angle: -90 };
  const placed = placeRotationHandle(bbox, {
    padding: 2,
    rotationOffset: 36,
    pageWidth: 792,
    pageHeight: 612,
    inset: 16,
  });
  assert.ok(placed);
  const clamped = clampHandleToPage(placed, bbox, { pageWidth: 792, pageHeight: 612, inset: 16 });
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const rad = (-90 * Math.PI) / 180;
  const world = {
    x: cx + (clamped.x - cx) * Math.cos(rad) - (clamped.y - cy) * Math.sin(rad),
    y: cy + (clamped.x - cx) * Math.sin(rad) + (clamped.y - cy) * Math.cos(rad),
  };
  assert.ok(world.x >= 16 - 1 && world.x <= 792 - 16 + 1);
  assert.ok(world.y >= 16 - 1 && world.y <= 612 - 16 + 1);
});

test('live spec covers CCW mtr, empty invent, undo, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-mtr-ccw.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Rotate counter-clockwise/);
  assert.match(spec, /post-CCW mtr must update angle/);
  assert.match(spec, /empty CCW invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
