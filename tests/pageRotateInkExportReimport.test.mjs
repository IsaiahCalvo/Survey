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
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
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
// export → ?testPdf= re-import of live page-space ink. Distinct from
// 649e75f2 / pageRotateExportReimport (rect-only) and from live
// page-rotate-ink-remap (no serialize/restore). Live proof:
// debug/scenarios/e2e-page-rotate-ink-export-reimport.spec.mjs
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

async function makePortraitPdfFile(name = 'rotate-ink-source.pdf', width = 612, height = 792) {
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

function liveInk(id = 'xf-rot-ink') {
  return createProductionPaperInk({
    id,
    tool: 'pen',
    points: [
      { x: 134.64, y: 237.60 },
      { x: 180, y: 280 },
      { x: 220, y: 250 },
    ],
    color: '#111111',
    width: 4,
    data: { id, tool: 'pen', type: 'path', pageNumber: 1 },
  });
}

function remapLiveInk(ink = liveInk()) {
  return transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [ink] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
}

test('local cache round-trips remapped ink centerline; missing key invents 0', () => {
  const mock = installLocalStorage();
  try {
    const ink = liveInk();
    const remapped = remapLiveInk(ink);
    saveAnnotationsByPage('clickable-link-test.pdf-23183', remapped.annotationsByPage);
    const loaded = loadAnnotationsByPage('clickable-link-test.pdf-23183');
    const stored = loaded[1].objects.find((obj) => obj.id === 'xf-rot-ink');
    const expected = rotateDisplayedPoint(
      ink.paperCenterline[0].x,
      ink.paperCenterline[0].y,
      612,
      792,
      90,
    );
    assert.equal(stored.left, 0);
    assert.equal(stored.angle, 0);
    assert.ok(Math.abs(stored.paperCenterline[0].x - expected.x) < 1e-6);
    assert.ok(Math.abs(stored.paperCenterline[0].y - expected.y) < 1e-6);
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
  const source = await makePortraitPdfFile('empty-rotate-ink-export.pdf');
  const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
    type: 'rotate', page: 1, delta: 90,
  });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeFileFromBytes('empty-rotate-ink-export.pdf', rotatedBytes),
    { 1: { width: 792, height: 612, objects: [] } },
    { 1: displayed },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'empty-rotate-ink-export' },
  );
  assert.ok(bytes?.byteLength > 0, 'empty export still writes bytes');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const count = annots ? annots.asArray().length : 0;
  assert.equal(count, 0);
});

test('exported remapped ink reimports remapped centerline after page rotate', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const ink = liveInk();
    const source = await makePortraitPdfFile('xf-rotate-ink-export.pdf');
    const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
      type: 'rotate', page: 1, delta: 90,
    });
    const remapped = remapLiveInk(ink);
    const after = remapped.annotationsByPage[1].objects[0];
    const expected = rotateDisplayedPoint(
      ink.paperCenterline[0].x,
      ink.paperCenterline[0].y,
      612,
      792,
      90,
    );
    const displayed = rotateDisplayedPageSize(612, 792, 90);

    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      await makeFileFromBytes('xf-rotate-ink-export.pdf', rotatedBytes),
      remapped.annotationsByPage,
      { 1: displayed },
      null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'xf-rotate-ink-export' },
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
    assert.ok(objects.length >= 1, 're-import must paint the exported stroke');
    const path = objects.find((obj) => obj.id === 'xf-rot-ink');
    assert.ok(path, 'ink id survives app metadata');
    assert.equal(path.appAnnotationType, 'path');
    assert.equal(path.left, 0);
    assert.equal(Number(path.angle) || 0, 0);
    const first = path.paperCenterline?.[0] || {};
    assert.ok(Math.abs(Number(first.x) - expected.x) < 1e-4, `imported centerline x ${first.x}`);
    assert.ok(Math.abs(Number(first.y) - expected.y) < 1e-4, `imported centerline y ${first.y}`);
    assert.ok(Math.abs(Number(first.x) - after.paperCenterline[0].x) < 1e-4);
    assert.ok(Math.abs(Number(first.y) - after.paperCenterline[0].y) < 1e-4);
    assert.ok(Math.abs(Number(first.x) - ink.paperCenterline[0].x) > 1, 'must not restore pre-rotate point');
    assert.equal(path.isPdfImported, true);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('app metadata + remapper + persist skip file.id; live spec covers export/reimport', () => {
  const ink = liveInk();
  const remapped = remapLiveInk(ink).annotationsByPage[1].objects[0];
  const metadata = buildPdfAppAnnotationMetadata(remapped, {
    id: 'xf-rot-ink',
    pageNumber: 1,
    type: 'path',
  });
  assert.ok(metadata, 'pen metadata is written (counter is the kind that skips)');
  assert.equal(metadata.geometry.angle, 0);
  assert.equal(metadata.geometry.left, 0);
  const expected = rotateDisplayedPoint(
    ink.paperCenterline[0].x,
    ink.paperCenterline[0].y,
    612,
    792,
    90,
  );
  assert.ok(Math.abs(metadata.geometry.paperCenterline[0].x - expected.x) < 1e-6);
  assert.ok(Math.abs(metadata.geometry.paperCenterline[0].y - expected.y) < 1e-6);
  const applied = applyPdfAppAnnotationMetadata({ type: 'path', left: 0, top: 0 }, metadata);
  assert.equal(applied.id, 'xf-rot-ink');
  assert.ok(Math.abs(applied.paperCenterline[0].x - remapped.paperCenterline[0].x) < 1e-6);
  assert.ok(Math.abs(applied.paperCenterline[0].y - remapped.paperCenterline[0].y) < 1e-6);

  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  const meta = read('src/utils/pdfAppAnnotationMetadata.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  const remapper = read('src/utils/pageAnnotationReindex.js');
  const spec = read('debug/scenarios/e2e-page-rotate-ink-export-reimport.spec.mjs');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(meta, /'paperCenterline'/);
  assert.match(exporter, /createFilledPaperInkAnnotation/);
  assert.match(remapper, /export function rotatePageSpaceInk/);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: '_e2e-page-rotate-ink-export-reimport.pdf', size: 99 }),
  );
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /page rotate must keep the live ink/);
  assert.match(spec, /re-import must keep remapped centerline/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /empty export still downloads/);
  assert.match(spec, /reload without save invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 ink-export-reimport edge/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
