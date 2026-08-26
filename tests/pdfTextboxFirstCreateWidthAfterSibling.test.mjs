// Text first-create must stamp Text Width, not a sibling tool's Width.
// Live toolbar writes Border/Width as strokeWidth. Text prefs used to omit
// strokeWidth, so Callout / Highlighter / Pen → Text inherited 2 / 20 / 3
// and first-create stamped the leak until Width was touched. Distinct from
// leftover-18, textbox first-create Width persist (user-set 8), and
// Counter first-pin Fill color sibling leak (39b4e9a5).
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
    strokeWidth: 1,
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'textbox-first-create-width-after-sibling-source.pdf',
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'textbox-first-create-width-after-sibling' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box };
}

test('Text defaults include Width 1; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /text: \{ strokeColor: '#000000', strokeOpacity: 100, strokeWidth: 1, lineBorderStyle: 'solid' \}/,
    'Text defaults must stamp Width 1 so sibling tools cannot leak 2 / 20 / 3',
  );
  assert.match(
    db,
    /highlighter: \{ strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 \}/,
    'Highlighter default Width stays 20 — the leak source when Text omitted strokeWidth',
  );
  assert.match(
    db,
    /callout: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100, lineBorderStyle: 'solid' \}/,
    'Callout default Width stays 2 — the same-category leak source',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Width does not leak',
  );
});

test('Text default Width is 1; sibling Highlighter / Callout / Pen widths are not', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(db, /strokeWidth: 1, lineBorderStyle: 'solid' \}/);
  assert.match(db, /strokeWidth: 20/);
  assert.match(db, /strokeWidth: 2/);
  assert.match(db, /pen: \{ strokeColor: '#ff0000', strokeWidth: 3/);
});

test('first-create still stamps live toolbar Width; default compose is 1', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /strokeWidth: Math\.max\(1, Number\(strokeWidth\) \|\| 1\)/,
    'first-create must still stamp live Width after the sibling default is applied',
  );
  const defaultBox = makeFirstBox();
  assert.equal(defaultBox.strokeWidth, 1);
  const leakedHighlighter = makeFirstBox({ strokeWidth: 20 });
  assert.equal(leakedHighlighter.strokeWidth, 20);
  const leakedCallout = makeFirstBox({ strokeWidth: 2 });
  assert.equal(leakedCallout.strokeWidth, 2);
});

test('first-create-shaped export writes FreeText /Border from Text default Width 1', async () => {
  const hairline = await exportFirstBox();
  assert.equal(dictBorderWidth(hairline.dict), 1);
  assert.equal(hairline.box.strokeWidth, 1);

  const leaked = await exportFirstBox({ strokeWidth: 20 });
  assert.equal(dictBorderWidth(leaked.dict), 20, 'leaked highlighter Width must remain distinguishable');
});
