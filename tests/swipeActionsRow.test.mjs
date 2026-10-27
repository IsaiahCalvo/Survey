/*
 * swipeActionsRow.test.mjs — owner 2026-10-27: slide any list row left for
 * its actions (Duplicate, Move, Copy, Share, Delete) without Select / Edit
 * mode, modelled on the EDC tracker's account list. Grew out of the
 * 2026-10-02 phone swipe-to-delete on Templates.
 *
 * Pins the pure rules (src/utils/swipeActions.js), the gesture rules that keep
 * the row out of the way (src/components/SwipeActionsRow.jsx) and the wiring
 * in every list. The motion itself is checked in a browser
 * (debug/scenarios/swipe-actions-row.spec.mjs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SWIPE_ACTION_ORDER,
  SWIPE_ACTION_WIDTH,
  SWIPE_FLING_VELOCITY,
  buildSwipeActions,
  canFullSwipe,
  fullSwipeThreshold,
  layoutSwipeSlots,
  releaseVelocity,
  revealAmount,
  settleSwipe,
  swipeOffset,
  swipeSlotBudget,
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

test('only what fits shows; the rest folds into More at the front, order kept', () => {
  const five = buildSwipeActions({ onDelete: noop, onShare: noop, onCopy: noop, onMove: noop, onDuplicate: noop });
  assert.equal(swipeSlotBudget(0), 3);
  assert.equal(swipeSlotBudget(360), 3);
  assert.equal(swipeSlotBudget(260), 3, 'a 260px desktop rail still shows three');
  assert.equal(swipeSlotBudget(900), 5);
  const phone = layoutSwipeSlots(five, 3);
  assert.deepEqual(phone.map((s) => s.key), ['more', 'share', 'delete']);
  assert.deepEqual(phone[0].overflow.map((a) => a.key), ['duplicate', 'move', 'copy']);
  assert.deepEqual(layoutSwipeSlots(five, 5).map((s) => s.key), ['duplicate', 'move', 'copy', 'share', 'delete']);
  assert.equal(canFullSwipe(phone), true);
  assert.equal(canFullSwipe(buildSwipeActions({ onMove: noop })), false);
  assert.equal(canFullSwipe(buildSwipeActions({ onDelete: noop, can: { delete: 'Only the owner can delete' } })), false, 'a blocked Delete is never full-swiped');
});

test('the row follows the finger, rubber-bands past the tray, barely moves right', () => {
  const reveal = 2 * SWIPE_ACTION_WIDTH;
  assert.equal(swipeOffset(0, -100, { reveal, rowWidth: 360 }), -100);
  const past = swipeOffset(0, -300, { reveal, rowWidth: 360 });
  assert.ok(past < -reveal && past > -300, 'gives less past the tray');
  assert.equal(swipeOffset(0, -300, { reveal, rowWidth: 360, full: true }), -300, '1:1 when it can be full-swiped');
  assert.ok(swipeOffset(0, 80, { reveal, rowWidth: 360 }) < 24);
});

test('let go: half the tray opens, a flick decides, a full swipe deletes', () => {
  const reveal = 144;
  const rowWidth = 360;
  assert.equal(fullSwipeThreshold(reveal, rowWidth), Math.max(reveal + 48, rowWidth * 0.56));
  assert.equal(settleSwipe({ offset: -80, velocity: 0, reveal, rowWidth, full: true, armed: false }), 'open');
  assert.equal(settleSwipe({ offset: -60, velocity: 0, reveal, rowWidth, full: true, armed: false }), 'close');
  assert.equal(settleSwipe({ offset: -40, velocity: -1200, reveal, rowWidth, full: true, armed: false }), 'open', 'a flick left opens');
  assert.equal(settleSwipe({ offset: -100, velocity: 1200, reveal, rowWidth, full: true, armed: false }), 'close', 'a flick right shuts');
  assert.equal(settleSwipe({ offset: -250, velocity: 0, reveal, rowWidth, full: true, armed: true }), 'full');
  assert.equal(settleSwipe({ offset: -250, velocity: SWIPE_FLING_VELOCITY + 100, reveal, rowWidth, full: true, armed: true }), 'open', 'flicked back');
  assert.equal(settleSwipe({ offset: -170, velocity: -2500, reveal, rowWidth, full: true, armed: false }), 'full', 'a hard flick past the tray');
  assert.equal(settleSwipe({ offset: -250, velocity: 0, reveal, rowWidth, full: false, armed: true }), 'open', 'no Delete, no full swipe');
  assert.equal(releaseVelocity([[0, 100], [50, 50], [100, 0]]), -1000);
  assert.equal(revealAmount(0, 2), 0);
  assert.equal(revealAmount(2 * SWIPE_ACTION_WIDTH, 2), 1);
});

test('it never fights scrolling, a reorder grip, a focused field or the edge-swipe back', () => {
  assert.match(row, /Math\.abs\(dy\) >= Math\.abs\(dx\)\)\s*\{\s*g\.mode = 'scroll';/);
  assert.match(row, /closest\?\.\('\[data-drag-rearrange-handle\], \[data-drag-handle\]'\)/);
  assert.match(row, /isEditable\(active\) && \(active === t \|\| active\.contains\(t\)\)/);
  assert.match(row, /if \(dx > 0 && g\.base === 0\) \{ g\.mode = 'scroll'; return; \}/);
  assert.match(css, /\.swipe-row \{[^}]*touch-action: pan-y;/);
  // A mouse never drags it (rows keep drag-to-reorder); a trackpad swipe does.
  assert.match(row, /e\.pointerType === 'mouse'/);
  assert.match(row, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(row, /scrollsSideways\(e\.target, root\.parentElement\)/);
  // At rest the row clips nothing (sticky cells, drag lift, sort shifts).
  assert.match(css, /\.swipe-row \{[^}]*overflow: visible;/);
  assert.match(css, /\.swipe-row\[data-swipe-revealed\],\s*\.swipe-row\.is-collapsing \{[^}]*overflow: clip;/);
});

test('one row open; elsewhere, scroll, Escape or another swipe shuts it; a tap on it only shuts it', () => {
  assert.match(row, /let closeOpenRow = null;/);
  // An open row is a light popover (dismissRules.js): an outside press shuts
  // it and keeps going, and Escape shuts only the row - never the phone
  // survey sheet it sits in (that sheet closed with it before).
  assert.match(row, /import \{ watchLightPopover \} from '\.\/dismissRules\.js';/);
  assert.match(row, /watchLightPopover\(\{\s*contains: \(el\) => root\.contains\(el\)/);
  assert.match(row, /document\.addEventListener\('scroll', onScroll/);
  assert.doesNotMatch(row, /addEventListener\('keydown'|'keydown', onKey/);
  assert.match(row, /mode === 'pending' && wasOpen[\s\S]{0,160}close\(\);/);
});

test('Delete on the danger fill (never gold), folds the row, honours reduced motion, unfolds if kept', () => {
  assert.match(css, /\[data-tone='danger'\] \{\s*background: var\(--danger-fill\);\s*color: var\(--on-danger\);/);
  assert.doesNotMatch(css, /--accent|--gold/);
  assert.match(css, /\.swipe-row\.is-collapsing \{[^}]*transition: height 220ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none !important;/);
  assert.match(row, /if \(reducedMotion\(\)\) \{ finish\(\); return; \}/);
  assert.match(row, /setTimeout\(restore, 60\)/);
  // Every action button is a real, labelled button with the shared tooltip.
  assert.match(row, /aria-label=\{slot\.overflow \? 'More actions' : slot\.label\}/);
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
