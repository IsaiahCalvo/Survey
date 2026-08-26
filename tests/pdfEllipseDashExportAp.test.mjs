// Ellipse / Circle Style dash must ride the existing /AP stream.
// Live toolbar already stamps strokeDashArray and flatten already writes
// borderDashArray, but createEllipseAnnotation stroked the oval solid so
// Acrobat stayed solid until Style was re-touched. Distinct from
// leftover-18, Ellipse flatten dash, Rect flatten dash, Polygon /
// PolyLine /BS /CA, and Square / Circle dict /BS (do not invent /BS —
// Survey reimport already keeps dash via metadata). Do not invent a
// create-poly tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeEllipse(patch = {}) {
  const committed = buildBoundaryShapeCommitJSON({
    tool: 'ellipse',
    id: `ellipse-dash-export-ap-${patch.idSuffix || 'default'}`,
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
    name: 'ellipse-dash-export-ap-source.pdf',
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

function readApStream(doc, dict) {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return '';
  const nRef = ap.get(PDFName.of('N'));
  const normal = lookupDict(doc, nRef);
  if (!normal) return '';
  return new TextDecoder('latin1').decode(decodePDFRawStream(normal).decode());
}

async function exportEllipse(patch) {
  const ellipse = makeEllipse(patch);
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [ellipse] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'ellipse-dash-export-ap' },
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
    apText: readApStream(doc, dict),
  };
}

test('next-draw Ellipse Style Dashed stamps strokeDashArray [6,4]', () => {
  const ellipse = makeEllipse({ lineBorderStyle: 'dashed' });
  assert.deepEqual(ellipse.strokeDashArray, [6, 4]);
  assert.match(String(ellipse.type), /ellipse/i);
});

test('annotated export writes Ellipse dash in /AP stream and does not invent /BS', async () => {
  const dashed = await exportEllipse({ idSuffix: 'dashed', lineBorderStyle: 'dashed' });
  assert.match(String(dashed.subtype), /Circle/);
  assert.equal(dashed.ap, true, 'Ellipse export already writes /AP');
  assert.match(
    dashed.apText,
    /\[6 4\] 0 d/,
    `dashed /AP must set the [6 4] dash pattern (got ${dashed.apText.slice(0, 240)})`,
  );
  assert.equal(dashed.bs, null, 'do not invent Square/Circle /BS — reimport keeps dash via /AP + metadata');
});

test('solid Ellipse /AP omits a non-empty dash', async () => {
  const solid = await exportEllipse({ idSuffix: 'solid', lineBorderStyle: 'solid' });
  assert.match(String(solid.subtype), /Circle/);
  assert.equal(solid.ap, true);
  assert.equal(solid.bs, null, 'solid Ellipse must omit /BS');
  assert.doesNotMatch(
    solid.apText,
    /\[\s*[1-9]/,
    'solid /AP must not emit a non-empty dash-setting op',
  );
});

test('export host still names the Ellipse /AP dash contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /this writer stroked the oval solid/);
  assert.match(writer, /Do not\s+invent a Square\/Circle \/BS leftover/);
  assert.match(writer, /stroke\.dash\.map\(n\)\.join\(' '\)\}\] 0 d/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
