// Imported PolyLine Style dash / Color Opacity must ride /BS + /CA.
// Live toolbar maps selected polyline → line Style + Color Opacity.
// Screen already honours strokeDashArray and rgba stroke, but
// createPolyLineAnnotation wrote hex /C + /Border width only, so Acrobat
// stayed solid and opaque until Style / Opacity were re-touched. Distinct
// from leftover-18, Line/Arrow /CA, Polygon Cloud Bump /AP, and Cloud
// stroke /CA. Do not invent a create-poly tool.
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

function makePolyline(patch = {}) {
  const strokeOpacity = patch.strokeOpacity ?? 100;
  return {
    type: 'polyline',
    left: 20,
    top: 30,
    width: 80,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 40 },
    ],
    stroke: `rgba(255, 0, 0, ${strokeOpacity / 100})`,
    fill: 'transparent',
    strokeWidth: 2,
    strokeDashArray: patch.strokeDashArray ?? null,
    id: `polyline-dash-opacity-${patch.idSuffix || 'default'}`,
    data: {
      id: `polyline-dash-opacity-${patch.idSuffix || 'default'}`,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'polyline-dash-opacity-export-source.pdf',
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

function readBsDash(doc, dict) {
  const raw = dict.get(PDFName.of('BS'));
  if (!raw) return null;
  const bs = lookupDict(doc, raw) || raw;
  const style = bs.get(PDFName.of('S'));
  const dash = bs.get(PDFName.of('D'));
  return {
    style: style?.decodeText ? style.decodeText() : String(style || ''),
    dash: dash && typeof dash.asArray === 'function'
      ? dash.asArray().map((n) => (n?.asNumber ? n.asNumber() : Number(n)))
      : null,
  };
}

async function exportPolyline(patch) {
  const polyline = makePolyline(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [polyline] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'polyline-dash-opacity-export' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    polyline,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    ca: dictNumber(dict, 'CA'),
    bs: readBsDash(doc, dict),
  };
}

async function flattenPolyline(patch) {
  const polyline = makePolyline(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [polyline] } },
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
  return { text, dash: polyline.strokeDashArray };
}

test('selected-patch PolyLine stamps Dashed [6,4] and Color Opacity 0.4', () => {
  const polyline = makePolyline({ strokeDashArray: [6, 4], strokeOpacity: 40 });
  assert.deepEqual(polyline.strokeDashArray, [6, 4]);
  assert.match(polyline.stroke, /0\.4/);
  assert.equal(polyline.type, 'polyline');
});

test('annotated export writes PolyLine /BS dash and /CA fade; solid opaque omits both', async () => {
  const fadedDash = await exportPolyline({
    idSuffix: 'dashed-fade',
    strokeDashArray: [6, 4],
    strokeOpacity: 40,
  });
  assert.match(String(fadedDash.subtype), /PolyLine/);
  assert.ok(fadedDash.bs, 'dashed PolyLine must write /BS');
  assert.equal(fadedDash.bs.style, 'D');
  assert.deepEqual(fadedDash.bs.dash, [6, 4]);
  assert.equal(fadedDash.ca, 0.4, 'Color Opacity must write PolyLine /CA 0.4');

  const dotted = await exportPolyline({
    idSuffix: 'dotted',
    strokeDashArray: [2, 4],
    strokeOpacity: 100,
  });
  assert.deepEqual(dotted.bs?.dash, [2, 4]);
  assert.equal(dotted.ca, undefined, 'opaque PolyLine must omit /CA');

  const solidOpaque = await exportPolyline({
    idSuffix: 'solid',
    strokeDashArray: null,
    strokeOpacity: 100,
  });
  assert.equal(solidOpaque.bs, null, 'solid PolyLine must omit /BS');
  assert.equal(solidOpaque.ca, undefined, 'opaque solid PolyLine must omit /CA');
});

test('print flatten writes PolyLine dash pattern and skips solid dash', async () => {
  const dashed = await flattenPolyline({
    idSuffix: 'flat-dash',
    strokeDashArray: [6, 4],
    strokeOpacity: 40,
  });
  assert.ok(
    /\[\s*6\s+4\s*\]\s+0\s+d\b/.test(dashed.text),
    `flatten must set the [6 4] dash pattern (got ${dashed.text.slice(0, 240)})`,
  );

  const solid = await flattenPolyline({
    idSuffix: 'flat-solid',
    strokeDashArray: null,
    strokeOpacity: 100,
  });
  assert.ok(
    !/\[\s*\d[\d\s.]*\]\s+[\d.]+\s+d\b/.test(solid.text),
    'solid flatten must not emit a non-empty dash-setting op',
  );
});

test('export host still names the PolyLine /BS /CA contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /maps selected imported polyline → line Style \+ Color/);
  assert.match(writer, /Do not invent a create-poly tool/);
  assert.match(writer, /Flatten used to stroke a solid path so/);
  assert.doesNotMatch(writer, /value: 'polygon'|label: 'Polygon'/);
  const shell = read('src/AppShell.jsx');
  assert.doesNotMatch(shell, /value: 'polygon'|label: 'Polygon'/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
