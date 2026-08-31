import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientRectToPageQuad,
  computeTextSelectionActionBarPosition,
  createTextMarkupAnnotation,
  mapOcrBoxToPage,
  mergeLineQuads,
  normalizeTextLinkUrl,
  buildTextMarkupLinkRegions,
  finalizeTextMarkupHorizontalEdge,
  resizeTextMarkupHorizontalEdge,
  getTextMarkupRangeHandlePositions,
  getTextMarkupRangeFixedOffset,
  getTextMarkupStackAtPoint,
  rotatePageQuad,
  resolveTextMarkupEditPaint,
  TEXT_MARKUP_DEFAULT_PAINT,
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

test('text links keep only safe external URLs', () => {
  assert.equal(normalizeTextLinkUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeTextLinkUrl('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeTextLinkUrl('mailto:test@example.com'), 'mailto:test@example.com');
  assert.equal(normalizeTextLinkUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTextLinkUrl('data:text/html,bad'), null);
  const annotation = createTextMarkupAnnotation({
    id: 'link-safe', pageNumber: 1, markupType: 'link', linkUrl: 'example.com/docs',
    quads: [{ x1: 1, y1: 2, x2: 11, y2: 2, x3: 1, y3: 7, x4: 11, y4: 7 }],
  });
  assert.equal(annotation.data.linkUrl, 'https://example.com/docs');
  assert.equal(annotation.pdfAnnotationType, 'Link');
});

test('each linked text line gets its own exact click region', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'link-lines', pageNumber: 1, markupType: 'link', linkUrl: 'example.com/spec',
    quads: [
      { x1: 10, y1: 20, x2: 60, y2: 20, x3: 10, y3: 30, x4: 60, y4: 30 },
      { x1: 10, y1: 40, x2: 80, y2: 40, x3: 10, y3: 50, x4: 80, y4: 50 },
    ],
  });
  const regions = buildTextMarkupLinkRegions([annotation], { width: 100, height: 200 });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map(({ left, top, width, height }) => ({ left, top, width, height })), [
    { left: '10%', top: '10%', width: '50%', height: '5%' },
    { left: '10%', top: '20%', width: '70%', height: '5%' },
  ]);
});

test('page links keep an internal page target without inventing a URL', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'link-page', pageNumber: 1, markupType: 'link', linkPageNumber: 3,
    quads: [{ x1: 10, y1: 20, x2: 50, y2: 20, x3: 10, y3: 30, x4: 50, y4: 30 }],
  });
  assert.equal(annotation.data.linkPageNumber, 3);
  assert.equal(annotation.data.linkUrl, undefined);
  assert.deepEqual(buildTextMarkupLinkRegions([annotation], { width: 100, height: 100 })[0], {
    id: 'link-page-0', mode: 'page', url: null, pageNumber: 3,
    left: '10%', top: '20%', width: '40%', height: '10%',
  });
});

test('redactions use opaque black paint and native Redact identity', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'redact-1', pageNumber: 1, markupType: 'redact', color: '#ff00ff', opacity: 0.2,
    quads: [{ x1: 1, y1: 2, x2: 11, y2: 2, x3: 1, y3: 7, x4: 11, y4: 7 }],
  });
  assert.equal(annotation.fill, '#000000');
  assert.equal(annotation.stroke, '#000000');
  assert.equal(annotation.opacity, 1);
  assert.equal(annotation.pdfAnnotationType, 'Redact');
});

test('all new text markup types default to thirty percent opacity', () => {
  for (const markupType of ['highlight', 'underline', 'squiggly', 'strikeout']) {
    assert.equal(TEXT_MARKUP_DEFAULT_PAINT[markupType].opacity, 30);
    const annotation = createTextMarkupAnnotation({
      id: `default-${markupType}`, pageNumber: 1, markupType,
      quads: [{ x1: 1, y1: 2, x2: 11, y2: 2, x3: 1, y3: 7, x4: 11, y4: 7 }],
    });
    assert.equal(annotation.opacity, 0.3);
  }
});

test('each selected text mark hydrates its own base color and effective opacity', () => {
  const amber = createTextMarkupAnnotation({
    id: 'amber', pageNumber: 1, markupType: 'highlight', color: '#f59e0b', opacity: 0.35,
    quads: [{ x1: 1, y1: 2, x2: 11, y2: 2, x3: 1, y3: 7, x4: 11, y4: 7 }],
  });
  const blue = createTextMarkupAnnotation({
    id: 'blue', pageNumber: 1, markupType: 'underline', color: '#2563eb', opacity: 0.8,
    quads: [{ x1: 20, y1: 2, x2: 30, y2: 2, x3: 20, y3: 7, x4: 30, y4: 7 }],
  });
  assert.deepEqual(resolveTextMarkupEditPaint(amber), { color: '#f59e0b', opacity: 35 });
  assert.deepEqual(resolveTextMarkupEditPaint(blue), { color: '#2563eb', opacity: 80 });
  assert.deepEqual(
    resolveTextMarkupEditPaint({ ...blue, stroke: 'rgba(37, 99, 235, 0.5)', opacity: 0.8 }),
    { color: '#2563eb', opacity: 40 },
  );
});

test('text markup range handles change the text start or end line only', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-edit', pageNumber: 1, markupType: 'highlight',
    quads: [
      { x1: 20, y1: 10, x2: 80, y2: 10, x3: 20, y3: 20, x4: 80, y4: 20 },
      { x1: 10, y1: 30, x2: 60, y2: 30, x3: 10, y3: 40, x4: 60, y4: 40 },
    ],
  });

  const left = resizeTextMarkupHorizontalEdge(annotation, 'ml', 5, 100);
  assert.deepEqual(left.data.quads, [
    { x1: 5, y1: 10, x2: 80, y2: 10, x3: 5, y3: 20, x4: 80, y4: 20 },
    annotation.data.quads[1],
  ]);
  assert.deepEqual(
    { top: left.top, height: left.height, scaleX: left.scaleX, scaleY: left.scaleY, angle: left.angle },
    { top: annotation.top, height: annotation.height, scaleX: 1, scaleY: 1, angle: 0 },
  );

  const right = resizeTextMarkupHorizontalEdge(annotation, 'mr', 95, 100);
  assert.deepEqual(right.data.quads, [
    annotation.data.quads[0],
    { x1: 10, y1: 30, x2: 95, y2: 30, x3: 10, y3: 40, x4: 95, y4: 40 },
  ]);
  assert.deepEqual(
    { top: right.top, height: right.height, scaleX: right.scaleX, scaleY: right.scaleY, angle: right.angle },
    { top: annotation.top, height: annotation.height, scaleX: 1, scaleY: 1, angle: 0 },
  );
});

test('text markup range handles clamp to page bounds and keep a usable width', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-clamp', pageNumber: 1, markupType: 'underline',
    quads: [{ x1: 20, y1: 10, x2: 30, y2: 10, x3: 20, y3: 20, x4: 30, y4: 20 }],
  });
  const left = resizeTextMarkupHorizontalEdge(annotation, 'ml', 99, 50);
  assert.equal(left.data.quads[0].x1, 29.5);
  assert.equal(left.data.quads[0].x3, 29.5);
  const right = resizeTextMarkupHorizontalEdge(annotation, 'mr', -20, 50);
  assert.equal(right.data.quads[0].x2, 20.5);
  assert.equal(right.data.quads[0].x4, 20.5);
  assert.strictEqual(resizeTextMarkupHorizontalEdge(annotation, 'mt', 10, 50), annotation);
});

test('text markup range handles move one endpoint line, never every aligned line', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-tied', pageNumber: 1, markupType: 'highlight',
    quads: [
      { x1: 10, y1: 10, x2: 80, y2: 10, x3: 10, y3: 20, x4: 80, y4: 20 },
      { x1: 10, y1: 30, x2: 80, y2: 30, x3: 10, y3: 40, x4: 80, y4: 40 },
    ],
  });

  const left = resizeTextMarkupHorizontalEdge(annotation, 'ml', 20, 100);
  assert.equal(left.left, 10);
  assert.equal(left.width, 70);
  assert.deepEqual(left.data.quads.map((quad) => [quad.x1, quad.x3]), [[20, 20], [10, 10]]);

  const right = resizeTextMarkupHorizontalEdge(annotation, 'mr', 70, 100);
  assert.equal(right.left, 10);
  assert.equal(right.width, 70);
  assert.deepEqual(right.data.quads.map((quad) => [quad.x2, quad.x4]), [[80, 80], [70, 70]]);
});

test('text range handles sit on the first and last selected lines', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-handles', pageNumber: 1, markupType: 'highlight',
    quads: [
      { x1: 20, y1: 10, x2: 80, y2: 10, x3: 20, y3: 20, x4: 80, y4: 20 },
      { x1: 10, y1: 30, x2: 60, y2: 30, x3: 10, y3: 40, x4: 60, y4: 40 },
    ],
  });
  assert.deepEqual(getTextMarkupRangeHandlePositions(annotation), {
    ml: { x: 20, y: 15 },
    mr: { x: 60, y: 35 },
  });
});

test('dragging an endpoint to another line wraps the text range one line at a time', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-wrap', pageNumber: 1, markupType: 'highlight',
    quads: [
      { x1: 20, y1: 10, x2: 80, y2: 10, x3: 20, y3: 20, x4: 80, y4: 20 },
      { x1: 10, y1: 30, x2: 60, y2: 30, x3: 10, y3: 40, x4: 60, y4: 40 },
      { x1: 15, y1: 50, x2: 70, y2: 50, x3: 15, y3: 60, x4: 70, y4: 60 },
    ],
  });
  const wrappedStart = resizeTextMarkupHorizontalEdge(annotation, 'ml', { x: 25, y: 35 }, 100);
  assert.equal(wrappedStart.data.quads.length, 2);
  assert.deepEqual(getTextMarkupRangeHandlePositions(wrappedStart).ml, { x: 25, y: 35 });
  const wrappedEnd = resizeTextMarkupHorizontalEdge(annotation, 'mr', { x: 50, y: 15 }, 100);
  assert.equal(wrappedEnd.data.quads.length, 1);
  assert.deepEqual(getTextMarkupRangeHandlePositions(wrappedEnd).mr, { x: 50, y: 15 });
});

test('stored text model expands across lines and keeps selected text in sync', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'stored-range', pageNumber: 1, markupType: 'highlight', selectedText: 'one',
    textRange: { start: 5, end: 8 },
    textRangeModel: {
      text: 'line one\nline two',
      runs: [
        { start: 0, end: 8, left: 10, top: 10, right: 90, bottom: 20, rtl: false },
        { start: 8, end: 17, left: 10, top: 30, right: 100, bottom: 40, rtl: false },
      ],
    },
    quads: [{ x1: 60, y1: 10, x2: 90, y2: 10, x3: 60, y3: 20, x4: 90, y4: 20 }],
  });
  const expanded = resizeTextMarkupHorizontalEdge(annotation, 'mr', { x: 80, y: 35 }, 100, 100);
  assert.equal(expanded.data.quads.length, 2);
  assert.equal(expanded.data.selectedText, 'one\nline t');
  assert.deepEqual(getTextMarkupRangeHandlePositions(expanded).mr, { x: 80, y: 35 });
});

test('either range handle can cross the other while pointer ownership stays fixed', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-cross', pageNumber: 1, markupType: 'highlight', selectedText: 'cde',
    textRange: { start: 2, end: 5 },
    textRangeModel: { text: 'abcdefghij', runs: [{ start: 0, end: 10, left: 0, right: 100, top: 0, bottom: 10 }] },
    quads: [{ x1: 20, y1: 0, x2: 50, y2: 0, x3: 20, y3: 10, x4: 50, y4: 10 }],
  });
  const crossedLeft = resizeTextMarkupHorizontalEdge(annotation, 'ml', { x: 80, y: 5 }, 100, 100, 5);
  assert.deepEqual(crossedLeft.data.textRange, { start: 5, end: 8 });
  assert.equal(crossedLeft.data.selectedText, 'fgh');
  assert.deepEqual(getTextMarkupRangeHandlePositions(crossedLeft), {
    ml: { x: 80, y: 5 },
    mr: { x: 50, y: 5 },
  });
  const crossedRight = resizeTextMarkupHorizontalEdge(annotation, 'mr', { x: 10, y: 5 }, 100, 100, 2);
  assert.deepEqual(crossedRight.data.textRange, { start: 1, end: 2 });
  assert.equal(crossedRight.data.selectedText, 'b');
  assert.deepEqual(getTextMarkupRangeHandlePositions(crossedRight), {
    ml: { x: 20, y: 5 },
    mr: { x: 10, y: 5 },
  });
});

test('range resize release uses the final pointer even when the last move stopped beside the fixed edge', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'range-release-cross', pageNumber: 1, markupType: 'underline', selectedText: 'cde',
    textRange: { start: 2, end: 5 },
    textRangeModel: { text: 'abcdefghij', runs: [{ start: 0, end: 10, left: 0, right: 100, top: 0, bottom: 10 }] },
    quads: [{ x1: 20, y1: 0, x2: 50, y2: 0, x3: 20, y3: 10, x4: 50, y4: 10 }],
  });
  const stalePreview = resizeTextMarkupHorizontalEdge(annotation, 'ml', { x: 49, y: 5 }, 100, 100, 5);
  const crossed = finalizeTextMarkupHorizontalEdge(
    annotation,
    stalePreview,
    'ml',
    { x: 80, y: 5 },
    100,
    100,
    5,
  );

  assert.deepEqual(crossed.data.textRange, { start: 5, end: 8 });
  assert.equal(crossed.data.selectedText, 'fgh');
  assert.equal(crossed._textRangeDragHandle, 'ml');
  assert.deepEqual(getTextMarkupRangeHandlePositions(crossed), {
    ml: { x: 80, y: 5 },
    mr: { x: 50, y: 5 },
  });

  const committedCrossed = {
    ...crossed,
    _textRangeHandleCrossed: undefined,
    data: { ...crossed.data, textRangeHandleCrossed: true },
  };
  assert.equal(getTextMarkupRangeFixedOffset(committedCrossed, 'ml'), 5);
  const crossedBack = resizeTextMarkupHorizontalEdge(
    committedCrossed,
    'ml',
    { x: 30, y: 5 },
    100,
    100,
    getTextMarkupRangeFixedOffset(committedCrossed, 'ml'),
  );
  assert.deepEqual(crossedBack.data.textRange, { start: 3, end: 5 });
  assert.equal(crossedBack._textRangeHandleCrossed, false);
  assert.deepEqual(getTextMarkupRangeHandlePositions(crossedBack), {
    ml: { x: 30, y: 5 },
    mr: { x: 50, y: 5 },
  });
});

test('stack cycling finds every visible text mark under the press after active-only resize', () => {
  const commonQuad = { x1: 20, y1: 10, x2: 80, y2: 10, x3: 20, y3: 20, x4: 80, y4: 20 };
  const extendedQuad = { x1: 20, y1: 10, x2: 95, y2: 10, x3: 20, y3: 20, x4: 95, y4: 20 };
  const annotations = [
    createTextMarkupAnnotation({ id: 'highlight', pageNumber: 1, markupType: 'highlight', quads: [extendedQuad] }),
    createTextMarkupAnnotation({ id: 'underline', pageNumber: 1, markupType: 'underline', quads: [commonQuad] }),
    createTextMarkupAnnotation({ id: 'squiggly', pageNumber: 1, markupType: 'squiggly', quads: [commonQuad] }),
    createTextMarkupAnnotation({ id: 'strikeout', pageNumber: 1, markupType: 'strikeout', quads: [commonQuad] }),
  ];
  annotations[2].visible = false;

  assert.deepEqual(getTextMarkupStackAtPoint(annotations, { x: 50, y: 15 }), [0, 1, 3]);
  assert.deepEqual(getTextMarkupStackAtPoint(annotations, { x: 90, y: 15 }), [0]);
  assert.deepEqual(getTextMarkupStackAtPoint(annotations, { x: 98, y: 15 }), []);
});

test('resizing one stacked review mark leaves its siblings unchanged', () => {
  const base = {
    pageNumber: 1,
    quads: [
      { x1: 20, y1: 10, x2: 80, y2: 10, x3: 20, y3: 20, x4: 80, y4: 20 },
      { x1: 10, y1: 30, x2: 60, y2: 30, x3: 10, y3: 40, x4: 60, y4: 40 },
    ],
  };
  const selected = createTextMarkupAnnotation({ id: 'selected', markupType: 'highlight', ...base });
  const sibling = createTextMarkupAnnotation({ id: 'sibling', markupType: 'underline', ...base });
  const siblingBefore = structuredClone(sibling);

  const resized = resizeTextMarkupHorizontalEdge(selected, 'mr', { x: 40, y: 35 }, 100, 100);

  assert.notDeepEqual(resized, selected);
  assert.deepEqual(sibling, siblingBefore);
  assert.equal(resized.data.markupType, 'highlight');
  assert.equal(sibling.data.markupType, 'underline');
});

test('legacy text marks without a range model cannot drift from their saved text', () => {
  const annotation = createTextMarkupAnnotation({
    id: 'legacy-range', pageNumber: 1, markupType: 'highlight', selectedText: 'saved words',
    quads: [{ x1: 10, y1: 10, x2: 60, y2: 10, x3: 10, y3: 20, x4: 60, y4: 20 }],
  });
  assert.equal(resizeTextMarkupHorizontalEdge(annotation, 'mr', { x: 90, y: 15 }, 100, 100), annotation);
});

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
