// Cloud Bump must persist per-tool the same way Style Cloud does.
// Live toolbar writes Bump as session cloudIntensity (1–20). Rect prefs
// used to omit cloudIntensity, so Style Cloud restored after remount
// while first-create stamped default bump 2 until Bump was touched.
// Distinct from leftover-18, session-shared Style dash (c082fc76),
// and the every-integer Cloud bump catalog (UL-34).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildBoundaryShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { parsePdfAppAnnotationMetadata } from '../src/utils/pdfAppAnnotationMetadata.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const sharedRect = {
  tool: 'rect',
  start: { x: 20, y: 30 },
  end: { x: 120, y: 110 },
  strokeColor: '#ff0000',
  strokeOpacity: 100,
  fillColor: '#ffffff',
  fillOpacity: 0,
  strokeWidth: 2,
  lineBorderStyle: 'cloud',
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

function makeCloudRect(cloudIntensity = 2) {
  return buildBoundaryShapeCommitJSON({
    ...sharedRect,
    id: `cloud-bump-persist-${cloudIntensity}`,
    cloudIntensity,
  });
}

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'cloud-bump-persist-source.pdf',
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

function cloudIntensityFromDict(dict) {
  const be = dict.get(PDFName.of('BE'));
  if (!be) return null;
  const intensity = be.get(PDFName.of('I'));
  return intensity?.asNumber ? intensity.asNumber() : Number(intensity);
}

async function exportCloudRect(cloudIntensity = 2) {
  const rect = makeCloudRect(cloudIntensity);
  assert.ok(rect, 'first-create commit must produce a cloud rect');
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    { 1: { objects: [rect] } },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'cloud-bump-persist' },
  );
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  assert.ok(annots, 'export must write Annots');
  const dict = doc.context.lookup(annots.asArray()[0]);
  return { dict, rect, metadata: dictMetadata(dict) };
}

test('Rect default includes Bump 2; prefs merge per key', () => {
  const db = read('src/hooks/useDatabase.js');
  assert.match(
    db,
    /rect: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100, lineBorderStyle: 'solid', cloudIntensity: 2 \}/,
    'Rect defaults must stamp Bump 2 so remount cannot drop a persisted Cloud bump',
  );
  assert.match(
    db,
    /ellipse: \{ strokeColor: '#ff0000', strokeWidth: 2, fillColor: '#ffffff', fillOpacity: 0, strokeOpacity: 100, lineBorderStyle: 'solid' \}/,
    'Ellipse stays bump-less — do not invent Cloud Bump chrome on Ellipse',
  );
  assert.match(
    db,
    /\.\.\.\(DEFAULT_TOOL_PREFERENCES\[toolId\] \|\| \{\}\)/,
    'getToolPreference must merge per-tool defaults so omitted Bump does not drop',
  );
});

test('tool switch restores Bump; Bump change persists per tool', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(
    viewer,
    /if \(toolPrefs\.cloudIntensity !== undefined\) \{\s*\n\s*setCloudIntensity\(Math\.max\(1, Math\.min\(20, Number\(toolPrefs\.cloudIntensity\) \|\| 2\)\)\);/,
    'switching tools / remount must restore that tool\'s Bump, not session default 2',
  );
  assert.match(
    viewer,
    /updateToolPreference\(activeTool, \{ cloudIntensity: next \}\)/,
    'Bump field must persist per-tool so a later remount can restore it',
  );
});

test('first-create still stamps live Bump; default compose is 2', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(
    commit,
    /pdfCloudIntensity: Math\.max\(1, Number\(cloudIntensity\) \|\| 2\)/,
    'first-create must still stamp live Bump after the persisted default is applied',
  );
  const defaultRect = makeCloudRect();
  assert.equal(defaultRect.data.pdfCloudIntensity, 2);
  const leaked = makeCloudRect(8);
  assert.equal(leaked.data.pdfCloudIntensity, 8);
  const ellipse = buildBoundaryShapeCommitJSON({
    ...sharedRect,
    tool: 'ellipse',
    id: 'cloud-bump-persist-ellipse',
    cloudIntensity: 8,
    lineBorderStyle: 'solid',
  });
  assert.equal(ellipse.data?.pdfCloudIntensity, undefined, 'Ellipse must not stamp Cloud Bump');
});

test('first-create-shaped export writes Square /BE /I; leaked bump stays distinguishable', async () => {
  const def = await exportCloudRect(2);
  assert.equal(def.metadata?.data?.pdfCloudIntensity ?? def.rect.data.pdfCloudIntensity, 2);
  assert.equal(cloudIntensityFromDict(def.dict), 2, 'default Bump writes /BE /I 2');

  const leaked = await exportCloudRect(8);
  assert.equal(
    leaked.metadata?.data?.pdfCloudIntensity ?? leaked.rect.data.pdfCloudIntensity,
    8,
    'persisted Bump 8 must remain distinguishable',
  );
  assert.equal(cloudIntensityFromDict(leaked.dict), 8, 'leaked Bump 8 must write /BE /I 8');
});
