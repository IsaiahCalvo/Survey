import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOUBLE_TAP_MAX_DELAY_MS,
  buildCaretAnchor,
  caretAnchorHostFor,
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

// ---------------------------------------------------------------------------
// Callout carrier vs callout text box (the caret-at-the-end bug, 2026-09-15)
// ---------------------------------------------------------------------------

/**
 * A callout as the DOM sees it: the carrier <g data-callout-id> spans the
 * arrow tip on the left all the way to the right edge of the text box, and the
 * text box lives in the right-hand quarter of it.
 */
const calloutCarrierOf = ({ carrier, text = null, textBox = null } = {}) => ({
  getAttribute: (name) => (name === 'data-callout-id' ? 'c-1' : null),
  getBoundingClientRect: () => carrier,
  querySelector: (selector) => {
    if (selector === '[data-callout-part="text"]') return text ? hostOf(text.left, text.top, text.width, text.height) : null;
    if (selector === '[data-callout-part="textBox"]') return textBox ? hostOf(textBox.left, textBox.top, textBox.width, textBox.height) : null;
    return null;
  },
});

test('a callout anchors against its text box, not the arrow-to-box carrier', () => {
  // carrier: arrow tip at x=100, text box from x=400 to x=600.
  const carrier = { left: 100, top: 180, width: 500, height: 120 };
  const textArea = { left: 406, top: 200, width: 188, height: 40 };
  const host = caretAnchorHostFor(calloutCarrierOf({ carrier, text: textArea }));
  assert.deepEqual(host.getBoundingClientRect(), textArea);

  // A double-click on the FIRST letter of the callout's text.
  const anchor = buildCaretAnchor({ x: 410, y: 218, host: calloutCarrierOf({ carrier, text: textArea }) });
  assert.deepEqual(anchor.hostRect, textArea);
  // The editor covers that same text area, so the point comes back unmoved —
  // it lands on the first letter. Measured against the carrier it resolved to
  // (410-100)/500 = 0.62 of the editor's width instead, i.e. the middle of the
  // string; a click past the middle of the box resolved past the last glyph and
  // the caret collapsed to the end.
  assert.deepEqual(resolveCaretAnchorPoint(anchor, textArea), { x: 410, y: 218 });
  const carrierAnchor = { x: 410, y: 218, hostRect: carrier };
  assert.notDeepEqual(resolveCaretAnchorPoint(carrierAnchor, textArea), { x: 410, y: 218 });
});

test('a callout with no text foreignObject falls back to its border rect, then the carrier', () => {
  const carrier = { left: 100, top: 180, width: 500, height: 120 };
  const border = { left: 400, top: 200, width: 200, height: 40 };
  assert.deepEqual(
    caretAnchorHostFor(calloutCarrierOf({ carrier, textBox: border })).getBoundingClientRect(),
    border,
  );
  // hidden text + a collapsed border rect: the carrier is still better than nothing
  assert.deepEqual(
    caretAnchorHostFor(calloutCarrierOf({ carrier, text: { left: 0, top: 0, width: 0, height: 0 } })).getBoundingClientRect(),
    carrier,
  );
});

test('a plain text annotation carrier is already the box the editor covers', () => {
  const box = hostOf(100, 200, 200, 50);
  // no data-callout-id -> passed through untouched
  assert.equal(caretAnchorHostFor({ ...box, getAttribute: () => null }).getBoundingClientRect().left, 100);
  assert.equal(caretAnchorHostFor(box), box);
  assert.equal(caretAnchorHostFor(null), null);
  // and the anchor it produces is unchanged by the narrowing
  const anchor = buildCaretAnchor({ x: 130, y: 215, host: box });
  assert.deepEqual(anchor.hostRect, { left: 100, top: 200, width: 200, height: 50 });
});
