// w27 (2026-09-24): the once-only embedded-import marker must not be written
// while a page of the PDF that carries markup could not be read — otherwise
// every later open skips the import and that page's markup never arrives
// ("imported marker set but marks missing").
//
// Before: importAnnotationsFromPdf swallows a page-level error (pdf.js
// getPage/getAnnotations failing), returns no objects for that page, and the
// viewer wrote the marker anyway. Now the viewer records the attempt and
// retries on the next open, bounded to EMBEDDED_IMPORT_MAX_ATTEMPTS opens; a
// failed page with no markup never holds the marker back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Y from 'yjs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import {
  EMBEDDED_IMPORT_INCOMPLETE_KEY,
  EMBEDDED_IMPORT_MARKER_KEY,
  EMBEDDED_IMPORT_MAX_ATTEMPTS,
  embeddedImportDecision,
  embeddedImportFailedPages,
  embeddedImportMarkerDecision,
  selectEmbeddedImportObjects,
} from '../src/utils/embeddedImportGate.js';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  docToByPage,
  getAnnotationsMap,
  getMetaValue,
  setMetaValue,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

// A two-page PDF: page 1 carries one square annotation, page 2 carries none.
async function twoPagePdfBytes() {
  const doc = await PDFDocument.create();
  const first = doc.addPage([100, 100]);
  doc.addPage([100, 100]);
  const square = doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50], C: [1, 0, 0], NM: PDFString.of('sq1'),
  });
  first.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(square)]));
  return doc.save();
}

// A pdf.js document whose pages cannot be read (the listed ones, or all).
const unreadablePdf = (numPages, failing = null) => ({
  numPages,
  getPage: async (n) => {
    if (!failing || failing.includes(n)) throw new Error(`page ${n} unreadable`);
    return {
      rotate: 0,
      view: [0, 0, 100, 100],
      getViewport: () => ({ width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] }),
      getAnnotations: async () => [],
    };
  },
});

async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

test('the importer reports an unreadable page and how much markup the file lists there', async () => {
  const bytes = await twoPagePdfBytes();
  const { annotationsByPage, nativeLayerPolicyByPage } = await quietly(
    () => importAnnotationsFromPdf(unreadablePdf(2), { rawPdfBytes: bytes }),
  );
  assert.deepEqual(annotationsByPage, {}, 'nothing imported from unreadable pages');
  assert.equal(nativeLayerPolicyByPage[1].reason, 'page-import-failed');
  assert.equal(nativeLayerPolicyByPage[1].rawAnnotationCount, 1);
  assert.equal(nativeLayerPolicyByPage[2].rawAnnotationCount, 0);
  // Only the page with markup holds the marker back.
  assert.deepEqual(embeddedImportFailedPages(nativeLayerPolicyByPage), [1]);
});

test('without the raw bytes an unreadable page counts as carrying markup', async () => {
  const { nativeLayerPolicyByPage } = await quietly(
    () => importAnnotationsFromPdf(unreadablePdf(3, [2]), {}),
  );
  assert.equal(nativeLayerPolicyByPage[2].rawAnnotationCount, null);
  assert.notEqual(nativeLayerPolicyByPage[1].reason, 'page-import-failed');
  assert.deepEqual(embeddedImportFailedPages(nativeLayerPolicyByPage), [2]);
  assert.deepEqual(embeddedImportFailedPages(null), []);
});

test('an unreadable page with markup holds the marker back, for a bounded number of opens', () => {
  assert.deepEqual(embeddedImportMarkerDecision({ failedPages: [] }), { write: true });
  let previous = null;
  const decisions = [];
  for (let open = 1; open <= EMBEDDED_IMPORT_MAX_ATTEMPTS; open += 1) {
    const decision = embeddedImportMarkerDecision({ failedPages: [7], previous });
    decisions.push(decision);
    if (!decision.write) previous = { attempts: decision.attempts, pages: decision.pages };
  }
  assert.deepEqual(decisions.slice(0, -1).map((d) => d.write), Array(EMBEDDED_IMPORT_MAX_ATTEMPTS - 1).fill(false));
  assert.deepEqual(decisions.at(-1), { write: true, incompletePages: [7], attempts: EMBEDDED_IMPORT_MAX_ATTEMPTS });
});

test('a page that could not be read once is imported on the next open, without duplicates', () => {
  const doc = new Y.Doc();
  const objects = (page, n) => Array.from({ length: n }, (_, i) => ({
    type: 'path', pdfAnnotationId: `${page}${i}R`, isPdfImported: true, left: i, data: {},
  }));
  const file = { 6: objects(6, 3), 7: objects(7, 2) };
  const importPass = (parsed, failedPages) => {
    const current = docToByPage(doc);
    const next = { ...current };
    for (const [pageKey, pageObjects] of Object.entries(parsed)) {
      const page = Number(pageKey);
      const have = new Set((current[page]?.objects || []).map((o) => o.id));
      const added = selectEmbeddedImportObjects(pageObjects, page, { existingIds: have });
      next[page] = { objects: [...(current[page]?.objects || []), ...added] };
    }
    syncByPageToDoc(doc, next);
    const decision = embeddedImportMarkerDecision({
      failedPages,
      previous: getMetaValue(doc, EMBEDDED_IMPORT_INCOMPLETE_KEY),
    });
    if (decision.write) setMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY, { count: getAnnotationsMap(doc).size });
    else setMetaValue(doc, EMBEDDED_IMPORT_INCOMPLETE_KEY, { attempts: decision.attempts, pages: decision.pages });
  };
  const markerNow = () => getMetaValue(doc, EMBEDDED_IMPORT_MARKER_KEY);

  importPass({ 6: file[6] }, [7]); // page 7 unreadable on the first open
  assert.equal(markerNow(), undefined, 'no marker while page 7 is missing');
  assert.equal(embeddedImportDecision({ role: 'owner', marker: markerNow() }), 'import');
  assert.deepEqual(getMetaValue(doc, EMBEDDED_IMPORT_INCOMPLETE_KEY), { attempts: 1, pages: [7] });

  importPass(file, []); // the next open reads every page
  const byPage = docToByPage(doc);
  assert.deepEqual([byPage[6].objects.length, byPage[7].objects.length], [3, 2]);
  assert.deepEqual(markerNow(), { count: 5 });
  assert.equal(embeddedImportDecision({ role: 'owner', marker: markerNow() }), 'skip');
});

test('the viewer asks the w27 decision before the marker and retries next open, not every render', () => {
  const viewer = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = viewer.indexOf('// Embedded import — exactly once per document AND store version');
  const block = viewer.slice(start, viewer.indexOf('// Keep this document\'s list thumbnail current', start));
  assert.ok(start > 0);
  const decisionAt = block.indexOf('embeddedImportMarkerDecision({');
  const markerAt = block.indexOf('excelSyncMetaSet(EMBEDDED_IMPORT_MARKER_KEY');
  assert.ok(decisionAt > 0 && decisionAt < markerAt, 'the decision runs before the marker is written');
  assert.match(block, /failedPages: embeddedImportFailedPages\(nativeLayerPolicyByPage\)/);
  assert.match(block, /previous: excelSyncMetaGet\(EMBEDDED_IMPORT_INCOMPLETE_KEY\)/);
  const heldBack = block.slice(decisionAt, markerAt);
  assert.match(heldBack, /if \(!markerDecision\.write\) \{[\s\S]*excelSyncMetaSet\(EMBEDDED_IMPORT_INCOMPLETE_KEY[\s\S]*return;/);
  assert.doesNotMatch(heldBack, /embeddedImportFallbackDoneRef\.current = null/);
});
