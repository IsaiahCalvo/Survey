import test from 'node:test';
import assert from 'node:assert/strict';
import { convertInkToFabricPath } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalPenPathSpec } from '../src/utils/nativeShapeFactory.js';
import { renderPathToSvgAttrs } from '../src/utils/svgPathAttrs.js';

// UX 2026-04-21 (import-normalization Chunk 2): the imported Ink Fabric
// spec must be field-for-field identical to an internally-drawn pen
// stroke for every behavior-gating field. Provenance fields
// (isPdfImported, pdfAnnotationId, pdfAnnotationType) are allowed to
// differ — they're metadata, not behavior. If this test fails the
// zoom-gap-on-imports bug + the eraser-thickens-imports bug will regress.

const inkAnnotation = {
  id: 'ink-norm-1',
  subtype: 'Ink',
  inkLists: [[10, 10, 20, 20, 30, 15]],
  color: [0, 0, 0],
  borderWidth: 2,
  rect: [0, 0, 100, 100],
};

const viewport = {
  height: 100,
  convertToViewportPoint: (x, y) => [x, 100 - y],
};

test('imported Ink has the same core Fabric properties as an internal pen stroke', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, 1);
  assert.ok(imported, 'convertInkToFabricPath should return a Fabric spec');
  const internal = makeInternalPenPathSpec({
    stroke: imported.stroke,
    strokeWidth: imported.strokeWidth,
  });

  const sharedKeys = ['type', 'fill', 'strokeUniform', 'strokeLineCap', 'strokeLineJoin'];
  for (const key of sharedKeys) {
    assert.equal(
      imported[key],
      internal[key],
      `Field drift on ${key}: imported=${JSON.stringify(imported[key])}, internal=${JSON.stringify(internal[key])}`
    );
  }
});

test('imported Ink preserves isPdfImported flag and pdfAnnotationType as metadata-only', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, 1);
  assert.ok(imported);
  assert.equal(imported.isPdfImported, true);
  assert.equal(imported.pdfAnnotationType, 'Ink');
  // Provenance id should be propagated from the annotation.
  assert.equal(imported.pdfAnnotationId, 'ink-norm-1');
});

test('imported Ink path is normalized to local coords with left/top carrying world position', () => {
  // UX 2026-04-21 (bbox-drift fix): regression test for the pen-stroke
  // resize drift bug. Imported Ink used to carry its path commands in
  // absolute viewport coords with no left/top, which caused
  // svgBoundingBox.getPathBBox Case 2 to double-count the world
  // translation after Fabric set `left` during resize (offsetX + minX*sx
  // instead of just offsetX). Fix: translate path data to local coords
  // at import time and carry the world placement on left/top.
  const ink = {
    id: 'ink-norm-local-1',
    subtype: 'Ink',
    // Two points in PDF coords: (10, 20) and (30, 40).
    inkLists: [[10, 20, 30, 40]],
    color: [0, 0, 0],
    borderWidth: 2,
    rect: [0, 0, 100, 100],
  };
  const vp = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const r = convertInkToFabricPath(ink, vp, 1);
  assert.ok(r);

  // After PDF → viewport flip: point 1 (10, 80), point 2 (30, 60).
  // minX=10, minY=60, maxX=30, maxY=80 → width=20, height=20.
  assert.equal(r.left, 10);
  assert.equal(r.top, 60);
  assert.equal(r.width, 20);
  assert.equal(r.height, 20);

  // Path data should now start at (0, 0) in local coords.
  assert.ok(Array.isArray(r.path) && r.path.length > 0, 'path should be non-empty');
  const firstCmd = r.path[0];
  // First command is ['M', x, y]; verify local coords fit inside [0..width]×[0..height].
  assert.ok(firstCmd[1] >= 0 && firstCmd[1] <= 20, `firstCmd[1]=${firstCmd[1]} out of [0,20]`);
  assert.ok(firstCmd[2] >= 0 && firstCmd[2] <= 20, `firstCmd[2]=${firstCmd[2]} out of [0,20]`);

  // Every subsequent coord pair should also be local (inside the bbox).
  for (const cmd of r.path) {
    for (let j = 1; j + 1 < cmd.length; j += 2) {
      assert.ok(
        cmd[j] >= 0 && cmd[j] <= 20,
        `local x out of [0,20]: cmd=${JSON.stringify(cmd)}`
      );
      assert.ok(
        cmd[j + 1] >= 0 && cmd[j + 1] <= 20,
        `local y out of [0,20]: cmd=${JSON.stringify(cmd)}`
      );
    }
  }
});

test('renderPathToSvgAttrs produces identical attrs for imported vs internal paths with same inputs', () => {
  const base = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 10, 10],
    ],
    stroke: '#000',
    strokeWidth: 2,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  };
  const imported = { ...base, isPdfImported: true, pdfAnnotationType: 'Ink', pdfAnnotationId: 'p1' };
  const internal = { ...base };

  const a = renderPathToSvgAttrs(imported);
  const b = renderPathToSvgAttrs(internal);

  const keys = [
    'stroke',
    'strokeWidth',
    'fill',
    'vectorEffect',
    'strokeLinecap',
    'strokeLinejoin',
    'opacity',
  ];
  for (const key of keys) {
    assert.equal(a[key], b[key], `attr drift on ${key}: imported=${a[key]}, internal=${b[key]}`);
  }
});
