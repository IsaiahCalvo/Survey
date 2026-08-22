import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';

// Survey-rail Create category leftover after rail Delete selected categories.
// Live proof: debug/scenarios/e2e-survey-rail-create-category.spec.mjs
// Not item Delete, not overlay Delete, not Rename, not category Delete as the GAP.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail Create category plus opens the modal on desktop only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /aria-label="Create category"/);
  assert.match(rail, /className="survey-marker-category-create-button"/);
  const plus = rail.slice(
    rail.indexOf('Same button look/size as before (shared'),
    rail.indexOf('aria-label="Create category"') + 80,
  );
  assert.match(plus, /\{!mobileMode && \(/);
  assert.match(plus, /onClick=\{openCreateCategoryModal\}/);
  assert.match(rail, /<CreateCategoryModal/);
  assert.match(rail, /addCategoryToCurrentTemplate\?\.\(selectedModuleId, categoryName\)/);
  assert.match(rail, /addCategoryAsNewTemplate\?\.\(selectedModuleId, categoryName, newTemplateName\)/);
  assert.match(rail, /existingCategoryNames=\{\(activeSurveyModule\?\.categories \|\| \[\]\)\.map/);
  assert.doesNotMatch(plus, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(plus, /data-counter-nubbin-handle/);
});

test('CreateCategoryModal rejects empty and duplicate names and requires a save option', () => {
  const modal = read('src/components/CreateCategoryModal.jsx');
  assert.match(modal, /placeholder="Enter category name\.\.\."/);
  assert.match(modal, /Modify current template/);
  assert.match(modal, /Save as new template/);
  assert.match(modal, /const categoryNameValid = Boolean\(categoryName\.trim\(\)\) && !categoryError/);
  assert.match(modal, /disabled=\{!canConfirm\}/);
  assert.match(modal, /Please enter a name for the new category/);
  assert.match(modal, /A category with this name already exists in this module/);
  assert.match(modal, /String\(existingName\)\.toLowerCase\(\) === trimmedName/);
  assert.match(modal, /if \(!selectedOption\)/);
  assert.match(modal, />Cancel</);
  assert.match(modal, /onClick=\{onClose\}/);
  assert.doesNotMatch(modal, /addHistoryCheckpoint/);
  assert.doesNotMatch(modal, /data-counter-nubbin-handle/);
});

test('PDFViewer create-category persist is local-first and is not an undo checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  const current = viewer.slice(
    viewer.indexOf('const handleAddCategoryToCurrentTemplate = useCallback(async (moduleId, categoryName) => {'),
    viewer.indexOf('const handleAddCategoryAsNewTemplate = useCallback(async (moduleId, categoryName, newTemplateName) => {'),
  );
  assert.match(current, /id: `cat-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(current, /name: categoryName/);
  assert.match(current, /checklist: \[\]/);
  assert.match(current, /setSelectedTemplate\(updatedTemplate\)/);
  assert.doesNotMatch(current, /addHistoryCheckpoint/);
  assert.doesNotMatch(current, /surveyTemplateRestore/);
  const asNew = viewer.slice(
    viewer.indexOf('const handleAddCategoryAsNewTemplate = useCallback(async (moduleId, categoryName, newTemplateName) => {'),
    viewer.indexOf('const handleNewColumnsDecision = useCallback(async (decision, templateName) => {'),
  );
  assert.match(asNew, /setSelectedTemplate\(newTemplate\)/);
  assert.doesNotMatch(asNew, /addHistoryCheckpoint/);
  assert.match(viewer, /snapshots omit it so pen\/shape undo does not rewind Create category/);
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:category-delete' }),
    true,
    'category-delete undo reason stays eligible; create does not invent a new reason',
  );
  assert.doesNotMatch(current, /data-handle=\{`vertex-\$\{/);
});
