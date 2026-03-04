import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf
} from '../src/utils/pdfAnnotationImporter.js';

const makeViewport = ({ xOffset = 0, yOffset = 0, pageHeight = 100 } = {}) => {
  const convertToViewportPoint = (x, y) => [x + xOffset, (pageHeight - y) + yOffset];

  return {
    height: pageHeight,
    convertToViewportPoint,
    convertToViewportRectangle(rect) {
      const [x1, y1] = convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = convertToViewportPoint(rect[2], rect[3]);
      return [x1, y1, x2, y2];
    }
  };
};

test('convertPdfAnnotationToFabric maps rectangle annotations using viewport transforms', () => {
  const viewport = makeViewport({ xOffset: 10, yOffset: 20, pageHeight: 100 });

  const annotation = {
    id: 'a1',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    color: [0, 0, 0]
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'rect');
  assert.equal(obj.left, 20);
  assert.equal(obj.top, 80);
  assert.equal(obj.width, 20);
  assert.equal(obj.height, 20);
});

test('convertPdfAnnotationToFabric ignores fully invisible square annotations', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'square-invisible-1',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    borderStyle: { width: 0 }
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);
  assert.equal(obj, null);
});

test('convertPdfAnnotationToFabric maps line endpoints using viewport point conversion', () => {
  const viewport = makeViewport({ xOffset: 7, yOffset: 3, pageHeight: 100 });

  const annotation = {
    id: 'line-1',
    subtype: 'Line',
    lineCoordinates: [5, 10, 15, 20],
    color: [0, 0, 0]
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'line');
  assert.equal(obj.x1, 12);
  assert.equal(obj.y1, 93);
  assert.equal(obj.x2, 22);
  assert.equal(obj.y2, 83);
});

test('convertPdfAnnotationToFabric applies opacity-based fill fallback for transparent Circle annotations', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'circle-1',
    subtype: 'Circle',
    rect: [10, 20, 30, 40],
    color: [1, 0, 0],
    opacity: 0.3
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'circle');
  assert.equal(obj.fill, 'rgba(255, 0, 0, 0.3)');
  assert.equal(obj.stroke, 'rgba(255, 0, 0, 0.3)');
});

test('convertPdfAnnotationToFabric smooths Ink paths and normalizes stroke width', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'ink-1',
    subtype: 'Ink',
    color: [0, 0, 1],
    borderStyle: { width: 3 },
    opacity: 0.5,
    inkLists: [
      [10, 10, 20, 20, 30, 15]
    ]
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'path');
  assert.equal(obj.stroke, 'rgba(0, 0, 255, 0.5)');
  assert.ok(Math.abs(obj.strokeWidth - 2.46) < 1e-6);
  assert.ok(obj.path.some((segment) => segment[0] === 'Q'));
});

test('convertPdfAnnotationToFabric prefers appearance-stream geometry for filled Ink annotations', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'ink-ap-1',
    subtype: 'Ink',
    color: [1, 0, 0],
    inkLists: [[10, 10, 20, 20]]
  };

  const rawMetadata = {
    ca: 0.3,
    appearance: {
      path: [
        ['M', 10, 10],
        ['L', 20, 10],
        ['L', 20, 20],
        ['Z']
      ],
      fillColor: [1, 0, 0],
      hasFill: true,
      hasStroke: true,
      strokeWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter'
    }
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport, 1, rawMetadata);

  assert.equal(obj.type, 'path');
  assert.equal(obj.fill, 'rgba(255, 0, 0, 0.3)');
  assert.equal(obj.stroke, null);
  assert.equal(obj.strokeLineCap, 'butt');
  assert.equal(obj.strokeLineJoin, 'miter');
  assert.ok(obj.path.some((segment) => segment[0] === 'Z'));
});

test('importAnnotationsFromPdf imports polygon and square annotations and reports no unsupported types', async () => {
  const viewport = makeViewport({ xOffset: 4, yOffset: 2, pageHeight: 200 });

  const page = {
    getViewport() {
      return viewport;
    },
    async getAnnotations() {
      return [
        {
          id: 'square-1',
          subtype: 'Square',
          rect: [10, 30, 50, 70],
          color: [0, 0, 0]
        },
        {
          id: 'poly-1',
          subtype: 'Polygon',
          vertices: [10, 10, 30, 10, 30, 30, 10, 30],
          color: [1, 0, 0]
        }
      ];
    }
  };

  const pdfDoc = {
    numPages: 1,
    async getPage(pageNum) {
      assert.equal(pageNum, 1);
      return page;
    }
  };

  const result = await importAnnotationsFromPdf(pdfDoc);

  assert.deepEqual(result.unsupportedTypes, []);
  assert.ok(result.annotationsByPage[1]);
  assert.equal(result.annotationsByPage[1].objects.length, 2);

  const square = result.annotationsByPage[1].objects.find((obj) => obj.pdfAnnotationType === 'Square');
  const polygon = result.annotationsByPage[1].objects.find((obj) => obj.pdfAnnotationType === 'Polygon');

  assert.ok(square);
  assert.equal(square.type, 'rect');
  assert.equal(square.left, 14);
  assert.equal(square.top, 132);
  assert.equal(square.width, 40);
  assert.equal(square.height, 40);

  assert.ok(polygon);
  assert.equal(polygon.type, 'polygon');
  assert.equal(polygon.points.length, 4);
});

test('convertPdfAnnotationToFabric preserves line endings and callout metadata for line annotations', () => {
  const viewport = makeViewport({ pageHeight: 100 });
  const annotation = {
    id: 'line-meta-1',
    subtype: 'Line',
    lineCoordinates: [10, 10, 30, 30],
    color: [0, 0, 0]
  };

  const rawMetadata = {
    lineEndings: ['None', 'ClosedArrow'],
    intent: 'LineArrow',
    calloutLine: [10, 10, 20, 20, 30, 30],
    borderDashArray: [4, 2]
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport, 1, rawMetadata);
  assert.equal(obj.type, 'line');
  assert.deepEqual(obj.data?.pdfLineEndings, ['None', 'ClosedArrow']);
  assert.equal(obj.data?.pdfIntent, 'LineArrow');
  assert.equal(obj.data?.pdfCalloutPoints?.length, 3);
  assert.deepEqual(obj.strokeDashArray, [4, 2]);
});

test('convertPdfAnnotationToFabric maps text and freetext-callout annotations with interaction metadata', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const textNote = {
    id: 'note-1',
    subtype: 'Text',
    rect: [10, 10, 20, 20],
    contents: 'Hello note'
  };

  const noteObj = convertPdfAnnotationToFabric(textNote, viewport);
  assert.equal(noteObj.type, 'rect');
  assert.equal(noteObj.data?.type, 'note');
  assert.equal(noteObj.data?.noteText, 'Hello note');

  const freeText = {
    id: 'freetext-1',
    subtype: 'FreeText',
    rect: [40, 40, 80, 60],
    color: [1, 1, 1]
  };

  const freeTextRawMetadata = {
    intent: 'FreeTextCallout',
    contents: 'Callout text',
    calloutLine: [20, 20, 30, 30, 40, 40],
    lineColor: [1, 0, 0],
    borderWidth: 1,
    defaultAppearanceData: {
      fontColor: [1, 0, 0],
      fontSize: 16
    },
    appearance: {
      path: [
        ['M', 10, 10],
        ['L', 40, 10],
        ['L', 40, 20],
        ['L', 10, 20],
        ['Z']
      ]
    }
  };

  const freeTextObj = convertPdfAnnotationToFabric(freeText, viewport, 1, freeTextRawMetadata);
  assert.equal(freeTextObj.type, 'textbox');
  assert.equal(freeTextObj.left, 10);
  assert.equal(freeTextObj.top, 80);
  assert.equal(freeTextObj.width, 30);
  assert.equal(freeTextObj.height, 10);
  assert.equal(freeTextObj.text, 'Callout text');
  assert.equal(freeTextObj.fill, '#ff0000');
  assert.equal(freeTextObj.stroke, '#ff0000');
  assert.equal(freeTextObj.backgroundColor, 'rgba(255, 255, 255, 1)');
  assert.equal(freeTextObj.data?.pdfIntent, 'FreeTextCallout');
  assert.equal(freeTextObj.data?.pdfCalloutPoints?.length, 3);
  assert.equal(freeTextObj.data?.pdfCalloutBoxRect?.width, 30);
  assert.equal(freeTextObj.data?.pdfCalloutBoxRect?.height, 10);
  assert.equal(freeTextObj.data?.pdfCalloutStyle?.borderColor, '#ff0000');
  assert.equal(freeTextObj.data?.pdfCalloutStyle?.textColor, '#ff0000');
});

test('importAnnotationsFromPdf imports AutoCAD SHX helper squares as invisible interactive proxies', async () => {
  const viewport = makeViewport({ pageHeight: 200 });

  const page = {
    getViewport() {
      return viewport;
    },
    async getAnnotations() {
      return [
        {
          id: 'shx-1',
          subtype: 'Square',
          rect: [100, 100, 108, 108],
          borderStyle: { width: 0 },
          titleObj: { str: 'AutoCAD SHX Text' },
          contentsObj: { str: '20' }
        }
      ];
    }
  };

  const pdfDoc = {
    numPages: 1,
    async getPage(pageNum) {
      assert.equal(pageNum, 1);
      return page;
    }
  };

  const result = await importAnnotationsFromPdf(pdfDoc);
  assert.ok(result.annotationsByPage[1]);
  assert.equal(result.annotationsByPage[1].objects.length, 1);
  const imported = result.annotationsByPage[1].objects[0];
  assert.equal(imported.type, 'rect');
  assert.equal(imported.fill, 'transparent');
  assert.equal(imported.stroke, 'transparent');
  assert.equal(imported.selectable, true);
  assert.equal(imported.evented, true);
  assert.equal(imported.hasControls, false);
  assert.equal(imported.perPixelTargetFind, false);
  assert.equal(imported.data?.isAutoCadShxText, true);
  assert.equal(imported.data?.shxText, '20');
  assert.deepEqual(result.unsupportedTypes, []);
});
