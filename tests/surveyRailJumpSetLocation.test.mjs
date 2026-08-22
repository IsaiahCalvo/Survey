import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-rail Jump / Set location leftover after Create category.
// Live proof: debug/scenarios/e2e-survey-rail-jump-set-location.spec.mjs
// Not Create category, not category Delete, not item Delete, not Rename.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop search button is Jump with location and Set location without', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label=\{surveyMarker\.bounds && surveyMarker\.pageNumber \? "Jump to this Survey Marker" : "Set location on PDF"\}/);
  assert.match(rail, /locateOrSetSurveyMarker\(surveyMarker\)/);
  const helperStart = rail.indexOf('const beginSetLocationOnPdf = (marker) => {');
  assert.ok(helperStart > 0, 'beginSetLocationOnPdf');
  const helper = rail.slice(helperStart, rail.indexOf('const commitSurveyMarkerName'));
  assert.match(helper, /setPendingLocationItem\(marker\)/);
  assert.match(helper, /setActiveTool\('survey-marker'\)/);
  assert.match(helper, /setActiveCategoryDropdown\('survey'\)/);
  assert.match(helper, /if \(marker\?\.bounds && marker\?\.pageNumber\)/);
  assert.match(helper, /handleLocateItemOnPDF\(marker\)/);
  assert.match(helper, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(helper, /setPendingLocationItem\(null\)/);
  assert.doesNotMatch(helper, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(helper, /data-counter-nubbin-handle/);
});

test('390 detail search button always names Jump and still branches via locateOrSet', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label="Jump to this Survey Marker"/);
  const mobile = rail.slice(
    rail.indexOf('aria-label="Jump to this Survey Marker"'),
    rail.indexOf('aria-label={hasNoteText ? \'Edit Survey Marker notes\''),
  );
  assert.match(mobile, /locateOrSetSurveyMarker\(mobileDetailMarker\)/);
  assert.doesNotMatch(mobile, /Set location on PDF/);
});

test('PDFViewer Jump requires bounds; Set location writes pageNumber + bounds; banner cancel exists', () => {
  const viewer = read('src/PDFViewer.jsx');
  const locate = viewer.slice(
    viewer.indexOf('const handleLocateItemOnPDF = useCallback((surveyMarker) => {'),
    viewer.indexOf('const handlePendingSurveyMarkerSelectionConsumed'),
  );
  assert.match(locate, /if \(!pageNumber \|\| !bounds\)/);
  assert.match(locate, /goToPage\(pageNumber\)/);
  assert.match(locate, /centerSurveyMarkerElementInViewer/);
  assert.match(locate, /setActiveTool\('select'\)/);
  const pending = viewer.slice(
    viewer.indexOf('// Handle locating a pending item (from "Locate" button on unlocated item)'),
    viewer.indexOf('// Unique ID for this surveyMarker (generated up-front for the checkpoint stamp)'),
  );
  assert.match(pending, /if \(pendingLocationItem\)/);
  assert.match(pending, /pageNumber,/);
  assert.match(pending, /bounds,/);
  assert.match(pending, /setPendingLocationItem\(null\)/);
  const created = viewer.slice(
    viewer.indexOf('const handleSurveyMarkerCreated = useCallback((pageNumber, bounds) => {'),
    viewer.indexOf('// Handle locating a pending item (from "Locate" button on unlocated item)'),
  );
  assert.match(created, /addHistoryCheckpoint\('highlight:create'/);
  assert.match(created, /hasPendingLocationItem: Boolean\(pendingLocationItem\)/);
  assert.match(viewer, /Draw a box on the PDF to locate "/);
  assert.match(viewer, /onClick=\{\(\) => setPendingLocationItem\(null\)\}/);
  assert.doesNotMatch(locate, /data-handle=\{`vertex-\$\{/);
});
