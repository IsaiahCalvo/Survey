// Textbox first-create must stamp next-draw Width.
// Live toolbar writes Border/Width as strokeWidth. First-create used to
// hardcode strokeWidth: 1, so a next-draw Width never reached persist /
// reimport / export until Width was touched again (selected-patch).
// Callout first-create already stamps lineThickness from strokeWidth.
// Distinct from leftover-18 and textbox stroke /Border export of an
// already-patched box (99a07184).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

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
    stroke: '#000000',
    strokeWidth: 8,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-width-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictBorderWidth(dict) {
  const value = dict.get(PDFName.of('Border'));
  if (!value || typeof value.asArray !== 'function') return null;
  const entries = value.asArray();
  if (entries.length < 3) return null;
  const width = entries[2];
  return width?.asNumber ? width.asNumber() : Number(width);
}

async function exportFirstBox(patch = {}) {
  const box = makeFirstBox(patch);
  assert.ok(box, 'first-create commit must produce a textbox');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-width' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box };
}

test('first-create overlay reads next-draw strokeWidth; PDFViewer passes it', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /Next-draw Width must ride the first box/,
    'first-create must name the leftover',
  );
  assert.match(
    overlay,
    /strokeWidth: Math\.max\(1, Number\(strokeWidth\) \|\| 1\)/,
    'first-create must stamp live Width, not hardcoded 1',
  );
  assert.equal(
    (overlay.match(/strokeWidth: 1,/g) || []).length,
    0,
    'first-create must not hardcode strokeWidth: 1',
  );

  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /strokeWidth=\{strokeWidth\}/,
    'PDFViewer must pass next-draw Width into TextEditOverlay',
  );
});

test('first-create commit keeps next-draw Width 8; omitted Width stays 1', () => {
  const thick = makeFirstBox();
  assert.equal(thick.strokeWidth, 8);
  assert.equal(thick.type, 'Textbox');
  const omitted = makeFirstBox({ strokeWidth: undefined });
  assert.equal(omitted.strokeWidth, 1);
});

test('first-create-shaped export writes FreeText /Border from next-draw Width', async () => {
  const thick = await exportFirstBox();
  assert.equal(dictBorderWidth(thick.dict), 8);

  const hairline = await exportFirstBox({ strokeWidth: 1 });
  assert.equal(dictBorderWidth(hairline.dict), 1);
});
