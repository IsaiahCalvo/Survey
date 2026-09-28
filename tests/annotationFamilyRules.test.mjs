// w52 (2026-09-28) — "one annotation family": the shared move / orbit /
// pick / restack / nudge rules every mark type obeys.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canMoveAnnotation,
  canOrbitCounter,
  isInteractiveForActiveSpace,
  isAnnotationInteractiveInActiveSpace,
  filterSelectableCallouts,
  reorderSelectionInStack,
  zOrderDirectionForKey,
  nudgeDeltaForKey,
  isTypingTarget,
  clampNudgeDelta,
  getCalloutPageBox,
  nudgeCalloutPatch,
  buildNudgedPage,
  translateAnnotationForMove,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  NUDGE_IDLE_COMMIT_MS,
  nudgePreviewTransform,
  isArrowOwningPopoverOpen,
  isNudgeKeyStillHeld,
  NUDGE_HELD_KEY_GRACE_MS,
  registerPendingNudgeFlush,
  flushPendingNudges,
} from '../src/utils/annotationFamilyRules.js';

const movementLocked = { type: 'rect', lockMovementX: true, lockMovementY: true };

// ---------------------------------------------------------------- bug 1
test('canMoveAnnotation matches the single-mark drag gate', () => {
  assert.equal(canMoveAnnotation({ type: 'rect', left: 0, top: 0 }), true);
  assert.equal(canMoveAnnotation(null), false);
  assert.equal(canMoveAnnotation({ type: 'group', data: { type: 'text-markup' } }), false);
  assert.equal(canMoveAnnotation(movementLocked), false, 'imported highlight / movement-locked mark');
  assert.equal(canMoveAnnotation({ type: 'rect', lockMovementX: true }), true, 'one axis only is not a lock');
  assert.equal(canMoveAnnotation({
    type: 'rect',
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  }), false);
});

// ---------------------------------------------------------------- bug 4
test('canOrbitCounter needs an unlocked counter (move + rotate)', () => {
  const counter = { type: 'group', data: { type: 'counter' } };
  assert.equal(canOrbitCounter(counter), true);
  assert.equal(canOrbitCounter({ ...counter, lockRotation: true }), false);
  assert.equal(canOrbitCounter({ ...counter, lockMovementX: true, lockMovementY: true }), false);
  assert.equal(canOrbitCounter({ type: 'rect' }), false, 'only counters orbit');
});

// ---------------------------------------------------------------- bug 3
test('isInteractiveForActiveSpace: outside a space everything is interactive', () => {
  assert.equal(isInteractiveForActiveSpace({ activeSpaceId: null }), true);
  assert.equal(isInteractiveForActiveSpace({}), true);
});

test('isInteractiveForActiveSpace: inside a space only that space\'s region marks are', () => {
  assert.equal(isInteractiveForActiveSpace({
    activeSpaceId: 's1', isScopedRegionAnnotation: true, derivedSpaceId: 's1',
  }), true);
  assert.equal(isInteractiveForActiveSpace({
    activeSpaceId: 's1', isScopedRegionAnnotation: true, derivedSpaceId: 's2',
  }), false);
  assert.equal(isInteractiveForActiveSpace({
    activeSpaceId: 's1', isScopedRegionAnnotation: false, derivedSpaceId: null,
  }), false, 'a background (canvas) mark is inert inside a space');
});

test('isAnnotationInteractiveInActiveSpace resolves a callout\'s region to its space', () => {
  const getSpaceIdForRegion = (regionId) => ({ r1: 's1', r2: 's2' }[regionId] ?? null);
  const inSpace = { id: 'c1', regionId: 'r1' };
  const otherSpace = { id: 'c2', regionId: 'r2' };
  const background = { id: 'c3' };
  const args = { activeSpaceId: 's1', getSpaceIdForRegion };
  assert.equal(isAnnotationInteractiveInActiveSpace({ annotation: inSpace, ...args }), true);
  assert.equal(isAnnotationInteractiveInActiveSpace({ annotation: otherSpace, ...args }), false);
  assert.equal(isAnnotationInteractiveInActiveSpace({ annotation: background, ...args }), false);
  assert.equal(isAnnotationInteractiveInActiveSpace({
    annotation: background, activeSpaceId: null, getSpaceIdForRegion,
  }), true);
});

// ---------------------------------------------------------------- bug 2
test('filterSelectableCallouts drops callouts the page hides or makes inert', () => {
  const callouts = [{ id: 'a' }, { id: 'b' }, null, { id: 'c' }];
  const visible = new Set(['a', 'c']);
  assert.deepEqual(
    filterSelectableCallouts(callouts, (id) => visible.has(id)).map((c) => c.id),
    ['a', 'c'],
  );
  assert.equal(filterSelectableCallouts(callouts, undefined), callouts, 'no predicate = legacy passthrough');
  assert.deepEqual(filterSelectableCallouts(null, () => true), []);
});

// ---------------------------------------------------------------- bug 5
test('reorderSelectionInStack: front / back keep the selection\'s relative order', () => {
  const objects = ['a', 'b', 'c', 'd', 'e'];
  const front = reorderSelectionInStack(objects, [3, 0], 'front');
  assert.deepEqual(front.objects, ['b', 'c', 'e', 'a', 'd']);
  assert.deepEqual(front.selectedIndices, [3, 4]);
  assert.equal(front.changed, true);
  const back = reorderSelectionInStack(objects, [1, 4], 'back');
  assert.deepEqual(back.objects, ['b', 'e', 'a', 'c', 'd']);
  assert.deepEqual(back.selectedIndices, [0, 1]);
});

test('reorderSelectionInStack: forward / backward step each run past one neighbour', () => {
  const objects = ['a', 'b', 'c', 'd', 'e'];
  const forward = reorderSelectionInStack(objects, [0, 1, 3], 'forward');
  assert.deepEqual(forward.objects, ['c', 'a', 'b', 'e', 'd']);
  assert.deepEqual(forward.selectedIndices, [1, 2, 4]);
  const backward = reorderSelectionInStack(objects, [1, 3, 4], 'backward');
  assert.deepEqual(backward.objects, ['b', 'a', 'd', 'e', 'c']);
  assert.deepEqual(backward.selectedIndices, [0, 2, 3]);
});

test('reorderSelectionInStack: already at the top / bottom is a no-op', () => {
  const objects = ['a', 'b', 'c'];
  assert.equal(reorderSelectionInStack(objects, [1, 2], 'front').changed, false);
  assert.equal(reorderSelectionInStack(objects, [1, 2], 'forward').changed, false);
  assert.equal(reorderSelectionInStack(objects, [0, 1], 'back').changed, false);
  assert.equal(reorderSelectionInStack(objects, [0], 'backward').changed, false);
});

test('reorderSelectionInStack moves callouts and shapes together, same object refs', () => {
  const shape = { type: 'rect', id: 's' };
  const callout = { type: 'group', data: { type: 'callout', id: 'c1' } };
  const other = { type: 'rect', id: 'o' };
  const objects = [shape, other, callout];
  const result = reorderSelectionInStack(objects, [0, 2], 'back');
  assert.equal(result.objects[0], shape);
  assert.equal(result.objects[1], callout);
  assert.equal(result.objects[2], other);
  assert.deepEqual(result.order, [0, 2, 1]);
  assert.deepEqual(objects, [shape, other, callout], 'input untouched');
});

test('reorderSelectionInStack ignores out-of-range and duplicate indices', () => {
  const result = reorderSelectionInStack(['a', 'b', 'c'], [0, 0, 9, -1, 1.5], 'front');
  assert.deepEqual(result.objects, ['b', 'c', 'a']);
});

test('zOrderDirectionForKey maps the four Cmd/Ctrl bracket chords', () => {
  const k = (code, extra = {}) => ({ code, metaKey: true, ...extra });
  assert.equal(zOrderDirectionForKey(k('BracketRight')), 'forward');
  assert.equal(zOrderDirectionForKey(k('BracketRight', { shiftKey: true })), 'front');
  assert.equal(zOrderDirectionForKey(k('BracketLeft')), 'backward');
  assert.equal(zOrderDirectionForKey(k('BracketLeft', { shiftKey: true })), 'back');
  assert.equal(zOrderDirectionForKey({ code: 'BracketLeft', ctrlKey: true }), 'backward');
  assert.equal(zOrderDirectionForKey({ code: 'BracketLeft' }), null, 'no modifier');
  assert.equal(zOrderDirectionForKey(k('BracketLeft', { altKey: true })), null);
  assert.equal(zOrderDirectionForKey(k('KeyC')), null);
});

// ---------------------------------------------------------------- bug 6
test('nudgeDeltaForKey: 1 page unit per press, Shift = 10, chords ignored', () => {
  assert.equal(NUDGE_STEP, 1);
  assert.equal(NUDGE_STEP_LARGE, 10);
  assert.deepEqual(nudgeDeltaForKey({ key: 'ArrowLeft' }), { dx: -1, dy: 0 });
  assert.deepEqual(nudgeDeltaForKey({ key: 'ArrowRight' }), { dx: 1, dy: 0 });
  assert.deepEqual(nudgeDeltaForKey({ key: 'ArrowUp' }), { dx: 0, dy: -1 });
  assert.deepEqual(nudgeDeltaForKey({ key: 'ArrowDown', shiftKey: true }), { dx: 0, dy: 10 });
  assert.equal(nudgeDeltaForKey({ key: 'ArrowDown', metaKey: true }), null);
  assert.equal(nudgeDeltaForKey({ key: 'ArrowDown', ctrlKey: true }), null);
  assert.equal(nudgeDeltaForKey({ key: 'ArrowDown', altKey: true }), null);
  assert.equal(nudgeDeltaForKey({ key: 'PageDown' }), null);
  assert.equal(nudgeDeltaForKey(null), null);
});

test('isTypingTarget: inputs, text areas, selects and editors own the arrow keys', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'textarea' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', contentEditable: 'true' }), true);
  assert.equal(isTypingTarget({
    tagName: 'SPAN',
    closest: (selector) => (selector === '.fabric-hidden-textarea' ? {} : null),
  }), true);
  assert.equal(isTypingTarget({ tagName: 'BODY', closest: () => null }), false);
  assert.equal(isTypingTarget(null), false);
});

test('clampNudgeDelta keeps the union box on the page, all members by one amount', () => {
  const boxes = [
    { left: 2, top: 50, width: 10, height: 10 },
    { left: 40, top: 80, width: 10, height: 15 },
  ];
  assert.deepEqual(clampNudgeDelta(boxes, -10, 0, 100, 100), { dx: -2, dy: 0 });
  assert.deepEqual(clampNudgeDelta(boxes, 0, 10, 100, 100), { dx: 0, dy: 5 });
  assert.deepEqual(clampNudgeDelta(boxes, 3, -3, 100, 100), { dx: 3, dy: -3 });
});

test('clampNudgeDelta never pushes an already off-page box back in the wrong way', () => {
  const box = [{ left: -5, top: 0, width: 10, height: 10 }];
  assert.deepEqual(clampNudgeDelta(box, -1, 0, 100, 100), { dx: 0, dy: 0 });
  assert.deepEqual(clampNudgeDelta(box, 1, 0, 100, 100), { dx: 1, dy: 0 });
  assert.deepEqual(clampNudgeDelta([], 4, 4, 100, 100), { dx: 4, dy: 4 });
});

test('callout nudge: page box and normalized patch', () => {
  const callout = {
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.3, y: 0.2 },
    textBoxPosition: { x: 0.4, y: 0.1 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
  };
  const box = getCalloutPageBox(callout, 1000, 500);
  assert.equal(box.left, 100);
  assert.equal(box.top, 50);
  assert.ok(Math.abs(box.width - 500) < 1e-9);
  assert.ok(Math.abs(box.height - 50) < 1e-9);
  const patch = nudgeCalloutPatch(callout, 10, -5, 1000, 500);
  assert.ok(Math.abs(patch.arrowTip.x - 0.11) < 1e-9);
  assert.ok(Math.abs(patch.arrowTip.y - 0.19) < 1e-9);
  assert.ok(Math.abs(patch.knee.x - 0.31) < 1e-9);
  assert.ok(Math.abs(patch.textBoxPosition.y - 0.09) < 1e-9);
  assert.deepEqual(callout.arrowTip, { x: 0.1, y: 0.2 }, 'original untouched');
});

test('translateAnnotationForMove moves a curved line\'s absolute midpoint too', () => {
  const line = { type: 'line', left: 10, top: 10, data: { midpoint: { x: 50, y: 60 } } };
  const moved = translateAnnotationForMove(line, 5, -2);
  assert.equal(moved.left, 15);
  assert.equal(moved.top, 8);
  assert.deepEqual(moved.data.midpoint, { x: 55, y: 58 });
  assert.equal(line.left, 10, 'input untouched');
});

test('buildNudgedPage moves only the nudged marks and keeps others\' concurrent edits', () => {
  const start = { id: 'a', type: 'rect', left: 10, top: 10, width: 20, height: 20, fill: 'red' };
  const currentPage = {
    objects: [
      // a collaborator recoloured the nudged mark mid-burst — keep it
      { ...start, fill: 'blue' },
      { id: 'b', type: 'rect', left: 100, top: 100, width: 5, height: 5 },
    ],
  };
  const result = buildNudgedPage(currentPage, { 0: start }, 3, -1);
  assert.deepEqual(result.indexes, [0]);
  assert.equal(result.annotations.objects[0].left, 13);
  assert.equal(result.annotations.objects[0].top, 9);
  assert.equal(result.annotations.objects[0].fill, 'blue');
  assert.equal(result.annotations.objects[1], currentPage.objects[1], 'other marks untouched');
  assert.equal(currentPage.objects[0].left, 10, 'current page not mutated');
});

test('buildNudgedPage finds a mark by id after it moved in the stack, skips deleted ones', () => {
  const start = { id: 'a', type: 'rect', left: 0, top: 0, width: 4, height: 4 };
  const moved = buildNudgedPage({ objects: [{ id: 'z', type: 'rect' }, { ...start }] }, { 0: start }, 1, 1);
  assert.deepEqual(moved.indexes, [1]);
  assert.equal(moved.annotations.objects[1].left, 1);
  assert.equal(buildNudgedPage({ objects: [{ id: 'z', type: 'rect' }] }, { 0: start }, 1, 1), null);
});

// ---------------------------------------------------------------- w57
test('w57: a burst commits ~400 ms after the last press (longer than the auto-repeat gap)', () => {
  // OS auto-repeat fires every ~30-80 ms and a quick re-tap lands in
  // ~150-250 ms; the commit waits past both, then saves once.
  assert.ok(NUDGE_IDLE_COMMIT_MS >= 300 && NUDGE_IDLE_COMMIT_MS <= 500, String(NUDGE_IDLE_COMMIT_MS));
});

test('w57: nudge preview is a render-time translate (single shape like a drag, else like a group drag)', () => {
  const single = nudgePreviewTransform({
    startObjects: { 3: { id: 'a' } }, calloutOriginals: {}, markerBoxes: {}, singleShape: true, dx: 2, dy: -10,
  });
  assert.deepEqual(single, { id: 3, dx: 2, dy: -10, nudge: true });

  const group = nudgePreviewTransform({
    startObjects: { 0: {}, 2: {} }, calloutOriginals: { c1: {} }, markerBoxes: { m1: {} }, singleShape: false, dx: 1, dy: 0,
  });
  assert.equal(group.id, 'group');
  assert.equal(group.nudge, true);
  assert.deepEqual([...group.affectedIds], [0, 2]);
  assert.deepEqual([...group.affectedCalloutIds], ['c1']);
  assert.deepEqual([...group.affectedMarkerIds], ['m1']);
  assert.deepEqual(group.markerDelta, { dx: 1, dy: 0 });

  // one shape moving out of a bigger selection (the rest locked) still
  // previews as a group, so the group frame follows
  const partial = nudgePreviewTransform({ startObjects: { 1: {} }, calloutOriginals: {}, singleShape: false, dx: 0, dy: 1 });
  assert.equal(partial.id, 'group');
  assert.equal(partial.affectedCalloutIds, null);
  assert.equal(partial.affectedMarkerIds, null);
});

test('w57: an open right-click menu owns the arrow keys', () => {
  const docWith = (found) => ({ querySelector: (sel) => (sel === '[data-annotation-context-menu]' && found ? {} : null) });
  assert.equal(isArrowOwningPopoverOpen(docWith(true)), true);
  assert.equal(isArrowOwningPopoverOpen(docWith(false)), false);
  assert.equal(isArrowOwningPopoverOpen(null), false);
});

test('w57: a held arrow key keeps the burst open; a lost release stops counting after the grace', () => {
  const burst = { keysDown: new Set(['ArrowRight']), lastKeyDownAt: 1000 };
  assert.equal(isNudgeKeyStillHeld(burst, 1000 + 1900), true, 'a slow OS repeat delay (~2 s) is still one hold');
  assert.equal(isNudgeKeyStillHeld(burst, 1000 + NUDGE_HELD_KEY_GRACE_MS), false, 'a release the page never saw');
  assert.equal(isNudgeKeyStillHeld({ keysDown: new Set(), lastKeyDownAt: 1000 }, 1001), false, 'released');
  assert.equal(isNudgeKeyStillHeld(null, 0), false);
});

test('w57: flushPendingNudges runs every registered flush; unregister removes it; one failure never blocks', () => {
  const ran = [];
  const offA = registerPendingNudgeFlush(() => ran.push('a'));
  const offB = registerPendingNudgeFlush(() => { throw new Error('boom'); });
  const offC = registerPendingNudgeFlush(() => ran.push('c'));
  flushPendingNudges();
  assert.deepEqual(ran, ['a', 'c']);
  offA(); offB(); offC();
  flushPendingNudges();
  assert.deepEqual(ran, ['a', 'c']);
});
