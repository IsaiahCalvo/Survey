import assert from 'node:assert/strict';
import test from 'node:test';

import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';

const viewport = {
  convertToViewportRectangle: ([x1, y1, x2, y2]) => [x1, y1, x2, y2],
};

test('no-appearance Circle keeps PDF.js numeric dashed border style', () => {
  const result = convertPdfAnnotationToFabric({
    id: 'circle-no-ap',
    subtype: 'Circle',
    rect: [20, 20, 120, 80],
    color: new Uint8ClampedArray([26, 51, 217]),
    interiorColor: null,
    hasAppearance: false,
    borderStyle: { width: 2, style: 2, dashArray: [5, 3] },
  }, viewport, 1);

  assert.deepEqual(result.strokeDashArray, [5, 3]);
});

test('no-appearance FreeText uses C for its frame, IC for its tint, and parsed DA for text', () => {
  const result = convertPdfAnnotationToFabric({
    id: 'freetext-no-ap',
    subtype: 'FreeText',
    rect: [45, 415, 275, 480],
    color: new Uint8ClampedArray([242, 242, 255]),
    interiorColor: new Uint8ClampedArray([255, 242, 204]),
    contents: 'Three lines',
    hasAppearance: false,
    borderStyle: { width: 1, style: 1, dashArray: [3] },
    defaultAppearanceData: {
      fontSize: 10,
      fontName: 'Helv',
      fontColor: new Uint8ClampedArray([0, 0, 178]),
    },
  }, viewport, 1);

  assert.equal(result.stroke, '#f2f2ff');
  assert.equal(result.backgroundColor, 'rgba(255, 242, 204, 1)');
  assert.equal(result.fill, '#0000b2');
});
