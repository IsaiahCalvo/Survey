// Drawboard interaction audit (2026-10-13) — the drawing-start rules:
//   C1 palm rejection by contact size (utils/touchContact.js)
//   C4 shape drag threshold (utils/dragThreshold.js)
//   C6 Space tap toggles Pan (utils/spaceTapToggle.js)
// plus source checks that the viewer and the SVG layer actually use them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PALM_CONTACT_MIN_PX, contactSizePx, isPalmContact, withoutPalmTouches,
} from '../src/utils/touchContact.js';
import {
  SHAPE_DRAG_THRESHOLD_PX, shapeDragThresholdPx, chebyshevDistance, hasPassedShapeDragThreshold,
} from '../src/utils/dragThreshold.js';
import {
  SPACE_TAP_MAX_MS, isSpaceTap, resolveSpaceTap, isSpaceTapBlockedTarget,
} from '../src/utils/spaceTapToggle.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------- palm (C1)

test('palm limit matches Drawboard (120 CSS px)', () => {
  assert.equal(PALM_CONTACT_MIN_PX, 120);
});

test('a touch pointer wider than 120 px is a palm; a fingertip is not', () => {
  assert.equal(isPalmContact({ pointerType: 'touch', width: 300, height: 300 }), true);
  assert.equal(isPalmContact({ pointerType: 'touch', width: 121, height: 20 }), true);
  assert.equal(isPalmContact({ pointerType: 'touch', width: 20, height: 130 }), true);
  assert.equal(isPalmContact({ pointerType: 'touch', width: 120, height: 120 }), false, 'exactly the limit is still a finger');
  assert.equal(isPalmContact({ pointerType: 'touch', width: 44, height: 44 }), false);
  assert.equal(isPalmContact({ pointerType: 'touch', width: 1, height: 1 }), false);
});

test('mouse and pen pointers are never palms, whatever they report', () => {
  assert.equal(isPalmContact({ pointerType: 'mouse', width: 500, height: 500 }), false);
  assert.equal(isPalmContact({ pointerType: 'pen', width: 500, height: 500 }), false);
});

test('Touch objects use radius x 2 (so touch and pointer handlers agree)', () => {
  assert.equal(contactSizePx({ radiusX: 150, radiusY: 150 }), 300);
  assert.equal(isPalmContact({ radiusX: 150, radiusY: 150 }), true);
  assert.equal(isPalmContact({ radiusX: 61, radiusY: 10 }), true, 'diameter 122');
  assert.equal(isPalmContact({ radiusX: 60, radiusY: 60 }), false, 'diameter 120');
  assert.equal(isPalmContact({ radiusX: 5, radiusY: 5 }), false);
  assert.equal(isPalmContact({ webkitRadiusX: 90, webkitRadiusY: 90 }), true, 'old WebKit names');
  assert.equal(isPalmContact({ radiusX: 150, radiusY: 150, touchType: 'stylus' }), false, 'a stylus is never a palm');
});

test('unknown contact size is not a palm', () => {
  assert.equal(isPalmContact({}), false);
  assert.equal(isPalmContact(null), false);
  assert.equal(isPalmContact({ pointerType: 'touch', width: NaN, height: undefined }), false);
  assert.equal(contactSizePx(undefined), 0);
});

test('withoutPalmTouches keeps fingers and drops palms (TouchList or array)', () => {
  const finger = { identifier: 1, radiusX: 8, radiusY: 8 };
  const palm = { identifier: 2, radiusX: 150, radiusY: 150 };
  const stylus = { identifier: 3, radiusX: 1, radiusY: 1, touchType: 'stylus' };
  assert.deepEqual(withoutPalmTouches([finger, palm]), [finger]);
  assert.deepEqual(withoutPalmTouches([palm]), []);
  assert.deepEqual(withoutPalmTouches([stylus, palm]), [stylus], 'pen + palm is one contact, not a pinch');
  const list = { length: 2, item: (i) => [finger, palm][i] };
  assert.deepEqual(withoutPalmTouches(list), [finger]);
  assert.deepEqual(withoutPalmTouches(null), []);
});

// -------------------------------------------------------- drag threshold (C4)

test('shape drag threshold: 6 px mouse/pen, 10 px touch (screen px)', () => {
  assert.deepEqual({ ...SHAPE_DRAG_THRESHOLD_PX }, { mouse: 6, pen: 6, touch: 10 });
  assert.equal(shapeDragThresholdPx('mouse'), 6);
  assert.equal(shapeDragThresholdPx('pen'), 6);
  assert.equal(shapeDragThresholdPx('touch'), 10);
  assert.equal(shapeDragThresholdPx(undefined), 6);
});

test('distance is Chebyshev (larger of |dx|, |dy|), like Drawboard', () => {
  assert.equal(chebyshevDistance({ x: 0, y: 0 }, { x: 5, y: 5 }), 5);
  assert.equal(chebyshevDistance({ x: 10, y: 10 }, { x: 3, y: 12 }), 7);
});

test('mouse/pen: 2/4/6 px stay a click, 7 and 9 px become a shape', () => {
  const s = { x: 100, y: 100 };
  for (const type of ['mouse', 'pen']) {
    for (const d of [0, 2, 4, 6]) assert.equal(hasPassedShapeDragThreshold(s, { x: 100 + d, y: 100 + d }, type), false, `${type} ${d}px`);
    for (const d of [7, 9, 40]) assert.equal(hasPassedShapeDragThreshold(s, { x: 100 + d, y: 100 }, type), true, `${type} ${d}px`);
  }
});

test('touch: up to 10 px is a tap, 11 px is a drag', () => {
  const s = { x: 50, y: 50 };
  for (const d of [4, 8, 10]) assert.equal(hasPassedShapeDragThreshold(s, { x: 50, y: 50 + d }, 'touch'), false, `${d}px`);
  for (const d of [11, 14, 60]) assert.equal(hasPassedShapeDragThreshold(s, { x: 50, y: 50 + d }, 'touch'), true, `${d}px`);
  assert.equal(hasPassedShapeDragThreshold(null, { x: 1, y: 1 }, 'touch'), false);
});

// ------------------------------------------------------------ Space tap (C6)

test('Space tap: short and not dragged', () => {
  assert.equal(SPACE_TAP_MAX_MS, 250);
  assert.equal(isSpaceTap({ downAt: 1000, upAt: 1080 }), true);
  assert.equal(isSpaceTap({ downAt: 1000, upAt: 1249 }), true);
  assert.equal(isSpaceTap({ downAt: 1000, upAt: 1250 }), false, 'a hold');
  assert.equal(isSpaceTap({ downAt: 1000, upAt: 1600 }), false, 'a hold');
  assert.equal(isSpaceTap({ downAt: 1000, upAt: 1100, dragged: true }), false, 'a quick space-drag is a hold');
  assert.equal(isSpaceTap({ downAt: NaN, upAt: 1100 }), false);
});

test('Space tap toggles Pan and back to the saved tool', () => {
  let state = resolveSpaceTap({ tool: 'pen', savedTool: null });
  assert.deepEqual(state, { nextTool: 'pan', savedTool: 'pen' });
  state = resolveSpaceTap({ tool: 'pan', savedTool: state.savedTool });
  assert.deepEqual(state, { nextTool: 'pen', savedTool: null });
  // Already on Pan with nothing saved: stays Pan (Drawboard tapFromPanButton).
  assert.deepEqual(resolveSpaceTap({ tool: 'pan', savedTool: null }), { nextTool: null, savedTool: null });
  // A shape tool too.
  assert.deepEqual(resolveSpaceTap({ tool: 'rect' }), { nextTool: 'pan', savedTool: 'rect' });
});

test('Space tap is blocked inside dialogs and menus', () => {
  const fakeEl = (matches) => ({ nodeType: 1, closest: (sel) => (matches && sel.includes('dialog') ? {} : null) });
  assert.equal(isSpaceTapBlockedTarget(fakeEl(true)), true);
  assert.equal(isSpaceTapBlockedTarget(fakeEl(false)), false);
  assert.equal(isSpaceTapBlockedTarget(null), false);
});

// ------------------------------------------------------------- wiring checks

test('viewer touch routing counts only non-palm touches', () => {
  const src = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(src, /from '\.\.\/utils\/touchContact(\.js)?'/);
  // onTouchStart / onTouchMove / onTouchEnd all classify by the filtered list.
  const start = src.slice(src.indexOf('const onTouchStart = (event) =>'), src.indexOf('const onTouchMove = (event) =>'));
  assert.match(start, /withoutPalmTouches\(event\.touches\)/);
  assert.doesNotMatch(start, /event\.touches\.length/, 'touchstart must not count a palm as a finger');
  const move = src.slice(src.indexOf('const onTouchMove = (event) =>'), src.indexOf('const onTouchEnd = (event) =>'));
  assert.match(move, /withoutPalmTouches\(event\.touches\)/);
  assert.doesNotMatch(move, /event\.touches\.length/);
  // A palm lifting is ignored, unless it was the last contact of a gesture
  // (a finger that spread to palm size) - then the gesture still ends, so
  // a pan or pinch can never be left hanging.
  const end = src.slice(src.indexOf('const onTouchEnd = (event) =>'), src.indexOf('const stopNativeGesture = (event) =>'));
  assert.match(end, /if \(isPalmOnlyChange\(event\) && \(touches\.length > 0 \|\| !mobileTouchRef\.current\)\) \{/);
  assert.doesNotMatch(end, /event\.touches\.length/);
});

test('SVG layer swallows palm presses before any tool sees them', () => {
  const src = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(src, /onPointerDownCapture=\{[^}]*isPalmContact\(e\)/);
});

test('SVG layer waits for the shape drag threshold before drawing a shape', () => {
  const src = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(src, /hasPassedShapeDragThreshold\(/);
  assert.doesNotMatch(src, /CLICK_PLACE_MAX_TRAVEL_PX/, 'one click rule, not two');
});

test('Space tap reaches the tool owner through onSpaceTap', () => {
  const container = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(container, /isSpaceTap\(/);
  assert.match(container, /cb\.current\.onSpaceTap\?\.\(/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /onSpaceTap=\{handleSpaceTap\}/);
  assert.match(viewer, /resolveSpaceTap\(/);
});
