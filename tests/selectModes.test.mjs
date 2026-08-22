import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSelectFamilyLabel,
  getSelectModeMenuFocusIndex,
  isSelectModeActive,
  loadSelectMode,
  saveSelectMode,
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
    assert.equal(isSelectModeActive(option, option.mode), true);
  }
});

test('the last Select-family mode survives reload and ignores invalid storage', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  saveSelectMode('lasso', storage);
  assert.equal(loadSelectMode(storage), 'lasso');
  saveSelectMode('text', storage);
  assert.equal(loadSelectMode(storage), 'text');

  values.set('lastSelectMode', 'not-a-mode');
  assert.equal(loadSelectMode(storage), 'rectangle');
  assert.equal(loadSelectMode({ getItem: () => { throw new Error('blocked'); } }), 'rectangle');
  assert.doesNotThrow(() => saveSelectMode('lasso', { setItem: () => { throw new Error('blocked'); } }));
});

test('Select mode menus wrap arrow keys and honor Home and End', () => {
  assert.equal(getSelectModeMenuFocusIndex('ArrowDown', 2, 3), 0);
  assert.equal(getSelectModeMenuFocusIndex('ArrowUp', 0, 3), 2);
  assert.equal(getSelectModeMenuFocusIndex('Home', 2, 3), 0);
  assert.equal(getSelectModeMenuFocusIndex('End', 0, 3), 2);
  assert.equal(getSelectModeMenuFocusIndex('Enter', 1, 3), null);
});
