import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
  parsePdfAppAnnotationMetadata,
  serializePdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';
import { createInkPathAffine } from '../src/utils/inkGeometryTransform.js';

const assertMatrixClose = (actual, expected) => {
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= 1e-9,
      `matrix[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
};

test('PDF app metadata round-trips long ink source geometry without truncation', () => {
  const sourcePoints = Array.from(
    { length: 1200 },
    (_unused, index) => [index / 10, Math.sin(index / 20)],
  );
  const presentationPath = [
    ['M', sourcePoints[0][0], sourcePoints[0][1]],
    ...sourcePoints.slice(1).map(([x, y]) => ['L', x, y]),
  ];
  const object = {
    id: 'long-source-ink',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 10, 10]],
    cmds: [['M', 0, 0], ['L', 10, 10]],
    left: 150,
    top: 130,
    width: 10,
    height: 10,
    pathOffset: { x: 5, y: 5 },
    scaleX: 2.3,
    scaleY: 0.37,
    angle: 61,
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
    flipX: true,
    flipY: false,
    skewX: 14,
    skewY: -7,
    originX: 'left',
    originY: 'top',
    paperEraserBaseTransform: {
      left: 20,
      top: 30,
      scaleX: 2,
      scaleY: 3,
      angle: 12,
    },
    paperSourceStroke: {
      path: [['m', 0, 5], ['a', 5, 5, 0, 0, 1, 10, 0], ['z']],
      operationalPath: [
        ['M', 0, 5],
        ['C', 0, 2.2386, 2.2386, 0, 5, 0],
        ['C', 7.7614, 0, 10, 2.2386, 10, 5],
        ['Z'],
      ],
      matrix: [1, 0, 0, 1, 150, 130],
      paintMode: 'fill',
      fill: '#c1121f',
      fillRule: 'evenodd',
    },
    paperEraserCuts: [[[
      [4, 3],
      [6, 3],
      [6, 7],
      [4, 7],
      [4, 3],
    ]]],
    data: {
      id: 'long-source-ink',
      tool: 'pen',
      inkGeometrySpace: 'local',
      inkGeometryOrigin: 'center-v1',
      pdfInkSourceGeometry: {
        version: 1,
        kind: 'ink-list',
        inkLists: [sourcePoints],
      },
      pdfInkPresentationGeometry: {
        version: 1,
        path: presentationPath,
      },
    },
  };

  const metadata = buildPdfAppAnnotationMetadata(object);
  assert.equal(metadata.data.pdfInkSourceGeometry.inkLists[0].length, 1200);
  assert.equal(metadata.data.pdfInkPresentationGeometry.path.length, 1200);
  assert.deepEqual(metadata.geometry.cmds, object.cmds);
  assert.deepEqual(
    metadata.geometry.paperEraserBaseTransform,
    object.paperEraserBaseTransform,
  );
  assert.deepEqual(metadata.geometry.paperSourceStroke, object.paperSourceStroke);
  assert.deepEqual(metadata.geometry.paperEraserCuts, object.paperEraserCuts);
  assert.equal(metadata.geometry.inkGeometrySpace, 'local');
  assert.equal(metadata.geometry.inkGeometryOrigin, 'center-v1');
  assert.equal(metadata.geometry.flipX, true);
  assert.equal(metadata.geometry.flipY, false);
  assert.equal(metadata.geometry.skewX, 14);
  assert.equal(metadata.geometry.skewY, -7);
  assert.equal(metadata.geometry.originX, 'left');
  assert.equal(metadata.geometry.originY, 'top');

  const parsed = parsePdfAppAnnotationMetadata(
    serializePdfAppAnnotationMetadata(object),
  );
  const restored = applyPdfAppAnnotationMetadata(
    { type: 'path', data: {} },
    parsed,
  );
  assert.deepEqual(restored.data.pdfInkSourceGeometry.inkLists[0], sourcePoints);
  assert.deepEqual(restored.data.pdfInkPresentationGeometry.path, presentationPath);
  assert.deepEqual(restored.paperEraserBaseTransform, object.paperEraserBaseTransform);
  assert.deepEqual(restored.paperSourceStroke, object.paperSourceStroke);
  assert.deepEqual(restored.paperEraserCuts, object.paperEraserCuts);
  assert.equal(restored.flipX, true);
  assert.equal(restored.flipY, false);
  assert.equal(restored.skewX, 14);
  assert.equal(restored.skewY, -7);
  assert.equal(restored.originX, 'left');
  assert.equal(restored.originY, 'top');
  assertMatrixClose(
    createInkPathAffine(restored, restored.path).matrix,
    createInkPathAffine(object, object.path).matrix,
  );
});

test('PDF app metadata preserves geometry beyond the former 50,000-entry boundary', () => {
  const path = Array.from(
    { length: 50_001 },
    (_unused, index) => [index === 0 ? 'M' : 'L', index, index % 17],
  );
  const object = {
    id: 'over-50k-ink',
    type: 'path',
    tool: 'pen',
    path,
    data: {
      id: 'over-50k-ink',
      tool: 'pen',
      pdfInkPresentationGeometry: {
        version: 1,
        path,
      },
    },
  };

  const parsed = parsePdfAppAnnotationMetadata(
    serializePdfAppAnnotationMetadata(object),
  );
  const restored = applyPdfAppAnnotationMetadata(
    { type: 'path', data: {} },
    parsed,
  );

  assert.equal(restored.path.length, 50_001);
  assert.deepEqual(restored.path.at(-1), ['L', 50_000, 50_000 % 17]);
  assert.equal(restored.data.pdfInkPresentationGeometry.path.length, 50_001);
  assert.deepEqual(
    restored.data.pdfInkPresentationGeometry.path.at(-1),
    ['L', 50_000, 50_000 % 17],
  );
});
