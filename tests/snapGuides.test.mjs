// Canvas audit chunks 2 + 3 — snap maths (Drawboard numbers).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAP_DISTANCE_PX,
  isSnapFreeModifier,
  snapThreshold,
  unionBox,
  boxesTouch,
  snapFeatures,
  findSnapOffset,
  buildSnapGuides,
  snapMoveBox,
  snapMoveFrame,
  snapResizePoint,
  sameSnapGuides,
  isSnappableMark,
  snapBoxForMark,
  calloutSnapBox,
  keepsProportions,
  snapRotationDegrees,
  isRightAngle,
  lockAspectToBiggerMove,
} from '../src/utils/snapGuides.js';

const box = (left, top, width, height) => ({ left, top, width, height });

test('threshold is 6 screen px in page units at every zoom', () => {
  assert.equal(SNAP_DISTANCE_PX, 6);
  assert.equal(snapThreshold(1), 6);
  assert.equal(snapThreshold(0.5), 3); // 200 % zoom: 6 px = 3 page units
  assert.equal(snapThreshold(2), 12); // 50 % zoom
  assert.equal(snapThreshold(NaN), 6);
});

test('Alt is the free-drag key; Ctrl / Cmd keep snapping (they move a selection here)', () => {
  assert.equal(isSnapFreeModifier({ altKey: true }), true);
  assert.equal(isSnapFreeModifier({ ctrlKey: true }), false);
  assert.equal(isSnapFreeModifier({ metaKey: true }), false);
  assert.equal(isSnapFreeModifier(null), false);
});

test('a box dropped 3 px low snaps flush to the other box top (Drawboard probe)', () => {
  const other = box(100, 100, 80, 80);
  const moved = box(300, 103, 50, 30);
  const off = snapMoveBox(moved, [other], snapThreshold(1));
  assert.equal(off.dy, -3);
  assert.equal(off.snappedY, true);
  // x: nothing within 6 (left 300 vs 100/180, right 350, centre 325 vs 140)
  assert.equal(off.dx, 0);
  assert.equal(off.snappedX, false);
});

test('edges meet edges (flush side by side), centres meet centres, never edge to centre', () => {
  const other = box(0, 0, 100, 100); // right edge 100, centre x 50
  // left edge 4 off the right edge -> flush
  assert.equal(snapMoveBox(box(104, 300, 20, 20), [other], 6).dx, -4);
  // centre 3 off the other centre -> centred
  assert.equal(snapMoveBox(box(43, 300, 20, 20), [other], 6).dx, -3);
  // a left edge 2 off the other's CENTRE does not snap there
  const off = snapMoveBox(box(52, 300, 200, 20), [other], 6);
  assert.equal(off.snappedX, false);
});

test('the nearest snap wins, each axis on its own', () => {
  const a = box(0, 0, 100, 100);
  const b = box(0, 200, 103, 50); // right edge 103
  const off = snapMoveBox(box(105, 98, 40, 40), [a, b], 6);
  assert.equal(off.dx, -2); // 105 -> 103 (2) beats 105 -> 100 (5)
  assert.equal(off.dy, 2); // top 98 -> 100 (bottom of a)
});

test('nothing beyond the threshold, nothing with no targets', () => {
  assert.deepEqual(snapMoveBox(box(0, 0, 10, 10), [box(17, 17, 10, 10)], 6), { dx: 0, dy: 0, snappedX: false, snappedY: false });
  assert.deepEqual(snapMoveBox(box(0, 0, 10, 10), [], 6), { dx: 0, dy: 0, snappedX: false, snappedY: false });
  assert.deepEqual(findSnapOffset(snapFeatures(box(0, 0, 1, 1)), [box(0, 0, 1, 1)], 0), { dx: 0, dy: 0, snappedX: false, snappedY: false });
});

test('guides: one dashed line per lined-up feature, spanning both boxes, with X points', () => {
  const other = box(100, 100, 80, 40);
  const shown = box(300, 100, 50, 30);
  const g = buildSnapGuides(shown, snapFeatures(shown), [other]);
  assert.equal(g.lines.length, 1);
  assert.deepEqual(g.lines[0], { axis: 'y', value: 100, min: 100, max: 350 });
  // corners on that line: 2 of the moved box + 2 of the other
  assert.equal(g.points.length, 4);
  assert.ok(g.points.every((p) => p.y === 100));
});

test('guides: centre lines run centre to centre; nothing lined up = no guides', () => {
  const other = box(0, 0, 100, 100);
  const shown = box(40, 300, 20, 20); // centre x 50 = other centre x
  const g = buildSnapGuides(shown, snapFeatures(shown), [other]);
  assert.deepEqual(g.lines, [{ axis: 'x', value: 50, min: 50, max: 310 }]);
  assert.equal(buildSnapGuides(box(400, 400, 5, 5), snapFeatures(box(400, 400, 5, 5)), [other]), null);
});

test('guides merge on the same line and keep the widest span', () => {
  const shown = box(100, 100, 50, 50);
  const g = buildSnapGuides(shown, snapFeatures(shown), [box(0, 100, 20, 10), box(400, 100, 20, 80)]);
  const top = g.lines.filter((l) => l.axis === 'y' && l.value === 100);
  assert.equal(top.length, 1);
  assert.equal(top[0].min, 0);
  assert.equal(top[0].max, 420);
});

test('snapMoveFrame returns the snapped delta and its guides together', () => {
  const frame = snapMoveFrame(box(300, 200, 50, 30), 0, -97, [box(100, 100, 80, 80)], 6);
  assert.equal(frame.dy, -100);
  assert.equal(frame.guides.lines[0].value, 100);
});

test('resize: only the dragged edges snap, edge to edge', () => {
  const targets = [box(200, 50, 10, 10)]; // left 200, top 50
  const r = snapResizePoint({ x: 197, y: 52 }, 'br', targets, 6);
  assert.equal(r.x, 200);
  assert.equal(r.y, 50);
  // an edge grabber only moves its own axis
  const side = snapResizePoint({ x: 197, y: 52 }, 'mr', targets, 6);
  assert.equal(side.x, 200);
  assert.equal(side.y, 52);
  assert.equal(side.features.y.length, 0);
});

test('a multi-selection snaps by its combined frame', () => {
  const u = unionBox([box(0, 0, 10, 10), box(50, 20, 10, 10), null]);
  assert.deepEqual(u, { left: 0, top: 0, width: 60, height: 30 });
  assert.equal(unionBox([]), null);
});

test('only marks on screen pull a drag', () => {
  assert.equal(boxesTouch(box(0, 0, 10, 10), box(5, 5, 100, 100)), true);
  assert.equal(boxesTouch(box(0, 0, 10, 10), box(50, 50, 100, 100)), false);
});

test('ink, highlighter and text highlights neither snap nor pull', () => {
  assert.equal(isSnappableMark({ type: 'path', tool: 'pen' }), false);
  assert.equal(isSnappableMark({ type: 'path', tool: 'highlighter' }), false);
  assert.equal(isSnappableMark({ type: 'path' }), false); // freehand / imported ink
  assert.equal(isSnappableMark({ type: 'rect', data: { type: 'text-markup' } }), false);
  assert.equal(isSnappableMark({ type: 'path', data: { lineStyle: 'cloud' } }), true);
  for (const type of ['rect', 'ellipse', 'line', 'polygon', 'polyline', 'textbox', 'image', 'circle', 'group']) {
    assert.equal(isSnappableMark({ type }), true, type);
  }
  assert.equal(isSnappableMark(null), false);
});

test('a counter snaps by its round body, not its nub', () => {
  const counter = { type: 'circle', left: 10, top: 20, radius: 14, scaleX: 1, data: { type: 'counter' } };
  assert.deepEqual(snapBoxForMark(counter, box(0, 0, 99, 99)), box(10, 20, 28, 28));
  assert.deepEqual(snapBoxForMark({ type: 'rect' }, box(1, 2, 3, 4)), box(1, 2, 3, 4));
});

test('a callout snaps by its drawn text box (with the descender band)', () => {
  const c = { textBoxPosition: { x: 0.1, y: 0.2 }, textBoxWidth: 0.25, textBoxHeight: 0.05, style: { fontSize: 20 } };
  const b = calloutSnapBox(c, 600, 800);
  assert.equal(b.left, 60);
  assert.equal(b.top, 160);
  assert.equal(b.width, 150);
  assert.equal(b.height, 40 + 7);
  assert.equal(calloutSnapBox({}, 600, 800), null);
});

test('photos and stamps keep proportions', () => {
  assert.equal(keepsProportions({ type: 'image' }), true);
  assert.equal(keepsProportions({ type: 'Image' }), true);
  assert.equal(keepsProportions({ type: 'rect' }), false);
});

test('rotation: right-angle magnet within 4 deg, whole degrees otherwise', () => {
  assert.equal(snapRotationDegrees(87), 90);
  assert.equal(snapRotationDegrees(86.9), 90); // 3.1 off -> magnet
  assert.equal(snapRotationDegrees(85.9), 86); // 4.1 off -> whole degrees
  assert.equal(Math.abs(snapRotationDegrees(-3.5)), 0);
  assert.equal(snapRotationDegrees(183.2), 180);
  assert.equal(snapRotationDegrees(33.4), 33);
  assert.equal(snapRotationDegrees(358), 360); // callers wrap
});

test('rotation: Shift = hard 15 deg steps; Alt = free', () => {
  assert.equal(snapRotationDegrees(33, { shift: true }), 30);
  assert.equal(snapRotationDegrees(38, { shift: true }), 45);
  assert.equal(snapRotationDegrees(-8, { shift: true }), -15);
  assert.equal(snapRotationDegrees(87.07, { free: true }), 87.07);
  assert.equal(snapRotationDegrees(87.07, { shift: true, free: true }), 87.07);
});

test('isRightAngle', () => {
  assert.equal(isRightAngle(0), true);
  assert.equal(isRightAngle(270), true);
  assert.equal(isRightAngle(-90), true);
  assert.equal(isRightAngle(45), false);
});

test('Shift + corner follows the bigger move (Drawboard +60/+20 probe)', () => {
  // 202 x 112 box dragged +60 / +20 from its fixed corner: x grows 1.297, y 1.179
  const sx = 262 / 202;
  const sy = 132 / 112;
  const locked = lockAspectToBiggerMove(sx, sy, 1, 1);
  assert.ok(Math.abs(locked.scaleX - sx) < 1e-12); // the corner stays under the pointer in x
  assert.ok(Math.abs(locked.scaleY - sx) < 1e-12);
  // shrinking: the bigger shrink wins
  const s2 = lockAspectToBiggerMove(0.5, 0.9, 1, 1);
  assert.deepEqual(s2, { scaleX: 0.5, scaleY: 0.5 });
  // flips keep their own sign; start scales are kept in proportion
  const s3 = lockAspectToBiggerMove(-1.5, 1.2, 1, 2);
  assert.equal(s3.scaleX, -1.5);
  assert.equal(s3.scaleY, 3);
});

test('sameSnapGuides', () => {
  const a = { lines: [{ axis: 'x', value: 1, min: 0, max: 2 }], points: [{ x: 1, y: 0 }] };
  assert.equal(sameSnapGuides(a, { lines: [{ ...a.lines[0] }], points: [{ x: 1, y: 0 }] }), true);
  assert.equal(sameSnapGuides(a, { lines: [{ ...a.lines[0], max: 3 }], points: [{ x: 1, y: 0 }] }), false);
  assert.equal(sameSnapGuides(null, null), true);
  assert.equal(sameSnapGuides(a, null), false);
});
