import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSelectFamilyLabel,
  isSelectModeActive,
  SELECT_MODE_OPTIONS,
} from '../src/utils/selectModes.js';

test('Select family keeps rectangle, lasso, and text in one stable mode list', () => {
  assert.deepEqual(SELECT_MODE_OPTIONS.map(({ mode, label }) => ({ mode, label })), [
    { mode: 'rectangle', label: 'Rectangle Select' },
    { mode: 'lasso', label: 'Lasso Select' },
    { mode: 'text', label: 'Text Select' },
  ]);
});

test('the stored mode owns the main Select label and checked menu row', () => {
  for (const option of SELECT_MODE_OPTIONS) {
    assert.equal(getSelectFamilyLabel('pan', option.mode), option.label);
    assert.equal(isSelectModeActive(option, 'pan', option.mode), true);
  }
});
