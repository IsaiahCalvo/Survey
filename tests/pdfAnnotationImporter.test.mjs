import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  buildPdfImportStatisticsSummary,
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf
} from '../src/utils/pdfAnnotationImporter.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cloneBytesForPdfjs = (bytes) => {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) return Uint8Array.from(bytes);
  if (bytes instanceof Uint8Array) return bytes.slice();
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return bytes;
};

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

test('buildPdfImportStatisticsSummary derives sampled, fallback, and skipped from importer diagnostics', () => {
  const summary = buildPdfImportStatisticsSummary({
    1: {
      importedAnnotations: [
        {
          status: 'imported',
          importOutcome: 'sampled',
          importOutcomeReason: 'appearance-path',
          rawSubtype: 'Ink',
        },
        {
          status: 'imported',
          importOutcome: 'fallback',
          importOutcomeReason: 'ink-list-polyline',
          rawSubtype: 'Ink',
        },
        {
          status: 'native-only',
          reason: 'unsupported-renderable-native-annotation',
          rawSubtype: 'Stamp',
        },
        {
          status: 'skipped',
          reason: 'converter-returned-null',
          rawSubtype: 'Square',
        },
        {
          status: 'app-callout-piece-grouped',
          importOutcome: 'sampled',
          importOutcomeReason: 'survey-app-callout-metadata',
          rawSubtype: 'Line',
        },
      ],
    },
  }, {
    pdfName: 'mixed-annotations.pdf',
    pageCount: 1,
  });

  assert.equal(summary.pdfName, 'mixed-annotations.pdf');
  assert.deepEqual(summary.counts, { sampled: 2, fallback: 2, skipped: 1 });
  assert.equal(summary.total, 5);
  assert.deepEqual(summary.byStatus, {
    imported: 2,
    'native-only': 1,
    skipped: 1,
    'app-callout-piece-grouped': 1,
  });
  assert.deepEqual(summary.bySubtype.Ink, { sampled: 1, fallback: 1, skipped: 0 });
  assert.equal(
    summary.reasons.fallback['unsupported-renderable-native-annotation'],
    1,
  );
  assert.equal(summary.reasons.skipped['converter-returned-null'], 1);
});

test('buildPdfImportStatisticsSummary treats PDF-provided subtype keys as data, not object prototypes', () => {
  const summary = buildPdfImportStatisticsSummary({
    1: {
      importedAnnotations: [{
        status: 'native-only',
        rawSubtype: '__proto__',
        reason: 'unsupported-renderable-native-annotation',
      }],
    },
  });

  assert.equal(summary.bySubtype.__proto__.fallback, 1);
  assert.equal(Object.prototype.fallback, undefined);
});

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

test('importAnnotationsFromPdf reports an unparseable counter marker as fallback', async () => {
  const viewport = makeViewport({ pageHeight: 100 });
  const pdfDoc = {
    numPages: 1,
    async getPage() {
      return {
        getViewport: () => viewport,
        async getAnnotations() {
          return [{
            id: 'broken-counter-1',
            subtype: 'Circle',
            subject: 'survey-counter',
            rect: [10, 20, 30, 40],
            color: [1, 0, 0],
          }];
        },
      };
    },
  };

  const result = await importAnnotationsFromPdf(pdfDoc);
  assert.deepEqual(result.importStatistics.counts, {
    sampled: 0,
    fallback: 1,
    skipped: 0,
  });
  assert.equal(
    result.diagnosticsByPage[1].importedAnnotations[0].importOutcomeReason,
    'counter-metadata-unparseable',
  );
});

test('importAnnotationsFromPdf records a failed page as skipped instead of dropping it', async () => {
  const pdfDoc = {
    numPages: 1,
    async getPage() {
      throw new TypeError('broken page geometry');
    },
  };

  const result = await importAnnotationsFromPdf(pdfDoc, {
    pdfName: 'broken-page.pdf',
  });
  assert.deepEqual(result.importStatistics.counts, {
    sampled: 0,
    fallback: 0,
    skipped: 1,
  });
  assert.equal(result.diagnosticsByPage[1].importedAnnotations[0].rawSubtype, 'Page');
  assert.equal(
    result.diagnosticsByPage[1].importedAnnotations[0].reason,
    'page-import-failed',
  );
  assert.equal(result.nativeLayerPolicyByPage[1].reason, 'page-import-failed');
});

test('importAnnotationsFromPdf records a getAnnotations failure as skipped instead of an empty page', async () => {
  const pdfDoc = {
    numPages: 1,
    async getPage() {
      return {
        getViewport: () => makeViewport({ pageHeight: 100 }),
        async getAnnotations() {
          throw new TypeError('broken annotation tree');
        },
      };
    },
  };

  const result = await importAnnotationsFromPdf(pdfDoc, {
    pdfName: 'broken-annotations.pdf',
  });
  assert.deepEqual(result.importStatistics.counts, {
    sampled: 0,
    fallback: 0,
    skipped: 1,
  });
  assert.equal(result.diagnosticsByPage[1].importedAnnotations[0].rawSubtype, 'Page');
  assert.equal(
    result.diagnosticsByPage[1].importedAnnotations[0].errorMessage,
    'broken annotation tree',
  );
  assert.equal(result.nativeLayerPolicyByPage[1].reason, 'page-import-failed');
});

test('one corrupt stroke does not discard healthy annotations on the same page', async () => {
  const corruptPaintOperations = [];
  Object.defineProperty(corruptPaintOperations, 'map', {
    value() {
      throw new TypeError('corrupt stroke appearance operations');
    },
  });
  const annotations = [
    {
      id: 'healthy-square',
      subtype: 'Square',
      rect: [10, 10, 30, 30],
      color: [1, 0, 0],
      borderStyle: { width: 1 },
    },
    {
      id: 'corrupt-ink',
      subtype: 'Ink',
      rect: [35, 35, 55, 55],
      color: [0, 0, 0],
      borderStyle: { width: 2 },
      inkLists: [[35, 35, 45, 45, 55, 40]],
      hasAppearance: true,
      _appearance: {
        path: [['M', 35, 35], ['L', 45, 45], ['L', 55, 40]],
        hasStroke: true,
        strokeWidth: 2,
        paintOperations: corruptPaintOperations,
      },
    },
    {
      id: 'healthy-circle',
      subtype: 'Circle',
      rect: [60, 60, 80, 80],
      color: [0, 0, 1],
      borderStyle: { width: 1 },
    },
  ];
  const pdfDoc = {
    numPages: 1,
    async getPage() {
      return {
        getViewport: () => makeViewport({ pageHeight: 100 }),
        async getAnnotations() {
          return annotations;
        },
      };
    },
  };
  const originalError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await importAnnotationsFromPdf(pdfDoc, { pdfName: 'mixed-corrupt-page.pdf' });
  } finally {
    console.error = originalError;
  }

  assert.notEqual(result.nativeLayerPolicyByPage[1].reason, 'page-import-failed');
  assert.deepEqual(
    result.annotationsByPage[1].objects.map((object) => object.pdfAnnotationId),
    ['healthy-square', 'healthy-circle'],
  );
  const corruptDiag = result.diagnosticsByPage[1].importedAnnotations
    .find((entry) => entry.rawId === 'corrupt-ink');
  assert.equal(corruptDiag.status, 'skipped');
  assert.equal(corruptDiag.reason, 'annotation-import-failed');
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
      data: cloneBytesForPdfjs(exportedBytes),
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
      data: cloneBytesForPdfjs(exportedBytes),
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
      data: cloneBytesForPdfjs(exportedBytes),
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
      data: cloneBytesForPdfjs(exportedBytes),
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
      data: cloneBytesForPdfjs(exportedBytes),
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

test('convertPdfAnnotationToFabric preserves InkList path commands and native stroke width', () => {
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
  // /BS width is rendering/export geometry truth. Interaction code may use a
  // larger hit target, but import must not thicken or shrink the annotation.
  assert.equal(obj.strokeWidth, 3);
  assert.deepEqual(
    obj.path.map((segment) => segment[0]),
    ['M', 'L', 'L'],
    'InkList points remain exact unless a stroked appearance path is available',
  );
});

test('convertPdfAnnotationToFabric maps PDF Squiggly to native text markup', () => {
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

  assert.equal(obj.type, 'group');
  assert.equal(obj.data.type, 'text-markup');
  assert.equal(obj.data.markupType, 'squiggly');
  assert.equal(obj.pdfAnnotationType, 'Squiggly');
  assert.equal(obj.pdfAnnotationId, 'squiggly-1');
  assert.equal(obj.isPdfImported, true);
  assert.equal(obj.stroke, '#ff0000');
  assert.equal(obj.opacity, 0.75);
  assert.equal(obj.selectable, true);
  assert.equal(obj.evented, true);
  assert.equal(obj.hasControls, false);
  assert.equal(obj.lockMovementX, true);
  assert.equal(obj.lockMovementY, true);
  assert.equal(obj.lockScalingX, true);
  assert.equal(obj.lockScalingY, true);
  assert.equal(obj.lockRotation, true);
  assert.ok(Array.isArray(obj.data.quads));
  assert.equal(obj.data.textRangeModel, undefined);
});

test('convertPdfAnnotationToFabric imports unmatched PDF text markup without stretch handles', () => {
  const viewport = makeViewport({ pageHeight: 200 });

  for (const subtype of ['Underline', 'StrikeOut']) {
    const obj = convertPdfAnnotationToFabric({
      id: `${subtype}-1`,
      subtype,
      rect: [10, 30, 90, 50],
      color: [1, 0, 0],
    }, viewport);

    assert.equal(obj.type, 'group');
    assert.equal(obj.data.type, 'text-markup');
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
  // UX 2026-07-17 (import-normalization item 4): filled appearance-stream ink
  // converges onto the NATIVE paper-ink representation at import — evenodd
  // polygons, transparent stroke — the same shape createProductionPaperInk
  // emits, so it rides the native render/hit/erase branch.
  assert.equal(obj.stroke, 'transparent');
  assert.equal(obj.strokeWidth, 0);
  assert.equal(obj.fillRule, 'evenodd');
  assert.equal(obj.paperInkGeometry, 'v1');
  assert.ok(Array.isArray(obj.polygons) && obj.polygons.length > 0, 'native polygons derived at import');
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
  assert.deepEqual(
    result.importStatistics.counts,
    { sampled: 2, fallback: 0, skipped: 0 },
    'a clean supported import must report zero fallback and skipped annotations',
  );

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
        },
        {
          id: 'sound-1',
          subtype: 'Sound',
          rect: [100, 60, 130, 90],
          hasAppearance: true
        },
        {
          id: 'sound-1',
          subtype: 'Sound',
          rect: [100, 60, 130, 90],
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

  assert.equal(result.nativeLayerPolicyByPage[1].hideNativeLayer, false);
  assert.equal(result.nativeLayerPolicyByPage[1].reason, 'renderable-native-annotations-not-imported');
  assert.deepEqual(result.nativeLayerPolicyByPage[1].nativeOnlyAnnotationIds, ['stamp-1']);
  assert.ok(result.diagnosticsByPage[1].importedAnnotations.some((entry) => (
    entry.rawId === 'stamp-1' &&
    entry.status === 'native-only' &&
    entry.reason === 'unsupported-renderable-native-annotation'
  )));
  assert.deepEqual(
    result.importStatistics.counts,
    { sampled: 0, fallback: 2, skipped: 1 },
    'InkList and native-only Stamp are fallbacks; non-renderable Sound is skipped',
  );
  assert.equal(
    result.diagnosticsByPage[1].importedAnnotations.filter((entry) => (
      entry.rawId === 'sound-1'
    )).length,
    1,
    'duplicate unsupported /NM ids must not inflate import statistics',
  );
  assert.ok(result.diagnosticsByPage[1].importedAnnotations.some((entry) => (
    entry.rawId === 'sound-1'
    && entry.status === 'skipped'
    && entry.reason === 'unsupported-nonrenderable-annotation'
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

  const dotted = convertPdfAnnotationToFabric({
    ...annotation,
    id: 'line-zero-dash-1',
    borderStyle: {
      style: 'D',
      dashArray: [0, 10],
    },
  }, viewport, 1);
  assert.deepEqual(
    dotted.strokeDashArray,
    [0, 10],
    'valid zero dash entries must not be deleted',
  );
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

// ---------------------------------------------------------------------------
// PATCH-DELETION SAFETY TESTS — KAL-256 §2.4 (embedded re-import)
//
// The embedded-import effect in PDFViewer.jsx runs the embedded PDF importer
// the first time a document is opened.
//
// KAL-275 (2026-08-19): a former half (a) of this block mirrored the OLD
// `hydration.count === 0` decision predicate. Production abandoned that gate —
// the import is now triggered by the durable per-document marker
// `documents.embedded_import_completed_at`, precisely because gating on
// count===0 let a single early stroke suppress the import forever. The
// mirrored predicate was defined inside THIS test file, so it asserted against
// its own local fixture and guarded nothing that ships; it was deleted with
// the patch it mirrored.
//
// What remains is the EFFECT half: importAnnotationsFromPdf run against a real
// fixture PDF that carries embedded annotations must return a non-empty
// per-page set with isPdfImported marks. This is the work the import does; if
// it were removed, a document carrying embedded markups would open blank.
//
// HOW TO VERIFY IT IS LOAD-BEARING:
//   Remove importAnnotationsFromPdf or change it to always return
//   { annotationsByPage: {}, ... }. The `totalImported > 0` assertion and
//   `isPdfImported === true` assertion will fail, proving the importer is the
//   actual mechanism the embedded import relies on.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (b) Self-heal effect: importAnnotationsFromPdf returns embedded marks
//     from a real PDF fixture that is known to carry annotations.
//
// Fixture: debug/fixtures/clickable-link-test.pdf
//   The importer currently returns 9 editable marks, including the native
//   hyperlink that used to live only in the pdf.js link overlay.
//
// Fixture: debug/fixtures/se011.pdf
//   Confirmed embedded annotation count: 500 marks across 99 pages.
//
// We assert "> 0 imported marks with isPdfImported===true" rather than an
// exact count to be resilient to future importer improvements that may
// parse additional annotation subtypes. The specific confirmed counts are
// documented in comments for reference.
// ---------------------------------------------------------------------------

test('[KAL-256] patch-deletion safety: self-heal effect — importAnnotationsFromPdf returns editable marks from clickable-link-test.pdf', async () => {
  const fixturePath = join(__dirname, '..', 'debug', 'fixtures', 'clickable-link-test.pdf');
  const bytes = readFileSync(fixturePath);

  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfjs(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;

  // This is the exact call the self-heal effect makes (PDFViewer.jsx:20632-20633).
  const result = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });

  const allObjects = Object.values(result.annotationsByPage || {})
    .flatMap((pg) => (Array.isArray(pg?.objects) ? pg.objects : []));

  const totalImported = allObjects.length;

  // Confirmed count at authoring: 8. Assert > 0 to be importer-resilient.
  assert.ok(totalImported > 0, `fixture must have > 0 imported marks (confirmed 8); got ${totalImported}`);

  // Every returned object must carry isPdfImported===true — the flag the
  // self-heal stamps on marks and that mergePreservingImportedMarks uses to
  // identify them for preservation.
  const withFlag = allObjects.filter((o) => o.isPdfImported === true);
  assert.equal(
    withFlag.length,
    totalImported,
    'every imported object must have isPdfImported===true'
  );
  const importedTextMarkup = allObjects.filter((object) => object?.data?.type === 'text-markup');
  assert.deepEqual(
    importedTextMarkup.map((object) => object.data.markupType).sort(),
    ['link', 'squiggly', 'strikeout', 'underline'],
  );
  assert.ok(
    importedTextMarkup.every((object) => object.data.textRangeModel?.runs?.length > 0),
    'every imported fixture text mark must be attached to PDF text runs',
  );
});

test('package2-rev4 page 9 imports all 1520 annotations without a page-wide failure', async () => {
  const fixturePath = join(__dirname, '..', 'debug', 'fixtures', 'package2-rev4.pdf');
  const bytes = readFileSync(fixturePath);
  const pdfDoc = await pdfjsLib.getDocument({
    data: cloneBytesForPdfjs(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  }).promise;
  const sourcePage = await pdfDoc.getPage(9);
  const sourceAnnotations = await sourcePage.getAnnotations({ intent: 'display' });
  const badStroke = sourceAnnotations.find((annotation) => annotation.id === '4949R');
  const pageNineOnlyDoc = {
    numPages: 9,
    async getPage(pageNumber) {
      return {
        getViewport: (options) => sourcePage.getViewport(options),
        async getAnnotations() {
          return pageNumber === 9 ? sourceAnnotations : [];
        },
      };
    },
  };

  const result = await importAnnotationsFromPdf(pageNineOnlyDoc, {
    rawPdfBytes: bytes,
    pdfName: 'package2-rev4.pdf',
  });
  const pageObjects = result.annotationsByPage[9]?.objects || [];

  assert.equal(sourceAnnotations.length, 1520, 'fixture page 9 annotation count changed');
  assert.ok(badStroke, 'fixture must retain the stroke that caused the page-wide loss');
  assert.notEqual(result.nativeLayerPolicyByPage[9].reason, 'page-import-failed');
  assert.equal(pageObjects.length, 1520, 'every page-9 annotation imports');
});

// --- KAL-405: single-tap imported ink marks render as dots -----------------

test('KAL-405 a single-point InkList tap imports as a filled dot sized to the pen', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const obj = convertPdfAnnotationToFabric({
    id: 'ink-tap-1',
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 4 },
    inkLists: [[50, 50]],
  }, viewport);

  assert.ok(obj, 'a pen tap must not be dropped at import');
  assert.equal(obj.type, 'path');
  // Diameter == pen width, centred on the tapped point (50, 50) in PDF space,
  // which is (50, 50) in this viewport.
  assert.equal(obj.width, 4);
  assert.equal(obj.height, 4);
  assert.equal(obj.left, 48);
  assert.equal(obj.top, 48);
  // Filled, never stroked — a stroked width-4 circle would render 8 wide.
  assert.equal(obj.fill, 'rgba(255, 0, 0, 1)');
  assert.equal(obj.stroke, 'transparent');
  assert.equal(obj.strokeWidth, 0);
  assert.equal(obj.pdfInkTapDot, true);
  assert.equal(obj.paperInkGeometry, 'v1');
  assert.ok(Array.isArray(obj.polygons) && obj.polygons.length > 0);
  assert.deepEqual(
    obj.path.map((segment) => segment[0]),
    ['M', 'C', 'C', 'C', 'C', 'Z'],
    'the dot is a closed circle built from four cubic segments',
  );
});

test('KAL-405 a multi-point ink stroke whose bounds collapse imports as a dot', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const obj = convertPdfAnnotationToFabric({
    id: 'ink-tap-2',
    subtype: 'Ink',
    color: [0, 0, 1],
    borderStyle: { width: 8 },
    // Eight samples from a tap that never travelled a visible distance.
    inkLists: [[40, 40, 40.2, 40.1, 40.15, 40.05, 40.05, 39.95, 40, 40]],
  }, viewport);

  assert.equal(obj.pdfInkTapDot, true);
  assert.equal(obj.width, 8);
  assert.equal(obj.height, 8);
  assert.equal(obj.fill, 'rgba(0, 0, 255, 1)');
  assert.equal(obj.strokeWidth, 0);
});

test('KAL-405 a genuinely short but real ink stroke is NOT converted to a dot', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  // 4pt pen, ~5pt of travel. Well above the quarter-pen-width threshold, so
  // this stays the stroked centreline the author drew.
  const obj = convertPdfAnnotationToFabric({
    id: 'ink-short-1',
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 4 },
    inkLists: [[50, 50, 54, 53]],
  }, viewport);

  assert.equal(obj.pdfInkTapDot, undefined);
  assert.equal(obj.stroke, 'rgba(255, 0, 0, 1)');
  assert.equal(obj.fill, null);
  assert.equal(obj.strokeWidth, 4);
  assert.deepEqual(obj.path.map((segment) => segment[0]), ['M', 'L']);
});

test('KAL-405 dot colour, opacity and size come from the source annotation', () => {
  const viewport = makeViewport({ pageHeight: 100 });

  const fat = convertPdfAnnotationToFabric({
    id: 'ink-tap-fat',
    subtype: 'Ink',
    color: [0, 0.6, 0],
    opacity: 0.5,
    borderStyle: { width: 12 },
    inkLists: [[30, 30]],
  }, viewport);

  const thin = convertPdfAnnotationToFabric({
    id: 'ink-tap-thin',
    subtype: 'Ink',
    color: [0, 0.6, 0],
    borderStyle: { width: 2 },
    inkLists: [[30, 30]],
  }, viewport);

  // Exactly the authored paint — no backdrop-dependent boost.
  assert.equal(fat.fill, 'rgba(0, 153, 0, 0.5)');
  assert.equal(thin.fill, 'rgba(0, 153, 0, 1)');
  // A fat pen leaves a fat dot.
  assert.equal(fat.width, 12);
  assert.equal(thin.width, 2);
});

test('KAL-405 three taps in one Ink annotation import as three dots', () => {
  const viewport = makeViewport({ pageHeight: 200 });

  const obj = convertPdfAnnotationToFabric({
    id: 'ink-tap-triple',
    subtype: 'Ink',
    color: [1, 0, 1],
    borderStyle: { width: 6 },
    inkLists: [[20, 100], [60, 100], [100, 100]],
  }, viewport);

  assert.equal(obj.pdfInkTapDot, true);
  assert.equal(obj.width, 86, 'spans the outer edges of the first and last dot');
  assert.equal(obj.height, 6);
  assert.equal(obj.polygons.length, 3, 'one filled ring per tap');
});

test('KAL-405 an imported ink dot survives export back into the PDF', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  const pdfFile = {
    name: 'ink-dot-export.pdf',
    async arrayBuffer() {
      return sourceBytes.buffer.slice(
        sourceBytes.byteOffset,
        sourceBytes.byteOffset + sourceBytes.byteLength,
      );
    },
  };

  const viewport = makeViewport({ pageHeight: 200 });
  const dot = {
    ...convertPdfAnnotationToFabric({
      id: 'ink-tap-export',
      subtype: 'Ink',
      color: [1, 0, 0],
      borderStyle: { width: 6 },
      inkLists: [[80, 120]],
    }, viewport),
    // An UNEDITED imported annotation is preserved verbatim from the source
    // file, so the exporter only re-authors it once the user has touched it.
    // That re-authoring is the path this test exercises.
    pdfImportedEditState: 'edited',
  };

  // Legacy shape: an imported tap saved BEFORE this fix — raw degenerate
  // geometry with no dot substitution. The exporter must still write a dot.
  const legacyTap = {
    id: 'ink-tap-legacy',
    type: 'path',
    left: 40,
    top: 40,
    width: 0,
    height: 0,
    path: [['M', 0, 0]],
    stroke: 'rgba(0, 0, 255, 1)',
    fill: null,
    strokeWidth: 6,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfImportedEditState: 'edited',
  };

  const originalWindow = globalThis.window;
  globalThis.window = {};
  let exportedBytes;
  try {
    exportedBytes = await savePDFWithAnnotationsPdfLib(
      pdfFile,
      { 1: { objects: [dot, legacyTap] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-kal405' },
    );
  } finally {
    globalThis.window = originalWindow;
  }

  // Assert on the PDF that was actually written, not on Survey's own embedded
  // state: a tap that still paints nothing would land as a zero-size /Rect
  // with a one-point /InkList, which is exactly the bug.
  const written = await PDFDocument.load(exportedBytes);
  const annots = written.getPages()[0].node.Annots();
  assert.equal(annots.size(), 2, 'both taps are written back into the PDF');

  const expectedFill = ['1 0 0 rg', '0 0 1 rg'];
  for (let index = 0; index < annots.size(); index += 1) {
    const dict = annots.lookup(index);
    assert.equal(dict.get(PDFName.of('Subtype')).toString(), '/Ink');

    const rect = dict.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
    const rectWidth = rect[2] - rect[0];
    const rectHeight = rect[3] - rect[1];
    assert.ok(rectWidth > 5 && rectWidth < 7, `exported dot keeps the 6pt pen width (got ${rectWidth})`);
    assert.ok(Math.abs(rectWidth - rectHeight) < 0.5, 'exported dot is round');

    // A real ring, not the single point that painted nothing.
    const inkList = written.context.lookup(dict.get(PDFName.of('InkList')));
    assert.ok(inkList.lookup(0).size() > 8, 'exported /InkList carries the dot outline');

    // The appearance stream fills — with the source colour, untransformed.
    const form = written.context.lookup(dict.get(PDFName.of('AP')).get(PDFName.of('N')));
    const content = inflateSync(Buffer.from(form.getContents())).toString('latin1');
    assert.ok(content.includes(expectedFill[index]), `dot ${index} keeps its source colour`);
    assert.ok(/\bf\*?\b/.test(content), 'the dot is filled, not stroked');
  }
});
