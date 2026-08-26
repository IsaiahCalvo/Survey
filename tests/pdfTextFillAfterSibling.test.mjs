// Text Color Fill chrome must stay empty after a sibling switch.
// Live toolbar writes Fill as session fillColor / fillOpacity. Text prefs
// used to omit those keys, so Callout (white / 90) and Counter (badge red /
// 100) leaked into the Text Color swatch until Fill was touched. First-create
// box fill stays empty — do not invent a first-create Fill. Distinct from
// leftover-18, session-shared Arrowhead (742dc241), and text first-create
// Width after sibling (aa0369af).
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
    fill: '#000000',
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
    name: 'text-fill-after-sibling-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'text-fill-after-sibling' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box };
}

test('Text defaults include empty Fill; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /text: \{ strokeColor: '#000000', strokeOpacity: 100, strokeWidth: 1, lineBorderStyle: 'solid', fillColor: '#ffffff', fillOpacity: 0 \}/,
    'Text defaults must stamp empty Fill so Callout / Counter cannot leak Fill chrome',
  );
  assert.match(
    db,
    /callout: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/,
    'Callout default Fill stays white / 90 — the leak source when Text omitted fill keys',
  );
  assert.match(
    db,
    /counter: \{ strokeColor: '#ffffff', strokeWidth: 14, strokeOpacity: 100, fillColor: '#ef4444', fillOpacity: 100 \}/,
    'Counter default Fill stays badge red / 100 — the other sibling leak source',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Fill does not leak',
  );
});

test('tool switch restores Fill; Fill change persists per tool', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(toolPrefs\.fillColor !== undefined\) setFillColor\(toolPrefs\.fillColor\);/,
    'switching tools must restore that tool\'s Fill color, not the sibling session value',
  );
  assert.match(
    viewer,
    /if \(toolPrefs\.fillOpacity !== undefined\) setFillOpacity\(toolPrefs\.fillOpacity\);/,
    'switching tools must restore that tool\'s Fill opacity, not the sibling session value',
  );
  assert.match(
    viewer,
    /updateToolPreference\(activeTool, \{ fillColor: color \}\)/,
    'Fill color picker must persist per-tool so a later sibling switch can restore it',
  );
  assert.match(
    viewer,
    /updateToolPreference\(activeTool, \{ fillOpacity: opacity \}\)/,
    'Fill opacity picker must persist per-tool so a later sibling switch can restore it',
  );
});

test('first-create box fill stays empty; leaked sibling fill is distinguishable', () => {
  const envelope = read('src/utils/textEditCommit.js');
  assert.match(
    envelope,
    /backgroundColor: ''/,
    'first-create envelope must stay empty — do not invent a first-create Fill',
  );
  const defaultBox = makeFirstBox();
  assert.equal(defaultBox.backgroundColor, '');
  const leakedCallout = { ...makeFirstBox(), backgroundColor: 'rgba(255, 255, 255, 0.9)' };
  assert.equal(leakedCallout.backgroundColor, 'rgba(255, 255, 255, 0.9)');
  const leakedCounter = { ...makeFirstBox(), backgroundColor: 'rgba(239, 68, 68, 1)' };
  assert.equal(leakedCounter.backgroundColor, 'rgba(239, 68, 68, 1)');
});

test('first-create-shaped export omits a box fill; leaked fill stays distinguishable', async () => {
  const empty = await exportFirstBox();
  assert.equal(empty.box.backgroundColor, '');
  assert.equal(
    dictHasFillColor(empty.dict),
    false,
    'empty-default first box must not invent a FreeText /C fill',
  );

  const leaked = await exportFirstBox();
  leaked.box.backgroundColor = 'rgba(255, 255, 255, 0.9)';
  const leakedBytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [leaked.box] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'text-fill-after-sibling-leaked' },
  );
  const leakedDoc = await PDFDocument.load(leakedBytes);
  const leakedPage = leakedDoc.getPage(0);
  const leakedAnnots = leakedPage.node.lookup(PDFName.of('Annots'));
  const leakedDict = leakedDoc.context.lookup(leakedAnnots.asArray()[0]);
  assert.equal(leaked.box.backgroundColor, 'rgba(255, 255, 255, 0.9)');
  assert.equal(
    dictHasFillColor(leakedDict),
    true,
    'leaked Callout white / 90 must remain distinguishable as FreeText /C',
  );
});
