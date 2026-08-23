import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';
import { placeRotationHandle, clampHandleToPage } from '../src/utils/svgBoundingBox.js';

// Source contracts for object-level mtr after page 180 (two CWs) on
// leftover-portrait viewBox 0 0 612 792. Named remapped mtr is CW +
// CCW; object-180 after CW is landscape leftover (792x612).
// Live proof: debug/scenarios/e2e-page-rotate-remap-mtr-180-page.spec.mjs

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

function worldOf(local, bbox) {
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const rad = (bbox.angle * Math.PI) / 180;
  const dx = local.x - cx;
  const dy = local.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

test('180 remapper (delta 180) hands mtr a 180deg object on leftover 612x792', () => {
  const rect = {
    type: 'rect',
    left: 122.4,
    top: 205.92,
    width: 122.4,
    height: 142.56,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'mtr-180-page', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
  const after = transformPageState(emptyModel([rect]), {
    type: 'rotate', page: 1, delta: 180, pageWidth: 612, pageHeight: 792,
  }).annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 61.2, 205.92 + 71.28, 612, 792, 180);
  assert.equal(after.angle, 180);
  assert.equal((((after.angle % 360) + 360) % 360), 180);
  assert.ok(Math.abs((after.left + 61.2) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.top + 71.28) - expected.y) < 1e-6);
  assert.notEqual(after.left, 122.4);
  assert.equal(after.data.left, after.left);
  assert.equal(after.data.angle, 180);
  const page = transformPageState(emptyModel([rect]), {
    type: 'rotate', page: 1, delta: 180, pageWidth: 612, pageHeight: 792,
  }).annotationsByPage[1];
  assert.equal(page.width, 612);
  assert.equal(page.height, 792);
});

test('placeRotationHandle + clamp stay on leftover 612x792 at remapped 180', () => {
  // RECT_BOX 0.20/0.26–0.40/0.44 after 180: center 428.40, 514.80
  const bbox = { left: 367.2, top: 443.52, width: 122.4, height: 142.56, angle: 180 };
  const placed = placeRotationHandle(bbox, {
    padding: 2,
    rotationOffset: 36,
    pageWidth: 612,
    pageHeight: 792,
    inset: 16,
  });
  assert.ok(placed);
  const clamped = clampHandleToPage(placed, bbox, { pageWidth: 612, pageHeight: 792, inset: 16 });
  const world = worldOf(clamped, bbox);
  assert.ok(world.x >= 16 - 1 && world.x <= 612 - 16 + 1, `mtr world x ${world.x}`);
  assert.ok(world.y >= 16 - 1 && world.y <= 792 - 16 + 1, `mtr world y ${world.y}`);
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  assert.ok(world.y > cy + 4, '180 world stem must sit on the +y (180deg) ray');
  assert.ok(Math.abs(world.x - cx) < 2, '180 world stem must not leave the 180deg ray');
});

test('live spec covers 180 mtr, br grow, empty invent, undo, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-mtr-180-page.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /rotate180ViaTwoCWs/);
  assert.match(spec, /post-180 mtr must update angle/);
  assert.match(spec, /post-180 br must grow bbox/);
  assert.match(spec, /empty 180 invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /Rotate 180/);
});
