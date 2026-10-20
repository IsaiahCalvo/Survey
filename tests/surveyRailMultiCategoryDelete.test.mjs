// KAL-501: in the Survey rail, ticking Cameras AND Doors and clicking Delete
// only deleted Doors. The rail called deleteCategory once per category and
// each call started from the same old template, so the last call won.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { removeCategoriesFromModules, toCategoryIdList } from '../src/utils/surveyCategoryDelete.js';

const RAIL = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
const PDF_VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

const modules = () => [
  { id: 'mod-a', categories: [{ id: 'c-cam', name: 'Cameras' }, { id: 'c-door', name: 'Doors' }, { id: 'c-wall', name: 'Walls' }] },
  { id: 'mod-b', categories: [{ id: 'c-cam', name: 'Cameras' }] },
];

test('two categories ticked together both go away in one pass', () => {
  const source = modules();
  const result = removeCategoriesFromModules(source, 'mod-a', ['c-cam', 'c-door']);
  assert.equal(result.changed, true);
  assert.deepEqual(result.modules[0].categories.map((c) => c.id), ['c-wall']);
  assert.deepEqual(result.removedIds.sort(), ['c-cam', 'c-door']);
  // Other modules keep their categories, even one with the same id.
  assert.equal(result.modules[1], source[1]);
  // The input is never changed.
  assert.equal(source[0].categories.length, 3);
});

test('one id still works, and ids that match nothing change nothing', () => {
  const source = modules();
  assert.deepEqual(removeCategoriesFromModules(source, 'mod-a', 'c-door').modules[0].categories.map((c) => c.id), ['c-cam', 'c-wall']);
  const none = removeCategoriesFromModules(source, 'mod-a', ['nope']);
  assert.equal(none.changed, false);
  assert.equal(none.modules, source);
  assert.equal(removeCategoriesFromModules(source, '', ['c-cam']).changed, false);
  assert.equal(removeCategoriesFromModules(source, 'mod-a', []).changed, false);
  assert.deepEqual(toCategoryIdList(['a', 'a', null, '', 'b']), ['a', 'b']);
  assert.deepEqual(toCategoryIdList('a'), ['a']);
});

test('the rail deletes all ticked categories with ONE deleteCategory call, after the loop', () => {
  const start = RAIL.indexOf('const deleteSelectedCategories = async');
  assert.ok(start > 0, 'category delete handler found');
  const body = RAIL.slice(start, RAIL.indexOf('setSelectedCategories({});', start));
  const calls = body.match(/deleteCategory\(/g) || [];
  assert.equal(calls.length, 1, 'exactly one deleteCategory call');
  assert.match(body, /deleteCategory\(selectedModuleId, selectedCatIds\)/);
  const loopEnd = body.lastIndexOf('});', body.indexOf('deleteCategory('));
  assert.ok(body.indexOf('selectedCatIds.forEach') < loopEnd, 'the call comes after the per-category loop');
});

test('the viewer handler removes every given category from one template', () => {
  const start = PDF_VIEWER.indexOf('const handleDeleteSurveyCategoryDefinition = useCallback(');
  assert.ok(start > 0);
  const body = PDF_VIEWER.slice(start, PDF_VIEWER.indexOf('}, [selectedTemplate', start));
  assert.match(body, /toCategoryIdList\(categoryIdOrIds\)/);
  assert.match(body, /removeCategoriesFromModules\(sourceModules, moduleId, categoryIds\)/);
  assert.match(body, /categoryIds\.includes\(current\)/, 'the open category closes if it was one of them');
});
