// Owner rule (2026-10-27): act first + Undo, never a confirm. Deleting a
// Survey category takes its Survey Markers with it at once; the toast's Undo
// puts the categories back where they were and brings their markers back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { removeCategoriesFromModules, restoreCategoriesToModules } from '../src/utils/surveyCategoryDelete.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const VIEWER = read('PDFViewer.jsx');
const RAIL = read('SurveySpacesRail.jsx');

const modules = () => [
  { id: 'm1', categories: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }] },
  { id: 'm2', categories: [{ id: 'x', name: 'X' }] },
];

test('a delete reports what went and where, and Undo puts each back in its place', () => {
  const source = modules();
  const { modules: after, removed } = removeCategoriesFromModules(source, 'm1', ['b', 'd']);
  assert.deepEqual(removed.map(({ category, index }) => [category.id, index]), [['b', 1], ['d', 3]]);
  const back = restoreCategoriesToModules(after, 'm1', removed);
  assert.equal(back.changed, true);
  assert.deepEqual(back.modules[0].categories.map((c) => c.id), ['a', 'b', 'c', 'd']);
  assert.equal(back.modules[1], after[1], 'other modules are untouched');
  assert.deepEqual(source[0].categories.map((c) => c.id), ['a', 'b', 'c', 'd'], 'input is not changed');
});

test('Undo twice, or after the list changed, never duplicates or loses a category', () => {
  const { modules: after, removed } = removeCategoriesFromModules(modules(), 'm1', ['a']);
  const once = restoreCategoriesToModules(after, 'm1', removed);
  const twice = restoreCategoriesToModules(once.modules, 'm1', removed);
  assert.equal(twice.changed, false);
  assert.equal(twice.modules, once.modules);
  // The list got shorter meanwhile: the category goes back at the end.
  const shorter = [{ id: 'm1', categories: [] }];
  assert.deepEqual(restoreCategoriesToModules(shorter, 'm1', [{ category: { id: 'z' }, index: 5 }]).modules[0].categories.map((c) => c.id), ['z']);
  assert.equal(restoreCategoriesToModules(shorter, 'm1', []).changed, false);
});

test('the viewer deletes at once, takes the markers through the marker delete, and offers Undo', () => {
  const start = VIEWER.indexOf('const handleDeleteSurveyCategoriesWithUndo = useCallback(');
  assert.ok(start > 0);
  const body = VIEWER.slice(start, VIEWER.indexOf('}, [selectedTemplate, handleDeleteSurveyCategoryDefinition', start));
  assert.match(body, /isUserLocked\(record\)/, 'a locked marker blocks the delete');
  assert.match(body, /if \(!handleDeleteSurveyCategoryDefinition\(moduleId, categoryIds\)\) return;/);
  // The family action runs the established marker delete (the ✕'s: takes the
  // box off the page, trashes it, reports a refusal) without a timeline step.
  assert.match(body, /changes: markers\.map\(\(\{ id, record \}\) => \(\{ id, before: record, after: null \}\)\)/);
  const family = VIEWER.slice(VIEWER.indexOf('const applySurveyMarkerFamilyAction = useCallback('));
  assert.match(family, /handleSurveyMarkerDeletedRef\.current\(record\.pageNumber, record\.bounds, change\.id\)/);
  assert.match(body, /onUndo: \(\) => restoreSurveyCategoriesRef\.current\?\.\(moduleId, removed, markers\)/);
  const restore = VIEWER.slice(VIEWER.indexOf('const handleRestoreSurveyCategories = useCallback('), start);
  assert.match(restore, /restoreCategoriesToModules\(sourceModules, moduleId, removed\)/);
  assert.match(restore, /updateSupabaseTemplate\(templateId,/, 'the restored template is saved');
  assert.match(restore, /changes: missing\.map\(\(\{ id, record \}\) => \(\{ id, before: null, after: record \}\)\)/);
  assert.match(VIEWER, /deleteCategory: handleDeleteSurveyCategoriesWithUndo,/);
});

test('every rail category delete (swipe, right-click, select mode) acts at once', () => {
  assert.doesNotMatch(RAIL, /This deletes the category and its Survey Markers/);
  assert.doesNotMatch(RAIL, /and all items within/);
  assert.match(RAIL, /onDelete: \(\) => deleteCategory\(selectedModuleId, category\.id\),/);
  assert.match(RAIL, /onClick: \(\) => deleteCategory\(selectedModuleId, listContextMenu\.id\) \},/);
  assert.match(RAIL, /onClick: \(\) => deleteSurveyMarkerNow\(listContextMenu\.id, listContextMenu\.name\) \},/);
});
