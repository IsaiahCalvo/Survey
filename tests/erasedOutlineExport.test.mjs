// Erased-outline PDF export — regression + contract tests.
//
// Erased pen strokes (and PDF-imported Drawboard/Adobe pressure-ink dots)
// are stored in Fabric as FILLED zero-width outlines: {strokeWidth: 0,
// fill: <color>}, possibly with hole rings as separate M...Z subpaths (see
// src/utils/geometryEraser.js). Both PDF ink exporters previously built
// /InkList unconditionally from path endpoints using stroke/strokeWidth —
// never inspecting fill or handling strokeWidth===0 — so an erased stroke
// exported as a wrong-width, unfilled polyline of the ribbon boundary.
//
// pdfAnnotationImporter.convertInkToFabricPath already prefers a filled
// /AP appearance over /InkList whenever hasFill===true && borderWidth<=0
// (see its "Drawboard/Adobe... filled zero-width appearance outlines"
// comment). These tests verify BOTH exporters now write that /AP contract,
// that it round-trips through the REAL importer, and that plain
// (non-erased) strokes still export exactly as before.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { bakeAnnotationsIntoPdf } from '../src/utils/pdfNativeExport/index.js';
import {
  convertInkToFabricPath,
  extractAppearanceMetadataForAnnotation,
} from '../src/utils/pdfAnnotationImporter.js';

const PAGE_W = 200;
const PAGE_H = 200;

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function makeBlankPdfBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE_W, PAGE_H]);
  return doc.save();
}

async function getFirstAnnotDict(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return { doc, dict: null };
  const ref = annots.asArray()[0];
  return { doc, dict: doc.context.lookup(ref) };
}

function readNumberArray(dict, key) {
  const arr = dict.get(PDFName.of(key));
  if (!arr) return null;
  return arr.asArray().map((n) => (typeof n.value === 'function' ? n.value() : Number(n)));
}

async function readAppearanceContent(doc, dict) {
  const ap = dict.get(PDFName.of('AP'));
  if (!ap) return null;
  const apDict = doc.context.lookup(ap);
  const n = apDict.get(PDFName.of('N'));
  const stream = doc.context.lookup(n);
  const decoded = decodePDFRawStream(stream).decode();
  return {
    content: Buffer.from(decoded).toString('latin1'),
    bbox: readNumberArray(stream.dict, 'BBox'),
  };
}

// A single-ring filled outline — the shape an erased pen stroke (or a
// closed pressure-ink dot) takes: strokeWidth 0, fill set, stroke absent.
const filledOutlineObj = {
  id: 'erased-single',
  type: 'path',
  path: [
    ['M', 10, 10],
    ['L', 50, 10],
    ['L', 50, 50],
    ['L', 10, 50],
    ['Z'],
  ],
  fill: '#ff0000',
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
};

// A two-subpath outline: an outer ring with a hole punched out of the
// middle (a stroke that had a bite erased clean through it, or an erase
// that ate the interior of a filled shape) — exercises the even-odd hole
// contract end to end.
const ringWithHoleObj = {
  id: 'erased-ring-hole',
  type: 'path',
  path: [
    ['M', 10, 10], ['L', 90, 10], ['L', 90, 90], ['L', 10, 90], ['Z'],
    ['M', 30, 30], ['L', 30, 70], ['L', 70, 70], ['L', 70, 30], ['Z'],
  ],
  fill: '#00cc66',
  stroke: null,
  strokeWidth: 0,
  opacity: 1,
};

// Plain, never-erased pen stroke — the pre-existing/unaffected shape.
const plainStrokeObj = {
  id: 'pen-1',
  type: 'path',
  path: [['M', 10, 10], ['L', 30, 30], ['M', 50, 50], ['L', 70, 70], ['L', 90, 90]],
  stroke: '#000000',
  strokeWidth: 2,
};

// --- Test 1: filled-outline export produces a filled /AP appearance -------

test('pdfAnnotationsPdfLib: filled-outline ink exports an /AP fill appearance with zero border', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [filledOutlineObj] } },
    { 1: { width: PAGE_W, height: PAGE_H } },
    null,
    { returnBytes: true },
  );
  const { doc, dict } = await getFirstAnnotDict(bytes);
  assert.ok(dict, 'annotation should be written');
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');

  // Zero-width border — the falsy-zero (`strokeWidth || 1`) bug previously
  // collapsed this to 1.
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 0]);

  const appearance = await readAppearanceContent(doc, dict);
  assert.ok(appearance, '/AP /N appearance stream should be present');
  assert.match(appearance.content, /f\*/, 'appearance must use an even-odd fill operator');
  assert.doesNotMatch(appearance.content, /\bS\b/, 'a pure fill appearance must not stroke');
  // Fill color (#ff0000 -> 1 0 0) must appear in the content stream.
  assert.match(appearance.content, /^1 0 0 rg/, 'fill color must be written before the path');

  const c = readNumberArray(dict, 'C');
  assert.deepEqual(c, [1, 0, 0]);

  const ca = dict.get(PDFName.of('CA'));
  assert.equal(ca?.value?.(), 1);

  // A reasonable /InkList fallback is still emitted for readers that
  // ignore /AP.
  const inkList = dict.get(PDFName.of('InkList'));
  assert.ok(inkList && inkList.asArray().length >= 1);
});

test('pdfNativeExport ink adapter: filled-outline ink exports the same /AP fill contract', async () => {
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: { objects: [filledOutlineObj] },
  });
  const { doc, dict } = await getFirstAnnotDict(bytes);
  assert.ok(dict, 'annotation should be written');
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 0]);

  const appearance = await readAppearanceContent(doc, dict);
  assert.ok(appearance, '/AP /N appearance stream should be present');
  assert.match(appearance.content, /f\*/, 'appearance must use an even-odd fill operator');
  assert.match(appearance.content, /^1 0 0 rg/, 'fill color must be written before the path');

  assert.deepEqual(readNumberArray(dict, 'C'), [1, 0, 0]);
  assert.equal(dict.get(PDFName.of('CA'))?.value?.(), 1);
});

// --- Test 2: two-subpath (ring + hole) round-trips through the real importer

test('ring-with-hole outline round-trips through the real importer with both subpaths intact', async () => {
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: { objects: [ringWithHoleObj] },
  });
  const { doc, dict } = await getFirstAnnotDict(bytes);
  assert.ok(dict, 'annotation should be written');

  // BBox must equal Rect exactly (identity Matrix + Rect==BBox means
  // content-stream coordinates map directly onto page coordinates).
  const rect = readNumberArray(dict, 'Rect');
  const appearance = await readAppearanceContent(doc, dict);
  assert.deepEqual(appearance.bbox, rect);

  // Feed the parsed dict through the REAL importer pipeline: the same
  // appearance extractor + convertInkToFabricPath that a live PDF import
  // uses.
  const parsedAppearance = extractAppearanceMetadataForAnnotation(dict, doc.context, {
    PDFName,
    decodePDFRawStream,
  });
  assert.ok(parsedAppearance?.hasFill, 'parsed appearance must report hasFill');

  const annotation = {
    id: 'round-trip-ink',
    color: readNumberArray(dict, 'C'),
    borderWidth: readNumberArray(dict, 'Border')[2],
    _appearance: parsedAppearance,
  };
  const viewport = { height: PAGE_H, convertToViewportPoint: (x, y) => [x, PAGE_H - y] };

  const result = convertInkToFabricPath(annotation, viewport, 1);
  assert.ok(result, 'convertInkToFabricPath should return a Fabric spec');

  // Fill color survives the round trip (#00cc66 -> rgba(0, 204, 102, ...)).
  assert.match(result.fill, /rgba\(\s*0\s*,\s*204\s*,\s*102\s*,/);
  // Renders as a fill, not a stroke — the load-bearing visual contract for
  // a filled outline (mirrors isErasedOutline in svgAnnotationRenderers.jsx,
  // which never draws a stroke for these).
  assert.equal(result.stroke, null);

  // Both subpaths (outer ring + hole) are present.
  const moveCount = result.path.filter((cmd) => cmd[0] === 'M').length;
  assert.equal(moveCount, 2, 'both the outer ring and the hole ring must survive the round trip');
  const closeCount = result.path.filter((cmd) => cmd[0] === 'Z').length;
  assert.equal(closeCount, 2, 'both subpaths must remain closed');
});

// --- Test 3: regression — plain (non-erased) strokes are unaffected -------

test('regression: plain non-erased strokes export exactly as before (pdfAnnotationsPdfLib)', async () => {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [plainStrokeObj] } },
    { 1: { width: PAGE_W, height: PAGE_H } },
    null,
    { returnBytes: true },
  );
  const { doc, dict } = await getFirstAnnotDict(bytes);
  assert.ok(dict);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');
  // No /AP for a plain stroked line — only the eraser-outline branch writes one.
  assert.equal(dict.get(PDFName.of('AP')), undefined);
  assert.equal(dict.get(PDFName.of('CA')), undefined);
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 2]);
  assert.deepEqual(readNumberArray(dict, 'C'), [0, 0, 0]);
  const inkList = dict.get(PDFName.of('InkList'));
  assert.equal(inkList.asArray().length, 2, 'two sub-paths, unchanged from the pre-existing contract');
  void doc;
});

test('regression: plain non-erased strokes export exactly as before (pdfNativeExport ink adapter)', async () => {
  const bytes = await bakeAnnotationsIntoPdf(await makeBlankPdfBytes(), {
    1: { objects: [plainStrokeObj] },
  });
  const { doc, dict } = await getFirstAnnotDict(bytes);
  assert.ok(dict);
  assert.equal(dict.get(PDFName.of('Subtype')).decodeText(), 'Ink');
  assert.equal(dict.get(PDFName.of('AP')), undefined);
  assert.equal(dict.get(PDFName.of('CA')), undefined);
  assert.deepEqual(readNumberArray(dict, 'Border'), [0, 0, 2]);
  assert.deepEqual(readNumberArray(dict, 'C'), [0, 0, 0]);
  const inkList = dict.get(PDFName.of('InkList'));
  assert.equal(inkList.asArray().length, 2, 'two sub-paths, unchanged from the pre-existing contract');
  void doc;
});
