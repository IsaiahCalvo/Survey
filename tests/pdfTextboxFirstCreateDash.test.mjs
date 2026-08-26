// Textbox first-create must stamp next-draw Style (strokeDashArray).
// Live toolbar writes Style as lineBorderStyle (solid / dashed / dotted).
// Selected-patch writes strokeDashArray [6,4] / [2,4]. First-create used
// the envelope's strokeDashArray: null, so a next-draw Dashed/Dotted never
// reached persist / reimport / flatten until Style was touched again.
// Callout first-create already stamps lineStyle. Text-tool default Style
// is solid, so the leftover only shows after next-draw Style leaves that
// default. Distinct from leftover-18, textbox first-create Width
// (866693f6), first-create Color Border (490309ac), first-create Border
// Opacity (9f62caa9), and textbox stroke /Border of an already-patched
// box (99a07184). Do not invent first-create Fill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  buildNewTextCommitJSON,
  dashArrayFromLineBorderStyle,
} from '../src/utils/textEditCommit.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';
import { resolveTextboxBoxStroke } from '../src/utils/annotationStyleCatalog.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const LIVE_STROKE = '#000000';
const LIVE_DASH = [6, 4];

function makeFirstBox(patch = {}) {
  return buildNewTextCommitJSON({
    text: 'Y',
    left: 24,
    top: 40,
    innerWrapWidth: 120,
    maxLineWidth: 20,
    lineCount: 1,
    naturalInnerHeight: 18,
    style: { fontSize: 16, fontFamily: 'Helvetica' },
    fill: '#007AFF',
    stroke: composeAnnotationColor(LIVE_STROKE, 100),
    strokeWidth: 1,
    strokeDashArray: LIVE_DASH,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-dash-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictMetadata(dict) {
  const value = dict.get(PDFName.of('SurveyAppAnnotation'));
  const raw = value?.decodeText ? value.decodeText() : null;
  return parsePdfAppAnnotationMetadata(raw);
}

async function exportFirstBox(patch = {}) {
  const box = makeFirstBox(patch);
  assert.ok(box, 'first-create commit must produce a textbox');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-dash' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box, metadata: dictMetadata(dict) };
}

test('first-create overlay stamps lineBorderStyle dash; PDFViewer passes it', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /Next-draw Style must ride the first box/,
    'first-create must name the leftover',
  );
  assert.match(
    overlay,
    /strokeDashArray: dashArrayFromLineBorderStyle\(lineBorderStyle\)/,
    'first-create must stamp live Style, not envelope null',
  );
  assert.match(
    overlay,
    /strokeDashArray: dashArrayFromLineBorderStyle\(lineBorderStyle\) \?\? s\.strokeDashArray \?\? null/,
    'commit must prefer live Style over mount-time envelope null',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /strokeWidth=\{strokeWidth\}\s*\n\s*lineBorderStyle=\{lineBorderStyle\}/,
    'PDFViewer must pass next-draw Style into TextEditOverlay',
  );
});

test('first-create commit keeps next-draw Dashed; omitted Style stays solid', () => {
  assert.deepEqual(dashArrayFromLineBorderStyle('dashed'), [6, 4]);
  assert.deepEqual(dashArrayFromLineBorderStyle('dotted'), [2, 4]);
  assert.equal(dashArrayFromLineBorderStyle('solid'), null);
  assert.equal(dashArrayFromLineBorderStyle('cloud'), null);
  assert.equal(dashArrayFromLineBorderStyle(null), null);

  const dashed = makeFirstBox();
  assert.deepEqual(dashed.strokeDashArray, [6, 4]);
  assert.equal(dashed.type, 'Textbox');
  assert.deepEqual(resolveTextboxBoxStroke(dashed).dash, [6, 4]);

  const omitted = makeFirstBox({ strokeDashArray: undefined });
  assert.equal(omitted.strokeDashArray, null);
  assert.equal(resolveTextboxBoxStroke(omitted).dash, null);

  const dotted = makeFirstBox({ strokeDashArray: dashArrayFromLineBorderStyle('dotted') });
  assert.deepEqual(dotted.strokeDashArray, [2, 4]);
  assert.deepEqual(resolveTextboxBoxStroke(dotted).dash, [2, 4]);
});

test('first-create-shaped export writes FreeText /BS dash from next-draw Style', async () => {
  const dashed = await exportFirstBox();
  assert.deepEqual(dashed.metadata?.style?.strokeDashArray, LIVE_DASH);
  assert.deepEqual(resolveTextboxBoxStroke(dashed.box).dash, [6, 4]);
  const bs = dashed.dict.get(PDFName.of('BS'));
  assert.ok(bs, 'dashed first-create must write /BS');
  const dash = bs.get(PDFName.of('D'));
  assert.deepEqual(dash.asArray().map((n) => n.asNumber()), [6, 4]);

  const solid = await exportFirstBox({ strokeDashArray: null });
  assert.equal(solid.metadata?.style?.strokeDashArray, null);
  assert.equal(resolveTextboxBoxStroke(solid.box).dash, null);
  assert.equal(solid.dict.get(PDFName.of('BS')), undefined, 'solid first-create omits /BS');
});
