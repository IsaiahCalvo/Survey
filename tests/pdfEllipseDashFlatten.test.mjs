// Ellipse / Circle Style dash must ride flatten borderDashArray.
// Live toolbar already stamps strokeDashArray and export writes dash in
// /AP + app metadata, but drawFlattenedObject called drawEllipse without
// borderDashArray so Style Dashed / Dotted printed solid. Distinct from
// leftover-18, Rect flatten dash, Polygon / PolyLine /BS /CA, and Square
// / Circle dict /BS (Survey reimport already keeps dash via /AP +
// metadata — do not invent /BS). Do not invent a create-poly tool.
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

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeEllipse(patch = {}) {
  const committed = buildBoundaryShapeCommitJSON({
    tool: 'ellipse',
    id: `ellipse-dash-flatten-${patch.idSuffix || 'default'}`,
    start: { x: 20, y: 30 },
    end: { x: 100, y: 90 },
    strokeColor: '#FF0000',
    strokeOpacity: 100,
    fillColor: '#00FF00',
    fillOpacity: 0,
    strokeWidth: 2,
    lineBorderStyle: patch.lineBorderStyle ?? 'dashed',
  });
  return {
    ...committed,
    type: String(committed.type || 'ellipse').toLowerCase(),
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'ellipse-dash-flatten-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
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

async function exportEllipse(patch) {
  const ellipse = makeEllipse(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [ellipse] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ellipse-dash-flatten' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const subtype = dict.get(PDFName.of('Subtype'));
  return {
    ellipse,
    doc,
    dict,
    subtype: subtype?.decodeText ? subtype.decodeText() : String(subtype || ''),
    bs: readBsDash(doc, dict),
    ap: dict.get(PDFName.of('AP')) != null,
  };
}

async function flattenEllipse(patch) {
  const ellipse = makeEllipse(patch);
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    await makePdfFile(),
    { 1: { objects: [ellipse] } },
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
  return { text, dash: ellipse.strokeDashArray };
}

test('next-draw Ellipse Style Dashed stamps strokeDashArray [6,4]', () => {
  const ellipse = makeEllipse({ lineBorderStyle: 'dashed' });
  assert.deepEqual(ellipse.strokeDashArray, [6, 4]);
  assert.match(String(ellipse.type), /ellipse/i);
});

test('annotated export keeps Ellipse dash in /AP + metadata and does not invent /BS', async () => {
  const dashed = await exportEllipse({ idSuffix: 'dashed', lineBorderStyle: 'dashed' });
  assert.match(String(dashed.subtype), /Circle/);
  assert.equal(dashed.ap, true, 'Ellipse export already writes /AP dash');
  assert.equal(dashed.bs, null, 'do not invent Square/Circle /BS — reimport keeps dash via /AP + metadata');

  const solid = await exportEllipse({ idSuffix: 'solid', lineBorderStyle: 'solid' });
  assert.equal(solid.bs, null, 'solid Ellipse must omit /BS');
});

test('print flatten writes Ellipse dash pattern and skips solid dash', async () => {
  const dashed = await flattenEllipse({ idSuffix: 'flat-dashed', lineBorderStyle: 'dashed' });
  assert.deepEqual(dashed.dash, [6, 4]);
  assert.match(
    dashed.text,
    /\[6 4\] 0 d/,
    `flatten must set the [6 4] dash pattern (got ${dashed.text.slice(0, 240)})`,
  );

  const solid = await flattenEllipse({ idSuffix: 'flat-solid', lineBorderStyle: 'solid' });
  assert.equal(solid.dash == null || solid.dash.length === 0, true);
  assert.doesNotMatch(
    solid.text,
    /\[\s*[1-9]/,
    'solid flatten must not emit a non-empty dash-setting op',
  );
});

test('export host still names the Ellipse flatten dash contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /ellipse Style dash/);
  assert.match(writer, /Do not invent a Square\/Circle \/BS leftover/);
  assert.match(writer, /borderDashArray: ellipseDash, borderDashPhase: 0/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
