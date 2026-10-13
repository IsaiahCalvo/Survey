// Drawboard canvas audit, chunk 4 — the floating quick bar over a selection.
//
// 1. Placement: above the selection and centred on it, below when there is no
//    room above, held 10px inside the viewer, hidden when scrolled away.
// 2. What it shows: per kind, "only what applies to all" for a mixed pick,
//    entity swatches for Survey Markers, nothing to restyle on a locked pick,
//    nothing at all on a read-only document.
// 3. Its actions are the existing ones (the Delete / Cmd+D keys, the
//    right-click menu), and it is mounted for the desktop layout only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  QUICK_BAR_MARGIN,
  QUICK_BAR_WIDTHS,
  computeSelectionQuickBarPosition,
  isQuickBarWidth,
  planSelectionQuickBar,
  selectionCommandKey,
  selectionFrameRect,
  selectionItemSelector,
} from '../src/utils/selectionQuickBar.js';
import { QUICK_MENU_GAP } from '../src/utils/textSelectionQuickMenu.js';

const VIEWER = { left: 48, top: 105, right: 1392, bottom: 900 };
const BAR = { barWidth: 195, barHeight: 36 };

test('placement: above the selection, centred on it', () => {
  const sel = { left: 528, top: 587, right: 749, bottom: 747 };
  const p = computeSelectionQuickBarPosition({ selectionRect: sel, bounds: VIEWER, ...BAR });
  assert.equal(p.side, 'above');
  assert.equal(p.top, sel.top - QUICK_MENU_GAP - BAR.barHeight);
  assert.ok(Math.abs((p.left + BAR.barWidth / 2) - (sel.left + sel.right) / 2) <= 1);
});

test('placement: flips below when there is no room above', () => {
  const sel = { left: 528, top: VIEWER.top + 20, right: 749, bottom: VIEWER.top + 180 };
  const p = computeSelectionQuickBarPosition({ selectionRect: sel, bounds: VIEWER, ...BAR });
  assert.equal(p.side, 'below');
  assert.equal(p.top, sel.bottom + QUICK_MENU_GAP);
});

test('placement: held inside the viewer at the side edges', () => {
  const left = computeSelectionQuickBarPosition({ selectionRect: { left: 0, top: 400, right: 80, bottom: 500 }, bounds: VIEWER, ...BAR });
  assert.equal(left.left, VIEWER.left + QUICK_BAR_MARGIN);
  const right = computeSelectionQuickBarPosition({ selectionRect: { left: 1360, top: 400, right: 1500, bottom: 500 }, bounds: VIEWER, ...BAR });
  assert.equal(right.left, VIEWER.right - QUICK_BAR_MARGIN - BAR.barWidth);
});

test('placement: a selection taller than the view pins the bar inside it', () => {
  const p = computeSelectionQuickBarPosition({ selectionRect: { left: 300, top: 0, right: 900, bottom: 2000 }, bounds: VIEWER, ...BAR });
  assert.equal(p.side, 'pinned');
  assert.ok(p.top >= VIEWER.top + QUICK_BAR_MARGIN && p.top + BAR.barHeight <= VIEWER.bottom - QUICK_BAR_MARGIN);
});

test('placement: hidden when the selection is out of view', () => {
  assert.equal(computeSelectionQuickBarPosition({ selectionRect: { left: 300, top: 950, right: 500, bottom: 1100 }, bounds: VIEWER, ...BAR }), null);
  assert.equal(computeSelectionQuickBarPosition({ selectionRect: null, bounds: VIEWER, ...BAR }), null);
});

test('frame: the union of the page overlays', () => {
  assert.deepEqual(
    selectionFrameRect([{ left: 10, top: 20, right: 30, bottom: 40 }, { left: 25, top: 5, width: 50, height: 10 }]),
    { left: 10, top: 5, right: 75, bottom: 40 },
  );
  assert.equal(selectionFrameRect([]), null);
});

const api = (contextTool, extra = {}) => ({
  contextTool,
  activeTool: 'select',
  handleFillColorChange: () => {},
  handleStrokeWidthInputChange: () => {},
  setLineBorderStyle: () => {},
  ...extra,
});
const items = (...kinds) => kinds.map((typeKey, i) => ({ id: `m${i}`, typeKey, pageNumber: 1 }));

test('plan: a rectangle gets the combined swatch, Line (width + style) and every action', () => {
  assert.deepEqual(planSelectionQuickBar({ items: items('rect'), api: api('rect') }), {
    colour: 'swatch', width: true, style: true, duplicate: true, remove: true, more: true,
  });
});

test('plan: an ink stroke gets the quick colour dots and width only', () => {
  const plan = planSelectionQuickBar({ items: items('pen'), api: api('pen') });
  assert.equal(plan.colour, 'dots');
  assert.equal(plan.width, true);
  assert.equal(plan.style, false);
});

test('plan: a stroke with no rebuildable width shows no width', () => {
  const plan = planSelectionQuickBar({ items: items('pen'), api: api('pen', { selectionCapabilities: { width: false } }) });
  assert.equal(plan.width, false);
});

test('plan: several marks show only what applies to all of them', () => {
  const plan = planSelectionQuickBar({ items: items('rect', 'pen'), api: api('rect') });
  assert.equal(plan.colour, 'swatch');
  assert.equal(plan.width, true);
  assert.equal(plan.style, false, 'ink has no line style');
  const counter = planSelectionQuickBar({ items: items('rect', 'counter'), api: api('rect') });
  assert.equal(counter.width, false, 'a counter has no line width');
});

test('plan: Survey Markers show entity swatches, or no colour without entities', () => {
  assert.equal(planSelectionQuickBar({ items: items('surveyMarker'), api: api('select'), entityCount: 2 }).colour, 'entity');
  assert.equal(planSelectionQuickBar({ items: items('surveyMarker', 'surveyMarker'), api: api('select'), entityCount: 2 }).colour, 'entity');
  assert.equal(planSelectionQuickBar({ items: items('surveyMarker'), api: api('select'), entityCount: 0 }).colour, null);
});

test('plan: a marker picked with a mark: Duplicate / Delete / More only', () => {
  assert.deepEqual(planSelectionQuickBar({ items: items('surveyMarker', 'rect'), api: api('rect'), entityCount: 2 }), {
    colour: null, width: false, style: false, duplicate: true, remove: true, more: true,
  });
});

test('plan: a locked pick cannot be restyled or deleted', () => {
  assert.deepEqual(planSelectionQuickBar({ items: items('rect'), api: api('rect'), locked: true }), {
    colour: null, width: false, style: false, duplicate: true, remove: false, more: true,
  });
});

test('plan: nothing on a read-only document or with nothing picked', () => {
  assert.equal(planSelectionQuickBar({ items: items('rect'), api: api('rect'), readOnly: true }), null);
  assert.equal(planSelectionQuickBar({ items: [], api: api('rect') }), null);
});

test('More targets the picked element a right-click would land on', () => {
  assert.equal(selectionItemSelector({ id: 'a1', typeKey: 'rect' }), '[data-annotation-id="a1"]');
  assert.equal(selectionItemSelector({ id: 'c"1', typeKey: 'callout' }), '[data-callout-id="c\\"1"]');
  assert.equal(selectionItemSelector({ id: 'sm', typeKey: 'surveyMarker' }), '[data-survey-marker-id="sm"]');
  assert.equal(selectionItemSelector(null), null);
});

test('Delete and Duplicate are the page layer\'s own keys', () => {
  assert.equal(selectionCommandKey('delete').key, 'Delete');
  assert.deepEqual(
    [selectionCommandKey('duplicate').key, selectionCommandKey('duplicate').ctrlKey, selectionCommandKey('duplicate').metaKey],
    ['d', true, false],
  );
  assert.deepEqual(
    [selectionCommandKey('duplicate', { mac: true }).ctrlKey, selectionCommandKey('duplicate', { mac: true }).metaKey],
    [false, true],
  );
  assert.equal(selectionCommandKey('nope'), null);
  // The layer still listens for exactly those keys.
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /e\.key !== 'Delete' && e\.key !== 'Backspace'/);
  assert.match(layer, /if \(key === 'd'\)/);
});

test('width presets', () => {
  assert.deepEqual([...QUICK_BAR_WIDTHS], [1, 2, 3, 4, 6, 8]);
  assert.equal(isQuickBarWidth('2', 2), true);
  assert.equal(isQuickBarWidth(2.5, 2), false);
  assert.equal(isQuickBarWidth('', 2), false);
});

test('mounted for the desktop layout only, with the tool bar\'s own colour controls', () => {
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /<SelectionQuickBar[\s\S]*?enabled=\{Boolean\(isViewerVisible && !isMobileViewer && bottomToolbarApi\)\}/);
  assert.match(shell, /onOpenColourPicker=\{toggleAnnotationColourPicker\}/);
  // The picker opens under the bar's control like under the tool bar's.
  assert.match(shell, /closest\?\.\('#chrome-top-host, #chrome-sub-toolbar-host, \[data-selection-quick-bar\]'\)/);
});

test('the bar never reaches into the annotation layer\'s zoom handling', () => {
  const bar = readFileSync(new URL('../src/components/SelectionQuickBar.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(bar, /zoomGeneration|setZoomGeneration|beginPdfjsScaleConfirmPending/);
  assert.match(bar, /getBoundingClientRect/);
  const css = readFileSync(new URL('../src/components/SelectionQuickBar.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /gold|--accent|#d8a84e/i, 'no gold in the bar');
  assert.doesNotMatch(css, /transition:\s*opacity/, 'shows and hides at once');
});
