import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  hexToRgbTriplet,
  flipY,
  appPointToPdf,
  makeBorderArray,
  registerAnnotationDict,
  attachAnnotationToPage,
  resolveAnnotationName,
  pdfStringOrEmpty,
  pdfNumberArray,
  getStrokeWidth,
  getFabricFill,
  getFabricStroke,
} from '../src/utils/pdfNativeExport/adapters/shared.js';

test('hexToRgbTriplet parses rgba/hex and falls back', () => {
  assert.deepEqual(hexToRgbTriplet('rgba(255, 128, 0, 0.5)'), [1, 128 / 255, 0]);
  assert.deepEqual(hexToRgbTriplet('#00ff00'), [0, 1, 0]);
  assert.deepEqual(hexToRgbTriplet('not-a-color'), [0, 0, 0]);
  assert.deepEqual(hexToRgbTriplet(''), [0, 0, 0]);
});

test('coordinate and border helpers', () => {
  assert.equal(flipY(100, 20), 80);
  assert.deepEqual(appPointToPdf(100, 10, 20), { x: 10, y: 80 });
  assert.deepEqual(makeBorderArray(2.5), [0, 0, 2.5]);
  assert.deepEqual(makeBorderArray(NaN), [0, 0, 1]);
});

test('dict registration + page attach', async () => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([200, 200]);
  const ref = registerAnnotationDict(pdfDoc, {
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [0, 0, 10, 10],
  });
  assert.ok(ref);
  assert.equal(attachAnnotationToPage(pdfDoc, page, null), false);
  assert.equal(attachAnnotationToPage(pdfDoc, page, ref), true);
  assert.ok(page.node.lookup(PDFName.of('Annots')));
  // Second attach reuses existing Annots array
  const ref2 = registerAnnotationDict(pdfDoc, {
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [1, 1, 11, 11],
  });
  assert.equal(attachAnnotationToPage(pdfDoc, page, ref2), true);
});

test('name/string/number and fabric paint helpers', () => {
  assert.match(resolveAnnotationName({ pdfAnnotationId: 'a1' }, 'x'), /^a1$/);
  assert.match(resolveAnnotationName({ id: 'i2' }, 'x'), /^i2$/);
  assert.match(resolveAnnotationName({ data: { id: 'd3' } }, 'x'), /^d3$/);
  assert.match(resolveAnnotationName({}, 'prefix'), /^prefix-/);

  assert.ok(pdfStringOrEmpty(null));
  assert.equal(pdfNumberArray([1, '2', null]).length, 3);

  assert.equal(getStrokeWidth({ strokeWidth: 3 }), 3);
  assert.equal(getStrokeWidth({ strokeWidth: 'x' }), 1);
  assert.equal(getFabricFill({ fill: 'transparent' }), null);
  assert.equal(getFabricFill({ fill: 'rgba(0,0,0,0)' }), null);
  assert.equal(getFabricFill({ fill: '#f00' }), '#f00');
  assert.equal(getFabricStroke({ stroke: 'transparent' }), '#000000');
  assert.equal(getFabricStroke({ stroke: '#abc' }), '#abc');
});
