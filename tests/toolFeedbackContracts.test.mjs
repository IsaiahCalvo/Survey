/**
 * toolFeedbackContracts.test.mjs — guards the two promises the tool row makes:
 *   1. every tool advertises a key, and no two tools fight over one;
 *   2. every drawing tool has a cursor that shows which tool it is, in a fixed
 *      neutral colour that never follows the stroke colour (owner ruling
 *      2026-09-16).
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
  toolCursorCss,
  __cursorCacheSize,
} from '../src/utils/toolCursors.js';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const pdfViewerSource = read('../src/PDFViewer.jsx');
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

test('every drag-out and freehand tool has a cursor; Pan, Eraser and Counter do not', () => {
  for (const tool of ['pen', 'highlighter', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'arrow', 'callout', 'text', 'select']) {
    assert.ok(hasToolCursor(tool), `${tool} has no cursor glyph`);
  }
  // Pan keeps the system grab hand, the Eraser paints its own size ring, and
  // the Counter's page overlay is parked, so it keeps its plain crosshair
  // rather than flashing a badge that only survives the tool switch.
  for (const tool of ['pan', 'eraser', 'counter']) {
    assert.ok(!hasToolCursor(tool), `${tool} should keep its own cursor`);
    assert.equal(toolCursorCss(tool), null);
  }
});

test('the Text tool wears its badge on the page and leaves the I-beam to the editor', () => {
  // The creation overlay takes the armed-tool cursor; when an editor opens the
  // overlay hands its pointer events over and the editor's caret cursor wins.
  assert.match(pdfViewerSource, /\(toolCursorCss\('text'\) \|\| 'text'\)/);
});

test('the cursor is a 42px image whose hotspot is the crosshair centre', () => {
  const css = toolCursorCss('rect');
  assert.match(css, /^url\("data:image\/svg\+xml,/);
  assert.ok(css.endsWith(`) ${CURSOR_HOTSPOT} ${CURSOR_HOTSPOT}, crosshair`), css.slice(-60));
  const svg = buildToolCursorSvg('rect');
  assert.match(svg, new RegExp(`width="${CURSOR_SIZE}" height="${CURSOR_SIZE}"`));
  assert.match(svg, new RegExp(`viewBox="0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}"`));
});

test('the badge never takes the stroke colour', () => {
  // Owner ruling 2026-09-16: the tool glyph beside the cursor must not change
  // colour with the stroke colour. The builder therefore takes a tool and
  // nothing else, so there is no colour to follow, and no call site can pass one.
  assert.equal(buildToolCursorSvg.length, 1, 'the cursor builder still takes a colour');
  assert.equal(toolCursorCss.length, 1, 'the cursor CSS helper still takes a colour');
  for (const tool of CURSOR_TOOL_IDS) {
    const svg = buildToolCursorSvg(tool);
    // One fixed ink and one white halo; nothing else. A tinted glyph would
    // vanish over a white page the moment someone picked white or pale yellow.
    const colours = new Set(svg.match(/(?:stroke|fill)="([^"]+)"/g).map((m) => m.split('"')[1]));
    colours.delete('none');
    assert.deepEqual([...colours].sort(), ['#161a22', '#ffffff'], `${tool} uses an off-palette colour`);
  }
  assert.ok(
    !/toolCursorCss\([^)]*strokeColor/.test(svgLayerSource + pdfViewerSource),
    'a call site still feeds the stroke colour into the cursor',
  );
});

test('each tool draws a different glyph', () => {
  const svgs = CURSOR_TOOL_IDS.map((tool) => buildToolCursorSvg(tool));
  assert.equal(new Set(svgs).size, CURSOR_TOOL_IDS.length, 'two tools share a cursor image');
});

test('the same tool hands back the same cached string', () => {
  const before = __cursorCacheSize();
  const a = toolCursorCss('arrow');
  const b = toolCursorCss('arrow');
  assert.equal(a, b);
  assert.ok(__cursorCacheSize() <= before + 1, 'a repeat lookup rebuilt the SVG');
});

test('the page surface and the tool-switch both use the shared cursor builder', () => {
  assert.match(svgLayerSource, /toolCursorCss\(activeTool\)/);
  assert.match(svgLayerSource, /armedToolCursor \|\| undefined/);
  assert.match(pdfViewerSource, /const armedCursor = toolCursorCss\(activeTool\);/);
});

test('an in-progress drag still shows the grab hand, not the tool badge', () => {
  // The gesture outranks the tool: while something is being moved the cursor
  // must say "you are moving this".
  assert.match(svgLayerSource, /interactionState === 'dragging' \? 'grabbing'/);
});
