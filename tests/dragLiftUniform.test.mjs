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
 * tokens.
 *
 * Owner 2026-10-30 ("I don't think I like the dotted lines that show where
 * it's going to drop … make the animation consistent … professional, clean"):
 * no dashed landing slot anywhere; the items part to open the gap, and every
 * surface (lists, PDF tabs, module tabs, bookmarks, pages) moves on the one
 * --motion-drag glide (src/reorder/dragMotion.js), the drop included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRAG_GLIDE, DRAG_GLIDE_CSS, settleDroppedItem } from '../src/reorder/dragMotion.js';
import { MOTION_MS } from '../src/utils/motion.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const tokens = read('src/styles/tokens.css');
const states = read('src/styles/states.css');

test('the lift is tokens, and there is no slot token', () => {
  for (const name of ['--drag-lift-bg', '--drag-lift-shadow', '--drag-lift-radius']) {
    assert.match(tokens, new RegExp(`${name}:`), name);
  }
  assert.match(tokens, /--drag-lift-bg: var\(--surface-3\);/);
  // Neutral: nothing about a lift is gold.
  const block = tokens.slice(tokens.indexOf('DRAG LIFT'), tokens.indexOf('--drag-lift-radius'));
  assert.doesNotMatch(block, /--accent|--focus|216, 168, 78/);
  assert.doesNotMatch(tokens, /--drag-slot-/);
});

test('one layered rule paints the whole lifted item and clears its children', () => {
  const layer = states.slice(states.indexOf('@layer drag-lift {'));
  assert.ok(layer.length > 0, 'drag-lift layer exists');
  assert.match(layer, /\[data-drag-lifted\] \{[^}]*background-color: var\(--drag-lift-bg\) !important;[^}]*box-shadow: var\(--drag-lift-shadow\) !important;[^}]*opacity: 1 !important;/);
  // Every child without information in its fill goes transparent: no inner block.
  assert.match(layer, /\[data-drag-lifted\] :not\([\s\S]*?\[data-drag-keep-fill\][\s\S]*?\) \{\s*background-color: transparent !important;/);
  // A colour swatch keeps its colour.
  assert.match(layer, /\[title='Edit color'\]/);
  // No landing slot.
  assert.doesNotMatch(states, /data-drag-slot|--drag-slot-/);
  // Only a PRESSED glyph loses its transform: an open space's fold arrow is
  // turned with one and must stay turned while its space is held.
  assert.match(layer, /\[data-drag-lifted\] \[data-glyph-only\]:active > \*,/);
  assert.doesNotMatch(layer, /\[data-drag-lifted\] \[data-glyph-only\] > \*/);
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

test('no surface draws a dashed landing slot', () => {
  for (const file of [
    'src/reorder/SortableRearrangeList.jsx', 'src/sidebar/BookmarksPanel.jsx', 'src/sidebar/PagesPanel.jsx',
    'src/styles.css', 'src/styles/states.css', 'src/mobile/mobilePdfViewer.css',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /--drag-slot-|data-drag-slot|data-bookmark-drop-slot|getDragSlotRect/, file);
  }
  // The page a carried page came from is an empty gap, never an outline.
  const styles = read('src/styles.css');
  const placeholder = styles.slice(styles.indexOf('[data-page-card][data-drag-placeholder] > *'), styles.indexOf('[data-page-card][data-drag-rider]'));
  assert.doesNotMatch(placeholder, /outline:|dashed/);
});

test('one drag glide: the token, its JS mirror and every surface', () => {
  assert.match(tokens, /--motion-drag: 200ms;/);
  assert.equal(MOTION_MS.drag, 200);
  assert.equal(DRAG_GLIDE.duration, MOTION_MS.drag);
  assert.equal(DRAG_GLIDE_CSS, `${DRAG_GLIDE.duration}ms ${DRAG_GLIDE.easing}`);
  const reorder = read('src/reorder/SortableRearrangeList.jsx');
  assert.match(reorder, /transition: transitionOption === undefined \? dragGlide\(\) : transitionOption/);
  assert.match(reorder, /settleDroppedItem\(getSortableRearrangeItemNode\(id\), rect\)/);
  for (const file of ['src/TabBar.jsx', 'src/components/SurveyModuleTabs.jsx', 'src/home/TemplatesEditor.jsx']) {
    const source = read(file);
    assert.match(source, /transition: dragGlide\(\)/, `${file} tabs glide on the shared clock`);
    assert.match(source, /useDropSettle\('data-[a-z-]+'\)/, `${file} settles a dropped tab`);
  }
  assert.match(read('src/sidebar/BookmarksPanel.jsx'), /export const BOOKMARK_SORT_TRANSITION = DRAG_GLIDE;/);
  assert.match(read('src/sidebar/PagesPanel.jsx'), /const PAGE_SLIDE = DRAG_GLIDE;/);
  // Spaces used to switch the glide off (transition={null}): rows jumped a
  // whole row in one frame. Nothing may switch it off again.
  const spaces = read('src/sidebar/SpacesPanel.jsx');
  assert.doesNotMatch(spaces, /transition=\{null\}|animateLayoutChanges=\{\(\) => false\}|animateSpaceLayoutChanges/);
});

test('a dropped item glides from where it was let go into its gap', () => {
  const calls = [];
  const node = {
    getBoundingClientRect: () => ({ left: 10, top: 100 }),
    animate: (frames, options) => { calls.push({ frames, options }); return {}; },
  };
  const win = { matchMedia: () => ({ matches: false }) };
  settleDroppedItem(node, { left: 10, top: 82 }, win);
  assert.deepEqual(calls[0].frames, [{ translate: '0px -18px' }, { translate: '0px 0px' }]);
  assert.equal(calls[0].options.duration, DRAG_GLIDE.duration);
  // Already in its gap: nothing to play. Reduced motion: never.
  assert.equal(settleDroppedItem(node, { left: 10, top: 100 }, win), null);
  assert.equal(settleDroppedItem(node, { left: 10, top: 40 }, { matchMedia: () => ({ matches: true }) }), null);
  assert.equal(calls.length, 1);
});

test('the drop never flicks: tab rows keep the new order at once, bookmarks move the real row', () => {
  // A tab row drew one frame in the old order after a reorder, so the passed
  // tabs jumped back a whole tab and slid forward again (template modules).
  const overflow = read('src/reorder/useTabOverflow.js');
  assert.match(overflow, /visible: ids\.filter\(\(id\) => !hiddenSet\.has\(id\)\)/);
  // The bookmark drag wrote its offset onto the swipe wrapper (the slot's
  // first child since 2026-10-27), which nothing cleared: a dropped bookmark
  // hung over the row below.
  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  assert.doesNotMatch(bookmarks, /firstElementChild/);
  assert.match(bookmarks, /const dragRowOf = \(outer\) => outer\?\.querySelector\('\[data-bookmark-drag-row\]'\)/);
  assert.equal(bookmarks.match(/data-bookmark-drag-row=\{/g)?.length, 2);
  assert.match(bookmarks, /useDropSettle\('data-bookmark-drag-row'\)/);
});
