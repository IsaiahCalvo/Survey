// Imported stroked Ink Color Opacity must ride dict /CA.
// Live toolbar maps selected imported Ink → pen Color Opacity. Screen
// already honours rgba stroke and flatten already applies borderOpacity,
// but createInkAnnotation wrote hex /C + AP ExtGState only. Viewers that
// regenerate from /InkList + /C (and the importer, which reads dict /CA)
// stayed opaque until Opacity was re-touched. Distinct from leftover-18,
// filled paper-ink flatten /CA, Pen first-stroke opacity compose, and
// Polygon /IC /AP /ca. Do not invent a create-ink tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream, PDFArray, PDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeImportedInk(patch = {}) {
  const strokeOpacity = patch.strokeOpacity ?? 100;
  return {
    type: 'path',
    left: 20,
    top: 30,
    width: 80,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    path: [
      ['M', 0, 0],
      ['L', 80, 0],
      ['L', 80, 40],
    ],
    stroke: `rgba(255, 0, 0, ${strokeOpacity / 100})`,
    fill: null,
    strokeWidth: 4,
    isPdfImported: true,
    pdfImportedEditState: 'edited',
    pdfAnnotationType: 'Ink',
    pdfAnnotationId: `ink-stroke-opacity-${patch.idSuffix || 'default'}`,
    id: `ink-stroke-opacity-${patch.idSuffix || 'default'}`,
    data: {
      id: `ink-stroke-opacity-${patch.idSuffix || 'default'}`,
      pdfAnnotationType: 'Ink',
      pdfImportedEditState: 'edited',
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'ink-stroke-opacity-export-source.pdf',
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

async function exportInk(patch) {
  const ink = makeImportedInk(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [ink] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ink-stroke-opacity-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    ink,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ca: dictNumber(dict, 'CA'),
    gs: annotAppearanceGs(doc, dict),
  };
}

async function flattenInk(patch) {
  const ink = makeImportedInk(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [ink] } },
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
  const resources = lookupDict(doc, page.node.get(PDFName.of('Resources')));
  const ext = lookupDict(doc, resources?.lookup?.(PDFName.of('ExtGState')) || resources?.get?.(PDFName.of('ExtGState')));
  const caValues = [];
  if (ext && typeof ext.entries === 'function') {
    for (const [, ref] of ext.entries()) {
      const gs = doc.context.lookup(ref) || ref;
      const ca = gs.get?.(PDFName.of('ca'));
      const CA = gs.get?.(PDFName.of('CA'));
      if (ca != null) caValues.push(ca.asNumber ? ca.asNumber() : Number(ca));
      if (CA != null) caValues.push(CA.asNumber ? CA.asNumber() : Number(CA));
    }
  }
  return { text, caValues, ink };
}

test('selected-patch imported Ink stamps Color Opacity 0.4 on stroke', () => {
  const ink = makeImportedInk({ strokeOpacity: 40 });
  assert.match(ink.stroke, /0\.4/);
  assert.equal(ink.type, 'path');
  assert.equal(ink.pdfAnnotationType, 'Ink');
  assert.equal(ink.strokeWidth, 4);
  assert.ok(!ink.paperInkGeometry, 'stroked import must not invent paper-ink fill');
});

test('annotated export writes Ink dict /CA fade; opaque omits /CA', async () => {
  const faded = await exportInk({ idSuffix: 'fade', strokeOpacity: 40 });
  assert.match(String(faded.subtype), /Ink/);
  assert.equal(faded.ca, 0.4, 'Color Opacity must write Ink dict /CA 0.4');
  assert.ok(
    Math.abs((faded.gs.CA ?? faded.gs.ca ?? -1) - 0.4) < 0.001,
    `AP /CA must stay fill 0.4 (got ${JSON.stringify(faded.gs)})`,
  );

  const opaque = await exportInk({ idSuffix: 'opaque', strokeOpacity: 100 });
  assert.equal(opaque.ca, undefined, 'opaque imported Ink must omit dict /CA');
});

test('print flatten applies imported Ink stroke fade and skips inventing paper-ink fill', async () => {
  const faded = await flattenInk({ idSuffix: 'flat-fade', strokeOpacity: 40 });
  assert.ok(
    faded.caValues.some((value) => Math.abs(value - 0.4) < 0.001)
      || /0\.4/.test(faded.text),
    `flatten must apply stroke fade 0.4 (got ${faded.text.slice(0, 240)})`,
  );
  assert.doesNotMatch(
    faded.text,
    /\bf\b/,
    `stroked import flatten must not invent a fill (got ${faded.text.slice(0, 240)})`,
  );

  const opaque = await flattenInk({ idSuffix: 'flat-opaque', strokeOpacity: 100 });
  assert.ok(
    !opaque.caValues.some((value) => value < 0.999),
    'opaque flatten must not invent a fade',
  );
});

test('export host still names the Ink dict /CA contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /maps selected imported Ink → pen Color Opacity/);
  assert.match(writer, /do not invent a create-ink tool/);
  assert.match(writer, /if \(alpha < 0\.99999\) annotationDict\.CA = alpha/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
