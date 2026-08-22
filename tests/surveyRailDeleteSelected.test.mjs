import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-rail Delete selected items leftover after overlay delete chrome.
// Live proof: debug/scenarios/e2e-survey-rail-delete-selected.spec.mjs
// Not overlay Delete, not E-04 rect Backspace, not counter-series Delete.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail Delete selected items is confirm-gated and disabled with none selected', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label="Delete selected items"/);
  assert.match(rail, /disabled=\{itemSelectedCount === 0\}/);
  const deleteStart = rail.indexOf('// Delete selected items');
  assert.ok(deleteStart > 0, 'delete loop comment');
  const handler = rail.slice(
    rail.lastIndexOf('onClick={async () => {', deleteStart),
    rail.indexOf('aria-label="Delete selected items"'),
  );
  assert.match(handler, /if \(selectedItemIds\.length === 0\)/);
  assert.match(handler, /Please select at least one item to delete/);
  assert.match(handler, /const confirmed = await askConfirm\(\{/);
  assert.match(handler, /title: `Delete \$\{selectedItemIds\.length\} item/);
  assert.match(handler, /confirmLabel: `Delete \$\{selectedItemIds\.length\} item/);
  assert.match(handler, /if \(!confirmed\) \{\s*return;/);
  assert.match(handler, /handleDeleteSurveyMarkerItem\(annotationId\)/);
  assert.doesNotMatch(handler, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(handler, /data-counter-nubbin-handle/);
});

test('item Select / Delete selected items toolbar is desktop-only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const toolbar = rail.slice(
    rail.indexOf('the inline item Select /'),
    rail.indexOf('aria-label="Delete selected items"') + 80,
  );
  assert.match(toolbar, /!copyModeActive && !mobileMode && \(/);
  assert.match(toolbar, /aria-label="Delete selected items"/);
  assert.match(rail, /ariaLabel=\{\`\$\{isMarkerSelected \? 'Deselect' : 'Select'\} \$\{surveyMarkerName\}\`\}/);
});

test('PDFViewer rail delete routes through handleSurveyMarkerDeleted + undo checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleDeleteSurveyMarkerItem = useCallback((annotationId) => {');
  assert.ok(start > 0, 'handleDeleteSurveyMarkerItem');
  const block = viewer.slice(start, start + 700);
  assert.match(block, /handleSurveyMarkerDeleted\(surveyMarker\.pageNumber, surveyMarker\.bounds, annotationId\)/);
  assert.match(viewer, /addHistoryCheckpoint\('highlight:delete'/);
  assert.match(viewer, /canCommitSurveyMarkerErase\(\{/);
  assert.doesNotMatch(block, /data-counter-nubbin-handle/);
  assert.doesNotMatch(block, /data-handle=\{`vertex-\$\{/);
});
