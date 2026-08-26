// Textbox first-create must stamp next-draw Color Border Opacity.
// Live toolbar writes Border as strokeColor + strokeOpacity. First-create
// used to stamp strokeColor hex only, so a next-draw fade never reached
// persist / reimport / flatten until Opacity was touched again
// (selected-patch composeColorForPatch). Callout first-create already
// stamps borderOpacity. Text-tool DEFAULT_TOOL_PREFERENCES.strokeOpacity
// is already 100, so the leftover only shows after next-draw Opacity
// leaves that default. Distinct from leftover-18, textbox first-create
// Width (866693f6), first-create Color Border (490309ac), and textbox
// stroke /Border of an already-patched box (99a07184).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';
import { resolveTextboxBoxStroke } from '../src/utils/annotationStyleCatalog.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const LIVE_STROKE = '#000000';
const LIVE_OPACITY = 40;
const LIVE_PAINT = composeAnnotationColor(LIVE_STROKE, LIVE_OPACITY);

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
    stroke: LIVE_PAINT,
    strokeWidth: 1,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-stroke-opacity-source.pdf',
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-stroke-opacity' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box, metadata: dictMetadata(dict) };
}

test('first-create overlay composes strokeColor + strokeOpacity; PDFViewer passes it', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /Next-draw Color Border \+ Border Opacity must ride the first box/,
    'first-create must name the leftover',
  );
  assert.match(
    overlay,
    /stroke: composeAnnotationColor\(\s*\(typeof strokeColor === 'string' && strokeColor\) \? strokeColor : '#000000',\s*strokeOpacity,/,
    'first-create must compose live Border Opacity, not hex-only',
  );
  assert.match(
    overlay,
    /stroke: composeAnnotationColor\(\s*\(typeof strokeColor === 'string' && strokeColor\) \? strokeColor : \(s\.stroke \|\| '#000000'\),\s*strokeOpacity,/,
    'commit must prefer live Border Opacity over mount-time hex',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /strokeOpacity=\{strokeOpacity\}/,
    'PDFViewer must pass next-draw Border Opacity into TextEditOverlay',
  );
});

test('first-create commit keeps next-draw fade 0.4; omitted Opacity stays opaque', () => {
  const faded = makeFirstBox();
  assert.equal(faded.stroke, 'rgba(0, 0, 0, 0.4)');
  assert.equal(faded.type, 'Textbox');
  assert.equal(resolveTextboxBoxStroke(faded).opacity, 0.4);

  const omitted = makeFirstBox({ stroke: composeAnnotationColor(LIVE_STROKE, undefined) });
  assert.equal(omitted.stroke, 'rgba(0, 0, 0, 1)');
  assert.equal(resolveTextboxBoxStroke(omitted).opacity, 1);

  const hexOnly = makeFirstBox({ stroke: LIVE_STROKE });
  assert.equal(hexOnly.stroke, '#000000');
  assert.equal(resolveTextboxBoxStroke(hexOnly).opacity, 1);
});

test('first-create-shaped export writes metadata stroke fade from next-draw Opacity', async () => {
  const faded = await exportFirstBox();
  assert.equal(faded.metadata?.style?.stroke, LIVE_PAINT);
  assert.equal(resolveTextboxBoxStroke(faded.box).opacity, 0.4);

  const opaque = await exportFirstBox({ stroke: composeAnnotationColor(LIVE_STROKE, 100) });
  assert.equal(opaque.metadata?.style?.stroke, 'rgba(0, 0, 0, 1)');
  assert.equal(resolveTextboxBoxStroke(opaque.box).opacity, 1);
});
