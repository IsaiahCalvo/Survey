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
  SELECTION_KEEPING_TOOLS,
  getToolSwitchSelectionClearReason,
  shouldBackdropPressDeselect,
  shouldEscapeDeselect,
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
    ['lasso-select-rounded.svg', '4426e3be98a00ae3d9c69644ccfa970007fa3a7f69f5bddb093b7977be6f988e'],
    ['text-select-rounded.svg', '206d7331013546f58733846df696525c106d42b574ed2cca4135caa58e3b5843'],
  ]) {
    const bytes = readFileSync(new URL(`../src/assets/icons/${fileName}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
  }

  // DELIBERATE ASSERTION CHANGE (2026-10-02, Select-trio optical balance; owner:
  // "Lasso looks smaller than Rectangular, Text Select looks even smaller").
  // The lasso and text-select hashes move because both assets were redrawn to
  // read the same size as Box Select: the lasso's cursor 0.65 -> 0.72 scale
  // with longer dashes, the text-select I-beam and field 0.75 -> 0.9 scale and
  // centred on the grid (its old fixed 2px CSS drop is gone). Box Select is
  // untouched. Still guarded: three distinct, locked assets. The old pin on
  // text-select's outer translate(12 12.6) group is replaced by the placement
  // that matters — its I-beam group drawn at 0.9, centred, with no outer group.
  const textSelectSource = readFileSync(new URL('../src/assets/icons/text-select-rounded.svg', import.meta.url), 'utf8');
  assert.match(textSelectSource, /<g transform="translate\(1\.2 -\.85\) scale\(\.9\)"/);
  assert.doesNotMatch(textSelectSource, /translate\(12 12\.6\)/);
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

  // DELIBERATE ASSERTION CHANGE (2026-09-22, board 14 owner ruling: "no split
  // button/caret/popover on the Select tool"). The hook was named
  // data-select-mode-trigger because the button opened the mode menu. The menu,
  // its anchor state and its outside-click watcher are gone, so the button is
  // just the Select tool and the hook says so: data-select-tool.
  assert.match(selectToolbar, /data-select-tool/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-trigger/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-indicator/);
  assert.doesNotMatch(selectToolbar, /data-select-mode-caret/);
  assert.doesNotMatch(selectToolbar, /getNextSelectModeMenuOpen/);
  assert.doesNotMatch(selectToolbar, /chrome-control--split/);
  // The trigger draws the live mode's glyph at the cluster's one glyph size.
  assert.match(selectToolbar, /getSelectFamilyIconName\(bottomToolbarApi\.activeTool, bottomToolbarApi\.selectionMode\)[\s\S]{0,80}size=\{CHROME_GLYPH\}/);

  // The three modes, as a group of tool buttons.
  const toggle = APP_SHELL_SOURCE.slice(
    APP_SHELL_SOURCE.indexOf('data-select-mode-toggle="true"'),
    APP_SHELL_SOURCE.indexOf('data-eraser-mode-toggle="true"'),
  );
  assert.match(toggle, /SELECT_MODE_OPTIONS\.map/);
  assert.match(toggle, /isSelectModeActive\(opt, bottomToolbarApi\.selectionMode\)/);
  assert.match(toggle, /aria-pressed=\{selected\}/);
  // DELIBERATE ASSERTION CHANGE — RULED 2026-09-26 owner: select modes in top
  // bar (w46). Box / Lasso / Text are tools beside the group icons now, drawn
  // exactly like pen / highlighter / eraser: the shared tool button, the shared
  // glyph size, the gold glyph for the live one — no segmented well and no
  // words (board 14's 12px glyph + short label). The full name stays the
  // tooltip and accessible name (asserted below).
  assert.match(toggle, /className=\{`btn chrome-subcontrol \$\{selected \? 'btn-active' : 'btn-ghost'\}`\}/);
  assert.match(toggle, /getSelectModeIconName\(opt\.mode\)\} size=\{CHROME_GLYPH\}/);
  assert.doesNotMatch(toggle.slice(0, toggle.indexOf('const toolbarOverflowItems')), /chrome-segmented/);
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
  //
  // DELIBERATE ASSERTION CHANGE (2026-09-22, board 7 owner ruling: "NO pop-up").
  // The third line pinned the 19px glyph in a row of the phone's selection-mode
  // FLYOUT. That flyout is deleted, so the three modes are drawn by the strip's
  // segmented toggle instead, at the strip's own STRIP_GLYPH.
  assert.match(MOBILE_CHROME_SOURCE, /const RAIL_GLYPH = 17;/);
  assert.match(MOBILE_CHROME_SOURCE, /getSelectFamilyIconName\(activeTool, bottomToolbarApi\?\.selectionMode\)\} size=\{RAIL_GLYPH\}/);
  assert.match(MOBILE_CHROME_SOURCE, /icon: getSelectModeIconName\('rectangle'\)/);
  assert.doesNotMatch(MOBILE_CHROME_SOURCE, /getSelectModeIconName\(option\.mode\)/);
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
  // Owner 2026-10-02 (Drawboard rule 2): a Pan click picks the mark and Pan
  // STAYS armed — the quick-pick no longer switches to Select.
  assert.equal((quickPickHandler.match(/activateSelectFamilyMode\('rectangle'\)/g) || []).length, 0);
  assert.match(quickPickHandler, /setPendingSvgSelection\(\{/);
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

test('switching to a non-picking tool drops the selection; Pan / Select / Text Select keep it (owner 2026-10-02)', () => {
  assert.deepEqual([...SELECTION_KEEPING_TOOLS], ['pan', 'select', 'text-select']);
  // Drawing, shape, text, eraser and survey tools all clear.
  for (const next of ['pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'line', 'arrow', 'polygon', 'text', 'callout', 'counter', 'survey-marker', 'region-edit']) {
    assert.equal(getToolSwitchSelectionClearReason('select', next), 'tool-change', next);
    assert.equal(getToolSwitchSelectionClearReason('pan', next), 'tool-change', next);
  }
  // A just-drawn shape loses its handles when another drawing tool is picked.
  assert.equal(getToolSwitchSelectionClearReason('rect', 'pen'), 'tool-change');
  // Among the picking tools the selection stays.
  assert.equal(getToolSwitchSelectionClearReason('pan', 'select'), null);
  assert.equal(getToolSwitchSelectionClearReason('select', 'pan'), null);
  assert.equal(getToolSwitchSelectionClearReason('select', 'text-select'), null);
  assert.equal(getToolSwitchSelectionClearReason('rect', 'select'), null);
  assert.equal(getToolSwitchSelectionClearReason('callout', 'select'), null);
  // No change, no clear.
  assert.equal(getToolSwitchSelectionClearReason('select', 'select'), null);
  // Leaving Text Select keeps its older, stricter rule.
  assert.equal(getToolSwitchSelectionClearReason('text-select', 'select'), 'text-select-tool-change');
  assert.equal(getToolSwitchSelectionClearReason('text-select', 'pen'), 'text-select-tool-change');
});

test('the tool-switch rule runs in one effect on activeTool, and Escape listens under every tool', () => {
  assert.match(
    PDF_VIEWER_SOURCE,
    /const reason = getToolSwitchSelectionClearReason\(previousTool, activeTool, \{ source \}\);\s*if \(reason\) clearAnnotationSelectionForContextChange\(reason\);\s*\}, \[activeTool, clearAnnotationSelectionForContextChange\]\);/,
  );
  const escStart = PDF_VIEWER_SOURCE.indexOf('// UX: Escape and grey-page backdrop clicks clear every selection mode alike.');
  const escEffect = PDF_VIEWER_SOURCE.slice(escStart, PDF_VIEWER_SOURCE.indexOf('const textSelectGestureActiveRef', escStart));
  assert.doesNotMatch(escEffect, /if \(!\['select', 'text-select'\]\.includes\(activeTool\)\) return undefined;/);
  assert.match(escEffect, /const escapeDeselects = shouldEscapeDeselect\(activeTool\);/);
  assert.match(escEffect, /const backdropDeselects = shouldBackdropPressDeselect\(activeTool\);/);
  assert.match(escEffect, /if \(escapeDeselects\) window\.addEventListener\('keydown', clear, true\);\s*if \(backdropDeselects\) window\.addEventListener\('pointerdown', clear, true\);/);
  for (const tool of ['pan', 'select', 'text-select', 'pen', 'rect', 'text', 'eraser', 'survey-marker']) {
    assert.equal(shouldEscapeDeselect(tool), true, tool);
  }
  assert.equal(shouldBackdropPressDeselect('select'), true);
  assert.equal(shouldBackdropPressDeselect('text-select'), true);
  assert.equal(shouldBackdropPressDeselect('pen'), false);
  assert.equal(shouldBackdropPressDeselect('pan'), false);
});

test('the rotation grabber has no connector line to the box (owner 2026-10-02)', () => {
  const overlay = readFileSync(new URL('../src/components/SVGSelectionOverlay.jsx', import.meta.url), 'utf8');
  const region = readFileSync(new URL('../src/RegionSelectionTool.jsx', import.meta.url), 'utf8');
  const fabricCustom = readFileSync(new URL('../src/utils/fabricCustomization.js', import.meta.url), 'utf8');
  for (const [name, src] of [['SVGSelectionOverlay', overlay], ['RegionSelectionTool', region]]) {
    const start = src.search(/\n\s+data-rotation-handle="mtr"|<g className="rotation-handle" data-rotation-handle="mtr"/);
    assert.notEqual(start, -1, name);
    const group = src.slice(start, src.indexOf('</g>', start));
    assert.doesNotMatch(group, /<line\b/, `${name} rotation group draws no <line>`);
    assert.match(group, /<circle/, `${name} keeps the grabber circle`);
  }
  assert.match(fabricCustom, /standardControls\.mtr\.withConnection = false;/);
});

// ---------------------------------------------------------------------------
// Drawboard PDF rules 1-13 (owner 2026-10-02; study scratchpad/drawboard2/RULES.md).
// One rule table (utils/selectModes.js); each test pins one rule and the place
// the app asks it.
// ---------------------------------------------------------------------------
const SVG_LAYER_SOURCE = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const INTERACTION_SOURCE = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
const GRAB_SOURCE = readFileSync(new URL('../src/hooks/useSelectionGrabHandoff.js', import.meta.url), 'utf8');
const ERASER_SOURCE = readFileSync(new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url), 'utf8');
const TEXT_EDIT_SOURCE = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');
const STYLES_SOURCE = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const rules = await import('../src/utils/selectModes.js');
const presence = await import('../src/utils/pageSelectionPresence.js');
const routing = await import('../src/utils/toolPressRouting.js');
const press = (tool, target, hasSelection = false, shiftKey = false) => rules.resolveToolPress({ tool, target, hasSelection, shiftKey });

test('rule 1: every tool has one class', () => {
  const expected = {
    select: 'select', 'text-select': 'select', pan: 'select', rect: 'select', ellipse: 'select', line: 'select', arrow: 'select', callout: 'select',
    pen: 'ink', highlighter: 'ink', polygon: 'point', polyline: 'point', eraser: 'eraser', text: 'text',
    counter: 'place', 'survey-marker': 'place', 'region-edit': 'other',
  };
  for (const [tool, cls] of Object.entries(expected)) assert.equal(rules.getToolSelectionClass(tool), cls, tool);
  assert.deepEqual([...rules.SHAPE_DRAW_TOOLS], ['rect', 'ellipse', 'line', 'arrow', 'callout']);
});

test('rule 2: a click on any mark with a select-capable tool picks it; the halo shows for them only', () => {
  for (const tool of rules.TOOL_CLASSES.select) {
    for (const target of ['mark', 'text']) assert.equal(press(tool, target).click, 'select', `${tool} ${target}`);
    assert.equal(rules.shouldShowHoverHalo(tool), true, tool);
  }
  for (const tool of ['pen', 'highlighter', 'polygon', 'polyline', 'text', 'eraser', 'counter']) assert.equal(rules.shouldShowHoverHalo(tool), false, tool);
  // the drawing surface asks the table on every press that is not on the selection
  assert.match(SVG_LAYER_SOURCE, /const press = resolvePagePress\(e\.nativeEvent, \{/);
  assert.match(SVG_LAYER_SOURCE, /state\.pressFallback && state\.startClient[\s\S]{0,200}< CLICK_PLACE_MAX_TRAVEL_PX\)[\s\S]{0,300}applyPressFallbackRef\.current\?\.\(state\.pressFallback\)/);
  // Pan picks and STAYS Pan; the shape tools' halo comes from the same hover effect
  assert.match(PDF_VIEWER_SOURCE, /const haloByPosition = activeTool === 'pan' \|\| activeTool === 'eraser'/);
});

test('rule 3: a drag is the tool\'s own job unless it starts on the selection', () => {
  assert.deepEqual(press('select', 'mark'), { drag: 'box-select', click: 'select', clearsSelection: false });
  assert.equal(press('pan', 'mark').drag, 'pan');
  for (const tool of rules.SHAPE_DRAW_TOOLS) assert.equal(press(tool, 'mark').drag, 'draw', tool);
  for (const tool of ['select', 'pan', 'rect', 'pen', 'highlighter', 'polygon', 'eraser', 'text', 'counter']) {
    assert.deepEqual(press(tool, 'selection', true), { drag: 'manipulate', click: 'keep', clearsSelection: false }, tool);
  }
  // Select: a press on an unselected mark picks it and starts a box / lasso, never a move
  assert.match(INTERACTION_SOURCE, /if \(!wasAlreadySelected && activeTool === 'select' && svgRef\.current\) \{\s*beginAreaSelectFromMark\(e\);/);
  assert.match(INTERACTION_SOURCE, /if \(!e\.shiftKey && !_calAlreadyIn && activeTool === 'select'[\s\S]{0,300}beginAreaSelectFromMark\(e\);/);
  assert.match(INTERACTION_SOURCE, /const beginAreaSelectFromMark = useCallback\(\(e\) => \{[\s\S]{0,1400}keepOnClick: true/);
  assert.match(INTERACTION_SOURCE, /if \(!mq\.shiftHeld && !mq\.keepOnClick\)/);
  assert.match(INTERACTION_SOURCE, /if \(!lasso\.shiftHeld && !lasso\.keepOnClick\)/);
  // under every other tool the selection is handed its own press
  assert.match(SVG_LAYER_SOURCE, /enabled: pageHasSelection && !isSelectFamilyTool\(activeTool\)/);
  assert.match(SVG_LAYER_SOURCE, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select' \|\| selectionGrabArmed\)/);
  assert.match(GRAB_SOURCE, /hit\.dispatchEvent\(new PointerEvent\('pointerdown', init\)\)/);
});

test('rule 4: ink never picks, ignores Shift, and a press off the selection clears it and draws', () => {
  for (const tool of ['pen', 'highlighter']) {
    for (const target of ['mark', 'text', 'empty']) {
      assert.deepEqual(press(tool, target, false, true), { drag: 'draw', click: 'tool', clearsSelection: false }, `${tool} ${target}`);
      assert.equal(press(tool, target, true).clearsSelection, true);
    }
  }
});

test('rule 5: the eraser erases, drops the selection, and never erases what was selected', () => {
  assert.deepEqual(press('eraser', 'mark', true), { drag: 'erase', click: 'tool', clearsSelection: true });
  presence.setEraseSparedIds(new Set(['keep-me']));
  assert.equal(presence.isEraseSpared({ id: 'keep-me', data: { id: 'keep-me' } }), true);
  assert.equal(presence.isEraseSpared({ id: 'other', data: { id: 'other' } }), false);
  presence.setEraseSparedIds(null);
  assert.equal(presence.isEraseSpared({ id: 'keep-me', data: { id: 'keep-me' } }), false);
  assert.match(ERASER_SOURCE, /if \(isEraseSpared\(object\)\) return 'selected';/);
  assert.match(PDF_VIEWER_SOURCE, /setEraseSparedIds\(getAllSelectedItemIds\(\)\);/);
});

test('rule 6: the Text tool makes a box only with nothing selected', () => {
  for (const target of ['mark', 'text', 'empty']) assert.equal(press('text', target, false).click, 'new-text', target);
  assert.equal(press('text', 'text', true).click, 'edit');
  assert.equal(press('text', 'mark', true).click, 'select');
  assert.deepEqual(press('text', 'empty', true), { drag: 'none', click: 'deselect', clearsSelection: true });
  assert.match(PDF_VIEWER_SOURCE, /const press = resolveToolPress\(\{ tool: 'text', target: where\.target, hasSelection: true \}\);/);
  // a click on existing text no longer opens it when nothing is selected
  assert.doesNotMatch(PDF_VIEWER_SOURCE, /Click \(not drag\): check if an existing text annotation was hit/);
});

test('rule 7: a double-click edits selected text under any tool; unselected text only gets picked (a double-tap edits)', () => {
  for (const tool of ['select', 'pan', 'rect', 'pen', 'eraser', 'counter', 'text']) {
    assert.equal(rules.resolveTextDoubleClick({ tool, wasSelected: true }), 'edit', tool);
  }
  for (const tool of ['select', 'pan', 'rect', 'arrow']) {
    assert.equal(rules.resolveTextDoubleClick({ tool, wasSelected: false, pointerType: 'mouse' }), 'select', tool);
    assert.equal(rules.resolveTextDoubleClick({ tool, wasSelected: false, pointerType: 'touch' }), 'edit', tool);
  }
  assert.equal(rules.resolveTextDoubleClick({ tool: 'text-select', wasSelected: false }), 'edit');
  assert.equal(rules.resolveTextDoubleClick({ tool: 'pen', wasSelected: false }), 'tool');
  assert.match(INTERACTION_SOURCE, /resolveTextDoubleClick\(\{ tool: activeTool, wasSelected, pointerType \}\) !== 'edit'/);
  assert.match(PDF_VIEWER_SOURCE, /resolveTextDoubleClick\(\{ tool: firstTapTool, wasSelected: target\.wasSelected, pointerType: event\.pointerType \}\) !== 'edit'/);
});

test('rule 8: Shift-click adds under select-capable tools only', () => {
  for (const tool of rules.TOOL_CLASSES.select) assert.equal(press(tool, 'mark', true, true).click, 'add', tool);
  for (const tool of ['pen', 'highlighter', 'polygon', 'eraser']) assert.notEqual(press(tool, 'mark', true, true).click, 'add', tool);
});

test('rule 9: after a new shape, a click on empty page only drops it; with nothing picked a Line click is its own', () => {
  for (const tool of rules.SHAPE_DRAW_TOOLS) assert.equal(press(tool, 'empty', true).click, 'deselect', tool);
  assert.equal(press('line', 'empty', false).click, 'tool');
  assert.equal(press('polygon', 'empty', true).click, 'deselect');
  assert.equal(press('polygon', 'empty', false).click, 'tool');
});

test('rule 10: Escape closes, commits, cancels, deselects, then puts the tool down; Delete and undo', () => {
  assert.equal(rules.resolveEscape({ popoverOpen: true, editing: true, hasSelection: true, tool: 'rect' }), 'close-popover');
  assert.equal(rules.resolveEscape({ editing: true, hasSelection: true, tool: 'rect' }), 'commit-edit');
  assert.equal(rules.resolveEscape({ draft: true, hasSelection: true, tool: 'rect' }), 'cancel-draft');
  assert.equal(rules.resolveEscape({ hasSelection: true, tool: 'rect' }), 'deselect');
  assert.equal(rules.resolveEscape({ tool: 'rect' }), 'switch-to-pan');
  assert.equal(rules.resolveEscape({ tool: 'pan' }), null);
  assert.equal(rules.shouldDeleteKeyRemoveSelection('pen', true), true);
  assert.equal(rules.shouldDeleteKeyRemoveSelection('pen', false), false);
  assert.deepEqual({ ...rules.UNDO_SELECTION_RULE }, { keepsSelection: true, addsSelection: false });
  assert.match(PDF_VIEWER_SOURCE, /if \(escapeAction === 'switch-to-pan'\) \{[\s\S]{0,200}if \(!event\.defaultPrevented\) setActiveToolLogged\('pan'/);
  assert.match(TEXT_EDIT_SOURCE, /commitRef\.current\(\{ flush: true, via: 'escape' \}\)/);
  assert.match(PDF_VIEWER_SOURCE, /if \(commitMeta\?\.via === 'escape'\) \{[\s\S]{0,400}setPendingSvgSelection\(\{ pageNumber, annotationIndex: committedIndex/);
  // Survey Markers' Delete is live under every tool, not only Select
  assert.match(SVG_LAYER_SOURCE, /if \(!selectionKeysLive \|\| !selectedSurveyMarkerId\) return;/);
});

test('rule 11: handles hide while the selection is moved, resized or rotated', () => {
  for (const state of ['dragging', 'resizing', 'rotating']) assert.equal(rules.shouldHideSelectionChrome(state), true, state);
  assert.equal(rules.shouldHideSelectionChrome('idle'), false);
  assert.match(SVG_LAYER_SOURCE, /data-selection-gesture=\{shouldHideSelectionChrome\(interactionState\) \? 'true' : undefined\}/);
  assert.match(STYLES_SOURCE, /\[data-selection-gesture="true"\] \.svg-selection-overlay/);
});

test('rule 12: keys, category tabs and view changes keep the selection; a tool button drops it', () => {
  for (const source of ['shortcut-key', 'category-tab', 'pan-button']) {
    assert.equal(rules.getToolSwitchSelectionClearReason('select', 'pen', { source }), null, source);
  }
  assert.equal(rules.getToolSwitchSelectionClearReason('select', 'pen', { source: 'toolbar' }), 'tool-change');
  assert.equal(rules.getToolSwitchSelectionClearReason('select', 'pen'), 'tool-change');
  assert.equal(rules.getToolSwitchSelectionClearReason('text-select', 'pen', { source: 'shortcut-key' }), 'text-select-tool-change');
  for (const change of ['scroll', 'zoom', 'page-change', 'panel-open']) assert.ok(rules.SELECTION_SURVIVES.includes(change), change);
  const keyboardStart = PDF_VIEWER_SOURCE.indexOf('// Keyboard shortcuts');
  assert.match(PDF_VIEWER_SOURCE.slice(keyboardStart, keyboardStart + 1500), /const setActiveTool = \(tool\) => setActiveToolLogged\(tool, \{ source: 'shortcut-key' \}\);/);
  assert.equal((APP_SHELL_SOURCE.match(/\{ source: 'category-tab' \}/g) || []).length, 3);
  // a page far away unmounts its layer; the pick is kept by id and comes back
  presence.recordPageSelection(1, []);
  presence.stashPageSelection(1, { documentId: 'doc', markIds: ['m1'] });
  assert.equal(presence.hasAnyPageSelection(), true);
  assert.equal(presence.peekStashedSelection(1, 'other-doc'), null);
  assert.deepEqual([...presence.peekStashedSelection(1, 'doc').markIds], ['m1']);
  presence.recordPageSelection(5, [{ id: 'x', typeKey: 'rect' }]); // a pick elsewhere replaces it
  assert.equal(presence.peekStashedSelection(1, 'doc'), null);
  presence.recordPageSelection(5, []);
  assert.equal(presence.hasAnyPageSelection(), false);
  assert.match(PDF_VIEWER_SOURCE, /keepSelectionAcrossRemount\n/);
});

test('rule 13: touch taps follow the same table; a tap that picks text arms a double-tap edit', () => {
  assert.equal(rules.TOUCH_RULES.tapIsClick, true);
  assert.equal(rules.TOUCH_RULES.holdIsTap, true);
  assert.equal(rules.TOUCH_RULES.doubleTapEditsText, true);
  // documented gap: the phone hold menu stays until the ⋮ button carries it
  assert.equal(rules.TOUCH_RULES.holdOpensMenu, true);
  assert.match(GRAB_SOURCE, /const notePick = useCallback\(\(key, \{ x, y, pointerType \} = \{\}\) => \{\s*if \(pointerType !== 'touch'\) return;/);
});

test('the grab hand-off only takes presses that land on the selection', () => {
  const el = (attrs, parent = null) => ({
    attrs,
    parent,
    getAttribute(name) { return this.attrs[name] ?? null; },
    closest(selector) {
      const names = selector.split(',').map((part) => part.trim().replace(/^\[|\]$/g, '').split('=')[0]);
      for (let node = this; node; node = node.parent) if (names.some((name) => name in node.attrs)) return node;
      return null;
    },
  });
  const svg = { contains: () => true };
  const wrap = el({ 'data-annotation-index': '2' });
  const objects = [{}, {}, { type: 'Textbox' }];
  assert.equal(routing.classifySelectionGrabTarget(el({}, wrap), svg, { selectedIds: new Set([1]), objects }), null);
  assert.deepEqual(
    { ...routing.classifySelectionGrabTarget(el({}, wrap), svg, { selectedIds: new Set([2]), objects }), el: null },
    { key: 'a:2', text: true, index: 2, calloutId: null, el: null },
  );
  assert.equal(routing.classifySelectionGrabTarget(el({ 'data-handle-hit-pad': 'tl' }), svg, {}).key, 'handle');
  assert.equal(routing.isPageCalloutSelected([{ id: 'c1', pageNumber: 2 }], new Set(['c1']), 2), true);
  assert.equal(routing.isPageCalloutSelected([{ id: 'c1', pageNumber: 2 }], new Set(['c1']), 3), false);
});
