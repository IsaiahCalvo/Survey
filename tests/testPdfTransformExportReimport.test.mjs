import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';

import {
  getPDFId,
  loadAnnotationsByPage,
  saveAnnotationsByPage,
} from '../src/viewerShared.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

// Source + helper contracts for create/transform then local save / export
// re-import on ?testPdf=. Live proof:
// debug/scenarios/e2e-testpdf-transform-export-reimport.spec.mjs
// Distinct from the 2026-08-22 create-only local save receipt.
// Cloud save / identity-churn stays leftover-18 X-01.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const cloneBytesForPdfjs = (bytes) => {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) return Uint8Array.from(bytes);
  if (bytes instanceof Uint8Array) return bytes.slice();
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return bytes;
};

function installLocalStorage() {
  const store = new Map();
  const localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
  };
  const previous = globalThis.localStorage;
  globalThis.localStorage = localStorage;
  return {
    store,
    restore() {
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    },
  };
}

async function makePdfFile(name = 'transform-source.pdf') {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const sourceBytes = await source.save();
  return {
    name,
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
}

const TRANSFORMED_RECT = {
  id: 'xf-rect',
  type: 'rect',
  left: 40,
  top: 50,
  width: 60,
  height: 40,
  scaleX: 1.5,
  scaleY: 1.25,
  angle: 90,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  data: { type: 'rect', tool: 'rect', id: 'xf-rect' },
};

const TRANSFORMED_PEN = {
  id: 'xf-pen',
  type: 'path',
  left: 20,
  top: 20,
  width: 80,
  height: 30,
  scaleX: 2,
  scaleY: 1.5,
  path: [['M', 0, 0], ['L', 80, 30]],
  stroke: '#ff0000',
  strokeWidth: 3,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  tool: 'pen',
  data: { type: 'path', tool: 'pen', id: 'xf-pen' },
};

test('local cache round-trips transformed rect + pen; missing key invents 0', () => {
  const mock = installLocalStorage();
  try {
    const pages = {
      1: {
        objects: [TRANSFORMED_RECT, TRANSFORMED_PEN],
      },
    };
    saveAnnotationsByPage('clickable-link-test.pdf-23183', pages);
    const loaded = loadAnnotationsByPage('clickable-link-test.pdf-23183');
    const rect = loaded[1].objects.find((obj) => obj.id === 'xf-rect');
    const pen = loaded[1].objects.find((obj) => obj.id === 'xf-pen');
    assert.equal(rect.angle, 90);
    assert.equal(rect.scaleX, 1.5);
    assert.equal(rect.scaleY, 1.25);
    assert.equal(rect.width, 60);
    assert.equal(pen.scaleX, 2);
    assert.equal(pen.scaleY, 1.5);
    assert.deepEqual(pen.path, TRANSFORMED_PEN.path);
    assert.deepEqual(loadAnnotationsByPage('text-search-glyph-lab.pdf-999'), {});
    mock.store.delete('annotationsByPage_clickable-link-test.pdf-23183');
    assert.deepEqual(loadAnnotationsByPage('clickable-link-test.pdf-23183'), {});
  } finally {
    mock.restore();
  }
});

test('empty export writes a PDF and invents 0 annotations', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile('empty-export.pdf'),
    { 1: { objects: [] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'empty-export' },
  );
  assert.ok(bytes?.byteLength > 0, 'empty export still writes bytes');
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const count = annots ? annots.asArray().length : 0;
  assert.equal(count, 0);
});

test('exported resized+rotated rect and resized pen reimport transformed geometry', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      await makePdfFile('xf-export.pdf'),
      { 1: { objects: [TRANSFORMED_RECT, TRANSFORMED_PEN] } },
      { 1: { width: 200, height: 200 } },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'xf-export' },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: cloneBytesForPdfjs(exportedBytes),
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const objects = imported.annotationsByPage[1].objects;
    assert.equal(objects.length, 2);

    const rect = objects.find((obj) => obj.id === 'xf-rect');
    const pen = objects.find((obj) => obj.id === 'xf-pen');
    assert.ok(rect, 'rect id survives app metadata');
    assert.ok(pen, 'pen id survives app metadata');
    assert.equal(rect.appAnnotationType, 'rect');
    assert.equal(rect.angle, 90);
    assert.equal(rect.scaleX, 1.5);
    assert.equal(rect.scaleY, 1.25);
    assert.equal(rect.width, 60);
    assert.equal(rect.height, 40);
    assert.equal(pen.appAnnotationType, 'path');
    assert.equal(pen.tool, 'pen');
    assert.equal(pen.scaleX, 2);
    assert.equal(pen.scaleY, 1.5);
    assert.deepEqual(pen.path, TRANSFORMED_PEN.path);
    assert.equal(rect.isPdfImported, true);
    assert.equal(pen.isPdfImported, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('app metadata geometry keys carry angle/scale; persist skips file.id', () => {
  const metadata = buildPdfAppAnnotationMetadata(TRANSFORMED_RECT, {
    id: 'xf-rect',
    pageNumber: 1,
    type: 'rect',
  });
  assert.equal(metadata.geometry.angle, 90);
  assert.equal(metadata.geometry.scaleX, 1.5);
  assert.equal(metadata.geometry.scaleY, 1.25);
  const applied = applyPdfAppAnnotationMetadata({ type: 'rect', left: 0, top: 0 }, metadata);
  assert.equal(applied.angle, 90);
  assert.equal(applied.scaleX, 1.5);

  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  const meta = read('src/utils/pdfAppAnnotationMetadata.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(meta, /'scaleX',\s*\n\s*'scaleY',\s*\n\s*'angle'/);
  assert.match(exporter, /const width = Math\.max\(0, \(Number\(fabricObj\.width\) \|\| 0\) \* scaleX\)/);
  assert.match(exporter, /createInkPageTransform/);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: '_e2e-transform-export-reimport.pdf', size: 99 }),
  );
});
