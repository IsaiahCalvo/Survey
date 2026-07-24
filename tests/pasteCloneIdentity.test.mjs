import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintPastedCloneIdentity } from '../src/utils/pasteCloneIdentity.js';
import { buildAnnotationHistoryAction, getAnnotationHistoryId } from '../src/utils/annotationLocalHistory.js';

// KAL-81 (2026-07-17): pasting a PDF-imported shape used to record history as
// a MOVE of the SOURCE annotation (the clone kept the source's data.id, so the
// save diff matched clone->source and emitted fabric:update) — undo then
// snapped the clone back onto the original instead of deleting the clone. The
// paste path now mints a fresh NATIVE identity for every clone BEFORE the save
// diff runs, and strips all import provenance so no two objects ever claim the
// same native PDF annotation id.

const importedEditedSource = () => ({
  type: 'rect',
  left: 100,
  top: 100,
  width: 60,
  height: 40,
  stroke: '#dc2626',
  isPdfImported: true,
  pdfAnnotationId: 'native-anno-7',
  pdfAnnotationType: 'Square',
  pdfImportedEditState: 'edited',
  pdfImportedEditedAt: '2026-07-01T00:00:00.000Z',
  pdfImportedEditedBy: 'user-1',
  pdfImportedEditSource: 'object:modified',
  layer: 'pdf-annotations',
  data: { id: 'source-uuid-1', annotationType: 'square', pdfImportedEditState: 'edited' },
});

const nativeSource = () => ({
  type: 'rect',
  left: 40,
  top: 40,
  width: 30,
  height: 30,
  id: 'native-uuid-9',
  data: { id: 'native-uuid-9', annotationType: 'square', authorId: 'user-1' },
});

test('pasted clone of an imported shape gets a fresh id and NO import provenance', () => {
  const source = importedEditedSource();
  const clone = mintPastedCloneIdentity(structuredClone(source));

  // Fresh identity, minted before any save diff.
  assert.ok(clone.data.id, 'clone must carry data.id (creation contract)');
  assert.notEqual(clone.data.id, source.data.id);
  assert.notEqual(getAnnotationHistoryId(clone), getAnnotationHistoryId(source));

  // The clone is a NATIVE object: every import-provenance field is gone —
  // top-level and data mirror alike. Two objects must never claim the same
  // native PDF annotation id (export preserve/remove + re-import dedupe).
  for (const key of [
    'isPdfImported',
    'pdfAnnotationId',
    'pdfAnnotationType',
    'pdfImportedEditState',
    'pdfImportedEditedAt',
    'pdfImportedEditedBy',
    'pdfImportedEditSource',
  ]) {
    assert.equal(key in clone, false, `clone must not carry ${key}`);
    assert.equal(key in clone.data, false, `clone.data must not carry ${key}`);
  }

  // Visual/geometry fields are untouched.
  assert.equal(clone.type, 'rect');
  assert.equal(clone.width, 60);
  assert.equal(clone.data.annotationType, 'square');
});

test('imported source with NO data still yields a clone with data.id', () => {
  // Untouched imports have no data.id/id — without a minted data.id the
  // history differ would skip the clone and paste would record nothing.
  const source = importedEditedSource();
  delete source.data;
  const clone = mintPastedCloneIdentity(structuredClone(source));
  assert.ok(clone.data?.id);
  assert.equal(getAnnotationHistoryId(clone), clone.data.id);
});

test('native clone gets a fresh uuid on every identity alias', () => {
  const source = nativeSource();
  const clone = mintPastedCloneIdentity(structuredClone(source));
  assert.notEqual(clone.data.id, source.data.id);
  assert.equal(clone.id, clone.data.id, 'top-level id alias must mirror the fresh id');
  assert.equal('pdfAnnotationId' in clone, false, 'paste must not mint a fake pdfAnnotationId');
});

test('history records the paste as a CREATE of the clone id — not a move of the source', () => {
  const source = importedEditedSource();
  const previousPage = { objects: [source] };

  // Simulate the paste path: deep clone, mint identity, offset, append.
  const clone = mintPastedCloneIdentity(structuredClone(source));
  clone.left += 25;
  clone.top += 25;
  const nextPage = { objects: [source, clone] };

  const action = buildAnnotationHistoryAction({ pageNumber: 3, previousPage, nextPage });
  assert.ok(action, 'paste must produce a history action');
  assert.equal(action.type, 'fabric:create');
  assert.equal(action.annotationId, clone.data.id);
  assert.notEqual(action.annotationId, getAnnotationHistoryId(source));
});

test('a legacy clone that keeps the source data.id fails safe until canonical promotion', () => {
  // History never invents a positional/NUL occurrence identity for a
  // malformed duplicate. The materialization boundary must promote it to a
  // unique serialized data.id before any save diff can target it.
  const source = importedEditedSource();
  const badClone = structuredClone(source);
  badClone.left += 25;
  const action = buildAnnotationHistoryAction({
    pageNumber: 3,
    previousPage: { objects: [source] },
    nextPage: { objects: [source, badClone] },
  });
  assert.equal(action, null);
});
