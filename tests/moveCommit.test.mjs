// w59 (owner 2026-09-28) — "When I Command-drag, I can drag it, but when I
// release it, it just snaps back." The drag preview followed the pointer with
// no page clamp while the save clamped each mark back inside the page, so a
// mark let go past a page edge (easy with a tiny mark zoomed out) jumped on
// release; group drags clamped each member on its own; the save found the
// mark by its drag-start list position. These pin the one shared rule
// (src/utils/moveCommit.js) and that both the preview and the save use it.
// The browser replay is scripts/verify-cmd-drag-snapback.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  markIdOf,
  resolveMarkIndex,
  clampMoveDelta,
  moveCommitThreshold,
  isBeyondMoveThreshold,
  describeDroppedMove,
} from '../src/utils/moveCommit.js';
import { attachMoveModifierListeners, getMoveModifierHeld } from '../src/utils/moveModifier.js';

const W = 612;
const H = 792;

test('a mark dragged past the page edge stops AT the edge, in the preview and the save alike', () => {
  const box = { left: 590, top: 100, width: 12, height: 10 }; // tiny rect hugging the right edge
  assert.deepEqual(clampMoveDelta([box], 60, 0, W, H), { dx: 10, dy: 0 });
  // along the edge: the along part still moves
  assert.deepEqual(clampMoveDelta([box], 30, 25, W, H), { dx: 10, dy: 25 });
  // fully blocked: nothing moves (and nothing snaps — the preview showed 0 too)
  const atEdge = { left: 600, top: 100, width: 12, height: 10 };
  assert.deepEqual(clampMoveDelta([atEdge], 200, 0, W, H), { dx: 0, dy: 0 });
});

test('a mark already hanging over an edge is never yanked back in (older / imported marks)', () => {
  const hanging = { left: -8, top: 300, width: 40, height: 20 };
  // a small drag right moves it by exactly that much (the old save jumped it to 0)
  assert.deepEqual(clampMoveDelta([hanging], 3, 0, W, H), { dx: 3, dy: 0 });
  // it can never be pushed further off
  assert.deepEqual(clampMoveDelta([hanging], -20, 0, W, H), { dx: 0, dy: 0 });
  // a box wider than the page stays where it is horizontally
  const wide = { left: -10, top: 10, width: 700, height: 20 };
  assert.deepEqual(clampMoveDelta([wide], 50, 5, W, H), { dx: 0, dy: 5 });
});

test('a group moves as one rigid piece — members never slide apart at an edge', () => {
  const rect = { left: 590, top: 10, width: 12, height: 10 };
  const counter = { left: 300, top: 2, width: 10, height: 10 };
  const d = clampMoveDelta([rect, counter], 80, -80, W, H);
  assert.deepEqual(d, { dx: 10, dy: -2 });
});

test('bad input never moves a mark', () => {
  assert.deepEqual(clampMoveDelta([{ left: 10, top: 10, width: 5, height: 5 }], NaN, Infinity, W, H), { dx: 0, dy: 0 });
  // a box with no usable numbers is ignored (no clamp, no NaN)
  assert.deepEqual(clampMoveDelta([{ left: NaN, top: 0, width: 1, height: 1 }], 4, 5, W, H), { dx: 4, dy: 5 });
});

test('the dragged mark is found by id at release, even if the page list changed mid-drag', () => {
  const a = { id: 'a' };
  const b = { data: { id: 'b' } };
  const c = { id: 'c' };
  assert.equal(markIdOf(b), 'b');
  // started at index 1 ('b'); a collaborator deleted 'a' during the drag
  assert.equal(resolveMarkIndex([b, c], 1, 'b'), 0);
  // someone added a mark in front
  assert.equal(resolveMarkIndex([{ id: 'x' }, a, b, c], 1, 'b'), 2);
  // it was deleted: -1 (nothing saved, nothing else moved)
  assert.equal(resolveMarkIndex([a, c], 1, 'b'), -1);
  // an id-less legacy mark falls back to its drag-start position
  assert.equal(resolveMarkIndex([{ type: 'rect' }, { type: 'path' }], 1, null), 1);
  assert.equal(resolveMarkIndex([{ type: 'rect' }], 1, null), -1);
});

test('the drag-or-click threshold is a small screen slop at high zoom, never more than 2 page units', () => {
  // inverseScale = page units per screen pixel
  assert.equal(moveCommitThreshold(1), 2); // 100 %: unchanged
  assert.equal(moveCommitThreshold(4), 2); // 25 %: unchanged
  assert.equal(moveCommitThreshold(0.125), 0.5); // 800 %: 4 px, not 16 px
  assert.equal(moveCommitThreshold(0.125, 'touch'), 1); // a finger gets 8 px
  assert.equal(moveCommitThreshold(undefined), 2);
  assert.equal(isBeyondMoveThreshold(1, 0, 0.125), true); // an 8 px drag at 800 % saves
  assert.equal(isBeyondMoveThreshold(0.25, 0, 0.125), false); // a 2 px wobble is still a click
  assert.equal(isBeyondMoveThreshold(1, 0, 1), false); // a 1 px wobble at 100 % is a click
});

test('a drag that ends without saving logs one line with the reason, the PDF and the delta', () => {
  const line = describeDroppedMove({
    reason: 'held-at-page-edge', mode: 'move', type: 'Rect', id: 'r1', dx: 200.123, dy: 0, pageNumber: 3, pdfName: 'Package 2 - Rev 4 -- IC.pdf',
  });
  assert.equal(line, '[MoveDiag] drag ended without saving reason=held-at-page-edge pdf=Package 2 - Rev 4 -- IC.pdf page=3 mode=move type=Rect id=r1 dx=200.12 dy=0');
  assert.match(describeDroppedMove({ reason: 'mark-gone', mode: 'move' }), /pdf=unknown\.pdf/);
});

// Replays the owner's key orders against the real key store and the shared
// rule: at every pointer move the preview is clampMoveDelta(raw); at release
// the save is the same call. Whatever order Cmd goes up in, what was shown
// last is what is saved.
function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { for (const fn of Array.from(listeners.get(type) || [])) fn(event); },
  };
}

function replay(steps, box) {
  const win = fakeWindow();
  const detach = attachMoveModifierListeners(win, { mac: true, doc: null });
  let drag = null;
  let lastPreview = null;
  const saves = [];
  for (const [kind, arg] of steps) {
    if (kind === 'metaDown') win.fire('keydown', { key: 'Meta', metaKey: true });
    else if (kind === 'metaUp') win.fire('keyup', { key: 'Meta', metaKey: false });
    else if (kind === 'down') {
      win.fire('pointerdown', { metaKey: arg.meta });
      // a press only starts a move while the key is held (the move zone)
      drag = getMoveModifierHeld() ? { x0: arg.x, y0: arg.y } : null;
      lastPreview = null;
    } else if (kind === 'move') {
      win.fire('pointermove', { metaKey: arg.meta });
      if (drag) lastPreview = clampMoveDelta([box], arg.x - drag.x0, arg.y - drag.y0, W, H);
    } else if (kind === 'up') {
      if (drag) {
        const raw = { dx: arg.x - drag.x0, dy: arg.y - drag.y0 };
        const saved = isBeyondMoveThreshold(raw.dx, raw.dy, 1)
          ? clampMoveDelta([box], raw.dx, raw.dy, W, H)
          : { dx: 0, dy: 0 };
        saves.push({ saved, shown: lastPreview });
        box = { ...box, left: box.left + saved.dx, top: box.top + saved.dy };
      }
      drag = null;
    }
  }
  detach();
  return { saves, box };
}

const glide = (x0, y0, dx, dy, meta, n = 20) => Array.from({ length: n }, (_, i) => (
  ['move', { x: x0 + (dx * (i + 1)) / n, y: y0 + (dy * (i + 1)) / n, meta }]
));

test('(a) Cmd down -> press -> move -> release -> Cmd up: the mark stays where it was shown', () => {
  const box = { left: 580, top: 100, width: 12, height: 10 };
  const { saves, box: end } = replay([
    ['metaDown'], ['down', { x: 586, y: 105, meta: true }], ...glide(586, 105, 60, 30, true),
    ['up', { x: 646, y: 135 }], ['metaUp'],
  ], box);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].saved, saves[0].shown);
  assert.deepEqual(saves[0].saved, { dx: 20, dy: 30 });
  assert.equal(end.left + end.width, W, 'held at the right edge, not snapped back');
  // The old code: the preview followed the raw pointer (60, 30) and the save
  // clamped the box into the page — the mark visibly jumped by 40 px.
  const oldShown = { dx: 60, dy: 30 };
  const oldSaved = { dx: Math.max(0, Math.min(box.left + 60, W - box.width)) - box.left, dy: 30 };
  assert.notDeepEqual(oldSaved, oldShown, 'the old rules disagreed: that disagreement was the snap back');
  assert.deepEqual(oldSaved, saves[0].saved, 'the save lands where the old save did; only the preview changed');
});

test('(b) Cmd let go mid-drag: the move carries on and saves what was shown', () => {
  const box = { left: 300, top: 780, width: 10, height: 6 };
  const { saves } = replay([
    ['metaDown'], ['down', { x: 305, y: 783, meta: true }], ...glide(305, 783, 20, 10, true, 10),
    ['metaUp'], ...glide(325, 793, 20, 10, false, 10), ['up', { x: 345, y: 803 }],
  ], box);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].saved, saves[0].shown);
  assert.deepEqual(saves[0].saved, { dx: 40, dy: 6 });
});

test('(c) Cmd held for several drags in a row: every drag saves what it showed', () => {
  const box = { left: 20, top: 20, width: 10, height: 10 };
  const { saves, box: end } = replay([
    ['metaDown'],
    ['down', { x: 25, y: 25, meta: true }], ...glide(25, 25, -40, 10, true), ['up', { x: -15, y: 35 }],
    ['down', { x: 5, y: 35, meta: true }], ...glide(5, 35, 30, -60, true), ['up', { x: 35, y: -25 }],
    ['down', { x: 35, y: 5, meta: true }], ...glide(35, 5, 50, 50, true), ['up', { x: 85, y: 55 }],
    ['metaUp'],
  ], box);
  assert.equal(saves.length, 3);
  for (const s of saves) assert.deepEqual(s.saved, s.shown);
  // (20,20) -> left edge (0,30) -> top edge (30,0) -> (80,50)
  assert.deepEqual(end, { left: 80, top: 50, width: 10, height: 10 });
});

// Source assertions (the repo's pattern for hooks that need a DOM): the drag
// preview and the save both go through the shared rule.
const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');

test('single move: the preview and the save use the same clamp and the save finds the mark by id', () => {
  assert.match(hook, /const shown = clampMoveDelta\(ds\.moveBoxes, dx, dy, pageWidth, pageHeight\);/);
  assert.match(hook, /setVisualTransform\(\{ id: ds\.annotationIndex, dx: shown\.dx, dy: shown\.dy \}\);/);
  assert.match(hook, /const moveIndex = resolveMarkIndex\(annotations\?\.objects, ds\.annotationIndex, ds\.markId\);/);
  assert.match(hook, /const \{ dx: actualDx, dy: actualDy \} = clampMoveDelta\(ds\.moveBoxes, dx, dy, pageWidth, pageHeight\);/);
  assert.match(hook, /const targetObj = updatedAnnotations\.objects\[moveIndex\];/);
  // no second, disagreeing page clamp on release any more
  assert.doesNotMatch(hook, /constrainToPage\(/);
  // after a counter's Shift-orbit the preview draws the orbited pose moved by
  // the same delta, and the release keeps the orbit's pointer angle
  assert.match(hook, /left: \(ds\.orbitBase\.left \?\? 0\) \+ shown\.dx,/);
  assert.match(hook, /pointerAngle: ds\.orbitBase\.data\.pointerAngle/);
});

test('group move: one rigid clamp for preview and save, callouts and markers included, members found by id', () => {
  assert.match(hook, /const \{ dx, dy \} = clampMoveDelta\(\s*ds\.groupBoxes,/);
  assert.match(hook, /\? clampMoveDelta\(ds\.groupBoxes, rawGroupDx, rawGroupDy, pageWidth, pageHeight\)/);
  assert.match(hook, /resolveMarkIndex\(updatedAnnotations\.objects, Number\(idxStr\), ds\.groupIds\?\.\[idxStr\] \?\? null\)/);
  assert.match(hook, /const dxNorm = dx \/ W;/);
  // a whole-callout move keeps the callout on the page with the same rule
  assert.match(hook, /const kept = clampMoveDelta\(wholeBox \? \[wholeBox\] : \[\], dxPage, dyPage, W, H\);/);
});

test('a drag that saves nothing says why (one [MoveDiag] line)', () => {
  assert.match(hook, /reportDroppedMove\(\{ reason: 'mark-gone', mode: 'move'/);
  assert.match(hook, /reason: 'held-at-page-edge', mode: 'move'/);
  assert.match(hook, /reportDroppedMove\(\{ reason: 'held-at-page-edge', mode: 'group-move'/);
  // the drag-start facts reset with the rest of the drag state
  assert.match(hook, /markId: undefined, moveBoxes: null, groupIds: null, groupBoxes: null, orbitBase: null,/);
  // a mark the lock guard puts back logs the reason too
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /\[MoveDiag\] save put locked marks back reason=locked pdf=/);
});
