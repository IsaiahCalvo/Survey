// Filled paper-ink flatten must honor rgba fill, not stroke the outline.
// Live toolbar writes Pen / Highlighter Color Opacity as composeAnnotationColor
// rgba fill (stroke 'transparent', strokeWidth 0). Export Ink /CA + AP /ca
// already fade the blob. Print flatten used to stroke the outline hex-only
// at width 1 (0 is falsy) and fall back to black. Distinct from leftover-18,
// pen first-stroke opacity (87173d9d), highlighter highlightColor compose,
// and arrowhead flatten /CA (6b8b2bb3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';
import { resolveShapeFill } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeInk(tool, color, patch = {}) {
  return createProductionPaperInk({
    id: `${tool}-flatten-fill-${patch.idSuffix || 'default'}`,
    tool,
    points: [{ x: 20, y: 20 }, { x: 80, y: 40 }, { x: 120, y: 30 }],
    color,
    width: tool === 'highlighter' ? 20 : 3,
    data: { id: `${tool}-flatten-fill-${patch.idSuffix || 'default'}` },
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'ink-flatten-fill-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictNumber(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (value == null) return undefined;
  return value?.asNumber ? value.asNumber() : Number(value);
}

function dictRgb(dict, key) {
  const value = dict.get(PDFName.of(key));
  if (!value || typeof value.asArray !== 'function') return null;
  return value.asArray().map((entry) => (entry?.asNumber ? entry.asNumber() : Number(entry)));
}

function lookupDict(doc, value) {
  if (!value) return null;
  if (typeof value.lookup === 'function' || typeof value.get === 'function') return value;
  return doc.context.lookup(value) || null;
}

function pageAlphas(doc, page) {
  const resources = lookupDict(doc, page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const fills = [];
  const strokes = [];
  if (!ext || typeof ext.entries !== 'function') return { fills, strokes };
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) fills.push(ca.asNumber ? ca.asNumber() : Number(ca));
    if (CA != null) strokes.push(CA.asNumber ? CA.asNumber() : Number(CA));
  }
  return { fills, strokes };
}

function flattenGroups(text) {
  const groups = String(text || '').match(/q[\s\S]*?Q/g) || [];
  return groups.map((group) => ({
    text: group,
    hasGs: /\/GS-?\d+\s+gs/.test(group),
    fills: (group.match(/(?:^|[\s])f\*?[\s]/gm) || []).length,
    strokes: (group.match(/(?:^|[\s])S(?:[\s]|$)/gm) || []).length,
    yellowFill: /1\s+1\s+0\s+rg/.test(group),
    redFill: /1\s+0\s+0\s+rg/.test(group),
    blackStroke: /0\s+0\s+0\s+RG/.test(group),
    multiply: /\/Multiply/.test(group) || /Multiply/.test(group),
  }));
}

async function exportInk(tool, color, patch = {}) {
  const object = makeInk(tool, color, patch);
  assert.ok(object, 'createProductionPaperInk must produce ink');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [object] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ink-flatten-fill' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { doc, dict, object };
}

async function flattenInk(tool, color, patch = {}) {
  const object = makeInk(tool, color, patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [object] } },
    { 1: { width: 200, height: 200 } },
    { returnBytes: true },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  const contents = doc.context.lookup(contentsRef);
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : [contents];
  const text = streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
  return { text, groups: flattenGroups(text), object, ...pageAlphas(doc, page) };
}

test('resolveShapeFill maps live highlighter rgba and leftover hex', () => {
  assert.equal(
    resolveShapeFill({ fill: 'rgba(255, 255, 0, 0.4)' }).paint,
    'rgba(255, 255, 0, 0.4)',
  );
  assert.equal(resolveShapeFill({ fill: composeAnnotationColor('#FFFF00', 40) }).opacity, 0.4);
  assert.equal(resolveShapeFill({ fill: composeAnnotationColor('#FFFF00', 0) }).visible, false);
  assert.equal(resolveShapeFill({ fill: '#FFFF00' }).opacity, 1);
});

test('production ink stores Color Opacity on fill; stroke stays empty', () => {
  const highlighter = makeInk('highlighter', composeAnnotationColor('#ffff00', 40));
  assert.equal(highlighter.fill, 'rgba(255, 255, 0, 0.4)');
  assert.equal(highlighter.stroke, 'transparent');
  assert.equal(highlighter.strokeWidth, 0);
  assert.equal(highlighter.globalCompositeOperation, 'multiply');
  const pen = makeInk('pen', composeAnnotationColor('#ff0000', 40));
  assert.equal(pen.fill, 'rgba(255, 0, 0, 0.4)');
  assert.equal(pen.stroke, 'transparent');
  assert.equal(pen.strokeWidth, 0);
});

test('annotated export writes Ink /CA from rgba fill; opaque omits a fade invent', async () => {
  const faded = await exportInk('highlighter', composeAnnotationColor('#ffff00', 40), { idSuffix: 'fade' });
  assert.deepEqual(dictRgb(faded.dict, 'C'), [1, 1, 0], '/C stays the fill hex');
  assert.equal(dictNumber(faded.dict, 'CA'), 0.4, 'Ink /CA must be live Color Opacity');

  const opaque = await exportInk('highlighter', '#ffff00', { idSuffix: 'opaque' });
  assert.equal(dictNumber(opaque.dict, 'CA'), 1, 'opaque highlighter still writes /CA 1 via paintAlpha');

  const zero = await exportInk('highlighter', composeAnnotationColor('#ffff00', 0), { idSuffix: 'zero' });
  assert.equal(dictNumber(zero.dict, 'CA'), 0, 'opacity-0 highlighter must write /CA 0');
});

test('print flatten fills the blob at live opacity; must not invent a black 1pt stroke', async () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const pathBranch = flatten.slice(
    flatten.indexOf("if (type === 'path')"),
    flatten.indexOf("if (type === 'rect')"),
  );
  assert.match(pathBranch, /isFilledPaperInk\(shifted\)/);
  assert.match(pathBranch, /color: fillColor/);
  assert.match(pathBranch, /opacity: fillOpacity/);
  assert.match(pathBranch, /blendMode: 'Multiply'/);

  const faded = await flattenInk('highlighter', composeAnnotationColor('#ffff00', 40), { idSuffix: 'flat-fade' });
  const painted = faded.groups.filter((group) => group.fills > 0);
  assert.ok(painted.length >= 1, `faded highlighter must flatten as a fill (got ${JSON.stringify(faded.groups)})`);
  assert.ok(painted.some((group) => group.yellowFill), `faded flatten must fill #FFFF00 (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be 0.4 (got ${faded.fills})`);
  painted.forEach((group, index) => {
    assert.equal(group.hasGs, true, `fill group ${index} must apply ExtGState`);
    assert.equal(group.strokes, 0, `filled ink must not stroke the outline (group ${index})`);
    assert.equal(group.blackStroke, false, 'must not invent a black outline');
  });

  const opaque = await flattenInk('pen', '#ff0000', { idSuffix: 'flat-opaque' });
  assert.ok(opaque.groups.some((group) => group.redFill), 'opaque pen flatten still paints the fill color');
  assert.ok(
    opaque.fills.every((value) => value >= 0.999) && opaque.fills.length >= 0,
    `opaque flatten must not invent a fade (got fills=${opaque.fills})`,
  );
  assert.ok(!opaque.groups.some((group) => group.blackStroke && group.strokes > 0), 'opaque pen must not invent a black stroke');

  const zero = await flattenInk('highlighter', composeAnnotationColor('#ffff00', 0), { idSuffix: 'flat-zero' });
  assert.ok(zero.fills.some((value) => value === 0), `opacity-0 flatten must write /ca 0 (got ${zero.fills})`);
});
