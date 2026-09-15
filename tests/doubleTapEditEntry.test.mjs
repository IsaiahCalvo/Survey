import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOUBLE_TAP_MAX_DELAY_MS,
  buildCaretAnchor,
  createDoubleTapTracker,
  editEntryKeyForHit,
  resolveCaretAnchorPoint,
  shouldHandleDoubleTapEntry,
} from '../src/utils/doubleTapEditEntry.js';

const annotationTap = (over = {}) => ({
  key: 'annotation:1:3', target: { kind: 'annotation', pageNumber: 1, annotationIndex: 3 },
  x: 100, y: 100, t: 0, pointerType: 'mouse', tool: 'pan', ...over,
});

test('only annotation and callout hits carry a pairing key', () => {
  assert.equal(editEntryKeyForHit({ kind: 'annotation', pageNumber: 2, annotationIndex: 0 }), 'annotation:2:0');
  assert.equal(editEntryKeyForHit({ kind: 'callout', calloutId: 'c-9', pageNumber: 2 }), 'callout:c-9');
  assert.equal(editEntryKeyForHit({ kind: 'page', pageNumber: 2 }), null);
  assert.equal(editEntryKeyForHit({ kind: 'counter', pageNumber: 2 }), null);
  assert.equal(editEntryKeyForHit({ kind: 'group', pageNumber: 2, groupIndices: [1, 2] }), null);
  assert.equal(editEntryKeyForHit(null), null);
});

test('two quick taps on the same annotation read as a double-tap', () => {
  const tracker = createDoubleTapTracker();
  assert.equal(tracker.register(annotationTap({ t: 0 })).isDoubleTap, false);
  const second = tracker.register(annotationTap({ t: 200, x: 103 }));
  assert.equal(second.isDoubleTap, true);
  // the tool the gesture STARTED in is what the caller restores
  assert.equal(second.firstTapTool, 'pan');
  assert.deepEqual(second.target, { kind: 'annotation', pageNumber: 1, annotationIndex: 3 });
});

test('a slow second tap is two separate clicks', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  assert.equal(tracker.register(annotationTap({ t: DOUBLE_TAP_MAX_DELAY_MS + 1 })).isDoubleTap, false);
});

test('a mouse pair that wandered is not a double-click, but the same wander passes for touch', () => {
  const mouse = createDoubleTapTracker();
  mouse.register(annotationTap({ t: 0 }));
  assert.equal(mouse.register(annotationTap({ t: 120, x: 110 })).isDoubleTap, false);

  const touch = createDoubleTapTracker();
  touch.register(annotationTap({ t: 0, pointerType: 'touch' }));
  assert.equal(touch.register(annotationTap({ t: 120, x: 110, pointerType: 'touch' })).isDoubleTap, true);
});

test('the FIRST tap decides the target when the hit test disagrees between taps', () => {
  // Pan hand-walks SVG geometry; Select reads the real hit targets. Where
  // annotations overlap the two disagree (observed live on mobile), so the pair
  // must not depend on both taps resolving the same thing.
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  const second = tracker.register(annotationTap({
    t: 100,
    key: 'annotation:1:9',
    target: { kind: 'annotation', pageNumber: 1, annotationIndex: 9 },
  }));
  assert.equal(second.isDoubleTap, true);
  assert.deepEqual(second.target, { kind: 'annotation', pageNumber: 1, annotationIndex: 3 });
});

test('a tap far from the first never pairs, whatever it hit', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  assert.equal(tracker.register(annotationTap({ t: 100, x: 400, y: 400 })).isDoubleTap, false);
});

test('a tap on empty page between two annotation taps breaks the pair', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  assert.equal(tracker.register(annotationTap({ t: 80, key: null, target: null })).isDoubleTap, false);
  assert.equal(tracker.register(annotationTap({ t: 160 })).isDoubleTap, false);
});

test('a double tap that only ever hit empty page opens nothing', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0, key: null, target: null }));
  const second = tracker.register(annotationTap({ t: 100, key: null, target: null }));
  assert.equal(second.isDoubleTap, false);
  assert.equal(second.target, null);
});

test('a triple tap opens the editor once, not twice', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  assert.equal(tracker.register(annotationTap({ t: 100 })).isDoubleTap, true);
  assert.equal(tracker.register(annotationTap({ t: 200 })).isDoubleTap, false);
});

test('a cancelled gesture (pointercancel) drops the pending tap', () => {
  const tracker = createDoubleTapTracker();
  tracker.register(annotationTap({ t: 0 }));
  tracker.reset();
  assert.equal(tracker.register(annotationTap({ t: 100 })).isDoubleTap, false);
});

test('Pan and Text Select own the pair; plain Select with a mouse leaves it to native dblclick', () => {
  assert.equal(shouldHandleDoubleTapEntry({ firstTapTool: 'pan', pointerType: 'mouse' }), true);
  assert.equal(shouldHandleDoubleTapEntry({ firstTapTool: 'text-select', pointerType: 'mouse' }), true);
  assert.equal(shouldHandleDoubleTapEntry({ firstTapTool: 'select', pointerType: 'mouse' }), false);
  // touch never synthesises a reliable dblclick, so we own it in every mode
  assert.equal(shouldHandleDoubleTapEntry({ firstTapTool: 'select', pointerType: 'touch' }), true);
  assert.equal(shouldHandleDoubleTapEntry({ firstTapTool: 'select', pointerType: 'pen' }), true);
});

const hostOf = (left, top, width, height) => ({
  getBoundingClientRect: () => ({ left, top, width, height }),
});

test('a caret anchor records the click as a fraction of the annotation box', () => {
  const anchor = buildCaretAnchor({ x: 130, y: 215, host: hostOf(100, 200, 200, 50) });
  assert.deepEqual(anchor.hostRect, { left: 100, top: 200, width: 200, height: 50 });
  // same box, unmoved -> same point
  assert.deepEqual(resolveCaretAnchorPoint(anchor, { left: 100, top: 200, width: 200, height: 50 }),
    { x: 130, y: 215 });
});

test('a caret anchor survives the scroll that opening the editor can cause', () => {
  // Observed live: under Text Select the editor mounted 500px below the click,
  // so a raw client point pointed nowhere near the glyphs.
  const anchor = buildCaretAnchor({ x: 130, y: 215, host: hostOf(100, 200, 200, 50) });
  const moved = resolveCaretAnchorPoint(anchor, { left: 100, top: 700, width: 200, height: 50 });
  assert.deepEqual(moved, { x: 130, y: 715 });
});

test('a caret anchor rescales when the editor box is inset from the annotation frame', () => {
  const anchor = buildCaretAnchor({ x: 150, y: 210, host: hostOf(100, 200, 200, 50) });
  // editor inset by 10px on every side
  assert.deepEqual(resolveCaretAnchorPoint(anchor, { left: 110, top: 210, width: 180, height: 30 }),
    { x: 155, y: 216 });
});

test('a caret anchor with no usable host falls back to the raw client point', () => {
  const anchor = buildCaretAnchor({ x: 42, y: 84, host: hostOf(0, 0, 0, 0) });
  assert.equal(anchor.hostRect, null);
  assert.deepEqual(resolveCaretAnchorPoint(anchor, { left: 9, top: 9, width: 5, height: 5 }),
    { x: 42, y: 84 });
  assert.equal(buildCaretAnchor({ x: NaN, y: 3, host: null }), null);
  assert.equal(resolveCaretAnchorPoint(null, { left: 0, top: 0, width: 1, height: 1 }), null);
});
