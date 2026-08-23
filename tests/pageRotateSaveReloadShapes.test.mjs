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

// Source contracts for local ?testPdf= save/reload AFTER page CW for
// ellipse / cloud-rect / highlighter. Named cloud save stays leftover-18 X-01.
// Live proof: debug/scenarios/e2e-page-rotate-save-reload-shapes.spec.mjs
// Do not stamp file.id.

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

test('local cache round-trips remapped ellipse / cloud-rect / highlighter without inventing file.id', () => {
  const ellipse = {
    type: 'ellipse',
    left: 110.16,
    top: 174.24,
    width: 146.88,
    height: 110.88,
    data: { id: 'xf-reload-ell', type: 'ellipse', tool: 'ellipse' },
    id: 'xf-reload-ell',
  };
  const cloud = {
    type: 'rect',
    left: 293.76,
    top: 190.08,
    width: 146.88,
    height: 110.88,
    data: { id: 'xf-reload-cloud', type: 'rect', pdfCloudIntensity: 2 },
    id: 'xf-reload-cloud',
  };
  const ink = {
    type: 'path',
    left: 0,
    top: 0,
    paperCenterline: [{ x: 134.64, y: 396.00 }],
    globalCompositeOperation: 'multiply',
    data: { id: 'xf-reload-hi', type: 'path', tool: 'highlighter' },
    id: 'xf-reload-hi',
  };

  const cw = transformPageState(emptyModel([ellipse, cloud, ink]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const [afterEll, afterCloud, afterInk] = cw.annotationsByPage[1].objects;
  const ellExpected = rotateDisplayedPoint(110.16 + 146.88 / 2, 174.24 + 110.88 / 2, 612, 792, 90);
  assert.ok(Math.abs((afterEll.left + afterEll.width / 2) - ellExpected.x) < 1e-6);
  assert.equal(afterCloud.data.pdfCloudIntensity, 2);
  const inkExpected = rotateDisplayedPoint(134.64, 396.00, 612, 792, 90);
  assert.ok(Math.abs(afterInk.paperCenterline[0].x - inkExpected.x) < 1e-6);
  assert.equal(afterInk.left, 0);

  const mock = installLocalStorage();
  try {
    const pdfId = getPDFId({ name: 'clickable-link-test.pdf', size: 23183 });
    saveAnnotationsByPage(pdfId, cw.annotationsByPage);
    const loaded = loadAnnotationsByPage(pdfId);
    assert.equal(loaded[1].objects[0].data.id, 'xf-reload-ell');
    assert.equal(loaded[1].objects[1].data.pdfCloudIntensity, 2);
    assert.equal(loaded[1].objects[2].data.id, 'xf-reload-hi');
    assert.notEqual(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'cloud-file-id');
  } finally {
    mock.restore();
  }
});

test('save/reload shapes after remap uses local cache; remount cannot bake /Rotate', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-save-reload-shapes.spec.mjs');
  const viewer = read('src/PDFViewer.jsx');
  const pageOps = read('src/hooks/usePageOperations.js');
  const pdfjs = read('src/components/PdfjsViewerContainer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 \/ X-01/);
  assert.match(spec, /Fixture remount cannot restore baked \/Rotate/);
  assert.match(spec, /desktop save\/reload after CW — \$\{kind\}/);
  assert.match(spec, /\['ellipse', createEllipse\]/);
  assert.match(spec, /\['cloud-rect', createCloudRect\]/);
  assert.match(spec, /\['highlighter', createHighlighter\]/);
  assert.match(spec, /390 save\/reload shapes after remap edge/);
  assert.match(spec, /remountLimit/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);

  assert.match(viewer, /localStorage\.setItem\(`pdfSidebar_\$\{pdfId\}`/);
  assert.match(pageOps, /newFile\.id = currentPdfFile\.id/);
  assert.match(pdfjs, /app handles rotation by rewriting bytes/);
  assert.match(dev, /Do NOT set file\.id/);
});
