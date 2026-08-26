// Textbox first-create must stamp next-draw Color Fill.
// Live toolbar writes Fill as fillColor + fillOpacity. First-create used
// envelope backgroundColor '' so a next-draw Fill never reached persist /
// reimport / flatten until Fill was touched again (selected-patch
// backgroundColor). Empty-default fillOpacity 0 stays '' — do not invent
// a first-create Fill on an empty-default textbox. Distinct from leftover-18,
// Text Fill after sibling (63792671), textbox first-create Width / Color
// Border / Border Opacity / Style, and textbox fillOpacity /C of an
// already-patched box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildNewTextCommitJSON, boxFillFromToolbar } from '../src/utils/textEditCommit.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';
import { resolveTextboxBoxFill } from '../src/utils/annotationStyleCatalog.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const LIVE_FILL = '#ffffff';
const LIVE_OPACITY = 40;
const LIVE_PAINT = composeAnnotationColor(LIVE_FILL, LIVE_OPACITY);

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
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 1,
    backgroundColor: LIVE_PAINT,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-fill-source.pdf',
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

function dictHasFillColor(dict) {
  const color = dict.get(PDFName.of('C'));
  if (!color || typeof color.asArray !== 'function') return false;
  return color.asArray().length >= 3;
}

async function exportFirstBox(patch = {}) {
  const box = makeFirstBox(patch);
  assert.ok(box, 'first-create commit must produce a textbox');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-fill' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box, metadata: dictMetadata(dict) };
}

test('first-create overlay composes fillColor + fillOpacity; PDFViewer passes it', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /Next-draw Color Fill must ride the first box/,
    'first-create must name the leftover',
  );
  assert.match(
    overlay,
    /backgroundColor: boxFillFromToolbar\(fillColor, fillOpacity\)/,
    'first-create must compose live Color Fill, not envelope empty',
  );
  assert.match(
    overlay,
    /backgroundColor: boxFillFromToolbar\(fillColor, fillOpacity\) \|\| s\.backgroundColor \|\| ''/,
    'commit must prefer live Color Fill over mount-time empty',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /fillColor=\{fillColor\}/,
    'PDFViewer must pass next-draw Color Fill into TextEditOverlay',
  );
  assert.match(
    viewer,
    /fillOpacity=\{fillOpacity\}/,
    'PDFViewer must pass next-draw Color Fill Opacity into TextEditOverlay',
  );
});

test('boxFillFromToolbar stamps user-set Fill; empty default stays empty', () => {
  assert.equal(boxFillFromToolbar(LIVE_FILL, LIVE_OPACITY), LIVE_PAINT);
  assert.equal(boxFillFromToolbar(LIVE_FILL, 0), '');
  assert.equal(boxFillFromToolbar(LIVE_FILL, undefined), '');
  assert.equal(boxFillFromToolbar('transparent', 40), '');
  assert.equal(boxFillFromToolbar('', 40), '');
  assert.equal(boxFillFromToolbar(null, 40), '');
});

test('first-create commit keeps next-draw Fill 0.4; omitted Fill stays empty', () => {
  const filled = makeFirstBox();
  assert.equal(filled.backgroundColor, 'rgba(255, 255, 255, 0.4)');
  assert.equal(filled.type, 'Textbox');
  assert.equal(resolveTextboxBoxFill(filled).opacity, 0.4);
  assert.equal(resolveTextboxBoxFill(filled).visible, true);

  const empty = makeFirstBox({ backgroundColor: boxFillFromToolbar(LIVE_FILL, 0) });
  assert.equal(empty.backgroundColor, '');
  assert.equal(resolveTextboxBoxFill(empty).visible, false);

  const omitted = makeFirstBox({ backgroundColor: undefined });
  assert.equal(omitted.backgroundColor, '');
  assert.equal(resolveTextboxBoxFill(omitted).visible, false);
});

test('first-create-shaped export writes /C from next-draw Fill; empty omits /C', async () => {
  const filled = await exportFirstBox();
  assert.equal(filled.metadata?.style?.backgroundColor, LIVE_PAINT);
  assert.equal(resolveTextboxBoxFill(filled.box).opacity, 0.4);
  assert.equal(dictHasFillColor(filled.dict), true, 'user-set Fill must write FreeText /C');

  const empty = await exportFirstBox({ backgroundColor: '' });
  assert.equal(empty.box.backgroundColor, '');
  assert.equal(
    dictHasFillColor(empty.dict),
    false,
    'empty-default first box must not invent a FreeText /C fill',
  );
});
