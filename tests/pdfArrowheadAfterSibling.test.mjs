// Arrowhead must stay per-tool after a sibling switch.
// Live toolbar writes Arrowhead as session arrowheadStyle (solidTriangle /
// vShape / openCircle / openTriangle / horizontalLine / none). Arrowhead-
// capable prefs used to omit arrowheadStyle, so Callout ↔ Arrow inherited
// the sibling head and first-create stamped the leak until Arrowhead was
// touched. Distinct from leftover-18, Style dash after sibling (c082fc76),
// and the every-head catalogs (S-04 / T-02).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildLineCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';
import { PDF_CALLOUT_METADATA_KEY } from '../src/utils/pdfCalloutMetadata.js';
import { ARROWHEAD_STYLES } from '../src/components/Callout/types.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const sharedLine = {
  id: 'arrow-after-sibling',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#ff0000',
  strokeOpacity: 100,
  strokeWidth: 2,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function makeArrow(arrowheadStyle = ARROWHEAD_STYLES.SOLID_TRIANGLE) {
  return buildLineCommitJSON({
    ...sharedLine,
    tool: 'arrow',
    arrowheadStyle,
  });
}

function makeCallout(arrowheadStyle = ARROWHEAD_STYLES.SOLID_TRIANGLE) {
  return {
    id: `callout-after-sibling-${arrowheadStyle}`,
    pageNumber: 1,
    arrowTip: { x: 0.12, y: 0.18 },
    knee: { x: 0.22, y: 0.22 },
    textBoxPosition: { x: 0.32, y: 0.20 },
    textBoxWidth: 0.28,
    textBoxHeight: 0.08,
    text: 'H',
    style: {
      fontColor: '#1e293b',
      fontSize: 14,
      arrowheadStyle,
    },
  };
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'arrowhead-after-sibling-source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function dictText(dict, key) {
  const value = dict.get(PDFName.of(key));
  return value?.decodeText ? value.decodeText() : null;
}

function lineEndingNames(dict) {
  const le = dict.get(PDFName.of('LE'));
  if (!le) return null;
  return le.asArray().map((name) => (name.decodeText ? name.decodeText() : String(name)));
}

async function exportArrow(arrowheadStyle) {
  const arrow = makeArrow(arrowheadStyle);
  assert.ok(arrow, 'arrow first-create commit must produce a Line');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [arrow] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'arrowhead-after-sibling' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  const metaRaw = dictText(dict, 'SurveyAppAnnotation');
  return {
    dict,
    arrow,
    endings: lineEndingNames(dict),
    metadata: parsePdfAppAnnotationMetadata(metaRaw),
  };
}

async function exportCallout(arrowheadStyle) {
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {},
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, callouts: [makeCallout(arrowheadStyle)] },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'callout export must write Annots');
  const dicts = annots.asArray().map((ref) => doc.context.lookup(ref));
  const line2 = dicts.find((dict) => {
    const meta = dictText(dict, PDF_CALLOUT_METADATA_KEY);
    return meta && JSON.parse(meta).part === 'line2';
  });
  assert.ok(line2, 'callout line2 must exist');
  return {
    endings: lineEndingNames(line2),
    metadata: JSON.parse(dictText(line2, PDF_CALLOUT_METADATA_KEY) || '{}'),
  };
}

test('Arrowhead-capable defaults include Solid triangle; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /arrow: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/,
    'Arrow defaults must stamp Solid triangle so Callout cannot leak V-shape',
  );
  assert.match(
    db,
    /callout: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 90, strokeOpacity: 100, lineBorderStyle: 'solid', arrowheadStyle: 'solidTriangle' \}/,
    'Callout default Arrowhead is Solid triangle — the same-category leak source when omitted',
  );
  assert.match(
    db,
    /line: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100, lineBorderStyle: 'solid' \}/,
    'Line stays headless — do not invent an Arrowhead pref on Line',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Arrowhead does not leak',
  );
});

test('tool switch restores Arrowhead; Arrowhead change persists per tool', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(toolPrefs\.arrowheadStyle !== undefined\) \{\s*\n\s*setArrowheadStyle\(toolPrefs\.arrowheadStyle\);/,
    'switching tools must restore that tool\'s Arrowhead, not the sibling session value',
  );
  assert.match(
    viewer,
    /updateToolPreference\(activeTool, \{ arrowheadStyle: next \}\)/,
    'Arrowhead picker must persist per-tool so a later sibling switch can restore it',
  );
});

test('first-create still stamps live Arrowhead; default compose is solidTriangle', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /arrowheadStyle: arrowheadStyleRef\.current \|\| rawCallout\.style\?\.arrowheadStyle/,
    'first-create callout must still stamp live Arrowhead after the sibling default is applied',
  );
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(
    commit,
    /data: \(tool === 'arrow' && arrowheadStyle\) \? \{ id, arrowheadStyle \} : \{ id \}/,
    'first-create arrow must still stamp live Arrowhead; Line stays headless',
  );
  const defaultArrow = makeArrow();
  assert.equal(defaultArrow.data.arrowheadStyle, 'solidTriangle');
  const leaked = makeArrow(ARROWHEAD_STYLES.V_SHAPE);
  assert.equal(leaked.data.arrowheadStyle, 'vShape');
  const line = buildLineCommitJSON({
    ...sharedLine,
    tool: 'line',
    id: 'line-after-sibling',
    arrowheadStyle: ARROWHEAD_STYLES.V_SHAPE,
  });
  assert.equal(line.data.arrowheadStyle, undefined, 'Line create never stamps Arrowhead');
});

test('first-create-shaped export writes Arrow ClosedArrow; leaked V-shape stays distinguishable', async () => {
  const solid = await exportArrow(ARROWHEAD_STYLES.SOLID_TRIANGLE);
  assert.equal(solid.arrow.data.arrowheadStyle, 'solidTriangle');
  assert.deepEqual(solid.endings, ['None', 'ClosedArrow']);
  assert.equal(solid.metadata?.flags?.arrowheadStyle || solid.metadata?.style?.arrowheadStyle || 'solidTriangle', 'solidTriangle');

  const leaked = await exportArrow(ARROWHEAD_STYLES.V_SHAPE);
  assert.equal(leaked.arrow.data.arrowheadStyle, 'vShape');
  assert.deepEqual(
    leaked.endings,
    ['None', 'Slash'],
    'leaked Callout V-shape must remain distinguishable on Arrow /LE',
  );

  const calloutDefault = await exportCallout(ARROWHEAD_STYLES.SOLID_TRIANGLE);
  assert.equal(calloutDefault.metadata.style.arrowheadStyle, 'solidTriangle');
  assert.deepEqual(calloutDefault.endings, ['None', 'ClosedArrow']);

  const calloutLeaked = await exportCallout(ARROWHEAD_STYLES.OPEN_CIRCLE);
  assert.equal(
    calloutLeaked.metadata.style.arrowheadStyle,
    'openCircle',
    'leaked Arrow Open circle must remain distinguishable on Callout metadata',
  );
  assert.deepEqual(calloutLeaked.endings, ['None', 'Circle']);
});
