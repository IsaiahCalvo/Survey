import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  getSelectFamilyIconName,
  getSelectFamilyLabel,
  getSelectModeIconName,
  getNextSelectModeMenuOpen,
  getSelectFamilyTransition,
  getSelectModeMenuFocusIndex,
  isSelectModeActive,
  loadSelectMode,
  saveSelectMode,
  SELECT_MODE_OPTIONS,
} from '../src/utils/selectModes.js';

const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const APP_SHELL_SOURCE = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const MOBILE_CHROME_SOURCE = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

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
  assert.deepEqual(SELECT_MODE_OPTIONS.map(({ mode, hint }) => ({ mode, hint })), [
    { mode: 'rectangle', hint: 'V' },
    { mode: 'lasso', hint: 'Alt+V' },
    { mode: 'text', hint: '⇧V' },
  ]);
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
    ['selection-cursor-rounded.svg', '5b84e601f810c906dfe32d464b9d175e0d18db794b4be0c0251aa8455cb80a01'],
    ['lasso-select-rounded.svg', '9fe83afeef1c13c09aa557728badf71696341213210b5b2924e1becba8e50d22'],
    ['text-select-rounded.svg', '7f75647ee4d328ec68eb867dfde598019fe1537db3861a7014273b812a80192e'],
  ]) {
    const bytes = readFileSync(new URL(`../src/assets/icons/${fileName}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
  }

  const textSelectSource = readFileSync(new URL('../src/assets/icons/text-select-rounded.svg', import.meta.url), 'utf8');
  assert.match(textSelectSource, /translate\(12 12\.6\)/);
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

test('the full Select trigger opens in one click and toggles once active', () => {
  assert.equal(getNextSelectModeMenuOpen(false, false), true);
  assert.equal(getNextSelectModeMenuOpen(true, false), true);
  assert.equal(getNextSelectModeMenuOpen(false, true), true);
  assert.equal(getNextSelectModeMenuOpen(true, true), false);

  let open = false;
  for (let index = 0; index < 1000; index += 1) {
    open = getNextSelectModeMenuOpen(open, true);
    assert.equal(open, index % 2 === 0);
  }
});

test('desktop Select uses one integrated Drawboard-style mode trigger', () => {
  const selectToolbar = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('// Select-family modes share one compact Drawboard-style button.'),
    APP_SHELL_SOURCE.indexOf('{/* Draw category */}'),
  );

  assert.match(selectToolbar, /data-select-mode-trigger/);
  assert.match(selectToolbar, /data-select-mode-indicator/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-caret/);
  assert.doesNotMatch(selectToolbar, /indicatorClick|event\.target\.closest/);
  assert.match(selectToolbar, /getNextSelectModeMenuOpen\(open, isActive\)/);
  assert.match(selectToolbar, /backgroundColor: '#1E1E1E'/);
  assert.doesNotMatch(selectToolbar, /background: selected \? '#1f2430'/);
  // B1: desktop uses the canonical label, just like the trigger and mobile sheet.
  assert.match(selectToolbar, /<span>\{opt\.label\}<\/span>/);
  assert.equal(SELECT_MODE_OPTIONS.find(option => option.mode === 'rectangle').label, 'Rectangle Select');
  assert.match(selectToolbar, /size=\{isSelect \? 22 : 20\}/);
  assert.match(selectToolbar, /getSelectModeIconName\(opt\.mode\)\} size=\{20\}/);
});

test('Draw uses the approved group icon at its optical size', () => {
  const drawToolbar = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('{/* Draw category */}'),
    APP_SHELL_SOURCE.indexOf('{/* Shapes category */}'),
  );

  assert.match(drawToolbar, /<Icon name="drawGroup" size=\{18\} \/>/);
});

test('Select family uses the larger optical sizes on mobile', () => {
  assert.match(MOBILE_CHROME_SOURCE, /getSelectFamilyIconName\(activeTool, bottomToolbarApi\?\.selectionMode\)\} size=\{21\}/);
  assert.match(MOBILE_CHROME_SOURCE, /getSelectModeIconName\(option\.mode\)\} size=\{19\}/);
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
