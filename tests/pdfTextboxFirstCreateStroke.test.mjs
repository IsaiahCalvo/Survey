// Textbox first-create must stamp next-draw Color Border.
// Live toolbar writes Border as strokeColor. First-create used to
// hardcode stroke: '#000000', so a next-draw Color never reached persist /
// reimport / export until Border was touched again (selected-patch).
// Callout first-create already stamps borderColor from strokeColor.
// Text-tool DEFAULT_TOOL_PREFERENCES.strokeColor is already '#000000', so
// the leftover only shows after next-draw Color Border leaves that default.
// Distinct from leftover-18, textbox first-create Width (866693f6), and
// textbox stroke /Border export of an already-patched box (99a07184).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const LIVE_STROKE = '#00FF00';

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
    stroke: LIVE_STROKE,
    strokeWidth: 3,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-stroke-source.pdf',
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-stroke' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box, metadata: dictMetadata(dict) };
}

test('first-create overlay reads next-draw strokeColor; PDFViewer already passes it', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /Next-draw Color Border must ride the first box/,
    'first-create must name the leftover',
  );
  assert.match(
    overlay,
    /stroke: composeAnnotationColor\(\s*\(typeof strokeColor === 'string' && strokeColor\) \? strokeColor : '#000000'/,
    'first-create must stamp live Color Border, not hardcoded #000000',
  );
  assert.match(
    overlay,
    /stroke: composeAnnotationColor\(\s*\(typeof strokeColor === 'string' && strokeColor\) \? strokeColor : \(s\.stroke \|\| '#000000'\)/,
    'commit must prefer live Color Border over mount-time black',
  );
  assert.equal(
    (overlay.match(/stroke: '#000000',/g) || []).length,
    0,
    'first-create must not hardcode stroke: \'#000000\'',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /strokeColor=\{strokeColor\}/,
    'PDFViewer must pass next-draw Color Border into TextEditOverlay',
  );
});

test('first-create commit keeps next-draw Color Border; omitted stroke stays #000000', () => {
  const green = makeFirstBox();
  assert.equal(green.stroke, LIVE_STROKE);
  assert.equal(green.type, 'Textbox');
  const omitted = makeFirstBox({ stroke: undefined });
  assert.equal(omitted.stroke, '#000000');
});

test('first-create-shaped export writes metadata stroke from next-draw Color Border', async () => {
  const green = await exportFirstBox();
  assert.equal(green.metadata?.style?.stroke, LIVE_STROKE);

  const black = await exportFirstBox({ stroke: '#000000' });
  assert.equal(black.metadata?.style?.stroke, '#000000');
});
