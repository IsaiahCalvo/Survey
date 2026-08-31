import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import {
  adaptSquare,
  adaptCircle,
  adaptLine,
  adaptFreeText,
  adaptPolygon,
  adaptPolyLine,
  adaptInk,
  adaptHighlight,
  adaptUnderline,
  adaptSquiggly,
  adaptStrikeOut,
  adaptRedact,
  resolveAdapter,
} from '../../../src/utils/pdfNativeExport/adapters/index.js';

const PAGE_W = 200;
const PAGE_H = 200;

async function setupContext() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  return { pdfDoc, page, pageHeight: PAGE_H };
}

function readDict(pdfDoc, ref) {
  return pdfDoc.context.lookup(ref);
}

function readSubtype(pdfDoc, ref) {
  return readDict(pdfDoc, ref).get(PDFName.of('Subtype')).decodeText();
}

function readNumberArray(dict, key) {
  const arr = dict.get(PDFName.of(key));
  if (!arr) return [];
  return arr.asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
}

test('adaptSquare writes Square with Y-flipped Rect and color', async () => {
  const ctx = await setupContext();
  const ref = adaptSquare(
    { id: 'sq', type: 'rect', left: 10, top: 20, width: 40, height: 30, stroke: '#ff0000', fill: '#00ff00', strokeWidth: 2 },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Square');
  const rect = readNumberArray(dict, 'Rect');
  assert.deepEqual(rect, [10, PAGE_H - 50, 50, PAGE_H - 20]);
  const color = readNumberArray(dict, 'C');
  assert.deepEqual(color, [1, 0, 0]);
  const ic = readNumberArray(dict, 'IC');
  assert.deepEqual(ic, [0, 1, 0]);
});

test('adaptCircle writes Circle with radius*2 bounding rect', async () => {
  const ctx = await setupContext();
  const ref = adaptCircle(
    { id: 'c', type: 'circle', left: 30, top: 40, radius: 15, stroke: '#000000' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Circle');
  const rect = readNumberArray(dict, 'Rect');
  // left=30, top=40, width=30, height=30 → x1=30, y1=H-70=130, x2=60, y2=H-40=160
  assert.deepEqual(rect, [30, 130, 60, 160]);
});

test('adaptLine writes Line with L array and Y-flipped Rect', async () => {
  const ctx = await setupContext();
  const ref = adaptLine(
    { id: 'l', type: 'line', x1: 10, y1: 20, x2: 70, y2: 80, stroke: '#0000ff' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Line');
  const l = readNumberArray(dict, 'L');
  assert.deepEqual(l, [10, PAGE_H - 20, 70, PAGE_H - 80]);
});

test('adaptLine preserves arrow line-endings', async () => {
  const ctx = await setupContext();
  const ref = adaptLine(
    { type: 'line', x1: 5, y1: 5, x2: 50, y2: 5, lineEnding2: 'ClosedArrow' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  const le = dict.get(PDFName.of('LE')).asArray().map((n) => String(n).replace(/^\//, ''));
  assert.deepEqual(le, ['None', 'ClosedArrow']);
});

test('adaptFreeText writes FreeText with Contents and DA', async () => {
  const ctx = await setupContext();
  const ref = adaptFreeText(
    { id: 'ft', type: 'textbox', left: 10, top: 10, width: 80, height: 20, text: 'Hello', fill: '#1e293b', fontSize: 14 },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'FreeText');
  assert.equal(dict.get(PDFName.of('Contents')).decodeText(), 'Hello');
  const da = dict.get(PDFName.of('DA')).decodeText();
  assert.match(da, /\/Helv 14 Tf/);
});

test('adaptPolygon writes Polygon with closed Vertices', async () => {
  const ctx = await setupContext();
  const ref = adaptPolygon(
    { id: 'p', type: 'polygon', left: 0, top: 0, points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 30 }], stroke: '#111111' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Polygon');
  const v = readNumberArray(dict, 'Vertices');
  assert.equal(v.length, 6);
  // First vertex should be Y-flipped (10, 190)
  assert.equal(v[0], 10);
  assert.equal(v[1], PAGE_H - 10);
});

test('adaptPolyLine writes PolyLine with open Vertices', async () => {
  const ctx = await setupContext();
  const ref = adaptPolyLine(
    { id: 'pl', type: 'polyline', left: 0, top: 0, points: [{ x: 5, y: 5 }, { x: 50, y: 25 }], stroke: '#111111' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'PolyLine');
  const v = readNumberArray(dict, 'Vertices');
  assert.deepEqual(v, [5, PAGE_H - 5, 50, PAGE_H - 25]);
});

test('adaptInk writes Ink with nested InkList', async () => {
  const ctx = await setupContext();
  const ref = adaptInk(
    { id: 'ink', type: 'path', path: [['M', 10, 10], ['L', 20, 20], ['M', 30, 30], ['L', 40, 40]], stroke: '#111111' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');
  const inkList = dict.get(PDFName.of('InkList')).asArray();
  assert.equal(inkList.length, 2); // two sub-paths
  const first = inkList[0].asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
  assert.deepEqual(first, [10, PAGE_H - 10, 20, PAGE_H - 20]);
});

test('adaptInk is paper-ink aware: InkList carries the persisted centerline and Border the source width', async () => {
  // Item 6 of INK-MODEL-AND-IMPORT-NORMALIZATION-2026-07-17: the adapter used
  // to dump outline-ring endpoints into InkList with strokeWidth 0 for filled
  // paper ink. Mirror the live exporter (pdfAnnotationsPdfLib
  // createFilledPaperInkAnnotation centerline fallback): the editable InkList
  // must be the true CENTERLINE and Border the original pen width.
  const { createProductionPaperInk } = await import('../../../src/utils/productionPaperInk.js');
  const paperInk = createProductionPaperInk({
    id: 'paper-ink-adapter',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const ctx = await setupContext();
  const ref = adaptInk(paperInk, ctx);
  const dict = readDict(ctx.pdfDoc, ref);

  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');
  const inkList = dict.get(PDFName.of('InkList')).asArray();
  assert.equal(inkList.length, 1, 'one centerline sub-path, not outline rings');
  const flat = inkList[0].asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
  const expected = paperInk.paperCenterline.flatMap((pt) => [pt.x, PAGE_H - pt.y]);
  assert.deepEqual(flat, expected, 'InkList must be the persisted centerline, Y-flipped');
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 20], 'Border carries the source pen width, not 0');
  assert.deepEqual(readNumberArray(dict, 'C'), [1, 0, 0], 'color comes from the paper-ink FILL, not the (absent) stroke');
});

test('adaptInk keeps the outline path for partially erased paper ink (no centerline reconstruction)', async () => {
  const { createProductionPaperInk } = await import('../../../src/utils/productionPaperInk.js');
  const { erasePageAnnotations } = await import('../../../src/utils/pageSpaceEraser.js');
  const original = createProductionPaperInk({
    id: 'paper-ink-erased-adapter',
    tool: 'pen',
    points: [{ x: 20, y: 70 }, { x: 180, y: 70 }],
    color: '#ff0000',
    width: 20,
  });
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [original] },
    eraserPoints: [{ x: 90, y: 58 }],
    eraserRadius: 7,
    mode: 'partial',
  }).pageAnnotations.objects[0];

  const ctx = await setupContext();
  const ref = adaptInk(erased, ctx);
  const dict = readDict(ctx.pdfDoc, ref);
  // Erased ink's centerline no longer matches the visible shape — same rule
  // as the live exporter: fall back to outline geometry with width 0.
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 0]);
  assert.ok(dict.get(PDFName.of('InkList')).asArray().length >= 1);
});

test('adaptHighlight writes Highlight with QuadPoints in Adobe order', async () => {
  const ctx = await setupContext();
  const ref = adaptHighlight(
    { id: 'h', type: 'rect', exportType: 'highlight', left: 10, top: 20, width: 40, height: 10, fill: '#ffff00' },
    ctx,
  );
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Highlight');
  const qp = readNumberArray(dict, 'QuadPoints');
  // TL, TR, BL, BR — y flipped
  assert.deepEqual(qp, [10, PAGE_H - 20, 50, PAGE_H - 20, 10, PAGE_H - 30, 50, PAGE_H - 30]);
});

test('text markup export preserves stored multi-line quads, selected text, and opacity', async () => {
  const ctx = await setupContext();
  const ref = adaptHighlight({
    id: 'multi', type: 'group', exportType: 'highlight', left: 10, top: 20, width: 60, height: 30,
    fill: '#abcdef', opacity: 0.42,
    data: {
      selectedText: 'line one\nline two',
      quads: [
        { x1: 10, y1: 20, x2: 50, y2: 20, x3: 10, y3: 30, x4: 50, y4: 30 },
        { x1: 12, y1: 40, x2: 70, y2: 40, x3: 12, y3: 50, x4: 70, y4: 50 },
      ],
    },
  }, ctx);
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Contents')).decodeText(), 'line one\nline two');
  assert.equal(dict.get(PDFName.of('CA')).value(), 0.42);
  assert.equal(readNumberArray(dict, 'QuadPoints').length, 16);
});

test('adaptUnderline, adaptSquiggly, adaptStrikeOut share quad-point math', async () => {
  const ctx = await setupContext();
  for (const [adapt, subtype] of [
    [adaptUnderline, 'Underline'],
    [adaptSquiggly, 'Squiggly'],
    [adaptStrikeOut, 'StrikeOut'],
  ]) {
    const ref = adapt(
      { type: 'rect', exportType: subtype.toLowerCase(), left: 5, top: 5, width: 20, height: 4, fill: '#ff0000' },
      ctx,
    );
    assert.equal(readSubtype(ctx.pdfDoc, ref), subtype);
  }
});

test('adaptRedact writes a non-concealing mark without selected text', async () => {
  const ctx = await setupContext();
  const ref = adaptRedact({
    id: 'redact', type: 'group', exportType: 'redact', left: 10, top: 20, width: 80, height: 14,
    fill: '#000000', opacity: 1,
    data: {
      selectedText: 'Private text',
      quads: [{ x1: 10, y1: 20, x2: 90, y2: 20, x3: 10, y3: 34, x4: 90, y4: 34 }],
    },
  }, ctx);
  const dict = readDict(ctx.pdfDoc, ref);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Redact');
  assert.deepEqual(readNumberArray(dict, 'IC'), [0, 0, 0]);
  assert.equal(dict.get(PDFName.of('Contents')), undefined);
  const appearance = dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const appearanceSource = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
  assert.match(appearanceSource, /\bre\s+S\b/);
  assert.doesNotMatch(appearanceSource, /\bre\s+f\b/);
});

test('resolveAdapter picks the right per-type adapter', () => {
  assert.equal(resolveAdapter({ type: 'rect' }), adaptSquare);
  assert.equal(resolveAdapter({ type: 'circle' }), adaptCircle);
  assert.equal(resolveAdapter({ type: 'rect', exportType: 'highlight' }), adaptHighlight);
  assert.equal(resolveAdapter({ type: 'rect', exportType: 'survey-marker' }), adaptHighlight);
  assert.equal(resolveAdapter({ type: 'path' }), adaptInk);
  assert.equal(resolveAdapter({ type: 'line' }), adaptLine);
  assert.equal(resolveAdapter({ type: 'polygon' }), adaptPolygon);
  assert.equal(resolveAdapter({ type: 'polyline' }), adaptPolyLine);
  assert.equal(resolveAdapter({ type: 'textbox' }), adaptFreeText);
  assert.equal(resolveAdapter({ type: 'unknown' }), null);
});

test('adapters return null for degenerate input (zero size, missing points)', async () => {
  const ctx = await setupContext();
  assert.equal(adaptSquare({ type: 'rect', left: 0, top: 0, width: 0, height: 0 }, ctx), null);
  assert.equal(adaptCircle({ type: 'circle', radius: 0 }, ctx), null);
  assert.equal(adaptPolygon({ type: 'polygon', points: [{ x: 0, y: 0 }] }, ctx), null);
  assert.equal(adaptPolyLine({ type: 'polyline', points: [] }, ctx), null);
  assert.equal(adaptInk({ type: 'path', path: [] }, ctx), null);
  assert.equal(adaptLine({ type: 'line', x1: 5, y1: 5, x2: 5, y2: 5 }, ctx), null);
});
