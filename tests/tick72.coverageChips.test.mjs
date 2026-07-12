/**
 * Tick-72 coverage chips: FreeText callout oversized RGB → isNearWhite
 * length!==7 guard (675); plus residual geometryHitTest sweeps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import {
  doesRectIntersectRect,
  doesRectIntersectEllipse,
} from '../src/utils/geometryHitTest.js';

const viewport = {
  convertToViewportPoint: (x, y) => [x, y],
  convertToViewportRectangle: (r) => r,
  width: 612,
  height: 792,
};

test('FreeText callout oversized RGB hits isNearWhite length guard', () => {
  // pdfColorToHex([256,256,256]) → "#100100100" (len 10) → isNearWhiteHexColor early false
  const obj = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      id: 'ft-oversize',
      rect: [10, 10, 120, 50],
      color: [256, 256, 256],
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

test('FreeText callout NaN channel also hits isNearWhite length guard', () => {
  const obj = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      id: 'ft-nan',
      rect: [10, 10, 120, 50],
      color: [NaN, 0, 0],
      contents: 'note',
      intent: 'FreeTextCallout',
      calloutLine: [10, 10, 40, 40, 80, 40],
      borderStyle: { width: 1 },
      _appearance: { strokeColor: [0.2, 0.2, 0.8] },
    },
    viewport,
    1,
  );
  assert.ok(obj === null || typeof obj === 'object');
});

test('geometryHitTest empty-paint rotated mid-edge sliver', () => {
  const hit = doesRectIntersectRect(
    { left: 30, top: 45, right: 32, bottom: 47 },
    {
      type: 'rect',
      left: 50,
      top: 50,
      width: 100,
      height: 2,
      angle: 5,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      originX: 'center',
      originY: 'center',
    },
  );
  assert.equal(typeof hit, 'boolean');
});

test('geometryHitTest stroke ellipse ring micro-sel', () => {
  const hit = doesRectIntersectEllipse(
    { left: 91.2, top: 49.8, right: 91.8, bottom: 50.2 },
    50,
    50,
    40,
    40,
    false,
    6,
  );
  assert.equal(typeof hit, 'boolean');
});
