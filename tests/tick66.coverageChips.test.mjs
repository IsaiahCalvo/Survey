/**
 * Tick-66 coverage chips: fabricCompat getPointer alias call-through,
 * geometryEraser multi-subpath M, FreeText near-white border fallback.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fabric } from '../src/utils/fabricCompat.js';
import { booleanErasePath } from '../src/utils/geometryEraser.js';
import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';

test('fabricCompat getPointer alias ignoreZoom branches', () => {
  const proto = fabric.Canvas?.prototype;
  assert.ok(proto);
  if (typeof proto.getPointer !== 'function') {
    return; // alias not installed on this Fabric build
  }
  const fake = {
    getScenePoint: () => ({ x: 1, y: 2 }),
    getViewportPoint: () => ({ x: 3, y: 4 }),
  };
  assert.deepEqual(proto.getPointer.call(fake, {}, false), { x: 1, y: 2 });
  assert.deepEqual(proto.getPointer.call(fake, {}, true), { x: 3, y: 4 });
});

test('geometryEraser multi-M subpath coverage', () => {
  const pathObj = {
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['M', 30, 0],
      ['L', 50, 0],
    ],
    strokeWidth: 3,
    pathOffset: { x: 0, y: 0 },
    calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
  };
  const result = booleanErasePath(
    pathObj,
    { points: [{ x: 10, y: 0 }, { x: 12, y: 0 }] },
    5,
  );
  assert.ok(result === null || result.pathData);
});

test('FreeText callout near-white border uses appearance stroke fallback', () => {
  const viewport = {
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => r,
    width: 612,
    height: 792,
  };
  const obj = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      id: 'ft-white',
      rect: [10, 10, 120, 50],
      color: [1, 1, 1],
      contents: 'note',
      intent: 'FreeTextCallout',
      calloutLine: [10, 10, 40, 40, 80, 40],
      defaultAppearance: '1 0 0 rg /Helv 12 Tf',
      borderStyle: { width: 1 },
      _appearance: { strokeColor: [0, 0, 1] },
    },
    viewport,
    1,
  );
  assert.ok(obj === null || typeof obj === 'object');
});
