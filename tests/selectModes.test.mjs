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
  SELECT_MODE_SHORT_LABELS,
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

  // DELIBERATE ASSERTION CHANGE (2026-09-16, icon-set consistency pass): the
  // selection-cursor hash moves because its stroke-width went 1.75 -> 1.5. Owner
  // ruling of this pass: the icons are ONE set and must share one stroke weight.
  // Select was the second-heaviest glyph in a rail whose lightest was 1.5 (a 33%
  // painted spread down one column). Nothing else about the asset changed, and
  // what this test actually guards — that the three Select-family modes keep
  // three distinct, locked assets — is untouched. The lasso and text-select
  // hashes are unchanged: both already resolve to ~1.5 through their scaled
  // groups.
  for (const [fileName, expectedHash] of [
    ['selection-cursor-rounded.svg', '0a438b4cf39a44e85607b9cd78d813a7e10ea2c0a49fa111b14ec77b2b9853ae'],
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

test('desktop Select arms the family and its modes are a segmented toggle', () => {
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved board 14,
  // ruling: "Select mode = Box / Lasso / Text segmented toggle using the app's
  // real glyphs; same on desktop"). The Select button was a split control with a
  // caret and a popover list of the three modes. It is now a plain 28px tool
  // button like every other one in the cluster — the cluster must never change
  // width when the armed tool changes — and the three modes are a segmented
  // toggle in Select's own settings, where all three are visible without opening
  // anything. So the caret, the indicator, the popover and its open/close
  // toggling are gone; what this test still guards is that the desktop uses ONE
  // integrated control for the family, that it draws the live mode's own glyph,
  // and that the desktop and the phone name the modes identically.
  const selectToolbar = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('// Select-family modes share one compact Drawboard-style button.'),
    APP_SHELL_SOURCE.indexOf('{/* Draw category */}'),
  );

  assert.match(selectToolbar, /data-select-mode-trigger/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-indicator/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-caret/);
  assert.doesNotMatch(selectToolbar, /getNextSelectModeMenuOpen/);
  assert.doesNotMatch(selectToolbar, /chrome-control--split/);
  // The trigger draws the live mode's glyph at the cluster's one glyph size.
  assert.match(selectToolbar, /getSelectFamilyIconName\(bottomToolbarApi\.activeTool, bottomToolbarApi\.selectionMode\)[\s\S]{0,80}size=\{CHROME_GLYPH\}/);

  // The three modes, as a segmented toggle on the settings side of the bar.
  const toggle = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('data-select-mode-toggle="true"'),
    APP_SHELL_SOURCE.indexOf('data-eraser-mode-toggle="true"'),
  );
  assert.match(toggle, /SELECT_MODE_OPTIONS\.map/);
  assert.match(toggle, /isSelectModeActive\(opt, bottomToolbarApi\.selectionMode\)/);
  assert.match(toggle, /aria-pressed=\{selected\}/);
  assert.match(toggle, /getSelectModeIconName\(opt\.mode\)\} size=\{12\}/);
  assert.match(toggle, /SELECT_MODE_SHORT_LABELS\[opt\.mode\]/);
  // B1: desktop uses the canonical label as the accessible name, as the phone does.
  assert.match(toggle, /aria-label=\{opt\.label\}/);
  assert.equal(SELECT_MODE_OPTIONS.find(option => option.mode === 'rectangle').label, 'Rectangle Select');
  assert.deepEqual(
    SELECT_MODE_OPTIONS.map(({ mode }) => SELECT_MODE_SHORT_LABELS[mode]),
    ['Box', 'Lasso', 'Text'],
  );
});

test('Draw uses the approved group icon at its optical size', () => {
  const drawToolbar = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('{/* Draw category */}'),
    APP_SHELL_SOURCE.indexOf('{/* Shapes category */}'),
  );

  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7): a chrome tool glyph is
  // CHROME_GLYPH (16 inside a 28px button), pinned as the shared constant.
  assert.match(drawToolbar, /<Icon name="drawGroup" size=\{CHROME_GLYPH\} \/>/);
});

test('Select family uses the larger optical sizes on mobile', () => {
  // 2026-09-16 phone sizing pass (owner ruling: one glyph size per tier, from
  // Drawboard's ratios). The Select chip is a rail tool like any other, so its
  // glyph is the rail constant instead of its own 21.
  //
  // RULED CHANGE 2026-09-16 (phone sweep; owner ruling "everything reads a
  // little big; sizing follows Drawboard's ratios uniformly"): RAIL_GLYPH is 17,
  // not 20. What this test protects is that the Select chip takes the rail's one
  // constant rather than a size of its own, and that still holds. The "larger on
  // mobile" in the title is now about the RATIO, not the raw number: the phone
  // chip is 30px against the desktop's 34px, and 17-in-30 (0.57) is a fuller
  // chip than the desktop's 18-in-34 (0.53).
  assert.match(MOBILE_CHROME_SOURCE, /const RAIL_GLYPH = 17;/);
  assert.match(MOBILE_CHROME_SOURCE, /getSelectFamilyIconName\(activeTool, bottomToolbarApi\?\.selectionMode\)\} size=\{RAIL_GLYPH\}/);
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
