import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';

// Empty-module Create template leftover after place-time Entity dialog.
// Live proof: debug/scenarios/e2e-survey-empty-create-template.spec.mjs
// Not heading-row plus Create category as the GAP.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('empty-module start-adding opens CreateCategoryModal on desktop only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /No categories available for this space\./);
  assert.match(rail, /className="survey-marker-empty-module-create-button"/);
  assert.match(rail, /aria-label="Create category for empty module"/);

  const emptyStart = rail.indexOf('No categories available for this space.');
  const empty = rail.slice(
    emptyStart,
    rail.indexOf('Choose survey template', emptyStart),
  );
  assert.match(empty, /\{!mobileMode && selectedTemplate && selectedModuleId && \(/);
  assert.match(empty, /onClick=\{\(e\) => \{/);
  assert.match(empty, /openCreateCategoryModal\(\)/);
  assert.doesNotMatch(empty, /onRequestCreateTemplate\?/);
  assert.doesNotMatch(empty, /startAddingCategory: true/);
  assert.match(rail, /<CreateCategoryModal/);
  assert.match(rail, /addCategoryToCurrentTemplate\?\.\(selectedModuleId, categoryName\)/);
  assert.match(rail, /addCategoryAsNewTemplate\?\.\(selectedModuleId, categoryName, newTemplateName\)/);
  assert.doesNotMatch(empty, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(empty, /data-counter-nubbin-handle/);
});

test('Empty Module Template is a local seed with one empty module', () => {
  const route = read('src/DevTestRoute.jsx');
  assert.match(route, /id: 'kal436-empty-module-template'/);
  assert.match(route, /name: 'Empty Module Template'/);
  assert.match(route, /id: 'kal436-empty-module'/);
  assert.match(route, /name: 'Empty Survey Data'/);
  assert.match(route, /Local seed only \(not a cloud persist seam\)/);

  // Slice stops at the later two-category seed (Walls + Windows). That
  // sibling is intended product after Create template — not leftover-18
  // and not a reason to skip this contract.
  const empty = route.slice(
    route.indexOf("id: 'kal436-empty-module-template'"),
    route.indexOf("id: 'kal436-two-category-template'"),
  );
  assert.match(empty, /categories: \[\]/);
  assert.doesNotMatch(empty, /entities:/);
  assert.doesNotMatch(empty, /name: 'Walls'/);
  assert.doesNotMatch(empty, /name: 'Doors'/);
  assert.doesNotMatch(empty, /Two Category Template/);
  assert.doesNotMatch(empty, /kal436-two-cat-walls/);

  const two = route.slice(
    route.indexOf("id: 'kal436-two-category-template'"),
    route.indexOf('const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY'),
  );
  assert.match(two, /name: 'Two Category Template'/);
  assert.match(two, /name: 'Walls'/);
  assert.match(two, /name: 'Windows'/);
  assert.doesNotMatch(two, /categories: \[\]/);
  assert.doesNotMatch(two, /Empty Module Template/);

  const kal436 = route.slice(
    route.indexOf("id: 'kal436-template'"),
    route.indexOf("id: 'kal436-entities-template'"),
  );
  assert.doesNotMatch(kal436, /Empty Module Template/);
  assert.doesNotMatch(kal436, /kal436-empty-module/);
  assert.doesNotMatch(kal436, /Two Category Template/);
});

test('CreateCategoryModal still rejects empty and duplicate template names', () => {
  const modal = read('src/components/CreateCategoryModal.jsx');
  assert.match(modal, /empty-module/);
  assert.match(modal, /placeholder="Enter category name\.\.\."/);
  assert.match(modal, /placeholder="Enter template name\.\.\."/);
  assert.match(modal, /Save as new template/);
  assert.match(modal, /A template with this name already exists/);
  assert.match(modal, /const categoryNameValid = Boolean\(categoryName\.trim\(\)\) && !categoryError/);
  assert.match(modal, /disabled=\{!canConfirm\}/);
  assert.match(modal, /Cancel/);
  assert.doesNotMatch(modal, /addHistoryCheckpoint/);
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:category-delete' }),
    true,
    'category-delete undo reason stays eligible; empty-module create does not invent a new reason',
  );
});
