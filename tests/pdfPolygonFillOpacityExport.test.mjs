// Imported Polygon (non-cloud) Fill Opacity must ride /AP ExtGState /ca.
// Live toolbar maps selected polygon → rect Color Fill. Screen already
// honours rgba fill and flatten already applied /ca, but
// createPolygonAnnotation wrote hex /IC only so Acrobat stayed opaque
// until Fill was re-touched. Same class as Cloud Fill /AP /ca. Distinct
// from leftover-18, Polygon /BS /CA, Polygon Cloud Bump /AP, and Cloud
// Fill /ca. Do not invent a create-poly tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveShapeFill, resolveShapeStroke } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makePolygon(patch = {}) {
  const fillOpacity = patch.fillOpacity ?? 100;
  const strokeOpacity = patch.strokeOpacity ?? 100;
  const fill = patch.fill ?? (
    fillOpacity <= 0
      ? 'transparent'
      : fillOpacity >= 100
        ? '#ffff00'
        : `rgba(255, 255, 0, ${fillOpacity / 100})`
  );
  return {
    type: 'polygon',
    left: 20,
    top: 30,
    width: 80,
    height: 60,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 60 },
      { x: 0, y: 60 },
    ],
    stroke: `rgba(255, 0, 0, ${strokeOpacity / 100})`,
    fill,
    strokeWidth: 2,
    strokeDashArray: patch.strokeDashArray ?? null,
    id: `polygon-fill-opacity-${patch.idSuffix || 'default'}`,
    data: {
      id: `polygon-fill-opacity-${patch.idSuffix || 'default'}`,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'polygon-fill-opacity-export-source.pdf',
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

function annotAppearanceGs(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return {};
  const nRef = ap.get(PDFName.of('N'));
  const stream = nRef?.dict ? nRef : doc.context.lookup(nRef);
  if (!stream) return {};
  const streamDict = stream.dict || stream;
  const resources = lookupDict(doc, streamDict.lookup?.(PDFName.of('Resources')) || streamDict.get?.(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  if (!ext || typeof ext.entries !== 'function') return {};
  const result = {};
  for (const [, ref] of ext.entries()) {
    const gs = doc.context.lookup(ref) || ref;
    const ca = gs.get?.(PDFName.of('ca'));
    const CA = gs.get?.(PDFName.of('CA'));
    if (ca != null) result.ca = ca.asNumber ? ca.asNumber() : Number(ca);
    if (CA != null) result.CA = CA.asNumber ? CA.asNumber() : Number(CA);
  }
  return result;
}

function hasAppearance(dict) {
  return dict.get(PDFName.of('AP')) != null;
}

async function exportPolygon(patch) {
  const polygon = makePolygon(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [polygon] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'polygon-fill-opacity-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    polygon,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ca: dictNumber(dict, 'CA'),
    ic: dictRgb(dict, 'IC'),
    gs: annotAppearanceGs(doc, dict),
    ap: hasAppearance(dict),
    be: dict.get(PDFName.of('BE')) != null,
  };
}

function pageIndependentAlphas(doc, page) {
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

async function flattenPolygon(patch) {
  const polygon = makePolygon(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [polygon] } },
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
  return { text, ...pageIndependentAlphas(doc, page) };
}

test('selected-patch Polygon stamps rgba fill; resolveShapeFill keeps 0.4', () => {
  const polygon = makePolygon({ fillOpacity: 40 });
  assert.equal(polygon.fill, 'rgba(255, 255, 0, 0.4)');
  assert.equal(polygon.type, 'polygon');
  assert.equal(resolveShapeFill(polygon).opacity, 0.4);
  assert.equal(resolveShapeStroke(polygon).opacity, 1);
});

test('annotated export writes Polygon /IC hex and independent fill /ca', async () => {
  const faded = await exportPolygon({ idSuffix: 'fill-fade', fillOpacity: 40 });
  assert.match(String(faded.subtype), /Polygon/);
  assert.equal(faded.be, false, 'non-cloud Polygon must omit /BE');
  assert.deepEqual(faded.ic, [1, 1, 0], '/IC stays the fill hex');
  assert.equal(faded.dict.get(PDFName.of('CA')), undefined, 'faded fill must not share dict /CA with the border');
  assert.ok(faded.ap, 'faded fill must attach /AP');
  assert.ok(Math.abs((faded.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.equal(faded.gs.CA, undefined, 'opaque stroke must omit ExtGState /CA');

  const strokeOnly = await exportPolygon({
    idSuffix: 'stroke-only',
    fillOpacity: 0,
    strokeOpacity: 40,
  });
  assert.equal(strokeOnly.be, false, 'stroke-only fade must omit /BE');
  assert.equal(strokeOnly.ic, null, 'opacity-0 fill must not invent /IC');
  assert.equal(strokeOnly.ap, false, 'stroke-only fade must not invent fill /AP');
  assert.equal(strokeOnly.ca, 0.4, 'stroke-only fade may use dict /CA');

  const opaque = await exportPolygon({
    idSuffix: 'opaque',
    fillOpacity: 100,
    strokeOpacity: 100,
  });
  assert.deepEqual(opaque.ic, [1, 1, 0], 'opaque fill still writes /IC hex');
  assert.equal(opaque.ap, false, 'opaque Polygon must omit /AP so default export stays byte-identical');
  assert.equal(opaque.ca, undefined, 'opaque Polygon must omit dict /CA');
});

test('print flatten applies Polygon fill /ca and skips opacity-0 fill', async () => {
  const faded = await flattenPolygon({ idSuffix: 'flat-fill', fillOpacity: 40 });
  assert.match(faded.text, /1\s+1\s+0\s+rg/, `yellow flatten must fill #FFFF00 (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be fill 0.4 (got ${faded.fills})`);

  const zeroFill = await flattenPolygon({ idSuffix: 'flat-zero', fillOpacity: 0 });
  assert.doesNotMatch(zeroFill.text, /1\s+1\s+0\s+rg/, `opacity-0 fill must not invent opaque yellow (got ${zeroFill.text.slice(0, 240)})`);
});

test('export host still names the Polygon fill /AP /ca contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /const polygonAppearancePath = /);
  assert.match(writer, /faded fill attaches \/AP ExtGState \/ca/);
  assert.match(writer, /Do not invent a create-poly tool/);
  assert.doesNotMatch(writer, /value: 'polygon'|label: 'Polygon'/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
