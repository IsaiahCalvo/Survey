import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  getSelectFamilyIconName,
  getSelectFamilyLabel,
  getSelectModeIconName,
  getSelectFamilyTransition,
  getSelectModeMenuFocusIndex,
  isSelectModeActive,
  loadSelectMode,
  saveSelectMode,
  SELECT_MODE_OPTIONS,
} from '../src/utils/selectModes.js';

const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('Select family keeps rectangle, lasso, and text in one stable mode list', () => {
  assert.deepEqual(SELECT_MODE_OPTIONS.map(({ mode, label }) => ({ mode, label })), [
    { mode: 'rectangle', label: 'Rectangle Select' },
    { mode: 'lasso', label: 'Lasso Select' },
    { mode: 'text', label: 'Text Select' },
  ]);
  assert.deepEqual(getSelectFamilyTransition('lasso'), {
    activeTool: 'select',
    selectionMode: 'lasso',
  });
  assert.deepEqual(getSelectFamilyTransition('not-a-mode'), {
    activeTool: 'select',
    selectionMode: 'rectangle',
  });
});

test('the stored mode owns the main Select label and checked menu row', () => {
  for (const option of SELECT_MODE_OPTIONS) {
    assert.equal(getSelectFamilyLabel('pan', option.mode), option.label);
    assert.equal(isSelectModeActive(option, option.mode), true);
  }
});

test('Select family keeps distinct approved icons without changing its transitions', () => {
  assert.equal(getSelectModeIconName('rectangle'), 'selectCursor');
  assert.equal(getSelectModeIconName('lasso'), 'lassoSelect');
  assert.equal(getSelectModeIconName('text'), 'textSelect');
  assert.equal(getSelectModeIconName('not-a-mode'), 'selectCursor');
  assert.equal(getSelectFamilyIconName('select', 'rectangle'), 'selectCursor');
  assert.equal(getSelectFamilyIconName('select', 'lasso'), 'lassoSelect');
  assert.equal(getSelectFamilyIconName('text-select', 'rectangle'), 'textSelect');

  for (const [fileName, expectedHash] of [
    ['selection-cursor-rounded.svg', 'bdccc5826285d0f6b00de134bd0febd34235255cc196f15225b91c0e05428722'],
    ['lasso-select-rounded.svg', 'f364ce22bb11524edf56e4035a894d67dc61297fd8455e58db8010d5cad974a9'],
    ['text-select-rounded.svg', 'b84a5baa309abbf8ed10d177f57c2d14f4f7cffe4df67c1785028c46d682b541'],
  ]) {
    const bytes = readFileSync(new URL(`../src/assets/icons/${fileName}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
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

test('creating or toggling a text mark keeps the live Text Select range active', () => {
  const textSelect = getSelectFamilyTransition('text');
  assert.deepEqual(textSelect, { activeTool: 'text-select', selectionMode: 'text' });

  const createHandler = PDF_VIEWER_SOURCE.slice(
    PDF_VIEWER_SOURCE.indexOf('const handleTextSelectionAction = useCallback'),
    PDF_VIEWER_SOURCE.indexOf('const isImportedSelectDeleteOnlyTextMarkupSelection'),
  );
  assert.doesNotMatch(createHandler, /activateSelectFamilyMode\('rectangle'\)/);
  assert.doesNotMatch(createHandler, /clearLiveTextSelection\(\)/);
  assert.match(createHandler, /text-markup:toggle-off-live-selection/);
  assert.ok(
    (createHandler.match(/restorePdfjsTextSelection\(selection\)/g) || []).length >= 2,
    'both a live toggle-off and a live create must restore the saved browser range',
  );
});

test('pan quick-pick leaves a saved Text Select mode in truthful rectangle object selection', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  saveSelectMode('text', storage);
  assert.equal(loadSelectMode(storage), 'text');

  const quickPickedObject = getSelectFamilyTransition('rectangle');
  assert.deepEqual(quickPickedObject, { activeTool: 'select', selectionMode: 'rectangle' });

  const quickPickHandler = PDF_VIEWER_SOURCE.slice(
    PDF_VIEWER_SOURCE.indexOf('// UX: pan-mode quick-click → select annotation'),
    PDF_VIEWER_SOURCE.indexOf('// UX: pan-mode hover —'),
  );
  assert.equal((quickPickHandler.match(/activateSelectFamilyMode\('rectangle'\)/g) || []).length, 2);
});

test('V and Shift+V use the same truthful Select-family transition as reload', () => {
  assert.deepEqual(getSelectFamilyTransition('rectangle'), {
    activeTool: 'select',
    selectionMode: 'rectangle',
  });
  assert.deepEqual(getSelectFamilyTransition('text'), {
    activeTool: 'text-select',
    selectionMode: 'text',
  });

  const keyboardStart = PDF_VIEWER_SOURCE.indexOf('// Keyboard shortcuts');
  const keyboardHandler = PDF_VIEWER_SOURCE.slice(keyboardStart, keyboardStart + 10_000);
  assert.match(keyboardHandler, /activateSelectFamilyMode\('rectangle'\)/);
  assert.match(keyboardHandler, /activateSelectFamilyMode\('text'\)/);
});
