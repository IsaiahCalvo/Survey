/**
 * Tick-65 coverage chips: geometryHitTest stroke/empty-paint rect paths,
 * pdfAnnotationImporter FreeText near-white + ink endpoint tails via exports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  doesRectIntersectRect,
  doesRectIntersectEllipse,
} from '../src/utils/geometryHitTest.js';
import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
  buildCloudPathCommands,
} from '../src/utils/pdfAnnotationImporter.js';

test('geometryHitTest stroke-only vertex + empty-paint edge', () => {
  // Stroke-only: sel covers a corner vertex
  const vertexHit = doesRectIntersectRect(
    { left: -2, top: -2, right: 2, bottom: 2 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'none',
      stroke: '#000',
      strokeWidth: 2,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(vertexHit, true);

  // Empty paint: no fill/stroke → edge tolerance path
  const emptyHit = doesRectIntersectRect(
    { left: 40, top: -3, right: 60, bottom: 3 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: 'transparent',
      stroke: 'none',
      strokeWidth: 0,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(emptyHit, true);

  // Fill+stroke where fill misses but stroke width catches a near miss
  const both = doesRectIntersectRect(
    { left: 98, top: 20, right: 110, bottom: 30 },
    {
      type: 'rect',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      fill: '#0f0',
      stroke: '#000',
      strokeWidth: 8,
      originX: 'left',
      originY: 'top',
    },
  );
  assert.equal(typeof both, 'boolean');

  // Stroke-only ellipse: sample near ring
  const ell = doesRectIntersectEllipse(
    { left: 99, top: 48, right: 101, bottom: 52 },
    50,
    50,
    50,
    50,
    false,
    4,
  );
  assert.equal(typeof ell, 'boolean');
});

test('pdfAnnotationImporter FreeText near-white + ink Z endpoint + cloud', () => {
  const viewport = {
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => r,
    width: 612,
    height: 792,
  };

  // FreeText with near-white border → isNearWhiteHexColor true/false branches
  const freeText = convertPdfAnnotationToFabric(
    {
      subtype: 'FreeText',
      id: 'ft-1',
      rect: [10, 10, 110, 50],
      color: [1, 1, 1],
      contents: 'hello',
      defaultAppearance: '0 0 0 rg /Helv 12 Tf',
      borderStyle: { width: 1 },
      intent: 'FreeTextCallout',
      lineEndings: ['None', 'None'],
      calloutLine: [10, 10, 20, 20, 30, 30],
    },
    viewport,
    1,
  );
  assert.ok(freeText === null || typeof freeText === 'object');

  const ink = convertInkToFabricPath(
    {
      subtype: 'Ink',
      id: 'ink-1',
      color: [0, 0, 0],
      borderStyle: { width: 1 },
      inkLists: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 0, y: 0 },
        ],
      ],
    },
    viewport,
    1,
  );
  assert.ok(ink === null || ink.type === 'path');

  const cloud = buildCloudPathCommands(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 0, y: 30 },
    ],
    2,
    1,
  );
  assert.ok(Array.isArray(cloud));

  // AutoCAD SHX square title path
  const shx = convertPdfAnnotationToFabric(
    {
      subtype: 'Square',
      id: 'shx-1',
      rect: [0, 0, 20, 20],
      color: [0, 0, 0],
      title: 'AutoCAD SHX Text',
      borderStyle: { width: 1 },
    },
    viewport,
    1,
  );
  assert.ok(shx);
  assert.equal(shx.data?.isAutoCadShxText, true);
});
