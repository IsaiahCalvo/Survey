/*
 * swipeToDeleteRow.test.mjs — owner 2026-10-02: on a phone, swipe a Templates
 * checklist item (and a category) LEFT to uncover a trash behind it.
 *
 * Pins the gesture rules that keep it out of the way of everything else
 * (src/components/SwipeToDeleteRow.jsx) and its wiring in the editor. The
 * motion itself is checked in a browser (scratchpad/templateActions).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const row = read('src/components/SwipeToDeleteRow.jsx');
const css = read('src/components/SwipeToDeleteRow.css');
const editor = read('src/home/TemplatesEditor.jsx');

test('a 96px zone, opened past half of it, rubber-banding beyond', () => {
  assert.match(row, /export const SWIPE_DELETE_ZONE = 96;/);
  assert.match(row, /if \(-offset > SWIPE_DELETE_ZONE \/ 2\) openRow\(\);\s*else close\(\);/);
  assert.match(row, /if \(x < -zone\) return -zone - rubberBand\(-zone - x, zone\);/);
});

test('it never fights scrolling, the reorder grip, or a focused field', () => {
  // Horizontal only after a clear intent; a vertical move first is a scroll.
  assert.match(row, /export const SWIPE_INTENT_SLOP = 8;/);
  assert.match(row, /Math\.abs\(dx\) > SWIPE_INTENT_SLOP && Math\.abs\(dx\) > Math\.abs\(dy\)/);
  assert.match(row, /g\.mode = 'scroll';\s*if \(isOpen\) close\(\);/);
  assert.match(css, /\.swipe-row \{[^}]*touch-action: pan-y;/);
  // The grip keeps dragging; a focused input keeps its caret.
  assert.match(row, /t\.closest\?\.\('\[data-drag-rearrange-handle\]'\)/);
  assert.match(row, /isEditable\(active\) && \(active === t \|\| active\.contains\(t\)\)/);
  // Touch only: no mouse / hover behaviour on a desktop.
  assert.doesNotMatch(row, /addEventListener\('(mousedown|mousemove|pointermove)'/);
  assert.doesNotMatch(css, /:hover/);
});

test('one row open; elsewhere, scroll or another swipe closes it; a tap on it only closes', () => {
  assert.match(row, /let closeOpenRow = null;/);
  assert.match(row, /if \(closeOpenRow && closeOpenRow !== close\) closeOpenRow\(\);/);
  assert.match(row, /'touchstart', outside/);
  assert.match(row, /'scroll', outside/);
  assert.match(row, /mode === 'pending' && wasOpen[\s\S]{0,160}close\(\);/);
});

test('trash on the danger fill (never gold), folds the row, honours reduced motion', () => {
  assert.match(css, /background: var\(--danger-fill\);\s*color: var\(--on-danger\);/);
  assert.doesNotMatch(css, /--accent|--gold/);
  assert.match(row, /<Icon name="trash"/);
  assert.match(css, /\.swipe-row\.is-collapsing \{[^}]*transition: height 220ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important;/);
  assert.match(row, /if \(reducedMotion\(\)\) \{ remove\(\); return; \}/);
  // A delete path that keeps the row (a confirm) unfolds it again.
  assert.match(row, /setTimeout\(restore, 60\)/);
});

test('wired on the phone item rows and category rows with the same delete paths', () => {
  assert.match(editor, /import SwipeToDeleteRow from '\.\.\/components\/SwipeToDeleteRow\.jsx';/);
  assert.match(editor, /<SwipeToDeleteRow label="Delete item" onDelete=\{\(\) => deleteItem\(ci, it\.id\)\}>/);
  assert.match(editor, /<SwipeToDeleteRow\s+label=\{`Delete \$\{c\.name\}`\}\s+disabled=\{catEdit\}\s+onDelete=\{\(\) => deleteCategories\(new Set\(\[c\.id\]\)\)\}/);
});
