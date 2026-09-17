/**
 * toolFeedbackContracts.test.mjs — guards the two promises the tool row makes:
 *   1. every tool advertises a key, and no two tools fight over one;
 *   2. the pointer over the page stays a PLAIN system cursor — no floating tool
 *      badge riding along beside it.
 *
 * RULED DECISION (owner, 2026-09-17): "I don't like the floating tool by the
 * cursor. It should just be crosshairs when drawing with an annotation. Pan
 * should be a hand tool, like we always had before. Selection: put it back to
 * the way we had before." The 2026-09-16 badge-cursor tests that lived in
 * section 2 — the glyph table, the 42px image, the hotspot, the fixed-colour
 * palette, the per-tool cache — are DELETED under that ruling, not rewritten to
 * pass, because the behaviour they guarded no longer exists. One guard replaces
 * them: it proves the badge cursor stays gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  TOOL_SHORTCUTS,
  READ_ONLY_BLOCKED_KEYS,
  shortcutConflicts,
  toolShortcutBadge,
  toolTooltip,
  tooltipForLabel,
} from '../src/utils/toolShortcuts.js';

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
// 2. No tool badge beside the cursor
// ---------------------------------------------------------------------------

test('no tool-badge cursor: the page shows plain system cursors only', () => {
  // Owner ruling 2026-09-17 (see the file header): the floating tool glyph that
  // rode beside the pointer is gone, and the module that drew it is deleted.
  assert.equal(
    existsSync(new URL('../src/utils/toolCursors.js', import.meta.url)),
    false,
    'src/utils/toolCursors.js is back — the badge cursor was removed for good',
  );
  for (const [name, source] of [['PDFViewer.jsx', pdfViewerSource], ['SVGAnnotationLayer.jsx', svgLayerSource]]) {
    assert.ok(!/toolCursorCss/.test(source), `${name} still calls the badge-cursor builder`);
    assert.ok(!/toolCursors/.test(source), `${name} still imports the badge-cursor module`);
    // An image cursor can only be spelled with a url(), so no data URL anywhere
    // near a cursor means no drawn cursor anywhere.
    assert.ok(
      !/cursor[^\n;]*data:image/.test(source),
      `${name} still hands the pointer a drawn image`,
    );
  }
  // What the tools show instead, exactly as they did before 2026-09-16:
  // a plain crosshair while drawing, the open hand for Pan, the I-beam in text.
  assert.match(
    pdfViewerSource,
    /if \(activeTool === 'pen' \|\| activeTool === 'highlighter' \|\| activeTool === REGION_EDIT_TOOL\) forcedCursor = 'crosshair';/,
  );
  assert.match(pdfViewerSource, /else if \(activeTool === 'pan'\) forcedCursor = 'grab';/);
  assert.match(svgLayerSource, /\? 'tool-crosshair' : undefined/);
});

test('an in-progress drag still shows the grab hand', () => {
  // The gesture outranks the tool: while something is being moved the cursor
  // must say "you are moving this".
  assert.match(svgLayerSource, /interactionState === 'dragging' \? 'grabbing'/);
});
