// Style dash must stay per-tool after a sibling switch.
// Live toolbar writes Style as session lineBorderStyle (solid / dashed /
// dotted / rect-only cloud). Style-capable prefs used to omit
// lineBorderStyle, so Callout / Rect → Text / Ellipse inherited Dashed
// and first-create stamped the leak until Style was touched. Distinct
// from leftover-18, textbox first-create Style persist (user-set Dashed),
// and Text first-create Width after sibling (aa0369af).
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
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

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
    strokeDashArray: dashArrayFromLineBorderStyle('solid'),
    ...patch,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'style-dash-after-sibling-source.pdf',
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
    { returnBytes: true, actionType: 'pdf-export', documentId: 'style-dash-after-sibling' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, box, metadata: dictMetadata(dict) };
}

test('Style-capable defaults include Solid; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /text: \{ strokeColor: '#000000', strokeOpacity: 100, strokeWidth: 1, lineBorderStyle: 'solid', fillColor: '#ffffff', fillOpacity: 0 \}/,
    'Text defaults must stamp Style Solid so sibling tools cannot leak Dashed',
  );
  assert.match(
    db,
    /callout: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/,
    'Callout default Style is Solid — the same-category leak source when omitted',
  );
  assert.match(
    db,
    /rect: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100, lineBorderStyle: 'solid', cloudIntensity: 2 \}/,
    'Rect default Style is Solid — the Shapes leak source when omitted',
  );
  assert.match(
    db,
    /ellipse: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100, lineBorderStyle: 'solid' \}/,
    'Ellipse default Style is Solid — must not inherit Rect Dashed / Cloud',
  );
  assert.match(
    db,
    /line: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid' \}/,
  );
  assert.match(
    db,
    /arrow: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/,
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Style does not leak',
  );
});

test('tool switch restores Style; Style change persists per tool', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(toolPrefs\.lineBorderStyle !== undefined\) \{\s*\n\s*setLineBorderStyle\(toolPrefs\.lineBorderStyle\);/,
    'switching tools must restore that tool\'s Style, not the sibling session value',
  );
  assert.match(
    viewer,
    /updateToolPreference\(activeTool, \{ lineBorderStyle: next \}\)/,
    'Style picker must persist per-tool so a later sibling switch can restore it',
  );
});

test('first-create still stamps live Style; default compose is solid', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(
    overlay,
    /strokeDashArray: dashArrayFromLineBorderStyle\(lineBorderStyle\)/,
    'first-create must still stamp live Style after the sibling default is applied',
  );
  const defaultBox = makeFirstBox();
  assert.equal(defaultBox.strokeDashArray, null);
  const leakedDashed = makeFirstBox({
    strokeDashArray: dashArrayFromLineBorderStyle('dashed'),
  });
  assert.deepEqual(leakedDashed.strokeDashArray, [6, 4]);
  const leakedDotted = makeFirstBox({
    strokeDashArray: dashArrayFromLineBorderStyle('dotted'),
  });
  assert.deepEqual(leakedDotted.strokeDashArray, [2, 4]);
});

test('first-create-shaped export writes FreeText solid omit /BS; leaked dash stays distinguishable', async () => {
  const solid = await exportFirstBox();
  assert.equal(solid.metadata?.style?.strokeDashArray, null);
  assert.equal(solid.box.strokeDashArray, null);
  assert.equal(solid.dict.get(PDFName.of('BS')), undefined, 'Text default Style omits /BS');

  const leaked = await exportFirstBox({
    strokeDashArray: dashArrayFromLineBorderStyle('dashed'),
  });
  assert.deepEqual(
    leaked.metadata?.style?.strokeDashArray,
    [6, 4],
    'leaked Callout / Rect Dashed must remain distinguishable',
  );
  const bs = leaked.dict.get(PDFName.of('BS'));
  assert.ok(bs, 'leaked dashed first-create must write /BS');
  const dash = bs.get(PDFName.of('D'));
  assert.deepEqual(dash.asArray().map((n) => n.asNumber()), [6, 4]);
});
