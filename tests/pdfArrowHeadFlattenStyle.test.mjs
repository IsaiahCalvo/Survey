// Arrow flatten must honor the live Arrowhead toolbar style.
// Screen + export /LE already keep data.arrowheadStyle, but print flatten
// used leftover drawArrowHead (two-line V) for every Arrow so Open circle /
// None / Solid triangle / Horizontal line printed as that leftover chevron
// until Arrowhead was re-touched. Distinct from leftover-18, Arrow flatten
// opacity, Arrowhead after sibling, and Line /AP (native Line has none).
// Do not invent Line /AP or callout Rotation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { ARROWHEAD_STYLES } from '../src/utils/lineRenderHelpers.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function makeArrow(patch = {}) {
  const style = patch.arrowheadStyle || ARROWHEAD_STYLES.SOLID_TRIANGLE;
  return {
    id: `arrow-head-style-${patch.idSuffix || 'default'}`,
    type: 'Line',
    left: 20,
    top: 30,
    width: 80,
    height: 40,
    x1: -40,
    y1: -20,
    x2: 40,
    y2: 20,
    stroke: '#FF0000',
    strokeWidth: 2,
    tool: 'arrow',
    data: {
      id: `arrow-head-style-${patch.idSuffix || 'default'}`,
      tool: 'arrow',
      annotationType: 'arrow',
      arrowheadStyle: style,
    },
    ...patch,
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'arrow-head-style-source.pdf',
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
  return text;
}

async function exportArrow(patch) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [makeArrow(patch)] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'arrow-head-style' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = lookupDict(doc, annots.asArray()[0]);
  const le = dict.get(PDFName.of('LE'));
  return {
    endings: le ? le.asArray().map((name) => (name.decodeText ? name.decodeText() : String(name))) : [],
  };
}

test('flatten Open circle paints a circle, not leftover two-line V; None omits a head', async () => {
  const circle = await flattenArrow({
    idSuffix: 'open-circle',
    arrowheadStyle: ARROWHEAD_STYLES.OPEN_CIRCLE,
  });
  assert.match(circle, /c[\s\S]*c[\s\S]*c/, `Open circle flatten must paint bezier arcs (got ${circle.slice(0, 280)})`);
  assert.doesNotMatch(circle, /(?:^|[\s])f(?:[\s]|$)/m, 'Open circle must not fill a leftover triangle');

  const none = await flattenArrow({
    idSuffix: 'none',
    arrowheadStyle: ARROWHEAD_STYLES.NONE,
  });
  assert.doesNotMatch(none, /(?:^|[\s])f(?:[\s]|$)/m, 'None must not fill a leftover triangle');
  const noneCurves = (none.match(/(?:^|[\s])c(?:[\s]|$)/gm) || []).length;
  const circleCurves = (circle.match(/(?:^|[\s])c(?:[\s]|$)/gm) || []).length;
  assert.ok(
    circleCurves > noneCurves,
    `Open circle must add circle curves beyond the shaft (circle=${circleCurves} none=${noneCurves})`,
  );

  const solid = await flattenArrow({
    idSuffix: 'solid',
    arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  });
  assert.match(solid, /(?:^|[\s])f(?:[\s]|$)/m, 'Solid triangle flatten must fill the live head');

  const plain = await flattenArrow({
    idSuffix: 'plain-line',
    tool: 'line',
    arrowheadStyle: undefined,
    data: { id: 'arrow-head-style-plain-line', tool: 'line' },
  });
  assert.doesNotMatch(plain, /(?:^|[\s])f(?:[\s]|$)/m, 'plain Line must stay headless');
});

test('annotated export writes /LE from live Arrowhead; flatten host names the spec', async () => {
  const circle = await exportArrow({
    idSuffix: 'export-circle',
    arrowheadStyle: ARROWHEAD_STYLES.OPEN_CIRCLE,
  });
  assert.ok(
    circle.endings.some((name) => String(name).includes('Circle')),
    `Open circle export must write /LE Circle (got ${JSON.stringify(circle.endings)})`,
  );

  const none = await exportArrow({
    idSuffix: 'export-none',
    arrowheadStyle: ARROWHEAD_STYLES.NONE,
  });
  assert.ok(
    none.endings.some((name) => String(name).includes('None')),
    `None export must write /LE None (got ${JSON.stringify(none.endings)})`,
  );

  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /resolveFlattenedArrowheadStyle/);
  assert.match(writer, /drawFlattenedArrowheadSpec\(page, spec, pageHeight\)/);
  assert.match(writer, /used leftover[\s\S]*drawArrowHead \(two-line V\)/);
});

test('export host still names the Arrow flatten style contract; isolated 8448 / 75/250 standing', () => {
  const writer = read('src/utils/pdfAnnotationsPdfLib.js');
  assert.match(writer, /Open circle \/ None \/ Solid[\s\S]*triangle \/ Horizontal line all printed as that V/);
  assert.match(writer, /Do not invent Line \/AP/);
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
