import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCloudPathCommands,
  categorizeAnnotations,
  convertInkToFabricPath,
  convertPdfAnnotationToFabric,
  extractAnnotationsFromPage,
  importAnnotationsFromPdf,
  pdfHasAnnotations,
} from '../src/utils/pdfAnnotationImporter.js';

test('categorizeAnnotations splits supported / unsupported / silent', () => {
  const { supported, unsupported } = categorizeAnnotations([
    { subtype: 'Ink' },
    { subtype: 'Square' },
    { subtype: 'Link' },
    { subtype: 'WeirdCustom' },
    { subtype: null },
  ]);
  assert.ok(supported.length >= 1);
  assert.ok(unsupported.some((a) => a.subtype === 'WeirdCustom'));
  assert.ok(!unsupported.some((a) => a.subtype === 'Link'));
});

test('buildCloudPathCommands builds closed cloud for CW and CCW quads', () => {
  assert.equal(buildCloudPathCommands(null), null);
  assert.equal(buildCloudPathCommands([{ x: 0, y: 0 }]), null);

  const cw = [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 0 },
  ];
  const cmds = buildCloudPathCommands(cw, 2, 1);
  assert.ok(Array.isArray(cmds) && cmds.length > 4);
  assert.equal(cmds[0][0], 'M');

  const ccw = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ];
  const cmds2 = buildCloudPathCommands(ccw, 3, 4);
  assert.ok(cmds2.length > 4);
});

function makeViewport() {
  return {
    height: 800,
    convertToViewportPoint: (x, y) => [x, y],
    convertToViewportRectangle: (r) => [r[0], r[1], r[2], r[3]],
  };
}

test('convertPdfAnnotationToFabric returns null for unknown subtype', () => {
  assert.equal(convertPdfAnnotationToFabric({ subtype: 'NoSuchType' }, makeViewport()), null);
});

test('convertPdfAnnotationToFabric covers Ink/Square/Circle/Line/FreeText/Polygon', () => {
  const viewport = makeViewport();

  const ink = convertPdfAnnotationToFabric({
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 2 },
    inkLists: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }]],
  }, viewport);
  assert.equal(ink?.type, 'path');
  assert.ok(Array.isArray(ink.path) && ink.path.length > 0);

  const inkFlat = convertPdfAnnotationToFabric({
    subtype: 'Ink',
    color: [0, 0, 1],
    inkLists: [[0, 0, 5, 5, 10, 0]],
  }, viewport);
  assert.equal(inkFlat?.type, 'path');

  const square = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [10, 20, 40, 50],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(square);
  assert.ok(['rect', 'path'].includes(square.type) || typeof square.left === 'number');

  const circle = convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [0, 0, 20, 20],
    color: [0, 1, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(circle);

  const line = convertPdfAnnotationToFabric({
    subtype: 'Line',
    lineCoordinates: [0, 0, 30, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(line);

  const freeText = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [5, 5, 80, 40],
    contents: 'hello',
    color: [0, 0, 0],
  }, viewport);
  assert.ok(freeText);

  const polygon = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    vertices: [0, 0, 10, 0, 10, 10, 0, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(polygon);

  const polyLine = convertPdfAnnotationToFabric({
    subtype: 'PolyLine',
    vertices: [0, 0, 15, 5, 30, 0],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(polyLine);

  const underline = convertPdfAnnotationToFabric({
    subtype: 'Underline',
    rect: [0, 0, 40, 10],
    quadPoints: [0, 10, 40, 10, 0, 0, 40, 0],
    color: [1, 0, 0],
  }, viewport);
  assert.ok(underline);

  assert.equal(convertPdfAnnotationToFabric({ subtype: 'Square', rect: null }, viewport), null);
  assert.equal(convertInkToFabricPath({ inkLists: [] }, viewport), null);
});


test('convertPdfAnnotationToFabric covers Text/Highlight/Squiggly/Caret and extract/import stubs', async () => {
  const viewport = makeViewport();

  const note = convertPdfAnnotationToFabric({
    subtype: 'Text',
    rect: [10, 10, 30, 30],
    contents: 'note',
    color: [1, 1, 0],
  }, viewport);
  assert.ok(note);

  const highlight = convertPdfAnnotationToFabric({
    subtype: 'Highlight',
    rect: [0, 0, 40, 12],
    quadPoints: [0, 12, 40, 12, 0, 0, 40, 0],
    color: [1, 1, 0],
  }, viewport);
  assert.ok(highlight);

  const squiggly = convertPdfAnnotationToFabric({
    subtype: 'Squiggly',
    rect: [0, 0, 40, 12],
    quadPoints: [0, 12, 40, 12, 0, 0, 40, 0],
    color: [1, 0, 0],
  }, viewport);
  assert.ok(squiggly);

  const caret = convertPdfAnnotationToFabric({
    subtype: 'Caret',
    rect: [5, 5, 15, 20],
    color: [0, 0, 1],
  }, viewport);
  assert.ok(caret);

  const strike = convertPdfAnnotationToFabric({
    subtype: 'StrikeOut',
    rect: [0, 0, 40, 12],
    quadPoints: [0, 12, 40, 12, 0, 0, 40, 0],
    color: [0, 0, 0],
  }, viewport);
  assert.ok(strike);

  assert.deepEqual(await extractAnnotationsFromPage({
    getAnnotations: async () => { throw new Error('ann-fail'); },
  }), []);

  assert.deepEqual(await extractAnnotationsFromPage({
    getAnnotations: async () => [{ subtype: 'Ink' }],
  }), [{ subtype: 'Ink' }]);

  const fakePdf = {
    numPages: 1,
    getPage: async () => ({
      getViewport: () => viewport,
      getAnnotations: async () => [
        {
          subtype: 'Square',
          id: 'sq-1',
          rect: [0, 0, 20, 20],
          color: [0, 0, 0],
          borderStyle: { width: 1 },
        },
        { subtype: 'Link' },
        { subtype: 'WeirdX' },
      ],
    }),
  };

  const imported = await importAnnotationsFromPdf(fakePdf, {});
  assert.ok(imported.annotationsByPage);
  assert.ok(imported.unsupportedTypes.includes('WeirdX'));

  assert.equal(await pdfHasAnnotations(fakePdf), true);
  assert.equal(await pdfHasAnnotations({
    numPages: 1,
    getPage: async () => ({ getAnnotations: async () => [{ subtype: 'Link' }] }),
  }), false);
  assert.equal(await pdfHasAnnotations({
    numPages: 1,
    getPage: async () => { throw new Error('page-fail'); },
  }), false);
});

test('convertPdfAnnotationToFabric exercises color fallbacks and opacity', () => {
  const viewport = makeViewport();

  const viaBorder = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 10, 10],
    borderColor: { 0: 219, 1: 52, 2: 37 },
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(viaBorder);

  const viaRgbObj = convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [0, 0, 10, 10],
    color: { r: 0, g: 128, b: 255 },
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(viaRgbObj);

  const gray = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 10, 10],
    color: [0.5],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(gray);

  const emptyColor = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 10, 10],
    color: [],
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(emptyColor);

  const opaque = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 10, 10],
    color: [1, 0, 0],
    borderStyle: { width: 2 },
    opacity: 50,
  }, viewport);
  assert.ok(opaque);

  const inkPairs = convertInkToFabricPath({
    color: [0, 0, 255],
    borderStyle: { width: 1 },
    inkLists: [[[0, 0], [5, 5]]],
  }, viewport);
  assert.ok(inkPairs);
});
