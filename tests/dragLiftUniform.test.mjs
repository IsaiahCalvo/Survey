/*
 * dragLiftUniform.test.mjs — one "picked up" look for every drag-to-reorder
 * item (owner 2026-10-01: "This drag and drop still looks kind of ugly … just a
 * uniform colour / uniform style when it gets picked up — especially where
 * only a section got grey. Mobile has a little bit of this too.").
 *
 * The held module tab showed two greys (its own lift plus a darker block where
 * a child still painted a fill) and was translucent; list rows were a 62%
 * ghost; Survey markers carried a gold focus ring; bookmarks, Spaces and tabs
 * each had their own surface and shadow. Now every lifted item carries
 * data-drag-lifted and ONE rule (states.css, in a cascade layer so it beats
 * the !important hover / pressed rules) paints it from the --drag-lift-*
 * tokens; the landing gap is one dashed --drag-slot-* outline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDragSlotRect } from '../src/reorder/dragSlot.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tokens = read('src/styles/tokens.css');
const states = read('src/styles/states.css');

test('the lift and the slot are tokens', () => {
  for (const name of ['--drag-lift-bg', '--drag-lift-shadow', '--drag-lift-radius', '--drag-slot-bg', '--drag-slot-border']) {
    assert.match(tokens, new RegExp(`${name}:`), name);
  }
  assert.match(tokens, /--drag-lift-bg: var\(--surface-3\);/);
  // Neutral: nothing about a lift is gold.
  const block = tokens.slice(tokens.indexOf('DRAG LIFT'), tokens.indexOf('--drag-slot-border'));
  assert.doesNotMatch(block, /--accent|--focus|216, 168, 78/);
});

test('one layered rule paints the whole lifted item and clears its children', () => {
  const layer = states.slice(states.indexOf('@layer drag-lift {'));
  assert.ok(layer.length > 0, 'drag-lift layer exists');
  assert.match(layer, /\[data-drag-lifted\] \{[^}]*background-color: var\(--drag-lift-bg\) !important;[^}]*box-shadow: var\(--drag-lift-shadow\) !important;[^}]*opacity: 1 !important;/);
  // Every child without information in its fill goes transparent: no inner block.
  assert.match(layer, /\[data-drag-lifted\] :not\([\s\S]*?\[data-drag-keep-fill\][\s\S]*?\) \{\s*background-color: transparent !important;/);
  // A colour swatch keeps its colour.
  assert.match(layer, /\[title='Edit color'\]/);
  // The slot is a pseudo-element on the list, drawn from the tokens.
  assert.match(layer, /\[data-sortable-rearrange-list\]\[data-drag-slot\]::before \{[^}]*border: var\(--drag-slot-border\);/);
});

test('every reorder surface opts into the shared lift instead of its own paint', () => {
  const reorder = read('src/reorder/SortableRearrangeList.jsx');
  assert.match(reorder, /data-drag-lifted=\{isDraggingVisual && lift \? '' : undefined\}/);
  assert.match(reorder, /opacity: isDraggingVisual && !lift \? draggingOpacity : 1/);

  const templates = read('src/home/TemplatesEditor.jsx');
  const tab = templates.slice(templates.indexOf('function SortableModuleTab('), templates.indexOf('function SortableModuleTabs('));
  assert.match(tab, /data-drag-lifted=\{isDragging \? '' : undefined\}/);
  assert.doesNotMatch(tab, /scale\(1\.04\)|isDragging \? 'var\(--surface-3|opacity: isDragging/);

  const tabBar = read('src/TabBar.jsx');
  assert.match(tabBar, /data-drag-lifted=\{isDragging \? '' : undefined\}/);
  assert.doesNotMatch(tabBar, /opacity: isDragging \? 0\.92/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.doesNotMatch(rail, /inset 0 0 0 2px var\(--focus\)/);

  const styles = read('src/styles.css');
  assert.doesNotMatch(styles, /\.spaces-item\.is-dragging \.spaces-item__block \{/);

  const pages = read('src/sidebar/PagesPanel.jsx');
  // Since 2026-10-07 the Pages tab drags with dnd-kit. Owner 2026-10-07 ("I
  // just want to be picking up and moving that page"): the lifted copy
  // (DragOverlay) is the page itself on the shared lift shadow, not a card
  // box wearing the shared lift surface.
  assert.match(pages, /data-page-drag-sheet=""/);
  assert.match(pages, /boxShadow: 'var\(--drag-lift-shadow\)'/);
  assert.doesNotMatch(pages, /data-drag-lifted=""/);
  assert.doesNotMatch(pages, /dragOverPage === pageNumber \? '1px solid var\(--accent\)'/);
});

test('the slot sits in the gap the rows open (dnd-kit vertical strategy)', () => {
  // three rows 35px tall, 6px apart
  const rows = [{ id: 'a', top: 0, height: 35 }, { id: 'b', top: 41, height: 35 }, { id: 'c', top: 82, height: 35 }];
  assert.deepEqual(getDragSlotRect(rows, 'a', 'a'), { top: 0, height: 35 });
  // a moves down over b: b shifts up, a lands with its bottom on b's bottom
  assert.deepEqual(getDragSlotRect(rows, 'a', 'b'), { top: 41, height: 35 });
  // c moves up over a: a and b shift down, c lands on a's top
  assert.deepEqual(getDragSlotRect(rows, 'c', 'a'), { top: 0, height: 35 });
  // a tall row moving down over a short one keeps its own height
  const mixed = [{ id: 'x', top: 0, height: 120 }, { id: 'y', top: 126, height: 35 }];
  assert.deepEqual(getDragSlotRect(mixed, 'x', 'y'), { top: 41, height: 120 });
  // no target: the slot stays where the row came from
  assert.deepEqual(getDragSlotRect(rows, 'b', null), { top: 41, height: 35 });
  assert.equal(getDragSlotRect(rows, 'zz', 'a'), null);
  assert.equal(getDragSlotRect([], 'a', 'b'), null);
});
