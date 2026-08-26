// Cloud Fill Opacity must ride Square /AP ExtGState /ca.
// Live toolbar writes rgba fill + Style Cloud /BE. Export skipped /AP so
// /IC stayed hex-only and a faded cloud reached Acrobat opaque. Flatten
// already applied /ca. Distinct from Cloud Bump persist (53d63a7c), shape
// fill/stroke /ca on plain Square (non-cloud), and leftover-18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { resolveShapeFill, resolveShapeStroke } from '../src/utils/annotationStyleCatalog.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const sharedRect = {
  tool: 'rect',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#ff0000',
  strokeOpacity: 100,
  fillColor: '#ffff00',
  strokeWidth: 2,
  lineBorderStyle: 'cloud',
  cloudIntensity: 8,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function makeCloudRect(patch = {}) {
  return buildBoundaryShapeCommitJSON({
    ...sharedRect,
    id: `cloud-fill-opacity-${patch.idSuffix || 'default'}`,
    fillOpacity: patch.fillOpacity ?? 40,
    strokeOpacity: patch.strokeOpacity ?? 100,
    fillColor: patch.fillColor ?? sharedRect.fillColor,
    strokeColor: patch.strokeColor ?? sharedRect.strokeColor,
    lineBorderStyle: patch.lineBorderStyle ?? 'cloud',
    cloudIntensity: patch.cloudIntensity ?? 8,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'cloud-fill-opacity-source.pdf',
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

async function exportRect(patch) {
  const rect = makeCloudRect(patch);
  assert.ok(rect, 'first-create commit must produce a cloud rect');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [rect] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-fill-opacity' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { rect, doc, dict, gs: annotAppearanceGs(doc, dict) };
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

async function flattenRect(patch) {
  const rect = makeCloudRect(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [rect] } },
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

test('first-create Cloud stamps rgba fill; resolveShapeFill keeps 0.4', () => {
  const rect = makeCloudRect({ fillOpacity: 40 });
  assert.equal(rect.fill, 'rgba(255, 255, 0, 0.4)');
  assert.equal(rect.data.pdfCloudIntensity, 8);
  assert.equal(resolveShapeFill(rect).opacity, 0.4);
  assert.equal(resolveShapeStroke(rect).opacity, 1);
});

test('annotated export writes Cloud /BE and independent fill /ca', async () => {
  const faded = await exportRect({ idSuffix: 'fill-fade', fillOpacity: 40 });
  assert.ok(faded.dict.get(PDFName.of('BE')), 'Cloud must still write /BE');
  assert.deepEqual(dictRgb(faded.dict, 'IC'), [1, 1, 0], '/IC stays the fill hex');
  assert.equal(faded.dict.get(PDFName.of('CA')), undefined, 'faded fill must not share dict /CA with the border');
  assert.ok(Math.abs((faded.gs.ca ?? -1) - 0.4) < 0.001, `AP /ca must be fill 0.4 (got ${JSON.stringify(faded.gs)})`);
  assert.equal(faded.gs.CA, undefined, 'opaque stroke must omit ExtGState /CA');

  const strokeOnly = await exportRect({
    idSuffix: 'stroke-only',
    fillOpacity: 0,
    strokeOpacity: 40,
  });
  assert.ok(strokeOnly.dict.get(PDFName.of('BE')), 'stroke-only fade still writes /BE');
  assert.equal(strokeOnly.dict.get(PDFName.of('IC')), undefined, 'opacity-0 fill must not invent /IC');
  assert.equal(dictNumber(strokeOnly.dict, 'CA'), 0.4, 'stroke-only fade may use dict /CA');

  const opaque = await exportRect({
    idSuffix: 'opaque',
    fillOpacity: 100,
    strokeOpacity: 100,
  });
  assert.ok(opaque.dict.get(PDFName.of('BE')), 'opaque Cloud must still write /BE');
  assert.equal(hasAppearance(opaque.dict), false, 'opaque Cloud must omit /AP so viewers keep native /BE scallops');
  assert.equal(opaque.dict.get(PDFName.of('CA')), undefined, 'opaque Cloud must omit dict /CA');
});

test('print flatten applies Cloud fill /ca and skips opacity-0 fill', async () => {
  const faded = await flattenRect({ idSuffix: 'flat-fill', fillOpacity: 40 });
  assert.match(faded.text, /1\s+1\s+0\s+rg/, `yellow flatten must fill #FFFF00 (got ${faded.text.slice(0, 240)})`);
  assert.ok(faded.fills.some((value) => Math.abs(value - 0.4) < 0.001), `flatten /ca must be fill 0.4 (got ${faded.fills})`);

  const zeroFill = await flattenRect({ idSuffix: 'flat-zero', fillOpacity: 0 });
  assert.doesNotMatch(zeroFill.text, /1\s+1\s+0\s+rg/, `opacity-0 fill must not invent opaque yellow (got ${zeroFill.text.slice(0, 240)})`);
});

test('export host still names the Cloud fade /AP contract; isolated 8448 / 75/250 standing', () => {
  const flatten = read('src/utils/pdfAnnotationsPdfLib.js');
  const creation = read('src/utils/annotationCreationCommit.js');
  assert.match(creation, /pdfCloudIntensity: Math\.max\(1, Number\(cloudIntensity\) \|\| 2\)/);
  assert.match(flatten, /const fabricPathCommandsToPdf = /);
  assert.match(flatten, /Cloudy Square used to skip \/AP so \/BE could generate the scallops/);
  assert.match(flatten, /if \(needsFade\) \{/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
