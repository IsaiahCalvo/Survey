import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';

// Survey-rail item Copy → setShowSpaceSelection leftover after item reorder.
// Live proof: debug/scenarios/e2e-survey-rail-item-copy-space.spec.mjs
// Distinct from dead copyModeActive ("Copy to Spaces" toolbar never entered).
// Not category Move/Copy stub. Not leftover-18 persist.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('item toolbar Copy is a compiled-in control distinct from dead copyModeActive', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const toolbar = rail.slice(
    rail.indexOf('aria-label="Item selection actions"'),
    rail.indexOf('aria-label="Delete selected items"'),
  );
  assert.match(toolbar, /Please select at least one item to copy/);
  assert.match(toolbar, /setCopiedItemSelection/);
  assert.match(toolbar, /setShowSpaceSelection\(true\)/);
  assert.match(toolbar, />\s*Copy\s*</);
  assert.match(toolbar, /disabled=\{itemSelectedCount === 0\}/);
  assert.doesNotMatch(toolbar, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(rail, /setCopyModeActive\(true\)/);
  assert.match(rail, /!copyModeActive && !mobileMode && \(/);
  assert.doesNotMatch(toolbar, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(toolbar, /data-counter-nubbin-handle/);
});

test('space picker lists modules-or-spaces, uses sourceModuleId, and checkpoints copy', () => {
  const viewer = read('src/PDFViewer.jsx');
  const modal = viewer.slice(
    viewer.indexOf('{/* Space Selection Modal */}'),
    viewer.indexOf('{/* Category Selection Modal (after highlighting) */}'),
  );
  assert.match(modal, /Select space/);
  assert.match(modal, /\(template\.modules \|\| template\.spaces \|\| \[\]\)\.forEach/);
  assert.match(modal, /No spaces available in any template/);
  assert.match(modal, /if \(availableModules\.length === 0\)/);
  assert.match(modal, /sourceModuleId = surveyMarkerModuleId \|\| selectedModuleId/);
  assert.match(modal, /if \(!sourceModuleId\)/);
  assert.match(modal, /\(t\.modules \|\| t\.spaces \|\| \[\]\)\.some\(s => s\.id === sourceModuleId\)/);
  assert.match(modal, /addHistoryCheckpoint\('survey-marker:copy'/);
  assert.match(modal, /setSelectedModuleId\(space\.id\)/);
  assert.match(modal, /\(template\.modules \|\| template\.spaces \|\| \[\]\)\.find\(s => s\.id === space\.id\)/);
  assert.doesNotMatch(modal, /if \(!sourceSpaceId\)/);
  assert.doesNotMatch(modal, /template\.spaces\.find\(s => s\.id === space\.id\)/);
  assert.doesNotMatch(modal, /setCopyModeActive\(true\)/);
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:copy' }),
    true,
    'copy undo reason stays eligible like rename/entity/reorder',
  );
});

test('Copy-to-Spaces copyModeActive toolbar stays unreachable', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const copyToSpaces = rail.slice(
    rail.indexOf('{/* Copy to Spaces button */}'),
    rail.indexOf('{/* Delete button */}'),
  );
  assert.match(copyToSpaces, /Copy to Spaces/);
  assert.match(copyToSpaces, /setShowSpaceSelection\(true\)/);
  assert.doesNotMatch(read('src/SurveySpacesRail.jsx') + read('src/PDFViewer.jsx'), /setCopyModeActive\(true\)/);
});
