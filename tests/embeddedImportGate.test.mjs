// Per-field sync (2026-09-24): the PDF's own embedded annotations are
// imported into the store-v3 `marks` map once per document, gated by a marker
// in the document's Y.Doc meta (the old server column no longer applies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Y from 'yjs';

import {
  EMBEDDED_IMPORT_MARKER_KEY,
  embeddedImportDecision,
  embeddedImportStableId,
  selectEmbeddedImportObjects,
} from '../src/utils/embeddedImportGate.js';
import {
  createViewerCaptureState,
  docToByPage,
  getAnnotationsMap,
  getMetaValue,
  setMetaValue,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

const embedded = () => [
  { type: 'rect', pdfAnnotationId: '39R', left: 1, data: { imported: true } },
  { type: 'path', pdfAnnotationId: '43R', left: 2, data: {} },
  { type: 'rect', left: 3, data: {} }, // no id in the file: page + position
];

test('only a writable role imports, a known marker skips, an unknown role waits', () => {
  assert.equal(embeddedImportDecision({ role: 'owner', marker: undefined }), 'import');
  assert.equal(embeddedImportDecision({ role: 'editor', marker: null }), 'import');
  assert.equal(embeddedImportDecision({ role: 'viewer', marker: undefined }), 'skip');
  assert.equal(embeddedImportDecision({ role: null, marker: undefined }), 'wait');
  assert.equal(embeddedImportDecision({ role: 'owner', marker: { at: 'x' } }), 'skip');
  assert.equal(embeddedImportDecision({ role: null, marker: { at: 'x' } }), 'skip');
});

test('imported ids are deterministic, so two editors importing at once never duplicate', () => {
  const a = selectEmbeddedImportObjects(embedded(), 3).map((o) => o.id);
  const b = selectEmbeddedImportObjects(embedded(), 3).map((o) => o.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['39R', '43R', 'pdf-embedded-3-2']);
  assert.equal(embeddedImportStableId({ data: { id: 'x' } }, 1, 0), 'x');

  // Two documents write the same import concurrently, then merge.
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  syncByPageToDoc(docA, { 3: { objects: selectEmbeddedImportObjects(embedded(), 3) } });
  syncByPageToDoc(docB, { 3: { objects: selectEmbeddedImportObjects(embedded(), 3) } });
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  assert.equal(getAnnotationsMap(docA).size, 3, 'no duplicates');
  assert.deepEqual(
    JSON.parse(JSON.stringify(docToByPage(docA))),
    JSON.parse(JSON.stringify(docToByPage(docB))),
  );
});

test('an embedded annotation someone deleted, or one already present, is not imported again', () => {
  const selected = selectEmbeddedImportObjects(embedded(), 3, {
    existingIds: new Set(['43R']),
    deletedPdfAnnotations: [{ pdfAnnotationId: '39R', pageNumber: 3 }, { pdfAnnotationId: '99R', pageNumber: 3 }],
  });
  assert.deepEqual(selected.map((o) => o.id), ['pdf-embedded-3-2']);
  // A tombstone on another page does not hide this page's annotation.
  const other = selectEmbeddedImportObjects(embedded(), 3, {
    deletedPdfAnnotations: [{ pdfAnnotationId: '39R', pageNumber: 4 }],
  });
  assert.ok(other.some((o) => o.id === '39R'));
});

test('the marker lives in the document itself, and a user delete after the import is final', () => {
  const doc = new Y.Doc();
  // A document the older build imported: its marks sit in the old map and the
  // new store sees nothing, and there is no v3 marker, so the import runs.
  doc.getMap('annotations').set('39R', { p: 3, o: { type: 'rect', pdfAnnotationId: '39R' } });
  assert.equal(getMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY), undefined);
  assert.equal(embeddedImportDecision({ role: 'owner', marker: getMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY) }), 'import');
  const viewer = createViewerCaptureState();
  syncByPageToDoc(doc, { 3: { objects: selectEmbeddedImportObjects(embedded(), 3) } }, { viewer });
  setMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY, { at: '2026-09-24T00:00:00Z', count: 3 });
  // The user deletes one imported mark; the next open skips the import.
  const view = docToByPage(doc);
  syncByPageToDoc(doc, { 3: { objects: view[3].objects.filter((o) => o.data.id !== '43R') } }, { viewer });
  assert.equal(getAnnotationsMap(doc).has('43R'), false);
  assert.equal(embeddedImportDecision({ role: 'owner', marker: getMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY) }), 'skip');
  assert.equal(doc.getMap('annotations').size, 1, 'the old map is untouched');
});

test('the viewer wires the gate: marker, role, tombstones, and the marker only after the marks are stored', () => {
  const viewer = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = viewer.indexOf('// Embedded import — exactly once per document AND store version');
  const block = viewer.slice(start, viewer.indexOf('// Keep this document\'s list thumbnail current', start));
  assert.ok(start > 0);
  assert.match(block, /embeddedImportDecision\(\{/);
  assert.match(block, /marker: excelSyncMetaGet\(EMBEDDED_IMPORT_MARKER_KEY\)/);
  assert.match(block, /deletedPdfAnnotations: durableDeletedPdfAnnotationsRef\.current/);
  assert.ok(
    block.indexOf('annotationDocHasStoredMarks(importedIds)') < block.indexOf('excelSyncMetaSet(EMBEDDED_IMPORT_MARKER_KEY'),
    'the marker is written after the marks are stored',
  );
  assert.doesNotMatch(block, /\.select\('embedded_import_completed_at'\)/, 'the old server column no longer gates the import');
});
