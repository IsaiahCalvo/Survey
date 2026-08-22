import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';
import { moveItemById } from '../src/reorder/flatReorderUtils.js';

// Survey-rail category reorder leftover after empty-module Create template.
// Live proof: debug/scenarios/e2e-survey-rail-category-reorder.spec.mjs
// Not Create category, not category Delete as the GAP, not item reorder.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('rail category rows wire SortableRearrangeList to handleReorderSurveyCategories on desktop only', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /<SortableRearrangeList/);
  assert.match(rail, /onReorder=\{\(activeId, overId\) => handleReorderSurveyCategories\(selectedModuleId, activeId, overId\)\}/);
  assert.match(rail, /title="Drag category to rearrange"/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /data-drag-rearrange-handle/);

  const categoryList = rail.slice(
    rail.indexOf('{/* Vocabulary rule: "Survey Marker" in full on mobile copy'),
    rail.indexOf('reorderSurveyMarkersInCategory(categorySurveyMarkers'),
  );
  assert.match(categoryList, /\{mobileMode \? null : isCategorySelectable \? \(/);
  assert.match(categoryList, /<DragRearrangeHandle/);
  assert.match(categoryList, /no drag-reorder handle or/);
  assert.doesNotMatch(categoryList, /Move up/);
  assert.doesNotMatch(categoryList, /Move down/);
  assert.doesNotMatch(categoryList, /data-handle=\{`vertex-\$\{/);
  assert.doesNotMatch(categoryList, /data-counter-nubbin-handle/);
});

test('PDFViewer category reorder uses moveItemById and is not an undo checkpoint', () => {
  const viewer = read('src/PDFViewer.jsx');
  const block = viewer.slice(
    viewer.indexOf('const handleReorderSurveyCategories = useCallback((moduleId, activeId, overId) => {'),
    viewer.indexOf('const handleDeleteSurveyCategoryDefinition = useCallback((moduleId, categoryId) => {'),
  );
  assert.match(block, /if \(!selectedTemplate \|\| !moduleId \|\| !activeId \|\| !overId \|\| activeId === overId\) return;/);
  assert.match(block, /const nextCategories = moveItemById\(categories, activeId, overId\);/);
  assert.match(block, /setSelectedTemplate\(updatedTemplate\)/);
  assert.match(block, /Failed to persist survey category order/);
  assert.doesNotMatch(block, /addHistoryCheckpoint/);
  assert.doesNotMatch(block, /surveyTemplateRestore/);
  assert.doesNotMatch(block, /data-handle=\{`vertex-\$\{/);
  assert.equal(
    isLegacyAnnotationHistoryMeta({ reason: 'survey-marker:category-delete' }),
    true,
    'category-delete undo reason stays eligible; reorder does not invent a new reason',
  );

  const wallsFirst = [
    { id: 'kal436-two-cat-walls', name: 'Walls' },
    { id: 'kal436-two-cat-windows', name: 'Windows' },
  ];
  assert.deepEqual(
    moveItemById(wallsFirst, 'kal436-two-cat-walls', 'kal436-two-cat-windows').map(({ name }) => name),
    ['Windows', 'Walls'],
  );
  assert.equal(
    moveItemById(wallsFirst, 'kal436-two-cat-walls', 'kal436-two-cat-walls'),
    wallsFirst,
    'self-drop is a no-op',
  );
});

test('Two Category Template is a local two-row seed; KAL-436 Existing stays single Walls', () => {
  const route = read('src/DevTestRoute.jsx');
  assert.match(route, /id: 'kal436-two-category-template'/);
  assert.match(route, /name: 'Two Category Template'/);
  assert.match(route, /id: 'kal436-two-category-module'/);
  assert.match(route, /id: 'kal436-two-cat-walls'/);
  assert.match(route, /id: 'kal436-two-cat-windows'/);
  assert.match(route, /Local seed only \(not a cloud persist seam\)\. Two categories/);

  const two = route.slice(
    route.indexOf("id: 'kal436-two-category-template'"),
    route.indexOf('const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY'),
  );
  assert.match(two, /name: 'Walls'/);
  assert.match(two, /name: 'Windows'/);
  assert.doesNotMatch(two, /name: 'Doors'/);
  assert.ok(
    two.indexOf("name: 'Walls'") < two.indexOf("name: 'Windows'"),
    'seed stores Walls first',
  );

  const kal436 = route.slice(
    route.indexOf("id: 'kal436-template'"),
    route.indexOf("id: 'kal436-entities-template'"),
  );
  assert.doesNotMatch(kal436, /Two Category Template/);
  assert.doesNotMatch(kal436, /kal436-two-cat-windows/);
  assert.match(kal436, /modules: makeKal436Modules\(\)/);

  const existing = route.slice(
    route.indexOf('const makeKal436Modules = () => [{'),
    route.indexOf("id: 'kal436-other-module'"),
  );
  assert.match(existing, /name: 'Walls'/);
  assert.doesNotMatch(existing, /name: 'Windows'/);
  assert.doesNotMatch(existing, /name: 'Doors'/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /window\.__e2eSurveyCategoryOrder/);
  assert.match(rail, /selectedTemplate, not the static seed array/);
});
