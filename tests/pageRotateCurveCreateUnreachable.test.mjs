import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Create-curve is not a toolbar tool. Curve is Line/Arrow midpoint handle
// (useSVGInteraction ds.mode === 'midpoint'). Handle commit is already
// receipted as failing in this VM (e2e-line-endpoint-midpoint);
// e2e-page-rotate-line-midpoint-remap seeds data.midpoint.
// Do not invent a Curve tool.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('no Curve toolbar tool on desktop or mobile shape catalogs', () => {
  const viewer = read('src/PDFViewer.jsx');
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const shapeBlock = viewer.slice(
    viewer.indexOf("activeCategoryDropdown === 'shape'"),
    viewer.indexOf("activeCategoryDropdown === 'shape'") + 2500,
  );
  assert.match(shapeBlock, /label: 'Rectangle'/);
  assert.match(shapeBlock, /label: 'Line'/);
  assert.match(shapeBlock, /label: 'Arrow'/);
  assert.doesNotMatch(shapeBlock, /label: 'Curve'/);
  assert.doesNotMatch(shapeBlock, /id: 'curve'/);
  assert.match(mobile, /label: 'Line'/);
  assert.doesNotMatch(mobile, /label: 'Curve'/);
  assert.doesNotMatch(mobile, /id: 'curve'/);
});

test('curve create path is Line midpoint handle; persist spec seeds, does not invent a tool', () => {
  const interaction = read('src/hooks/useSVGInteraction.js');
  assert.match(interaction, /ds\.mode === 'midpoint'/);
  assert.match(interaction, /Phase 15 LINE-01 \/ ARROW-01 — live-paint midpoint translate/);
  assert.match(interaction, /obj\.data\.midpoint/);

  const remap = read('debug/scenarios/e2e-page-rotate-line-midpoint-remap.spec.mjs');
  assert.match(remap, /Seed/);
  assert.match(remap, /data\.midpoint/);
  assert.match(remap, /Handle drags/);

  const reindex = read('src/utils/pageAnnotationReindex.js');
  assert.match(reindex, /data\.midpoint/);
  assert.match(reindex, /Do not independently/);
});
