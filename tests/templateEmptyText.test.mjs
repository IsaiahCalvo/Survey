import test from 'node:test';
import assert from 'node:assert/strict';
import { templateCategoryEmptyText } from '../src/home/templateEmptyText.js';

test('no modules: points at adding a module, not at categories', () => {
  assert.equal(templateCategoryEmptyText(0), 'No modules yet. Add a module to start.');
});
test('a module with no categories keeps the category hint', () => {
  assert.equal(templateCategoryEmptyText(2), 'This module has no categories yet.');
});
