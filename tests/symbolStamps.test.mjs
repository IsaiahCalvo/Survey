// KAL-407 (F13): the engineering symbol library and how a placed symbol is
// drawn everywhere: screen picture, canvas painter, print and PDF export.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  SYMBOLS, SYMBOL_CATEGORIES, SYMBOL_STROKE_WIDTH, buildSymbolSvg, createSymbolStampObject, getSymbol,
  isSymbolStamp, parseSymbolPath, symbolPaintViewBox, symbolsInCategory, transformSymbolPath,
} from '../src/utils/symbolLibrary.js';
import { isPdfStampProxy } from '../src/utils/pdfStampProxy.js';
import { annotationImageSource } from '../src/utils/annotationImageCache.js';
import { drawAnnotationObject } from '../src/utils/annotationCanvasPainter.js';
import { savePDFWithAnnotationsPdfLib, savePDFWithFlattenedRegularAnnotationsForPrint } from '../src/utils/pdfAnnotationsPdfLib.js';

test('library: unique ids, both disciplines filled, every path parses', () => {
  assert.equal(new Set(SYMBOLS.map((s) => s.id)).size, SYMBOLS.length);
  for (const category of SYMBOL_CATEGORIES) assert.ok(symbolsInCategory(category.id).length >= 8, category.id);
  for (const symbol of SYMBOLS) {
    assert.ok(symbol.label && symbol.viewBox.every((n) => n > 0), symbol.id);
    for (const path of symbol.paths) assert.ok(parseSymbolPath(path.d).length > 0, symbol.id);
    const [px, py, pw, ph] = symbolPaintViewBox(symbol);
    const pad = SYMBOL_STROKE_WIDTH / 2;
    assert.deepEqual([px, py, pw, ph], [-pad, -pad, symbol.viewBox[0] + 2 * pad, symbol.viewBox[1] + 2 * pad]);
    const svg = buildSymbolSvg(symbol, '#2563eb');
    assert.ok(svg.includes(`viewBox="${px} ${py} ${pw} ${ph}"`), symbol.id);
    assert.ok(svg.includes('stroke="#2563eb"'), symbol.id);
  }
  assert.throws(() => parseSymbolPath('m0 0 l10 10'), /absolute/);
  assert.throws(() => parseSymbolPath('M0 0 C1 1 2 2 3 3'));
});

test('a placed symbol is a centred, unlocked stamp mark that keeps its proportions', () => {
  const mark = createSymbolStampObject({ symbolId: 'iec-resistor', color: '#111111', centerX: 200, centerY: 100, id: 'sym-1' });
  assert.equal(mark.width, 40);
  assert.equal(mark.height, 15);
  assert.equal(mark.left + mark.width / 2, 200);
  assert.equal(mark.top + mark.height / 2, 100);
  assert.ok(isPdfStampProxy(mark) && isSymbolStamp(mark));
  assert.equal(mark.lockMovementX, undefined);
  assert.equal(mark.data.id, 'sym-1');
  assert.match(decodeURIComponent(mark.src), /^data:image\/svg\+xml;charset=utf-8,<svg /);
  assert.equal(createSymbolStampObject({ symbolId: 'nope', centerX: 0, centerY: 0 }), null);
  // An imported PDF stamp is not a library symbol, and still waits on its picture.
  const imported = { type: 'image', src: 'data:image/png;base64,AA==', pdfAnnotationType: 'Stamp' };
  assert.equal(isSymbolStamp(imported), false);
  assert.equal(annotationImageSource(imported), imported.src);
  assert.equal(annotationImageSource(mark), null, 'a symbol never waits on an image decode');
});

test('symbol paths map onto the mark box, resized and rotated like the screen', () => {
  const symbol = getSymbol('iec-earth');
  const box = { left: 10, top: 20, width: 96, height: 48, angle: 0 };
  assert.equal(transformSymbolPath('M24 4 V24', symbol.viewBox, box), 'M58 24 L58 44');
  // 90 degrees clockwise (y down) about the box centre (58, 44).
  assert.equal(transformSymbolPath('M24 4 V24', symbol.viewBox, { ...box, angle: 90 }), 'M78 44 L58 44');
  assert.equal(transformSymbolPath('M0 0 A5 5 0 0 1 10 0', [10, 10], { left: 0, top: 0, width: 20, height: 10, angle: 0 }), 'M0 0 A10 5 0 0 1 20 0');
  // Same padded viewBox the SVG picture uses: an authored edge stays inside the
  // mark so Path2D / print keep the stroke the <image> no longer clips.
  const paint = { left: 0, top: 0, width: 66.5, height: 26.5, angle: 0 };
  assert.equal(transformSymbolPath('M0 12', symbolPaintViewBox(getSymbol('iec-resistor')), paint), 'M1.25 13.25');
});

test('canvas painter draws a symbol from its paths, in its colour', () => {
  const made = [];
  globalThis.Path2D = class { constructor(d) { this.d = d; made.push(d); } };
  const log = { strokes: 0, fills: 0, strokeStyle: null };
  const context = {
    save() {}, restore() {}, translate() {}, rotate() {}, drawImage() { throw new Error('no picture'); },
    stroke() { log.strokes += 1; log.strokeStyle = this.strokeStyle; }, fill() { log.fills += 1; },
  };
  try {
    const mark = createSymbolStampObject({ symbolId: 'iec-diode', color: '#2563eb', centerX: 50, centerY: 50 });
    drawAnnotationObject(context, mark, 1);
    const symbol = getSymbol('iec-diode');
    assert.equal(log.strokes, symbol.paths.length);
    assert.equal(log.fills, symbol.paths.filter((p) => p.fill).length);
    assert.equal(log.strokeStyle, '#2563eb');
    assert.ok(made.every((d) => /^M/.test(d)));
  } finally {
    delete globalThis.Path2D;
  }
});

const blankPdf = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const bytes = await doc.save();
  return { name: 'blank.pdf', async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
};

const opsOf = async (bytes) => {
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
  const page = await (await task.promise).getPage(1);
  const list = await page.getOperatorList();
  const annotations = await page.getAnnotations();
  await task.destroy();
  return { list, annotations };
};

const IMAGE_OPS = [pdfjsLib.OPS.paintImageXObject, pdfjsLib.OPS.paintInlineImageXObject];

test('print draws a symbol as vector paths, not a picture', async () => {
  const mark = createSymbolStampObject({ symbolId: 'isa-control-valve', color: '#e11d48', centerX: 150, centerY: 100 });
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await blankPdf(), { 1: { objects: [mark] } }, { 1: { width: 300, height: 200 } },
    { actionType: 'pdf-print-flattened-regular-annotations', documentId: 'doc-symbols' },
  );
  const { list } = await opsOf(bytes);
  const paths = list.fnArray.filter((fn) => fn === pdfjsLib.OPS.constructPath).length;
  assert.ok(paths >= getSymbol('isa-control-valve').paths.length, `paths drawn: ${paths}`);
  assert.ok(!list.fnArray.some((fn) => IMAGE_OPS.includes(fn)), 'no picture in print');
});

test('export writes a symbol as a Stamp annotation with a vector appearance', async () => {
  const mark = createSymbolStampObject({ symbolId: 'iec-motor', color: '#111111', centerX: 100, centerY: 100, id: 'sym-export' });
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(await blankPdf(), { 1: { objects: [mark] } }, { 1: { width: 300, height: 200 } }, null,
      { returnBytes: true, actionType: 'pdf-export', documentId: 'doc-symbols' });
  } finally {
    globalThis.window = originalWindow;
  }
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(annots?.size?.(), 1);
  const stamp = annots.lookup(0);
  assert.equal(stamp.get(PDFName.of('Subtype')).toString(), '/Stamp');
  const rect = stamp.lookup(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  assert.ok(rect[0] <= 80 && rect[2] >= 120 && rect[1] <= 80 && rect[3] >= 120, `rect ${rect}`);
  const { annotations } = await opsOf(bytes);
  assert.equal(annotations[0]?.subtype, 'Stamp');
  assert.equal(annotations[0]?.hasAppearance, true);
});
