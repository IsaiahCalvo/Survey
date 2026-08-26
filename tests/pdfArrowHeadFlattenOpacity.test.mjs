// Line/Arrow flatten arrowhead must honor rgba stroke opacity.
// Live toolbar writes Color Opacity as composeAnnotationColor rgba stroke.
// Export Line /CA already fades the whole annotation; print flatten faded
// the shaft and then drew the head hex-only (opaque tip). Distinct from
// shape /ca vs /CA, callout borderOpacity Line /CA, and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveShapeStroke } from '../src/utils/annotationStyleCatalog.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeArrow(patch = {}) {
  return {
    id: `arrow-head-opacity-${patch.idSuffix || 'default'}`,
    type: 'Line',
    left: 20,
    top: 30,
    width: 80,
    height: 40,
    x1: -40,
    y1: -20,
    x2: 40,
    y2: 20,
    stroke: 'rgba(255, 0, 0, 0.4)',
    strokeWidth: 2,
    tool: 'arrow',
    lineEnding2: 'ClosedArrow',
    data: {
      id: `arrow-head-opacity-${patch.idSuffix || 'default'}`,
      tool: 'arrow',
      annotationType: 'arrow',
      arrowheadStyle: 'solidTriangle',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'arrow-head-opacity-source.pdf',
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

function pageStrokeAlphas(doc, page) {
  const resources = lookupDict(doc, page.node.lookup(PDFName.of('Resources')) || page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const strokes = [];
  if (!ext || typeof ext.entries !== 'function') return { strokes };
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const CA = gs.get?.(PDFName.of('CA'));
    if (CA != null) strokes.push(CA.asNumber ? CA.asNumber() : Number(CA));
  }
  return { strokes };
}

function flattenStrokeGroups(text) {
  const groups = String(text || '').match(/q[\s\S]*?Q/g) || [];
  return groups.map((group) => ({
    text: group,
    hasGs: /\/GS-?\d+\s+gs/.test(group),
    strokes: (group.match(/(?:^|[\s])S(?:[\s]|$)/gm) || []).length,
  }));
}

async function exportArrow(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeArrow(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'arrow-head-opacity' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { doc, dict };
}

async function flattenArrow(patch) {
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [makeArrow(patch)] } },
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
  return { text, groups: flattenStrokeGroups(text), ...pageStrokeAlphas(doc, page) };
}

test('resolveShapeStroke maps live arrow rgba and leftover hex', () => {
  assert.equal(resolveShapeStroke({ stroke: 'rgba(255, 0, 0, 0.4)', strokeWidth: 2 }).paint, 'rgba(255, 0, 0, 0.4)');
  assert.equal(resolveShapeStroke({ stroke: composeAnnotationColor('#FF0000', 40), strokeWidth: 2 }).opacity, 0.4);
  assert.equal(resolveShapeStroke({ stroke: composeAnnotationColor('#FF0000', 0), strokeWidth: 2 }).visible, false);
  assert.equal(resolveShapeStroke({ stroke: '#FF0000', strokeWidth: 2 }).opacity, 1);
});

test('annotated export writes Line /CA from rgba stroke; opaque omits /CA', async () => {
  const faded = await exportArrow({ idSuffix: 'fade' });
  assert.deepEqual(dictRgb(faded.dict, 'C'), [1, 0, 0], '/C stays the stroke hex');
  assert.equal(dictNumber(faded.dict, 'CA'), 0.4, 'Line /CA must be live Color Opacity');

  const opaque = await exportArrow({ idSuffix: 'opaque', stroke: '#FF0000' });
  assert.equal(opaque.dict.get(PDFName.of('CA')), undefined, 'opaque Line must omit /CA');

  const zero = await exportArrow({
    idSuffix: 'zero',
    stroke: composeAnnotationColor('#FF0000', 0),
  });
  assert.equal(dictNumber(zero.dict, 'CA'), 0, 'opacity-0 Line must write /CA 0');
});

test('print flatten fades shaft and solid-triangle head together; opaque does not invent a fade', async () => {
  const faded = await flattenArrow({ idSuffix: 'flat-fade' });
  assert.match(faded.text, /1\s+0\s+0\s+RG/, `faded flatten must still stroke #FF0000 (got ${faded.text.slice(0, 240)})`);
  assert.match(faded.text, /1\s+0\s+0\s+rg/, 'solid-triangle flatten must fill the live head');
  assert.ok(faded.strokes.some((value) => Math.abs(value - 0.4) < 0.001), `flatten shaft /CA must be 0.4 (got ${faded.strokes})`);
  const fadedGs = (faded.text.match(/\/GS-?\d+\s+gs/g) || []).length;
  assert.ok(fadedGs >= 2, `shaft + filled head must both apply ExtGState (gs=${fadedGs})`);
  const painted = faded.groups.filter((group) => group.strokes > 0 || /(?:^|[\s])f(?:[\s]|$)/m.test(group.text));
  painted.forEach((group, index) => {
    assert.equal(group.hasGs, true, `paint group ${index} must apply ExtGState (head must not print opaque)`);
  });

  const opaque = await flattenArrow({ idSuffix: 'flat-opaque', stroke: '#FF0000' });
  assert.match(opaque.text, /1\s+0\s+0\s+RG/, 'opaque flatten still paints the stroke color');
  assert.ok(opaque.strokes.every((value) => value >= 0.999), `opaque flatten must not invent a fade (got ${opaque.strokes})`);

  const zero = await flattenArrow({
    idSuffix: 'flat-zero',
    stroke: composeAnnotationColor('#FF0000', 0),
  });
  assert.ok(zero.strokes.some((value) => value === 0), `opacity-0 flatten must write /CA 0 (got ${zero.strokes})`);
});

test('flatten hosts still name the arrowhead opacity contract', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const spec = flatten.slice(
    flatten.indexOf('function drawFlattenedArrowheadSpec'),
    flatten.indexOf('const drawFlattenedLine'),
  );
  assert.match(spec, /parsePdfDrawColor\(spec\.color/);
  assert.match(spec, /opacity: stroke\.opacity/);
  const line = flatten.slice(flatten.indexOf('const drawFlattenedLine'), flatten.indexOf('const pickFlattenedTextFont'));
  assert.match(line, /drawFlattenedArrowheadSpec\(page, spec, pageHeight\)/);
  assert.match(line, /obj\?\.stroke \|\| '#000000'/);
});
