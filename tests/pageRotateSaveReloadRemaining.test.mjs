import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPDFId,
  loadAnnotationsByPage,
  saveAnnotationsByPage,
} from '../src/viewerShared.js';
import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for local ?testPdf= save/reload AFTER page CW.
// Live proof: debug/scenarios/e2e-page-rotate-save-reload-remaining.spec.mjs
// Named cloud save stays leftover-18 X-01. Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

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
    restore() {
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    },
  };
}

function emptyModel(objects = [], width = 612, height = 792) {
  return {
    annotationsByPage: { 1: { width, height, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

test('local cache round-trips remapped leftover types without inventing file.id', () => {
  const line = {
    type: 'line',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 126.72,
    data: { id: 'xf-reload-line', type: 'line', tool: 'line' },
  };
  const cw = transformPageState(emptyModel([line]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const remapped = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(110.16 + 146.88 / 2, 174.24 + 126.72 / 2, 612, 792, 90);
  assert.ok(Math.abs((remapped.left + remapped.width / 2) - expected.x) < 1e-6);
  assert.equal(cw.annotationsByPage[1].width, 792);

  const mock = installLocalStorage();
  try {
    const pdfId = getPDFId({ name: 'clickable-link-test.pdf', size: 23183 });
    saveAnnotationsByPage(pdfId, cw.annotationsByPage);
    const loaded = loadAnnotationsByPage(pdfId);
    assert.equal(loaded[1].objects[0].data.id, 'xf-reload-line');
    assert.ok(Math.abs(loaded[1].objects[0].left - remapped.left) < 1e-6);
    assert.notEqual(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'cloud-file-id');
  } finally {
    mock.restore();
  }
});

test('save/reload remaining after remap uses local cache; remount cannot bake /Rotate', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-save-reload-remaining.spec.mjs');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const pdfjs = read('src/components/PdfjsViewerContainer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 \/ X-01/);
  assert.match(spec, /Fixture remount cannot restore baked \/Rotate/);
  assert.match(spec, /desktop save\/reload after CW — callout/);
  assert.match(spec, /desktop save\/reload after CW — counter/);
  assert.match(spec, /desktop save\/reload after CW — line/);
  assert.match(spec, /desktop save\/reload after CW — arrow/);
  assert.match(spec, /desktop save\/reload after CW — textbox/);
  assert.match(spec, /desktop save\/reload after CW — survey-marker/);
  assert.match(spec, /390 save\/reload remaining after remap edge/);
  assert.match(spec, /remountLimit/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);

  assert.match(viewer, /localStorage\.setItem\(`pdfSidebar_\$\{pdfId\}`/);
  assert.match(viewer, /newFile\.id = currentPdfFile\.id/);
  assert.match(pdfjs, /app handles rotation by rewriting bytes/);
  assert.match(reindex, /rotatePageSpaceCounter/);
  assert.match(reindex, /rotateCalloutFractions/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
