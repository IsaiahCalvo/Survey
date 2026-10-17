import test from 'node:test';
import assert from 'node:assert/strict';
import { moveSurveyCategories } from '../src/utils/surveyCategoryMove.js';
const category = { id: 'c', name: 'Walls', checklist: [{ id: 'q', text: 'Done?' }] };
const template = { id: 't', modules: [{ id: 'a', categories: [category] }, { id: 'b', categories: [] }] };
test('category move keeps marker identity, answers, media and geometry', () => {
  const marker = { moduleId: 'a', categoryId: 'c', pageNumber: 2, bounds: { x: 12, y: 18 }, checklistResponses: { q: { selection: 'Y', note: { text: 'Keep', photos: ['p'] } } } };
  const other = { moduleId: 'b', categoryId: 'c', name: 'Unrelated' };
  const result = moveSurveyCategories(template, { mark: marker, other }, 'a', 'b', ['c']);
  assert.equal(result.ok, true);
  assert.equal(result.template.modules[0].categories.length, 0);
  assert.strictEqual(result.template.modules[1].categories[0], category);
  assert.deepEqual(result.markers.mark, { ...marker, moduleId: 'b' });
  assert.strictEqual(result.markers.other, other);
  assert.equal(marker.moduleId, 'a');
  assert.equal(template.modules[0].categories.length, 1);
});
test('move rejects missing or duplicate destinations without changing data', () => {
  assert.equal(moveSurveyCategories(template, {}, 'a', 'a', ['c']).ok, false);
  assert.equal(moveSurveyCategories(template, {}, 'a', 'b', ['missing']).ok, false);
  const collision = { ...template, modules: [template.modules[0], { id: 'b', categories: [{ id: 'different', name: 'walls' }] }] };
  assert.equal(moveSurveyCategories(collision, {}, 'a', 'b', ['c']).ok, false);
});
