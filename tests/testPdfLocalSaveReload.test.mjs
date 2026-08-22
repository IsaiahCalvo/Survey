import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPDFId,
  loadAnnotationsByPage,
  saveAnnotationsByPage,
} from '../src/viewerShared.js';

// Source + helper contracts for the reachable ?testPdf= local save path.
// Live proof is debug/scenarios/e2e-testpdf-local-save-reload.spec.mjs.
// Cloud save / identity-churn stays leftover-18 X-01.

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
    store,
    restore() {
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    },
  };
}

test('saveAnnotationsByPage / loadAnnotationsByPage round-trip and fail closed', () => {
  const mock = installLocalStorage();
  try {
    assert.deepEqual(loadAnnotationsByPage(null), {});
    assert.deepEqual(loadAnnotationsByPage(''), {});
    saveAnnotationsByPage(null, { 1: { objects: [{ id: 'nope' }] } });
    assert.equal(mock.store.size, 0);

    const pages = { 1: { objects: [{ id: 'rect-1', type: 'rect', data: { type: 'rect' } }] } };
    saveAnnotationsByPage('clickable-link-test.pdf-23183', pages);
    assert.deepEqual(loadAnnotationsByPage('clickable-link-test.pdf-23183'), pages);
    assert.deepEqual(loadAnnotationsByPage('text-search-glyph-lab.pdf-999'), {});

    mock.store.set('annotationsByPage_clickable-link-test.pdf-23183', '{not-json');
    assert.deepEqual(loadAnnotationsByPage('clickable-link-test.pdf-23183'), {});
  } finally {
    mock.restore();
  }
});

test('getPDFId stays name-size and never invents a cloud file.id', () => {
  assert.equal(getPDFId(null), null);
  assert.equal(getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }), 'clickable-link-test.pdf-23183');
  assert.equal(getPDFId({ name: 'mutated.pdf', size: 99, _surveyPdfId: 'kept-id' }), 'kept-id');
  assert.notEqual(
    getPDFId({ name: 'clickable-link-test.pdf', size: 23183 }),
    getPDFId({ name: 'text-search-glyph-lab.pdf', size: 100 }),
  );
});

test('?testPdf= persist writes local cache only when file.id is absent', () => {
  const viewer = read('src/PDFViewer.jsx');
  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
  assert.match(viewer, /if \(!pdfId\) return;\s*\n\s*if \(pdfFile\?\.id\) return;\s*\n\s*saveAnnotationsByPage\(pdfId, annotationsByPage\)/);
  assert.match(viewer, /shouldUseLocalAnnotationCache \? loadAnnotationsByPage\(id\) : \{\}/);
  assert.match(viewer, /const isCloudBackedDoc = !!pdfFile\?\.id/);
  assert.match(viewer, /Loading the older annotationsByPage_\* localStorage cache here causes a/);
});
