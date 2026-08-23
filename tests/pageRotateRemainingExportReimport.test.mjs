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
  saveSurveyMarkers,
} from '../src/viewerShared.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { readSurveyMarkerLayer } from '../src/utils/pdfAppAnnotationMetadata.js';
import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source + helper contracts for page-rotate remapper then local cache /
// export → ?testPdf= re-import of live counter, survey-marker, line, and
// textbox. Distinct from 649e75f2 rect, a3e9bcff ink, ed08b9ed callout.
// Live proof:
// debug/scenarios/e2e-page-rotate-remaining-export-reimport.spec.mjs
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

async function makePortraitPdfFile(name = 'rotate-remaining-source.pdf', width = 612, height = 792) {
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

function liveLine() {
  return {
    id: 'ln-xf-export',
    type: 'line',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 126.72,
    x1: -73.44,
    y1: -63.36,
    x2: 73.44,
    y2: 63.36,
    angle: 0,
    stroke: '#111111',
    strokeWidth: 2,
    data: { id: 'ln-xf-export', type: 'line', tool: 'line', pageNumber: 1 },
  };
}

function liveTextbox() {
  return {
    id: 'tb-xf-export',
    type: 'textbox',
    left: 293.76,
    top: 158.4,
    width: 159.12,
    height: 110.88,
    angle: 0,
    text: 'A',
    fontFamily: 'Helvetica',
    fill: '#111111',
    data: { id: 'tb-xf-export', type: 'textbox', tool: 'text', pageNumber: 1 },
  };
}

function liveCounter() {
  return {
    id: 'ctr-xf-export',
    type: 'circle',
    left: 157.36,
    top: 397.84,
    radius: 14,
    fill: '#ef4444',
    stroke: '#ffffff',
    data: {
      id: 'ctr-xf-export',
      type: 'counter',
      pointerAngle: 225,
      displayNumber: 1,
      seriesId: 'series-xf',
      seriesStart: 1,
      pageNumber: 1,
    },
  };
}

function liveMarker() {
  return {
    annotationId: 'sm-xf-export',
    pageNumber: 1,
    bounds: { x: 306, y: 364.32, width: 134.64, height: 126.72, angle: 0 },
    categoryId: 'kal436-category',
    moduleId: 'kal436-module',
    name: 'walls-xf',
    color: '#d8a84e',
  };
}

function remapAll() {
  return transformPageState({
    annotationsByPage: {
      1: { width: 612, height: 792, objects: [liveLine(), liveTextbox(), liveCounter()] },
    },
    surveyMarkers: { 'sm-xf-export': liveMarker() },
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
}

function linePagePoint(obj, which = 1) {
  const left = Number(obj.left);
  const top = Number(obj.top);
  const width = Number(obj.width);
  const height = Number(obj.height);
  const cx = left + width / 2;
  const cy = top + height / 2;
  const x = Number(which === 1 ? obj.x1 : obj.x2);
  const y = Number(which === 1 ? obj.y1 : obj.y2);
  const rad = (Number(obj.angle) || 0) * Math.PI / 180;
  return {
    x: cx + x * Math.cos(rad) - y * Math.sin(rad),
    y: cy + x * Math.sin(rad) + y * Math.cos(rad),
  };
}

test('local cache round-trips remapped counter/line/textbox/survey-marker; missing key invents 0', () => {
  const mock = installLocalStorage();
  try {
    const remapped = remapAll();
    saveAnnotationsByPage('clickable-link-test.pdf-23183', remapped.annotationsByPage);
    saveSurveyMarkers('clickable-link-test.pdf-23183', remapped.surveyMarkers);
    const loaded = loadAnnotationsByPage('clickable-link-test.pdf-23183');
    const line = loaded[1].objects.find((obj) => (obj.id || obj.data?.id) === 'ln-xf-export');
    const text = loaded[1].objects.find((obj) => (obj.id || obj.data?.id) === 'tb-xf-export');
    const counter = loaded[1].objects.find((obj) => (obj.id || obj.data?.id) === 'ctr-xf-export');
    const marker = remapped.surveyMarkers['sm-xf-export'];
    const liveL = liveLine();
    const liveT = liveTextbox();
    const liveC = liveCounter();
    const liveM = liveMarker();
    const expectedLine = rotateDisplayedPoint(linePagePoint(liveL).x, linePagePoint(liveL).y, 612, 792, 90);
    const expectedText = rotateDisplayedPoint(liveT.left + liveT.width / 2, liveT.top + liveT.height / 2, 612, 792, 90);
    const expectedCounter = rotateDisplayedPoint(liveC.left + liveC.radius, liveC.top + liveC.radius, 612, 792, 90);
    const expectedMarker = rotateDisplayedPoint(
      liveM.bounds.x + liveM.bounds.width / 2,
      liveM.bounds.y + liveM.bounds.height / 2,
      612,
      792,
      90,
    );
    const afterLine = linePagePoint(line);
    assert.ok(Math.abs(afterLine.x - expectedLine.x) < 1e-6);
    assert.ok(Math.abs(afterLine.y - expectedLine.y) < 1e-6);
    assert.ok(Math.abs((text.left + text.width / 2) - expectedText.x) < 1e-6);
    assert.ok(Math.abs((text.top + text.height / 2) - expectedText.y) < 1e-6);
    assert.equal(text.fontFamily, 'Helvetica');
    assert.ok(Math.abs((counter.left + counter.radius) - expectedCounter.x) < 1e-6);
    assert.ok(Math.abs((counter.top + counter.radius) - expectedCounter.y) < 1e-6);
    assert.equal(counter.data.pointerAngle, 315);
    assert.ok(Math.abs((marker.bounds.x + marker.bounds.width / 2) - expectedMarker.x) < 1e-6);
    assert.ok(Math.abs((marker.bounds.y + marker.bounds.height / 2) - expectedMarker.y) < 1e-6);
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
  const source = await makePortraitPdfFile('empty-rotate-remaining-export.pdf');
  const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
    type: 'rotate', page: 1, delta: 90,
  });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makeFileFromBytes('empty-rotate-remaining-export.pdf', rotatedBytes),
    { 1: { width: 792, height: 612, objects: [] } },
    { 1: displayed },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'empty-rotate-remaining-export', surveyMarkers: {} },
  );
  assert.ok(bytes?.byteLength > 0, 'empty export still writes bytes');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  const count = annots ? annots.asArray().length : 0;
  assert.equal(count, 0);
});

test('exported remapped counter/line/textbox/survey-marker reimport after page rotate', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    const source = await makePortraitPdfFile('xf-rotate-remaining-export.pdf');
    const rotatedBytes = await mutatePdfPages(await source.arrayBuffer(), {
      type: 'rotate', page: 1, delta: 90,
    });
    const remapped = remapAll();
    const displayed = rotateDisplayedPageSize(612, 792, 90);
    const liveL = liveLine();
    const liveT = liveTextbox();
    const liveC = liveCounter();
    const liveM = liveMarker();
    const expectedLine = rotateDisplayedPoint(linePagePoint(liveL).x, linePagePoint(liveL).y, 612, 792, 90);
    const expectedText = rotateDisplayedPoint(liveT.left + liveT.width / 2, liveT.top + liveT.height / 2, 612, 792, 90);
    const expectedCounter = rotateDisplayedPoint(liveC.left + liveC.radius, liveC.top + liveC.radius, 612, 792, 90);
    const expectedMarker = rotateDisplayedPoint(
      liveM.bounds.x + liveM.bounds.width / 2,
      liveM.bounds.y + liveM.bounds.height / 2,
      612,
      792,
      90,
    );

    const exportedBytes = await savePDFWithAnnotationsPdfLib(
      await makeFileFromBytes('xf-rotate-remaining-export.pdf', rotatedBytes),
      remapped.annotationsByPage,
      { 1: displayed },
      null,
      {
        returnBytes: true,
        actionType: 'pdf-export',
        documentId: 'xf-rotate-remaining-export',
        surveyMarkers: remapped.surveyMarkers,
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
    const objects = imported.annotationsByPage[1]?.objects || imported.annotationsByPage['1']?.objects || [];
    assert.ok(objects.length >= 3, `re-import must paint the exported objects, got ${objects.length}`);

    const line = objects.find((obj) => (obj.id || obj.data?.id) === 'ln-xf-export');
    const text = objects.find((obj) => (obj.id || obj.data?.id) === 'tb-xf-export');
    const counter = objects.find((obj) => (
      (obj.id || obj.data?.id) === 'ctr-xf-export' || obj.data?.type === 'counter'
    ));
    assert.ok(line, 'line id survives export metadata');
    assert.ok(text, 'textbox id survives export metadata');
    assert.ok(counter, 'counter id survives survey-counter metadata');

    const importedLinePt = linePagePoint({
      left: Number(line.left ?? 0),
      top: Number(line.top ?? 0),
      width: Number(line.width ?? 0),
      height: Number(line.height ?? 0),
      x1: Number(line.x1 ?? 0),
      y1: Number(line.y1 ?? 0),
      x2: Number(line.x2 ?? 0),
      y2: Number(line.y2 ?? 0),
      angle: Number(line.angle ?? 0),
    });
    assert.ok(Math.abs(importedLinePt.x - expectedLine.x) < 8, `imported line x ${importedLinePt.x}`);
    assert.ok(Math.abs(importedLinePt.y - expectedLine.y) < 8, `imported line y ${importedLinePt.y}`);
    assert.ok(Math.abs(importedLinePt.x - linePagePoint(liveL).x) > 1, 'must not restore pre-rotate line');

    const textCx = Number(text.left) + Number(text.width) / 2;
    const textCy = Number(text.top) + Number(text.height) / 2;
    assert.ok(Math.abs(textCx - expectedText.x) < 8, `imported textbox cx ${textCx}`);
    assert.ok(Math.abs(textCy - expectedText.y) < 8, `imported textbox cy ${textCy}`);
    assert.equal(String(text.fontFamily || text.data?.fontFamily || ''), 'Helvetica');

    const radius = Number(counter.radius ?? counter.data?.radius ?? 14);
    const counterCx = Number(counter.left) + radius;
    const counterCy = Number(counter.top) + radius;
    assert.ok(Math.abs(counterCx - expectedCounter.x) < 8, `imported counter cx ${counterCx}`);
    assert.ok(Math.abs(counterCy - expectedCounter.y) < 8, `imported counter cy ${counterCy}`);
    assert.ok(Math.abs(counterCx - (liveC.left + liveC.radius)) > 1, 'must not restore pre-rotate counter');

    const markers = readSurveyMarkerLayer(imported.appLayerState);
    const marker = markers['sm-xf-export'] || Object.values(markers)[0];
    assert.ok(marker, 're-import must restore hidden-layer survey-marker');
    assert.equal(marker.annotationId || Object.keys(markers)[0], 'sm-xf-export');
    const markerCx = Number(marker.bounds.x) + Number(marker.bounds.width) / 2;
    const markerCy = Number(marker.bounds.y) + Number(marker.bounds.height) / 2;
    assert.ok(Math.abs(markerCx - expectedMarker.x) < 1e-4, `imported marker cx ${markerCx}`);
    assert.ok(Math.abs(markerCy - expectedMarker.y) < 1e-4, `imported marker cy ${markerCy}`);
    assert.ok(Math.abs(marker.bounds.x - liveM.bounds.x) > 1, 'must not restore pre-rotate survey-marker');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('remaining-type remappers + persist skip file.id; live spec covers export/reimport', () => {
  const remapped = remapAll();
  assert.equal(remapped.annotationsByPage[1].objects.length, 3);
  assert.ok(remapped.surveyMarkers['sm-xf-export']);
  assert.notEqual(remapped.surveyMarkers['sm-xf-export'].bounds.x, liveMarker().bounds.x);

  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  const remapper = read('src/utils/pageAnnotationReindex.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  const spec = read('debug/scenarios/e2e-page-rotate-remaining-export-reimport.spec.mjs');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(remapper, /export function rotatePageSpaceCounter/);
  assert.match(remapper, /export function rotateSurveyMarkerBounds/);
  assert.match(exporter, /surveyMarkers: options\?\.surveyMarkers \|\| \{\}/);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: '_e2e-page-rotate-line-export-reimport.pdf', size: 99 }),
  );
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /page rotate must keep the live \$\{kind\}/);
  assert.match(spec, /desktop rotate remapper then export re-import of \$\{kind\}/);
  assert.match(spec, /re-import must keep remapped line start/);
  assert.match(spec, /re-import must keep remapped textbox center/);
  assert.match(spec, /re-import must keep remapped counter center/);
  assert.match(spec, /re-import must keep remapped survey-marker center/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /empty export still downloads/);
  assert.match(spec, /reload without save invents 0/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remaining-export-reimport edge/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
