import test from 'node:test';
import assert from 'node:assert/strict';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { PDFDocument } from 'pdf-lib';

import {
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf
} from '../src/utils/pdfAnnotationImporter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

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

test('convertPdfAnnotationToFabric keeps plain external Circle annotations as circles without counter metadata', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'external-circle-1',
    subtype: 'Circle',
    rect: [10, 20, 30, 40],
    color: [0, 0, 1],
    interiorColor: [0, 1, 0]
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'circle');
  assert.notEqual(obj.data?.type, 'counter');
  assert.equal(obj.appAnnotationType, undefined);
  assert.equal(obj.data?.appAnnotationMetadata, undefined);
  assert.equal(obj.pdfAnnotationType, 'Circle');
});

test('convertPdfAnnotationToFabric rebuilds marked app counter Circle annotations as counters', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const annotation = {
    id: 'counter-raw-1',
    subtype: 'Circle',
    rect: [10, 60, 34, 84],
    color: [1, 1, 1],
    interiorColor: [0.937, 0.267, 0.267]
  };
  const rawMetadata = {
    subject: 'survey-counter',
    counterMetadata: {
      app: 'SurveyApp',
      kind: 'survey-counter',
      type: 'counter',
      version: 1,
      id: 'counter-raw-1',
      displayNumber: 9,
      color: '#ef4444',
      radius: 12,
      pageNumber: 1,
      position: { left: 10, top: 16, centerX: 22, centerY: 28 },
      pointerAngle: 225,
      series: { id: 'series-1', name: 'Punch', color: '#ef4444', start: 3 },
      group: { id: 'group-1', sequence: 9 },
      data: { numberColor: '#ffffff', createdAt: 1234 }
    }
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport, 1, rawMetadata);

  assert.equal(obj.type, 'circle');
  assert.equal(obj.data.type, 'counter');
  assert.equal(obj.data.id, 'counter-raw-1');
  assert.equal(obj.data.displayNumber, 9);
  assert.equal(obj.fill, '#ef4444');
  assert.equal(obj.data.seriesId, 'series-1');
  assert.equal(obj.data.seriesName, 'Punch');
  assert.equal(obj.data.seriesStart, 3);
  assert.equal(obj.left, 10);
  assert.equal(obj.top, 16);
  assert.equal(obj.radius, 12);
});

test('exported counter PDF reimports as a counter, not a generic circle', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'counter-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};

  try {
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {
        1: {
          objects: [{
            type: 'circle',
            left: 40,
            top: 50,
            radius: 14,
            fill: '#22c55e',
            stroke: '#ffffff',
            strokeWidth: 1.5,
            data: {
              type: 'counter',
              id: 'counter-export-roundtrip',
              displayNumber: 12,
              pointerAngle: 180,
              seriesId: 'series-green',
              seriesName: 'Green List',
              seriesColor: '#22c55e',
              seriesStart: 10,
            },
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: exportedBytes,
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const obj = imported.annotationsByPage[1].objects[0];

    assert.equal(obj.type, 'circle');
    assert.equal(obj.data.type, 'counter');
    assert.equal(obj.data.id, 'counter-export-roundtrip');
    assert.equal(obj.data.displayNumber, 12);
    assert.equal(obj.fill, '#22c55e');
    assert.equal(obj.data.seriesId, 'series-green');
    assert.equal(obj.data.seriesName, 'Green List');
    assert.equal(obj.left, 40);
    assert.equal(obj.top, 50);
    assert.equal(obj.radius, 14);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('exported app-created PDF annotations reimport as editable supported annotation types', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'app-created-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};

  try {
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {
        1: {
          objects: [
            { id: 'export-path', type: 'path', left: 0, top: 0, path: [['M', 20, 20], ['L', 60, 30]], stroke: '#111111', strokeWidth: 2 },
            { id: 'export-rect', type: 'rect', left: 20, top: 50, width: 30, height: 20, fill: 'transparent', stroke: '#111111' },
            { id: 'export-circle', type: 'circle', left: 70, top: 50, radius: 10, fill: 'transparent', stroke: '#111111' },
            { id: 'export-line', type: 'line', x1: 20, y1: 100, x2: 80, y2: 110, stroke: '#111111', strokeWidth: 2 },
            { id: 'export-polygon', type: 'polygon', left: 105, top: 80, points: [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 15, y: 20 }], fill: 'transparent', stroke: '#111111' },
            { id: 'export-polyline', type: 'polyline', left: 140, top: 80, points: [{ x: 0, y: 0 }, { x: 18, y: 10 }, { x: 35, y: 4 }], stroke: '#111111' },
            { id: 'export-text', type: 'textbox', left: 20, top: 130, width: 80, height: 20, text: 'Export note', fill: '#111111' },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        surveyMarkers: {
          'export-highlight': { pageNumber: 1, bounds: { x: 100, y: 20, width: 40, height: 12 }, color: 'rgba(203, 220, 255, 0.5)', moduleId: 'module-h', regionId: 'region-h', spaceId: 'space-h' },
        },
      },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: exportedBytes,
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const objects = imported.annotationsByPage[1].objects;
    const importedTypes = objects.map((obj) => obj.pdfAnnotationType).sort();

    assert.deepEqual(importedTypes, ['Circle', 'FreeText', 'Ink', 'Line', 'PolyLine', 'Polygon', 'Square']);
    assert.ok(objects.every((obj) => obj.isPdfImported === true));
    assert.deepEqual(objects.map((obj) => obj.id).sort(), [
      'export-circle',
      'export-line',
      'export-path',
      'export-polygon',
      'export-polyline',
      'export-rect',
      'export-text',
    ]);
    assert.equal(objects.find((obj) => obj.pdfAnnotationType === 'FreeText')?.text, 'Export note');
    assert.equal(objects.find((obj) => obj.pdfAnnotationType === 'FreeText')?.appAnnotationType, 'textbox');
    const rect = objects.find((obj) => obj.id === 'export-rect');
    assert.equal(rect.appAnnotationType, 'rect');
    assert.equal(rect.moduleId, undefined);
    assert.equal(rect.regionId, undefined);
    assert.equal(rect.spaceId, undefined);
    assert.equal(objects.some((obj) => obj.id === 'export-highlight'), false);
    assert.equal(imported.unsupportedTypes.length, 0);
    assert.equal(imported.nativeLayerPolicyByPage[1].hideNativeLayer, true);
    assert.deepEqual(imported.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, []);
    assert.equal(imported.nativeLayerPolicyByPage[1].nativeRenderableAnnotationIds.length, 7);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('exported app-created pen stroke reimports with original app geometry', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'app-pen-geometry-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};

  try {
    const originalPath = [['M', 0, 0], ['Q', 20, 10, 40, 30], ['L', 80, 90]];
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {
        1: {
          objects: [{
            id: 'app-pen-original',
            type: 'path',
            left: 42,
            top: 33,
            width: 80,
            height: 90,
            path: originalPath,
            stroke: '#ff0000',
            strokeWidth: 3,
            fill: null,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            tool: 'pen',
          }],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-test' },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: exportedBytes,
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const obj = imported.annotationsByPage[1].objects[0];

    assert.equal(obj.id, 'app-pen-original');
    assert.equal(obj.type, 'path');
    assert.equal(obj.left, 42);
    assert.equal(obj.top, 33);
    assert.equal(obj.width, 80);
    assert.equal(obj.height, 90);
    assert.deepEqual(obj.path, originalPath);
    assert.equal(obj.stroke, '#ff0000');
    assert.equal(obj.strokeWidth, 3);
    assert.equal(obj.selectable, true);
    assert.equal(obj.evented, true);
    assert.equal(imported.nativeLayerPolicyByPage[1].hideNativeLayer, true);
    assert.deepEqual(imported.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('exported app-created callout reimports as one app callout without loose Line or FreeText duplicates', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'callout-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};

  try {
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {},
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-test',
        callouts: [{
          id: 'callout-roundtrip-1',
          pageNumber: 1,
          arrowTip: { x: 0.12, y: 0.18 },
          knee: { x: 0.24, y: 0.28 },
          textBoxPosition: { x: 0.42, y: 0.32 },
          textBoxWidth: 0.22,
          textBoxHeight: 0.11,
          text: 'Roundtrip callout',
          style: {
            borderColor: '#0f172a',
            fontColor: '#dc2626',
            lineThickness: 3,
            fontSize: 16,
            textAlign: 'center',
          },
        }],
      },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: exportedBytes,
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const looseObjects = imported.annotationsByPage[1]?.objects || [];
    const callouts = imported.calloutsByPage[1] || [];

    assert.equal(callouts.length, 1);
    assert.equal(looseObjects.length, 0);
    assert.deepEqual(imported.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, []);

    const callout = callouts[0];
    assert.equal(callout.id, 'callout-roundtrip-1');
    assert.equal(callout.pageNumber, 1);
    assert.equal(callout.text, 'Roundtrip callout');
    assert.equal(callout.moduleId, undefined);
    assert.equal(callout.regionId, undefined);
    assert.equal(callout.spaceId, undefined);
    assert.deepEqual(callout.arrowTip, { x: 0.12, y: 0.18 });
    assert.deepEqual(callout.knee, { x: 0.24, y: 0.28 });
    assert.deepEqual(callout.textBoxPosition, { x: 0.42, y: 0.32 });
    assert.equal(callout.textBoxWidth, 0.22);
    assert.equal(callout.textBoxHeight, 0.11);
    assert.equal(callout.style.borderColor, '#0f172a');
    assert.equal(callout.style.fontColor, '#dc2626');
    assert.equal(callout.style.lineThickness, 3);
    assert.equal(callout.style.fontSize, 16);
    assert.equal(callout.style.textAlign, 'center');
    assert.equal(callout.isPdfImported, true);
    assert.equal(callout.pdfAnnotationSubject, 'survey-callout');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('exported hidden app layer state reimports separately from regular PDF annotations', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'hidden-layer-source.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
  const originalWindow = globalThis.window;
  globalThis.window = {};

  try {
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      {
        1: {
          objects: [
            { id: 'regular-path', type: 'path', left: 0, top: 0, path: [['M', 20, 20], ['L', 60, 60]], stroke: '#ff0000', strokeWidth: 3 },
            { id: 'survey-circle', type: 'circle', left: 40, top: 40, radius: 12, moduleId: 'module-a', stroke: '#111111' },
          ],
        },
      },
      { 1: { width: 200, height: 200 } },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'doc-hidden-layer',
        spaces: [{ id: 'space-a', assignedPages: [{ pageId: 1, regions: [{ regionId: 'region-a' }] }] }],
        surveyMarkers: {
          'survey-highlight': { pageNumber: 1, moduleId: 'module-a', bounds: { x: 10, y: 10, width: 20, height: 10 } },
        },
        callouts: [{
          id: 'region-callout',
          pageNumber: 1,
          regionId: 'region-a',
          arrowTip: { x: 0.1, y: 0.1 },
          knee: { x: 0.2, y: 0.2 },
          textBoxPosition: { x: 0.3, y: 0.2 },
          text: 'Region callout',
        }],
      },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: exportedBytes,
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });

    assert.deepEqual(imported.annotationsByPage[1].objects.map((obj) => obj.id), ['regular-path']);
    assert.equal(imported.calloutsByPage[1], undefined);
    assert.equal(imported.appLayerState.documentId, 'doc-hidden-layer');
    assert.equal(imported.appLayerState.layers.scopedAnnotationsByPage[1].objects[0].id, 'survey-circle');
    assert.equal(imported.appLayerState.layers.surveyMarkers['survey-highlight'].moduleId, 'module-a');
    assert.equal(imported.appLayerState.layers.spaces[0].id, 'space-a');
    assert.equal(imported.appLayerState.layers.callouts[0].id, 'region-callout');
  } finally {
    globalThis.window = originalWindow;
  }
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

test('convertPdfAnnotationToFabric maps PDF Squiggly to stroke path contract', () => {
  const viewport = makeViewport({ pageHeight: 200 });

  const annotation = {
    id: 'squiggly-1',
    subtype: 'Squiggly',
    rect: [10, 30, 90, 50],
    color: [1, 0, 0],
    borderStyle: { width: 2 },
    opacity: 0.75,
  };

  const obj = convertPdfAnnotationToFabric(annotation, viewport);

  assert.equal(obj.type, 'path');
  assert.equal(obj.pdfAnnotationType, 'Squiggly');
  assert.equal(obj.pdfAnnotationId, 'squiggly-1');
  assert.equal(obj.isPdfImported, true);
  assert.equal(obj.stroke, 'rgba(255, 0, 0, 0.75)');
  assert.equal(obj.fill, null);
  assert.equal(obj.strokeLineCap, 'round');
  assert.equal(obj.strokeLineJoin, 'round');
  assert.ok(obj.strokeWidth <= 1.1);
  assert.equal(obj.strokeUniform, undefined);
  assert.equal(obj.left, 0);
  assert.equal(obj.top, 0);
  assert.equal(obj.selectable, true);
  assert.equal(obj.evented, true);
  assert.equal(obj.hasControls, false);
  assert.equal(obj.lockMovementX, true);
  assert.equal(obj.lockMovementY, true);
  assert.equal(obj.lockScalingX, true);
  assert.equal(obj.lockScalingY, true);
  assert.equal(obj.lockRotation, true);
  assert.ok(Array.isArray(obj.path));
  assert.ok(obj.path.length >= 80);
  const yValues = obj.path.map((segment) => segment[2]).filter(Number.isFinite);
  const peakToValley = Math.max(...yValues) - Math.min(...yValues);
  assert.ok(peakToValley < 3);
});

test('convertPdfAnnotationToFabric imports PDF text markup as select-delete only', () => {
  const viewport = makeViewport({ pageHeight: 200 });

  for (const subtype of ['Underline', 'StrikeOut']) {
    const obj = convertPdfAnnotationToFabric({
      id: `${subtype}-1`,
      subtype,
      rect: [10, 30, 90, 50],
      color: [1, 0, 0],
    }, viewport);

    assert.equal(obj.type, 'rect');
    assert.equal(obj.pdfAnnotationType, subtype);
    assert.equal(obj.selectable, true);
    assert.equal(obj.evented, true);
    assert.equal(obj.hasControls, false);
    assert.equal(obj.lockMovementX, true);
    assert.equal(obj.lockMovementY, true);
    assert.equal(obj.lockScalingX, true);
    assert.equal(obj.lockScalingY, true);
    assert.equal(obj.lockRotation, true);
  }
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

test('importAnnotationsFromPdf reports native layer can be hidden when every renderable annotation imports', async () => {
  const viewport = makeViewport({ pageHeight: 200 });

  const page = {
    getViewport() {
      return viewport;
    },
    async getAnnotations() {
      return [
        {
          id: 'ink-1',
          subtype: 'Ink',
          rect: [10, 10, 50, 50],
          color: [1, 0, 0],
          borderStyle: { width: 5 },
          hasAppearance: true,
          inkLists: [[10, 10, 20, 20, 30, 10]]
        },
        {
          id: 'poly-1',
          subtype: 'Polygon',
          vertices: [10, 10, 30, 10, 30, 30, 10, 30],
          color: [1, 0, 0],
          interiorColor: [1, 0, 0],
          opacity: 0.3,
          hasAppearance: true
        },
        {
          id: 'popup-1',
          subtype: 'Popup',
          hasAppearance: false
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

  assert.equal(result.nativeLayerPolicyByPage[1].hideNativeLayer, true);
  assert.deepEqual(result.nativeLayerPolicyByPage[1].importedIds.sort(), ['ink-1', 'poly-1']);
  assert.deepEqual(result.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, []);
  assert.equal(result.diagnosticsByPage[1].rawAnnotations.length, 3);
  assert.equal(result.diagnosticsByPage[1].importedAnnotations.length, 2);
});

test('importAnnotationsFromPdf keeps native layer visible when a renderable annotation is not imported', async () => {
  const viewport = makeViewport({ pageHeight: 200 });

  const page = {
    getViewport() {
      return viewport;
    },
    async getAnnotations() {
      return [
        {
          id: 'ink-1',
          subtype: 'Ink',
          rect: [10, 10, 50, 50],
          color: [1, 0, 0],
          borderStyle: { width: 5 },
          hasAppearance: true,
          inkLists: [[10, 10, 20, 20]]
        },
        {
          id: 'stamp-1',
          subtype: 'Stamp',
          rect: [60, 60, 90, 90],
          hasAppearance: true
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

  assert.equal(result.nativeLayerPolicyByPage[1].hideNativeLayer, false);
  assert.equal(result.nativeLayerPolicyByPage[1].reason, 'renderable-native-annotations-not-imported');
  assert.deepEqual(result.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, ['stamp-1']);
  assert.ok(result.diagnosticsByPage[1].importedAnnotations.some((entry) => (
    entry.rawId === 'stamp-1' &&
    entry.status === 'native-only' &&
    entry.reason === 'unsupported-renderable-native-annotation'
  )));
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
  assert.equal(freeTextObj.left, 4);
  assert.equal(freeTextObj.top, 74);
  assert.equal(freeTextObj.width, 42);
  assert.equal(freeTextObj.height, 22);
  assert.equal(freeTextObj.text, 'Callout text');
  assert.equal(freeTextObj.fill, '#ff0000');
  assert.equal(freeTextObj.stroke, '#ff0000');
  assert.equal(freeTextObj.backgroundColor, 'transparent');
  assert.equal(freeTextObj.data?.pdfIntent, 'FreeTextCallout');
  assert.equal(freeTextObj.data?.pdfCalloutPoints?.length, 3);
  assert.equal(freeTextObj.data?.pdfCalloutBoxRect?.width, 30);
  assert.equal(freeTextObj.data?.pdfCalloutBoxRect?.height, 83.84);
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

// KAL-20 regression: synthetic mixed fixture proves the importer surfaces
// FileAttachment in `unsupportedTypes` while still importing the supported
// Square next to it. The fixture is generated by
// `scripts/kal-20-generate-mixed-fixture.mjs` and lives under
// `debug/fixtures/pdf-native-edge-cases/`. The notice in App.jsx is driven
// directly by this array, so this is the unit-level regression cover for
// the bottom-right Unsupported Annotations Notice positive case.
test('importAnnotationsFromPdf flags FileAttachment as unsupported on the synthetic mixed fixture', async () => {
  const fixtureUrl = new URL(
    '../debug/fixtures/pdf-native-edge-cases/kal-20-mixed-fileattachment.pdf',
    import.meta.url
  );
  const fs = await import('node:fs/promises');
  const bytes = new Uint8Array(await fs.readFile(fixtureUrl));

  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(0),
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;

  const result = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });

  assert.ok(
    result.unsupportedTypes.includes('FileAttachment'),
    `expected FileAttachment in unsupportedTypes, got ${JSON.stringify(result.unsupportedTypes)}`
  );

  // Supported Square still imports next to the unsupported FileAttachment.
  assert.ok(result.annotationsByPage[1], 'expected page 1 to have imported objects');
  const types = result.annotationsByPage[1].objects.map((obj) => obj?.pdfAnnotationType);
  assert.ok(types.includes('Square'), `expected Square import, got ${JSON.stringify(types)}`);
});
