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
