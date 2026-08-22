import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Survey-rail Delete selected categories leftover after rail Rename.
// Live proof: debug/scenarios/e2e-survey-rail-delete-categories.spec.mjs
// Not item Delete selected, not overlay Delete, not E-04, not counter-series.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail Delete selected categories is confirm-gated and disabled with none selected', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label="Delete selected categories"/);
  assert.match(rail, /disabled=\{!hasSelectedCategories\}/);
  const handlerStart = rail.indexOf('const deleteSelectedCategories = async () => {');
  assert.ok(handlerStart > 0, 'deleteSelectedCategories handler');
  const handler = rail.slice(
    handlerStart,
    rail.indexOf('aria-label="Delete selected categories"'),
  );
  assert.match(handler, /if \(selectedCatIds\.length === 0\)/);
  assert.match(handler, /Please select at least one category to delete/);
  assert.match(handler, /const confirmed = await askConfirm\(\{/);
  assert.match(handler, /title: `Delete \$\{selectedCatIds\.length\} categor/);
  assert.match(handler, /confirmLabel: `Delete categor/);
  assert.match(handler, /if \(!confirmed\) \{\s*return;/);
  assert.match(handler, /deleteCategory\(selectedModuleId, catId\)/);
  assert.match(handler, /checkpointSurveyCategoryDelete\(selectedCatIds\)/);
  assert.match(handler, /delete updated\[annotationId\]/);
  assert.doesNotMatch(handler, /handleDeleteSurveyMarkerItem/);
  assert.doesNotMatch(handler, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(handler, /data-counter-nubbin-handle/);
});

test('category Select / Delete selected categories toolbar is desktop-only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const toolbar = rail.slice(
    rail.indexOf('UX (mobile demo parity): the select/copy-mode admin'),
    rail.indexOf('aria-label="Delete selected categories"') + 80,
  );
  assert.match(toolbar, /mobileMode \? null : !copyModeActive/);
  assert.match(toolbar, /aria-label="Delete selected categories"/);
  assert.match(rail, /className="survey-marker-category-select-button"/);
  assert.match(rail, /ariaLabel=\{\`\$\{isCategorySelectionSelected \? 'Deselect' : 'Select'\} \$\{category\.name/);
});

test('PDFViewer category-delete checkpoint restores template + markers', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const checkpointSurveyCategoryDelete = useCallback((categoryIds = []) => {');
  assert.ok(start > 0, 'checkpointSurveyCategoryDelete');
  const block = viewer.slice(start, start + 700);
  assert.match(block, /snapshot\.surveyTemplate = deepClone\(selectedTemplateRef\.current\)/);
  assert.match(block, /snapshot\.surveyTemplateRestore = true/);
  assert.match(block, /addHistoryCheckpoint\('survey-category:delete'/);
  assert.match(viewer, /if \(stateToRestore\.surveyTemplateRestore && stateToRestore\.surveyTemplate\)/);
  assert.match(viewer, /setSelectedTemplate\(nextTemplate\)/);
  assert.match(viewer, /const handleDeleteSurveyCategoryDefinition = useCallback\(\(moduleId, categoryId\) => \{/);
  assert.doesNotMatch(block, /data-counter-nubbin-handle/);
  assert.doesNotMatch(block, /data-handle=\{`vertex-\$\{/);
});
