/*
 * swipeActionsRow.test.mjs — owner 2026-10-27: slide any list row for its
 * actions without Select / Edit mode, a copy of the EDC tracker's account
 * list (redone the same day: "your animation is way too much ... copy
 * whatever that HTML was doing for desktop, then make it mobile-friendly").
 *
 * Pins the pure rules (src/utils/swipeActions.js), the gesture rules that keep
 * the row out of the way (src/components/SwipeActionsRow.jsx) and the wiring
 * in every list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SWIPE_ACTION_ORDER,
  SWIPE_ACTION_WIDTH,
  SWIPE_FLING_VELOCITY,
  SWIPE_SPRING,
  buildSwipeActions,
  canFullSwipe,
  fullSwipeThreshold,
  layerFrame,
  releaseVelocity,
  settleSwipe,
  splitSwipeSides,
  springAt,
  swipeOffset,
} from '../src/utils/swipeActions.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const row = read('src/components/SwipeActionsRow.jsx');
const css = read('src/components/SwipeActionsRow.css');
const noop = () => {};

test('actions come in the select-mode order, Delete last, from the same handler names', () => {
  const sectionButtons = read('src/components/SectionIconButton.jsx');
  const selectOrder = [...sectionButtons.matchAll(/\{ key: '(\w+)', label: '[^']+', handler: 'on\w+' \}/g)].map((m) => m[1]);
  assert.deepEqual(SWIPE_ACTION_ORDER.map((a) => a.key), selectOrder);
  const all = buildSwipeActions({ onDelete: noop, onShare: noop, onCopy: noop, onMove: noop, onDuplicate: noop });
  assert.deepEqual(all.map((a) => a.key), ['duplicate', 'move', 'copy', 'share', 'delete']);
  assert.equal(all.at(-1).danger, true);
  assert.equal(all.filter((a) => a.danger).length, 1);
});

test('a missing handler or can:false leaves an action out; a reason string keeps it, explaining', () => {
  const list = buildSwipeActions({ onDuplicate: noop, onShare: noop, onDelete: noop, can: { duplicate: false, share: 'Only the owner can share' } });
  assert.deepEqual(list.map((a) => a.key), ['share', 'delete']);
  assert.equal(list[0].reason, 'Only the owner can share');
  assert.equal(list[1].reason, null);
  assert.equal(buildSwipeActions({ onDelete: noop, labels: { delete: 'Remove' } })[0].label, 'Remove');
  assert.deepEqual(buildSwipeActions({}), []);
});

test('like the HTML: one action per side - Delete on the right, one everyday action on the left', () => {
  const five = buildSwipeActions({ onDelete: noop, onShare: noop, onCopy: noop, onMove: noop, onDuplicate: noop });
  const sides = splitSwipeSides(five);
  assert.deepEqual(sides.trailing.map((a) => a.key), ['delete']);
  assert.deepEqual(sides.leading.map((a) => a.key), ['duplicate'], 'Duplicate first when the list does not say');
  const shared = splitSwipeSides(buildSwipeActions({ lead: 'share', onDelete: noop, onShare: noop, onDuplicate: noop }));
  assert.deepEqual(shared.leading.map((a) => a.key), ['share']);
  assert.deepEqual(splitSwipeSides(buildSwipeActions({ onMove: noop, onDelete: noop })).leading.map((a) => a.key), ['move']);
  assert.deepEqual(splitSwipeSides(buildSwipeActions({ onMove: noop, onCopy: noop, onDelete: noop, can: { move: 'Needs another module' } })).leading.map((a) => a.key), ['copy'], 'a blocked action is skipped on the left');
  const onlyDelete = splitSwipeSides(buildSwipeActions({ onDelete: noop }));
  assert.deepEqual(onlyDelete.leading, []);
  assert.equal(canFullSwipe(onlyDelete.trailing), true);
  assert.equal(canFullSwipe(splitSwipeSides(buildSwipeActions({ onDelete: noop, can: { delete: 'Only the owner can delete' } })).trailing), false, 'a blocked Delete is never full-swiped');
  assert.equal(SWIPE_ACTION_WIDTH, 76, "the HTML's action width");
});

test('the row follows the finger to the whole row, rubber-bands past it, and never opens an empty side', () => {
  const sides = splitSwipeSides(buildSwipeActions({ onDelete: noop }));
  assert.equal(swipeOffset(-100, { ...sides, rowWidth: 360 }), -100);
  assert.equal(swipeOffset(-300, { ...sides, rowWidth: 360 }), -300, '1:1 when it can be full-swiped');
  const past = swipeOffset(-500, { ...sides, rowWidth: 360 });
  assert.ok(past < -360 && past > -500, 'gives less past the row');
  assert.equal(swipeOffset(80, { ...sides, rowWidth: 360 }), 0, 'nothing on the left: it does not move');
  const blocked = splitSwipeSides(buildSwipeActions({ onDelete: noop, can: { delete: 'No' } }));
  assert.ok(Math.abs(swipeOffset(-200, { ...blocked, rowWidth: 360 })) < 200, 'a blocked side stops at its block');
});

test('let go: half the block opens, a flick decides, a full swipe runs it', () => {
  const rowWidth = 360;
  const base = { count: 1, rowWidth, full: true, armed: false };
  assert.equal(fullSwipeThreshold(1, rowWidth), Math.max(76 + 48, rowWidth * 0.56));
  assert.equal(settleSwipe({ ...base, offset: -40, velocity: 0 }), 'open');
  assert.equal(settleSwipe({ ...base, offset: -30, velocity: 0 }), 'close');
  assert.equal(settleSwipe({ ...base, offset: 30, velocity: 0 }), 'close', 'the left side works the same way');
  assert.equal(settleSwipe({ ...base, offset: 40, velocity: 0 }), 'open');
  assert.equal(settleSwipe({ ...base, offset: -20, velocity: -1200 }), 'open', 'a flick left opens');
  assert.equal(settleSwipe({ ...base, offset: -60, velocity: 1200 }), 'close', 'a flick right shuts');
  assert.equal(settleSwipe({ ...base, offset: -250, velocity: 0, armed: true }), 'full');
  assert.equal(settleSwipe({ ...base, offset: -250, velocity: SWIPE_FLING_VELOCITY + 100, armed: true }), 'open', 'flicked back');
  assert.equal(settleSwipe({ ...base, offset: -120, velocity: -2500 }), 'full', 'a hard flick past the block');
  assert.equal(settleSwipe({ ...base, offset: -250, velocity: 0, full: false, armed: true }), 'open', 'blocked: no full swipe');
  assert.equal(releaseVelocity([[0, 100], [50, 50], [100, 0]]), -1000);
});

test("the block rides the row's edge, its glyph centred in the strip, icon then label", () => {
  const shut = layerFrame({ x: 0, side: 'trailing' });
  assert.equal(shut.layerX, -0);
  assert.equal(shut.iconOpacity, 0);
  const open = layerFrame({ x: -76, side: 'trailing' });
  assert.equal(open.layerX, -76, 'fills exactly the strip it uncovers');
  assert.equal(open.anchorX, 38, 'glyph in the middle of it');
  assert.equal(open.iconOpacity, 1);
  assert.equal(open.labelOpacity, 1);
  const peek = layerFrame({ x: -30, side: 'trailing' });
  assert.ok(peek.iconOpacity > 0 && peek.iconOpacity < 1 && peek.labelOpacity === 0, 'the icon comes first');
  const covered = layerFrame({ x: -250, side: 'trailing', coverRank: 0, cover: 1 });
  assert.equal(covered.anchorX, 38, 'armed: the glyph stays by the row edge');
  const lead = layerFrame({ x: 76, side: 'leading' });
  assert.equal(lead.layerX, 76);
  assert.equal(lead.anchorX, -38);
});

test("no-bounce springs: the HTML's 0.26s / 0.4s, eased, never past the target", () => {
  assert.deepEqual(SWIPE_SPRING, { snappy: 0.26, smooth: 0.4, morph: 0.42 });
  let max = -Infinity;
  for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, springAt({ from: 0, to: -76, duration: SWIPE_SPRING.snappy, t }).value);
  assert.ok(max <= 0, 'no overshoot');
  assert.ok(Math.abs(springAt({ from: 0, to: -76, duration: SWIPE_SPRING.snappy, t: 0.3 }).value + 76) < 2, 'settled by ~0.3s');
});

test('finger, pen and mouse drag it (as in the HTML); it never fights scrolling, a grip, a field or a native drag', () => {
  assert.doesNotMatch(row, /e\.pointerType === 'mouse' \|\| !e\.isPrimary/, 'a mouse drags it too');
  assert.match(row, /e\.pointerType === 'mouse' && e\.button !== 0/);
  assert.match(row, /root\.addEventListener\('dragstart', onDragStart, true\)/);
  assert.match(row, /if \(dx >= 2 && dx > dy \* 2\) e\.preventDefault\(\);\s*else g = null;/);
  assert.match(row, /Math\.abs\(dy\) >= Math\.abs\(dx\)\)\s*\{\s*g\.mode = 'scroll';/);
  assert.match(row, /closest\?\.\('\[data-drag-rearrange-handle\], \[data-drag-handle\]'\)/);
  assert.match(row, /isEditable\(active\) && \(active === t \|\| active\.contains\(t\)\)/);
  assert.match(row, /dx > 0 && g\.type !== 'mouse' && g\.x0 < EDGE_BACK_PX/);
  assert.match(css, /\.swipe-row \{[^}]*touch-action: pan-y;/);
  // No trackpad wheel swipe: the HTML has none.
  assert.doesNotMatch(row, /'wheel'/);
  // At rest the row clips nothing (sticky cells, drag lift, sort shifts).
  assert.match(css, /\.swipe-row \{[^}]*overflow: visible;/);
  assert.match(css, /\.swipe-row\[data-swipe-revealed\],\s*\.swipe-row\[data-removing\] \{[^}]*overflow: clip;/);
});

test('one row open; elsewhere, scroll, Escape or another swipe shuts it; a tap on it only shuts it', () => {
  assert.match(row, /let closeOpenRow = null;/);
  // An open row is a light popover (dismissRules.js): an outside press shuts
  // it and keeps going, and Escape shuts only the row - never the phone
  // survey sheet it sits in.
  assert.match(row, /import \{ watchLightPopover \} from '\.\/dismissRules\.js';/);
  assert.match(row, /watchLightPopover\(\{\s*contains: \(el\) => root\.contains\(el\)/);
  assert.match(row, /document\.addEventListener\('scroll', onScroll/);
  assert.doesNotMatch(row, /addEventListener\('keydown'|'keydown', onKey/);
  assert.match(row, /mode === 'pending' && wasOpen[\s\S]{0,160}settle\(0\);/);
});

test('Delete on the danger fill (never gold), slides away and folds, honours reduced motion, comes back if kept', () => {
  assert.match(css, /\[data-tone='danger'\] \{\s*background: var\(--danger-fill\);\s*color: var\(--on-danger\);/);
  assert.doesNotMatch(css, /--accent|--gold/);
  assert.match(css, /\.swipe-row\.is-folding \{[^}]*transition: height 400ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important;/);
  assert.match(row, /if \(reducedMotion\(\)\) \{ finish\(\); return; \}/);
  assert.match(row, /setTimeout\(restore, 60\)/);
  // Every block is a real, labelled button with the shared tooltip.
  assert.match(row, /aria-label=\{label \? `\$\{action\.label\} \$\{label\}` : action\.label\}/);
  assert.match(row, /\{\.\.\.tip\(/);
  assert.doesNotMatch(row, /\btitle=/);
});

const lists = {
  'src/home/TemplatesEditor.jsx': ['templateSwipeActions(t)', 'categorySwipeActions(c)', 'entitySwipeActions(r)', "buildSwipeActions({ onDelete: () => deleteItem(ci, it.id) })", "buildSwipeActions({ onDelete: () => deleteItem(i, it.id) })"],
  'src/home/ProjectsFolderTree.jsx': ['projectSwipeActions(p)', 'fileSwipeActions(f)'],
  'src/home/DocumentsLedger.jsx': ['documentSwipeActions(d)'],
  'src/sidebar/BookmarksPanel.jsx': ['buildSwipeActions({ onDelete: onDelete ? () => onDelete(item.id) : undefined })'],
  'src/sidebar/SpacesPanel.jsx': ['onDelete: canManageSpaces ? () => onDelete(space.id) : undefined', "labels: { delete: 'Remove' }"],
  'src/SurveySpacesRail.jsx': ['categorySwipeActions(category)', 'surveyMarkerSwipeActions('],
};

test('wired into every list, off while Select / Edit mode is on', () => {
  for (const [file, needles] of Object.entries(lists)) {
    const src = read(file);
    assert.match(src, /import SwipeActionsRow, \{ buildSwipeActions \} from '\.{1,2}\/(components\/)?(\.\.\/)?(components\/)?SwipeActionsRow\.jsx';/, file);
    needles.forEach((needle) => assert.ok(src.includes(needle), `${file}: ${needle}`));
    assert.equal(src.split('<SwipeActionsRow').length - 1, src.split('</SwipeActionsRow>').length - 1, `${file}: balanced`);
  }
  const templates = read('src/home/TemplatesEditor.jsx');
  assert.match(templates, /<SwipeActionsRow label=\{t\.name\} disabled=\{tplEdit\}/);
  assert.match(templates, /<SwipeActionsRow label=\{c\.name\} disabled=\{catEdit\}/);
  assert.match(read('src/home/ProjectsFolderTree.jsx'), /<SwipeActionsRow label=\{p\.name\} disabled=\{jobsEdit\}/);
  assert.match(read('src/home/DocumentsLedger.jsx'), /disabled=\{docSelectMode\} actions=\{documentSwipeActions\(d\)\}/);
});

test('act first: template delete no longer asks, it offers Undo like documents and projects', () => {
  const dash = read('src/Dashboard.jsx');
  const start = dash.indexOf('const hubArchiveTemplates = async');
  const body = dash.slice(start, dash.indexOf('const hubSaveTemplates = async', start));
  assert.doesNotMatch(body, /askConfirm\(/);
  assert.match(body, /enqueueArchiveUndo\(\{[\s\S]*onUndo: \(\) => \{ void undoArchivedTemplates\(succeeded\); \}/);
  assert.match(body, /restoreArchiveItems\(succeeded\)/);
  // A Survey Marker swipe-delete is one Undo step: delete, then an Undo toast.
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /handleDeleteSurveyMarkerItem\(id\);\s*showToast\(`Deleted \$\{label\}`, 'info', \{ action: \{ label: 'Undo', onClick: \(\) => onUndoLastChange\(\) \}/);
  assert.match(read('src/AppShell.jsx'), /onUndoLastChange=\{active \? \(topToolbarApi\?\.onUndo \|\| null\) : null\}/);
});
