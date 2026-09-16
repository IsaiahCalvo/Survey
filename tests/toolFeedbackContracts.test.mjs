/**
 * toolFeedbackContracts.test.mjs — guards the three promises the tool row makes:
 *   1. every tool advertises a key, and no two tools fight over one;
 *   2. every drawing tool has a cursor that shows which tool it is and what
 *      colour the next mark will be;
 *   3. switching to Pan or Select leaves the tool row on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TOOL_SHORTCUTS,
  READ_ONLY_BLOCKED_KEYS,
  shortcutConflicts,
  toolShortcutBadge,
  toolTooltip,
  tooltipForLabel,
} from '../src/utils/toolShortcuts.js';
import {
  CURSOR_HOTSPOT,
  CURSOR_SIZE,
  CURSOR_TOOL_IDS,
  buildToolCursorSvg,
  hasToolCursor,
  normalizeCursorColor,
  toolCursorCss,
  __cursorCacheSize,
} from '../src/utils/toolCursors.js';
import {
  DEFAULT_RECENT_COLORS,
  QUICK_COLOR_SLOTS,
  QUICK_WIDTHS,
  loadRecentColors,
  nextRecentColors,
} from '../src/utils/quickStyleRecents.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const pdfViewerSource = read('../src/PDFViewer.jsx');
const appShellSource = read('../src/AppShell.jsx');
const svgLayerSource = read('../src/components/SVGAnnotationLayer.jsx');

// ---------------------------------------------------------------------------
// 1. The shortcut map
// ---------------------------------------------------------------------------

test('no two tool shortcuts claim the same chord', () => {
  const conflicts = shortcutConflicts();
  assert.deepEqual(
    conflicts,
    [],
    `conflicting chords: ${conflicts.map((c) => `${c.chord} (${c.labels.join(' / ')})`).join(', ')}`,
  );
});

test('every tool the toolbar can arm has a key', () => {
  // The armable tools, taken from the category lists the toolbar itself uses.
  const armable = [
    'pan', 'select', 'text-select',
    'pen', 'highlighter', 'eraser',
    'rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter',
    'text', 'callout',
  ];
  const covered = new Set(TOOL_SHORTCUTS.map((s) => s.tool));
  const missing = armable.filter((tool) => !covered.has(tool));
  assert.deepEqual(missing, [], `tools with no shortcut: ${missing.join(', ')}`);
});

test('every shortcut carries a badge and a single lowercase letter', () => {
  for (const shortcut of TOOL_SHORTCUTS) {
    assert.ok(shortcut.badge, `${shortcut.label} has no badge`);
    assert.match(shortcut.key, /^[a-z]$/, `${shortcut.label} key is not a plain letter`);
    assert.ok(shortcut.label, 'every shortcut names its tool');
  }
});

test('the badge spells out its own modifiers', () => {
  const lasso = TOOL_SHORTCUTS.find((s) => s.label === 'Lasso Select');
  const textSelect = TOOL_SHORTCUTS.find((s) => s.label === 'Text Select');
  const partial = TOOL_SHORTCUTS.find((s) => s.label === 'Partial erase');
  assert.equal(lasso.badge, 'Alt+V');
  assert.equal(textSelect.badge, 'Shift+V');
  assert.equal(partial.badge, 'Shift+E');
});

test('the four pre-existing bindings are untouched', () => {
  // V select, Alt+V lasso, Shift+V text select, P pen were shipped behaviour
  // before this change and must not move.
  assert.equal(toolShortcutBadge('select', 'rectangle'), 'V');
  assert.equal(toolShortcutBadge('select', 'lasso'), 'Alt+V');
  assert.equal(toolShortcutBadge('text-select'), 'Shift+V');
  assert.equal(toolShortcutBadge('pen'), 'P');
  // …and so are the other letters that were already live.
  assert.equal(toolShortcutBadge('highlighter'), 'H');
  assert.equal(toolShortcutBadge('eraser'), 'E');
  assert.equal(toolShortcutBadge('text'), 'T');
  assert.equal(toolShortcutBadge('callout'), 'Q');
  assert.equal(toolShortcutBadge('line'), 'L');
  assert.equal(toolShortcutBadge('arrow'), 'A');
  assert.equal(toolShortcutBadge('counter'), 'C');
  assert.equal(toolShortcutBadge('polygon'), 'G');
  assert.equal(toolShortcutBadge('polyline'), 'K');
});

test('the letters added for the gaps are R, O and M', () => {
  assert.equal(toolShortcutBadge('rect'), 'R');
  assert.equal(toolShortcutBadge('ellipse'), 'O');
  assert.equal(toolShortcutBadge('pan'), 'M');
});

test('the keyboard handler actually listens for every mapped letter', () => {
  for (const shortcut of TOOL_SHORTCUTS) {
    const upper = shortcut.key.toUpperCase();
    const pattern = new RegExp(`e\\.key === '${shortcut.key}' \\|\\| e\\.key === '${upper}'`);
    assert.match(
      pdfViewerSource,
      pattern,
      `PDFViewer has no keydown branch for ${shortcut.label} (${shortcut.badge})`,
    );
  }
});

test('read-only documents swallow the drawing letters and only those', () => {
  assert.deepEqual(
    READ_ONLY_BLOCKED_KEYS,
    ['a', 'c', 'e', 'g', 'h', 'k', 'l', 'o', 'p', 'q', 'r', 't'],
  );
  // Looking is always allowed: Pan and the Select family stay live.
  for (const key of ['m', 'v']) {
    assert.ok(!READ_ONLY_BLOCKED_KEYS.includes(key), `${key} must stay live on a read-only doc`);
  }
  // And the guard reads the map rather than a retyped copy.
  assert.match(pdfViewerSource, /READ_ONLY_BLOCKED_KEYS\.includes\(e\.key\.toLowerCase\(\)\)/);
});

test('tooltip text is the name, then the badge', () => {
  assert.equal(toolTooltip('Rectangle', 'rect'), 'Rectangle  R');
  assert.equal(tooltipForLabel('Rectangle'), 'Rectangle  R');
  assert.equal(tooltipForLabel('Pan'), 'Pan  M');
  assert.equal(tooltipForLabel('Rectangle Select'), 'Rectangle Select  V');
  assert.equal(tooltipForLabel('Partial erase'), 'Partial erase  Shift+E');
  // The eraser renames itself; both names keep the badge.
  assert.equal(tooltipForLabel('Full stroke erase'), 'Full stroke erase  E');
  // A label with no binding is returned untouched — tool GROUPS keep their name.
  assert.equal(tooltipForLabel('Shapes'), 'Shapes');
  assert.equal(tooltipForLabel(''), '');
});

test('the shared tooltip binder appends the badge, so no call site can forget it', () => {
  const tooltipSource = read('../src/components/Tooltip.jsx');
  assert.match(tooltipSource, /const text = tooltipForLabel\(rawText\);/);
  // The mobile rail uses a native title=, so it asks for the badge itself.
  const mobileSource = read('../src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobileSource, /title=\{tooltipForLabel\(label\)\}/);
  assert.match(mobileSource, /aria-label=\{label\}/);
});

// ---------------------------------------------------------------------------
// 2. The tool cursor
// ---------------------------------------------------------------------------

test('every drag-out and freehand tool has a cursor; Pan and Eraser do not', () => {
  for (const tool of ['pen', 'highlighter', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'counter', 'callout', 'text', 'select']) {
    assert.ok(hasToolCursor(tool), `${tool} has no cursor glyph`);
  }
  // Pan keeps the system grab hand; the Eraser paints its own size ring.
  assert.ok(!hasToolCursor('pan'));
  assert.ok(!hasToolCursor('eraser'));
  assert.equal(toolCursorCss('pan', '#ff0000'), null);
  assert.equal(toolCursorCss('eraser', '#ff0000'), null);
});

test('the cursor is a 42px image whose hotspot is the crosshair centre', () => {
  const css = toolCursorCss('rect', '#ff0000');
  assert.match(css, /^url\("data:image\/svg\+xml,/);
  assert.ok(css.endsWith(`) ${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}, crosshair`), css.slice(-60));
  const svg = buildToolCursorSvg('rect', '#ff0000');
  assert.match(svg, new RegExp(`width="${CURSOR_SIZE}" height="${CURSOR_SIZE}"`));
  assert.match(svg, new RegExp(`viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}"`));
});

test('the cursor carries the colour the next mark will be', () => {
  const red = buildToolCursorSvg('ellipse', '#ff0000');
  const blue = buildToolCursorSvg('ellipse', '#0080ff');
  assert.ok(red.includes('#ff0000'), 'red cursor does not mention its colour');
  assert.ok(blue.includes('#0080ff'), 'blue cursor does not mention its colour');
  assert.notEqual(red, blue, 'two colours produced the same cursor');
});

test('each tool draws a different glyph', () => {
  const svgs = CURSOR_TOOL_IDS.map((tool) => buildToolCursorSvg(tool, '#ff0000'));
  assert.equal(new Set(svgs).size, CURSOR_TOOL_IDS.length, 'two tools share a cursor image');
});

test('a junk colour falls back instead of being injected into the SVG', () => {
  assert.equal(normalizeCursorColor('#12ab34'), '#12ab34');
  assert.equal(normalizeCursorColor('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)');
  assert.equal(normalizeCursorColor('red'), 'red');
  assert.equal(normalizeCursorColor('"/><script>x</script>'), '#161a22');
  assert.equal(normalizeCursorColor(null), '#161a22');
  const svg = buildToolCursorSvg('line', '"/><script>alert(1)</script>');
  assert.ok(!svg.includes('<script'), 'a colour got through as markup');
});

test('the same tool and colour hand back the same cached string', () => {
  const before = __cursorCacheSize();
  const a = toolCursorCss('arrow', '#00ff00');
  const b = toolCursorCss('arrow', '#00ff00');
  assert.equal(a, b);
  assert.equal(__cursorCacheSize(), before + 1, 'a repeat lookup rebuilt the SVG');
  toolCursorCss('arrow', '#0000ff');
  assert.equal(__cursorCacheSize(), before + 2, 'a new colour did not get its own entry');
});

test('the page surface and the tool-switch both use the shared cursor builder', () => {
  assert.match(svgLayerSource, /toolCursorCss\(activeTool, strokeColor\)/);
  assert.match(svgLayerSource, /armedToolCursor \|\| undefined/);
  assert.match(pdfViewerSource, /const armedCursor = toolCursorCss\(activeTool, strokeColor\);/);
});

test('an in-progress drag still shows the grab hand, not the tool badge', () => {
  // The gesture outranks the tool: while something is being moved the cursor
  // must say "you are moving this".
  assert.match(svgLayerSource, /interactionState === 'dragging' \? 'grabbing'/);
});

// ---------------------------------------------------------------------------
// 3. The tool row stays open
// ---------------------------------------------------------------------------

test('nothing closes the tool row just because Pan or Select was armed', () => {
  assert.ok(
    !/activeTool === 'pan' \|\| activeTool === 'select' \|\| activeTool === 'text-select'\)\s*&&[\s\S]{0,140}setActiveCategoryDropdown\(null\)/.test(pdfViewerSource),
    'the close-on-pan/select effect is back',
  );
  // The Pan / Select buttons must not close it on the way out either.
  const selectButtonBlock = appShellSource.slice(
    appShellSource.indexOf('data-select-mode-trigger={isSelect'),
    appShellSource.indexOf('data-select-mode-indicator'),
  );
  assert.ok(selectButtonBlock.length > 0, 'could not find the Pan/Select button block');
  assert.ok(
    !selectButtonBlock.includes('setActiveCategoryDropdown(null)'),
    'the Pan/Select button still folds the tool row away',
  );
});

test('a group button arms its last tool when you are not in that group', () => {
  // openToolGroup decides by what is ARMED, not by what happens to be showing,
  // which is what makes "one click back to Ellipse" work.
  assert.match(appShellSource, /const openToolGroup = useCallback\(/);
  assert.match(appShellSource, /if \(armedInGroup && api\.activeCategoryDropdown === group\)/);
  assert.match(appShellSource, /if \(!armedInGroup\) api\.setActiveTool\(lastUsedTool\)/);
  for (const group of ['draw', 'shape', 'review']) {
    assert.ok(
      appShellSource.includes(`openToolGroup('${group}'`),
      `the ${group} group button does not go through openToolGroup`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Quick styles in the row
// ---------------------------------------------------------------------------

test('the row offers three colours and three widths', () => {
  assert.equal(QUICK_COLOR_SLOTS, 3);
  assert.equal(DEFAULT_RECENT_COLORS.length, 3);
  assert.equal(QUICK_WIDTHS.length, 3);
  assert.deepEqual([...QUICK_WIDTHS], [2, 6, 12]);
});

test('recent colours are newest first, de-duplicated and capped at three', () => {
  let recents = [...DEFAULT_RECENT_COLORS];
  recents = nextRecentColors(recents, '#00ff00');
  assert.deepEqual(recents, ['#00ff00', '#ff0000', '#000000']);
  // Re-picking a colour promotes it instead of duplicating it.
  recents = nextRecentColors(recents, '#000000');
  assert.deepEqual(recents, ['#000000', '#00ff00', '#ff0000']);
  assert.equal(new Set(recents).size, recents.length);
  // A non-hex value (a gradient, a name, undefined) never enters the list.
  assert.deepEqual(nextRecentColors(recents, 'chartreuse'), recents);
  assert.deepEqual(nextRecentColors(recents, null), recents);
});

test('the row always shows three dots, even with nothing stored', () => {
  const blocked = { getItem() { throw new Error('private browsing'); } };
  assert.deepEqual(loadRecentColors(blocked), [...DEFAULT_RECENT_COLORS]);
  const partial = { getItem: () => JSON.stringify(['#123456']) };
  const filled = loadRecentColors(partial);
  assert.equal(filled.length, QUICK_COLOR_SLOTS);
  assert.equal(filled[0], '#123456');
  const junk = { getItem: () => '{not json' };
  assert.deepEqual(loadRecentColors(junk), [...DEFAULT_RECENT_COLORS]);
});

test('the quick strip sits in the markup rows and the full picker stays shared', () => {
  assert.match(pdfViewerSource, /\['draw', 'shape', 'review'\]\.includes\(activeCategoryDropdown\) && activeTool !== 'eraser'/);
  assert.match(pdfViewerSource, /onOpenColorPicker=\{\(\) => setShowAnnotationColorPicker\(true\)\}/);
  // One shared picker app-wide: the strip must not mount its own.
  const quickStyles = read('../src/components/ToolQuickStyles.jsx');
  assert.ok(!/import .*CompactColorPicker/.test(quickStyles), 'the quick strip imports its own colour picker');
  assert.ok(!/<CompactColorPicker/.test(quickStyles), 'the quick strip mounts a second colour picker');
});
