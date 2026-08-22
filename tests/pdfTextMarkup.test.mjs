import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientRectToPageQuad,
  computeTextSelectionActionBarPosition,
  createTextMarkupAnnotation,
  mapOcrBoxToPage,
  mergeLineQuads,
  rotatePageQuad,
} from '../src/utils/pdfTextMarkup.js';
import { serializeFabricObjectToRow, deserializeRowToFabricObject } from '../src/services/annotationTypeSerializers.js';
import { getEraserOperation } from '../src/utils/eraserPolicy.js';

test('selection client geometry maps through mixed page sizes', () => {
  const rect = { left: 120, top: 240, right: 220, bottom: 260 };
  const pageRect = { left: 100, top: 200, width: 300, height: 400 };
  assert.deepEqual(clientRectToPageQuad(rect, pageRect, { width: 600, height: 800 }), {
    x1: 40, y1: 80, x2: 240, y2: 80, x3: 40, y3: 120, x4: 240, y4: 120,
  });
});

test('range action bar clears app chrome and stays inside a phone viewport', () => {
  assert.deepEqual(
    computeTextSelectionActionBarPosition(
      { left: 8, top: 82, width: 30, height: 18 },
      { viewportWidth: 390, viewportHeight: 844, chromeBottom: 77 },
    ),
    { left: 138, top: 108 },
  );
  assert.deepEqual(
    computeTextSelectionActionBarPosition(
      { left: 350, top: 820, width: 20, height: 14 },
      { viewportWidth: 390, viewportHeight: 844, chromeBottom: 77 },
    ),
    { left: 252, top: 772 },
  );
});

test('quad mapping supports 0, 90, 180, and 270 degree page rotations', () => {
  const q = { x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 40, x4: 30, y4: 40 };
  assert.deepEqual(rotatePageQuad(q, 0, 100, 200), q);
  assert.deepEqual(rotatePageQuad(q, 90, 100, 200), { x1: 180, y1: 10, x2: 180, y2: 30, x3: 160, y3: 10, x4: 160, y4: 30 });
  assert.deepEqual(rotatePageQuad(q, 180, 100, 200), { x1: 90, y1: 180, x2: 70, y2: 180, x3: 90, y3: 160, x4: 70, y4: 160 });
  assert.deepEqual(rotatePageQuad(q, 270, 100, 200), { x1: 20, y1: 90, x2: 20, y2: 70, x3: 40, y3: 90, x4: 40, y4: 70 });
});

test('line fragments merge but separate and RTL runs remain exact', () => {
  const quads = [
    { x1: 30, y1: 10, x2: 50, y2: 10, x3: 30, y3: 20, x4: 50, y4: 20 },
    { x1: 10, y1: 10, x2: 30, y2: 10, x3: 10, y3: 20, x4: 30, y4: 20 },
    { x1: 5, y1: 30, x2: 25, y2: 30, x3: 5, y3: 40, x4: 25, y4: 40 },
  ];
  assert.deepEqual(mergeLineQuads(quads), [
    { x1: 10, y1: 10, x2: 50, y2: 10, x3: 10, y3: 20, x4: 50, y4: 20 },
    quads[2],
  ]);
});

for (const type of ['highlight', 'underline', 'squiggly', 'strikeout']) {
  test(`${type} record keeps exact text, quads, color, opacity, and group`, () => {
    const annotation = createTextMarkupAnnotation({
      id: `${type}-1`, pageNumber: 2, selectionGroupId: 'range-1', markupType: type,
      selectedText: 'שלום\nworld', color: '#123456', opacity: 0.42,
      quads: [{ x1: 10, y1: 20, x2: 50, y2: 20, x3: 10, y3: 30, x4: 50, y4: 30 }],
    });
    assert.equal(annotation.data.selectedText, 'שלום\nworld');
    assert.equal(annotation.data.selectionGroupId, 'range-1');
    assert.equal(annotation.exportType, type);
    assert.equal(annotation.fill, '#123456');
    assert.equal(annotation.opacity, 0.42);
    assert.equal(annotation.hasControls, false);
  });
}

test('OCR boxes map locally to page space and rotation', () => {
  assert.deepEqual(
    mapOcrBoxToPage({ x: 100, y: 50, width: 200, height: 100 }, { width: 1000, height: 500 }, { width: 600, height: 800 }),
    { x1: 60, y1: 80, x2: 180, y2: 80, x3: 60, y3: 240, x4: 180, y4: 240 },
  );
});

test('text markup survives cloud row serialization and stays atomic for erasing', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'mark-1', pageNumber: 1, markupType: 'highlight', selectedText: 'saved text',
    quads: [{ x1: 1, y1: 2, x2: 11, y2: 2, x3: 1, y3: 7, x4: 11, y4: 7 }],
  });
  const row = serializeFabricObjectToRow(annotation, { documentId: 'doc-1', userId: 'user-1', pageNumber: 1 });
  assert.equal(row.annotation_type, 'square');
  const restored = deserializeRowToFabricObject(row).fabricObject;
  assert.deepEqual(restored.data.quads, annotation.data.quads);
  assert.equal(restored.data.selectedText, 'saved text');
  assert.equal(getEraserOperation(restored, 'partial'), 'entire');
});
