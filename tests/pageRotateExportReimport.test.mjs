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
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source + helper contracts for page-rotate remapper then local cache /
// export → ?testPdf= re-import. Distinct from 41644a94 transform-only
// export/reimport (page stayed 612×792). Live proof:
// debug/scenarios/e2e-page-rotate-export-reimport.spec.mjs
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

async function makePortraitPdfFile(name = 'rotate-source.pdf', width = 612, height = 792) {
  const source = await PDFDocument.create();
  source.addPage([width, height]);
  const sourceBytes = await source.save();
  return {
    name,
    size: sourceBytes.byteLength,
    async arrayBuffer() {
      return sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
    },
  };
}

async function makeFileFromBytes(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

const RESIZED_RECT = {
  id: 'xf-rot-rect',
  type: 'rect',
  left: 122.4,
  top: 205.9,
  width: 135.4,
  height: 152.2,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  fill: 'transparent',
  stroke: '#111111',
  strokeWidth: 2,
  data: { type: 'rect', tool: 'rect', id: 'xf-rot-rect', pageNumber: 1 },
};

function remapResizedRect() {
  return transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [RESIZED_RECT] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
}

test('local cache round-trips remapped rect; missing key invents 0', () => {
  const mock = installLocalStorage();
  try {
    const remapped = remapResizedRect();
    saveAnnotationsByPage('clickable-link-test.pdf-23183', remapped.annotationsByPage);
    const loaded = loadAnnotationsByPage('clickable-link-test.pdf-23183');
    const rect = loaded[1].objects.find((obj) => obj.id === 'xf-rot-rect');
    const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
    assert.equal(rect.angle, 90);
    assert.equal(rect.width, 135.4);
    assert.equal(rect.height, 152.2);
    assert.ok(Math.abs((rect.left + 135.4 / 2) - expected.x) < 1e-6);
    assert.ok(Math.abs((rect.top + 152.2 / 2) - expected.y) < 1e-6);
    assert.equal(loaded[1].width, 792);
    assert.equal(loaded[1].height, 612);
    assert.deepEqual(loadAnnotationsByPage('text-search-glyph-lab.pdf-999'), {});
    mock.store.delete('annotationsByPage_clickable-link-test.pdf-23183');
    assert.deepEqual(loadAnnotationsByPage('clickable-link-test.pdf-23183'), {});
  } finally {
    mock.restore();
  }
});

test('empty export of a rotated page writes a PDF and invents 0 annotations', async () => {
  const source = await makePortraitPdfFile('empty-rotate-export.pdf');
  const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
    type: 'rotate', page: 1, delta: 90,
  });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeFileFromBytes('empty-rotate-export.pdf', rotatedBytes),
    { 1: { width: 792, height: 612, objects: [] } },
    { 1: displayed },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'empty-rotate-export' },
  );
  assert.ok(bytes?.byteLength > 0, 'empty export still writes bytes');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const count = annots ? annots.asArray().length : 0;
  assert.equal(count, 0);
});

test('exported remapped rect reimports remapped center/angle after page rotate', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const source = await makePortraitPdfFile('xf-rotate-export.pdf');
    const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
      type: 'rotate', page: 1, delta: 90,
    });
    const remapped = remapResizedRect();
    const after = remapped.annotationsByPage[1].objects[0];
    const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
    const displayed = rotateDisplayedPageSize(612, 792, 90);

    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      await makeFileFromBytes('xf-rotate-export.pdf', rotatedBytes),
      remapped.annotationsByPage,
      { 1: displayed },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'xf-rotate-export' },
    );

    const loadingTask = pdfjsLib.getDocument({
      data: cloneBytesForPdfjs(exportedBytes),
      disableWorker: true,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    assert.equal(page.rotate, 90);
    assert.ok(Math.abs(viewport.width - 792) < 0.5, `viewport width ${viewport.width}`);
    assert.ok(Math.abs(viewport.height - 612) < 0.5, `viewport height ${viewport.height}`);

    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: exportedBytes });
    const objects = imported.annotationsByPage[1].objects;
    assert.equal(objects.length, 1);
    const rect = objects.find((obj) => obj.id === 'xf-rot-rect');
    assert.ok(rect, 'rect id survives app metadata');
    assert.equal(rect.appAnnotationType, 'rect');
    assert.equal(rect.angle, 90);
    assert.equal(rect.width, 135.4);
    assert.equal(rect.height, 152.2);
    assert.ok(Math.abs((rect.left + 135.4 / 2) - expected.x) < 1e-6);
    assert.ok(Math.abs((rect.top + 152.2 / 2) - expected.y) < 1e-6);
    assert.ok(Math.abs(rect.left - after.left) < 1e-6);
    assert.ok(Math.abs(rect.top - after.top) < 1e-6);
    assert.equal(rect.isPdfImported, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('app metadata + remapper + persist skip file.id; live spec covers export/reimport', () => {
  const remapped = remapResizedRect().annotationsByPage[1].objects[0];
  const metadata = buildPdfAppAnnotationMetadata(remapped, {
    id: 'xf-rot-rect',
    pageNumber: 1,
    type: 'rect',
  });
  assert.equal(metadata.geometry.angle, 90);
  assert.ok(metadata.geometry.left > 600, 'remapped left is past the pre-rotate origin');
  const applied = applyPdfAppAnnotationMetadata({ type: 'rect', left: 0, top: 0 }, metadata);
  assert.equal(applied.angle, 90);
  assert.equal(applied.left, remapped.left);

  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  const meta = read('src/utils/pdfAppAnnotationMetadata.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  const hook = read('src/hooks/usePageOperations.js');
  const spec = read('debug/scenarios/e2e-page-rotate-export-reimport.spec.mjs');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(meta, /'scaleX',\s*\n\s*'scaleY',\s*\n\s*'angle'/);
  assert.match(exporter, /const width = Math\.max\(0, \(Number\(fabricObj\.width\) \|\| 0\) \* scaleX\)/);
  assert.match(hook, /peekDisplayedPageSize/);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: '_e2e-page-rotate-export-reimport.pdf', size: 99 }),
  );
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /page rotate must keep the resized rect/);
  assert.match(spec, /re-import must keep remapped center/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /empty export still downloads/);
  assert.match(spec, /reload without save invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 rotate-export edge/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
