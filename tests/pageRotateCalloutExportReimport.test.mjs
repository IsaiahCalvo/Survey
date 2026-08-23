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
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  rotateNormalizedBox,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source + helper contracts for page-rotate remapper then local cache /
// export → ?testPdf= re-import of live callout 0–1 fractions. Distinct
// from 649e75f2 / pageRotateExportReimport (rect-only), a3e9bcff /
// pageRotateInkExportReimport (ink-only), and live page-rotate-callout-remap
// (no serialize/restore). Live proof:
// debug/scenarios/e2e-page-rotate-callout-export-reimport.spec.mjs
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

async function makePortraitPdfFile(name = 'rotate-callout-source.pdf', width = 612, height = 792) {
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

const LIVE_CALLOUT = {
  id: 'callout-xf-export',
  pageNumber: 1,
  arrowTip: { x: 0.16, y: 0.22 },
  knee: { x: 0.22, y: 0.28 },
  textBoxPosition: { x: 0.44, y: 0.42 },
  textBoxWidth: 120 / 612,
  textBoxHeight: 32 / 792,
  text: 'A',
  style: { fontFamily: 'Arial', lineStyle: 'solid' },
};

function liveCallout() {
  return { ...LIVE_CALLOUT };
}

function remapLiveCallout(callout = liveCallout()) {
  const projected = calloutToAnnotationObject(callout, { width: 612, height: 792 });
  return transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [projected] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
}

function remappedFractions(remapped = remapLiveCallout()) {
  return remapped.annotationsByPage[1].objects[0].data.legacyCallout;
}

test('local cache round-trips remapped callout fractions; missing key invents 0', () => {
  const mock = installLocalStorage();
  try {
    const remapped = remapLiveCallout();
    saveAnnotationsByPage('clickable-link-test.pdf-23183', remapped.annotationsByPage);
    const loaded = loadAnnotationsByPage('clickable-link-test.pdf-23183');
    const stored = loaded[1].objects.find((obj) => obj.data?.id === 'callout-xf-export' || obj.id === 'callout-xf-export');
    const expectedBox = rotateNormalizedBox(
      LIVE_CALLOUT.textBoxPosition,
      LIVE_CALLOUT.textBoxWidth,
      LIVE_CALLOUT.textBoxHeight,
      612,
      792,
      90,
    );
    const legacy = stored.data.legacyCallout;
    assert.ok(Math.abs(legacy.textBoxPosition.x - expectedBox.x) < 1e-6);
    assert.ok(Math.abs(legacy.textBoxPosition.y - expectedBox.y) < 1e-6);
    assert.ok(Math.abs(legacy.textBoxWidth - expectedBox.width) < 1e-6);
    assert.ok(Math.abs(legacy.textBoxHeight - expectedBox.height) < 1e-6);
    assert.notEqual(legacy.textBoxPosition.x, LIVE_CALLOUT.textBoxPosition.x);
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
  const source = await makePortraitPdfFile('empty-rotate-callout-export.pdf');
  const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
    type: 'rotate', page: 1, delta: 90,
  });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeFileFromBytes('empty-rotate-callout-export.pdf', rotatedBytes),
    { 1: { width: 792, height: 612, objects: [] } },
    { 1: displayed },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'empty-rotate-callout-export', callouts: [] },
  );
  assert.ok(bytes?.byteLength > 0, 'empty export still writes bytes');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const count = annots ? annots.asArray().length : 0;
  assert.equal(count, 0);
});

test('exported remapped callout reimports remapped fractions after page rotate', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const source = await makePortraitPdfFile('xf-rotate-callout-export.pdf');
    const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
      type: 'rotate', page: 1, delta: 90,
    });
    const remapped = remapLiveCallout();
    const fractions = remappedFractions(remapped);
    const expectedBox = rotateNormalizedBox(
      LIVE_CALLOUT.textBoxPosition,
      LIVE_CALLOUT.textBoxWidth,
      LIVE_CALLOUT.textBoxHeight,
      612,
      792,
      90,
    );
    const displayed = rotateDisplayedPageSize(612, 792, 90);

    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      await makeFileFromBytes('xf-rotate-callout-export.pdf', rotatedBytes),
      remapped.annotationsByPage,
      { 1: displayed },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'xf-rotate-callout-export',
        callouts: [fractions],
      },
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
    const callouts = imported.calloutsByPage[1] || imported.calloutsByPage['1'] || [];
    assert.ok(callouts.length >= 1, 're-import must paint the exported callout');
    const callout = callouts.find((row) => row.id === 'callout-xf-export');
    assert.ok(callout, 'callout id survives SurveyAppCallout metadata');
    assert.ok(Math.abs(callout.textBoxPosition.x - expectedBox.x) < 1e-4, `imported boxX ${callout.textBoxPosition.x}`);
    assert.ok(Math.abs(callout.textBoxPosition.y - expectedBox.y) < 1e-4, `imported boxY ${callout.textBoxPosition.y}`);
    assert.ok(Math.abs(callout.textBoxWidth - expectedBox.width) < 1e-4);
    assert.ok(Math.abs(callout.textBoxHeight - expectedBox.height) < 1e-4);
    assert.ok(Math.abs(callout.textBoxPosition.x - LIVE_CALLOUT.textBoxPosition.x) > 0.01, 'must not restore pre-rotate fraction');
    assert.equal(callout.isPdfImported, true);

    const oldCx = LIVE_CALLOUT.textBoxPosition.x * 612 + 60;
    const oldCy = LIVE_CALLOUT.textBoxPosition.y * 792 + 16;
    const expectedCenter = rotateDisplayedPoint(oldCx, oldCy, 612, 792, 90);
    const importedCx = callout.textBoxPosition.x * 792 + (callout.textBoxWidth * 792) / 2;
    const importedCy = callout.textBoxPosition.y * 612 + (callout.textBoxHeight * 612) / 2;
    assert.ok(Math.abs(importedCx - expectedCenter.x) < 1e-3);
    assert.ok(Math.abs(importedCy - expectedCenter.y) < 1e-3);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('callout metadata + remapper + persist skip file.id; live spec covers export/reimport', () => {
  const remapped = remapLiveCallout();
  const fractions = remappedFractions(remapped);
  assert.equal(fractions.id, 'callout-xf-export');
  assert.notEqual(fractions.textBoxPosition.x, LIVE_CALLOUT.textBoxPosition.x);
  const expectedBox = rotateNormalizedBox(
    LIVE_CALLOUT.textBoxPosition,
    LIVE_CALLOUT.textBoxWidth,
    LIVE_CALLOUT.textBoxHeight,
    612,
    792,
    90,
  );
  assert.ok(Math.abs(fractions.textBoxPosition.x - expectedBox.x) < 1e-6);
  assert.ok(Math.abs(fractions.textBoxPosition.y - expectedBox.y) < 1e-6);

  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  const meta = read('src/utils/pdfAppAnnotationMetadata.js');
  const calloutMeta = read('src/utils/pdfCalloutMetadata.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  const remapper = read('src/utils/pageAnnotationReindex.js');
  const spec = read('debug/scenarios/e2e-page-rotate-callout-export-reimport.spec.mjs');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(meta, /if \(item\.type === 'callout'/);
  assert.match(calloutMeta, /export const PDF_CALLOUT_SUBJECT = 'survey-callout'/);
  assert.match(exporter, /const calloutToExportObject = \(callout, pageSize\)/);
  assert.match(remapper, /export function rotateCalloutFractions/);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: '_e2e-page-rotate-callout-export-reimport.pdf', size: 99 }),
  );
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /page rotate must keep the live callout/);
  assert.match(spec, /re-import must keep remapped box center/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /empty export still downloads/);
  assert.match(spec, /reload without save invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 callout-export-reimport edge/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
