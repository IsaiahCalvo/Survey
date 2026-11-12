import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPLINE_STEP, insertSplineCorner, keepPivot, moveSplineCorner, polySplineStep, removeSplineCorner,
  sampleSpline, setPolylineCurve, splineCorners, splineSpanMidpoint, splinePointAt,
} from '../src/utils/polySpline.js';
import { canRemovePolyVertex, insertPolyVertex, removePolyVertex } from '../src/utils/polyVertices.js';
import { buildPolyShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { collectEndpointCandidates, polyWorldPoints } from '../src/utils/drawSnap.js';

const corners = [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }, { x: 150, y: 40 }];
const curved = (extra = {}) => ({
  type: 'polyline', left: 0, top: 0, angle: 0, scaleX: 1, scaleY: 1,
  points: sampleSpline(corners, SPLINE_STEP),
  data: { id: 'p1', spline: { step: SPLINE_STEP } },
  ...extra,
});

test('the curve passes through every clicked corner, at index j * step', () => {
  const pts = sampleSpline(corners, 12);
  assert.equal(pts.length, (corners.length - 1) * 12 + 1);
  corners.forEach((c, j) => assert.deepEqual(pts[j * 12], c));
  assert.deepEqual(splineCorners(pts, 12), corners);
});

test('the curve bends: points between corners leave the straight side', () => {
  const pts = sampleSpline(corners, 12);
  // Along the middle span the curve leaves the straight side 1 -> 2.
  const [a, b] = [corners[1], corners[2]];
  const off = (p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  const most = Math.max(...pts.slice(12, 25).map(off));
  assert.ok(most > 2, `most ${most}`);
  // No overshoot past the corners' own height range on this zigzag.
  for (const p of pts) assert.ok(p.y > -8 && p.y < 48, `y ${p.y}`);
});

test('two corners draw a straight line; bunched corners do not loop', () => {
  const two = sampleSpline([{ x: 0, y: 0 }, { x: 10, y: 10 }], 4);
  two.forEach((p) => assert.ok(Math.abs(p.x - p.y) < 1e-9));
  const bunched = sampleSpline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 101, y: 1 }, { x: 200, y: 0 }], 12);
  for (const p of bunched) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > -5 && p.x < 205);
  const repeated = sampleSpline([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 }], 6);
  for (const p of repeated) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('polySplineStep only trusts a polyline whose point count fits its step', () => {
  assert.equal(polySplineStep(curved()), SPLINE_STEP);
  assert.equal(polySplineStep({ ...curved(), type: 'polygon' }), 0);
  assert.equal(polySplineStep({ ...curved(), points: curved().points.slice(1) }), 0);
  assert.equal(polySplineStep({ ...curved(), data: {} }), 0);
});

test('moving a corner keeps the other corners where they were', () => {
  const pts = moveSplineCorner(curved().points, 12, 12, { x: 60, y: 80 });
  const c = splineCorners(pts, 12);
  assert.deepEqual(c, [corners[0], { x: 60, y: 80 }, corners[2], corners[3]]);
  // A curve sample is not a corner: moving one changes nothing.
  const same = curved().points;
  assert.equal(moveSplineCorner(same, 12, 5, { x: 1, y: 1 }), same);
});

test('adding and deleting corners keeps the step', () => {
  const added = insertSplineCorner(curved().points, 12, 1, { x: 75, y: 25 });
  assert.equal(added.length, 4 * 12 + 1);
  assert.deepEqual(splineCorners(added, 12)[2], { x: 75, y: 25 });
  const removed = removeSplineCorner(curved().points, 12, 24);
  assert.deepEqual(splineCorners(removed, 12), [corners[0], corners[1], corners[3]]);
  assert.equal(removeSplineCorner(curved().points, 12, 7), null);
  const short = sampleSpline(corners.slice(0, 2), 12);
  assert.equal(removeSplineCorner(short, 12, 0), null);
});

test('polyVertices helpers count and edit corners on a curve', () => {
  assert.equal(canRemovePolyVertex(curved()), true);
  assert.equal(canRemovePolyVertex({ ...curved(), points: sampleSpline(corners.slice(0, 2), 12) }), false);
  const removed = removePolyVertex(curved(), 12);
  assert.equal(polySplineStep(removed), 12);
  assert.deepEqual(splineCorners(removed.points, 12), [corners[0], corners[2], corners[3]]);
  // Dense side 15 sits in span 1 (corners 1 -> 2): the new corner lands there.
  const obj = curved();
  const inserted = insertPolyVertex(obj, 15, 0.5);
  assert.equal(polySplineStep(inserted), 12);
  const c = splineCorners(inserted.points, 12);
  assert.equal(c.length, 5);
  // It sits on the drawn curve itself (not on the stored chord 15 -> 16).
  const on = splinePointAt(obj.points, 12, 15, 0.5);
  assert.ok(Math.hypot(c[2].x - on.x, c[2].y - on.y) < 1e-9, `${c[2].x},${c[2].y} vs ${on.x},${on.y}`);
});

test('the "+" handle sits on the curve halfway between corners', () => {
  const pts = curved().points;
  assert.deepEqual(splineSpanMidpoint(pts, 12, 1), pts[18]);
  assert.equal(splineSpanMidpoint(pts, 12, 3), null);
});

test('a new curved polyline stores the curve and its step', () => {
  const json = buildPolyShapeCommitJSON({ tool: 'polyline', id: 'n1', points: corners, strokeWidth: 2, curve: true });
  assert.equal(json.data.spline.step, SPLINE_STEP);
  assert.equal(json.points.length, (corners.length - 1) * SPLINE_STEP + 1);
  assert.equal(polySplineStep(json), SPLINE_STEP);
  const straight = buildPolyShapeCommitJSON({ tool: 'polyline', id: 'n2', points: corners, strokeWidth: 2 });
  assert.equal(straight.points.length, 4);
  assert.equal(straight.data.spline, undefined);
  // Owner 2026-10-28: a polyline is never clouded, so a stale Cloud style
  // left from a shape tool draws it solid - and curved. A polygon never curves.
  const staleCloud = buildPolyShapeCommitJSON({ tool: 'polyline', id: 'n3', points: corners, strokeWidth: 2, curve: true, lineBorderStyle: 'cloud' });
  assert.equal(staleCloud.points.length, (corners.length - 1) * SPLINE_STEP + 1);
  assert.equal(staleCloud.data.pdfCloudIntensity, undefined);
  const polygon = buildPolyShapeCommitJSON({ tool: 'polygon', id: 'n4', points: corners, strokeWidth: 2, curve: true });
  assert.equal(polygon.points.length, 4);
});

test('turning a polyline curved and back keeps its corners', () => {
  const straight = { type: 'polyline', left: 5, top: 5, angle: 30, points: corners, data: { id: 's' } };
  const on = setPolylineCurve(straight, true);
  assert.equal(polySplineStep(on), SPLINE_STEP);
  assert.deepEqual(splineCorners(on.points, SPLINE_STEP), corners);
  const off = setPolylineCurve(on, false);
  assert.deepEqual(off.points, corners);
  assert.equal(off.data.spline, undefined);
  assert.equal(setPolylineCurve(on, true), null);
  assert.equal(setPolylineCurve(straight, false), null);
  assert.equal(setPolylineCurve({ ...straight, data: { pdfCloudIntensity: 2 } }, true), null);
});

test('snapping offers a curve\'s corners, not its samples', () => {
  const out = collectEndpointCandidates([curved()]);
  assert.equal(out.length, corners.length);
});

// Codex review on #1214: "+" on a turned curve must not move its corners.
test('adding a corner to a turned curve keeps the other corners in place', async () => {
  const obj = curved({ angle: 90, left: 40, top: 20, points: sampleSpline([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], SPLINE_STEP) });
  const before = splineCorners(polyWorldPoints(obj), SPLINE_STEP);
  const added = insertSplineCorner(obj.points, SPLINE_STEP, 0, splineSpanMidpoint(obj.points, SPLINE_STEP, 0));
  const after = splineCorners(polyWorldPoints(keepPivot(obj, obj.points, added)), SPLINE_STEP);
  [[0, 0], [1, 2], [2, 3]].forEach(([was, now]) => {
    assert.ok(Math.hypot(after[now].x - before[was].x, after[now].y - before[was].y) < 1e-6, `corner ${was}`);
  });
  const { readFileSync } = await import('node:fs');
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /obj = keepPivot\(obj, obj\.points, insertSplineCorner\(/);
});

// ---- Curve handles (owner 2026-11-09, Takeoff's Shift handles) ----
import {
  isBezierSpline, markBezierSpline, moveSplineHandle, sampleSplineSpans, splineSpans,
} from '../src/utils/polySpline.js';

const near = (a, b, tol = 1e-6) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

test('handles read back out of the drawn curve: resampling them gives the same curve', () => {
  const pts = sampleSpline(corners, SPLINE_STEP);
  const spans = splineSpans(pts, SPLINE_STEP);
  assert.equal(spans.length, corners.length - 1);
  const again = sampleSplineSpans(spans, SPLINE_STEP);
  assert.equal(again.length, pts.length);
  again.forEach((p, i) => assert.ok(near(p, pts[i], 1e-6), `point ${i}`));
});

test('handles survive the 0.01 save rounding within a hair', () => {
  const pts = sampleSpline(corners, SPLINE_STEP).map((p) => ({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) }));
  const exact = splineSpans(sampleSpline(corners, SPLINE_STEP), SPLINE_STEP);
  splineSpans(pts, SPLINE_STEP).forEach((s, i) => {
    assert.ok(near(s.c1, exact[i].c1, 0.05) && near(s.c2, exact[i].c2, 0.05), `span ${i}`);
  });
});

test('Alt-dragging one handle bends only its own span; corners stay put', () => {
  const pts = sampleSpline(corners, SPLINE_STEP);
  const bent = moveSplineHandle(pts, SPLINE_STEP, 1, 'c1', { x: 70, y: 120 }, true);
  assert.equal(bent.length, pts.length);
  assert.deepEqual(splineCorners(bent, SPLINE_STEP), corners);
  // Spans 0 and 2 are untouched; span 1 moved toward the handle.
  for (let i = 0; i <= 12; i += 1) assert.ok(near(bent[i], pts[i], 1e-6));
  for (let i = 24; i < pts.length; i += 1) assert.ok(near(bent[i], pts[i], 1e-6));
  assert.ok(Math.max(...bent.slice(13, 24).map((p) => p.y)) > Math.max(...pts.slice(13, 24).map((p) => p.y)) + 10);
  assert.ok(near(splineSpans(bent, SPLINE_STEP)[1].c1, { x: 70, y: 120 }, 1e-6));
});

test('dragging a handle keeps its corner smooth: the other handle turns in line, same length', () => {
  const pts = sampleSpline(corners, SPLINE_STEP);
  const before = splineSpans(pts, SPLINE_STEP);
  const bent = moveSplineHandle(pts, SPLINE_STEP, 1, 'c1', { x: 70, y: 120 });
  const after = splineSpans(bent, SPLINE_STEP);
  assert.deepEqual(splineCorners(bent, SPLINE_STEP), corners);
  assert.ok(near(after[1].c1, { x: 70, y: 120 }, 1e-6));
  const corner = corners[1];
  const a = { x: after[1].c1.x - corner.x, y: after[1].c1.y - corner.y };
  const b = { x: after[0].c2.x - corner.x, y: after[0].c2.y - corner.y };
  const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  assert.ok(cos < -0.9999, `handles in line through the corner (cos ${cos})`);
  const oldLen = Math.hypot(before[0].c2.x - corner.x, before[0].c2.y - corner.y);
  assert.ok(Math.abs(Math.hypot(b.x, b.y) - oldLen) < 1e-6, 'the other handle keeps its length');
  // Span 2 is untouched.
  for (let i = 24; i < pts.length; i += 1) assert.ok(near(bent[i], pts[i], 1e-6));
  // A corner made sharp with Alt stays sharp on the next plain drag.
  const sharp = moveSplineHandle(pts, SPLINE_STEP, 1, 'c1', { x: 70, y: 120 }, true);
  const again = moveSplineHandle(sharp, SPLINE_STEP, 1, 'c1', { x: 75, y: 100 });
  const s0 = splineSpans(sharp, SPLINE_STEP)[0].c2;
  assert.ok(near(splineSpans(again, SPLINE_STEP)[0].c2, s0, 0.05), 'sharp corner left alone');
});

test('a hand-bent curve: moving a corner carries its handles and keeps far spans', () => {
  const pts = moveSplineHandle(sampleSpline(corners, SPLINE_STEP), SPLINE_STEP, 1, 'c1', { x: 70, y: 120 });
  const before = splineSpans(pts, SPLINE_STEP);
  const moved = moveSplineCorner(pts, SPLINE_STEP, 2 * SPLINE_STEP, { x: 110, y: 10 }, true);
  const after = splineSpans(moved, SPLINE_STEP);
  assert.ok(near(after[1].c1, before[1].c1, 1e-6), 'far handle of span 1 kept');
  assert.ok(near(after[1].c2, { x: before[1].c2.x + 10, y: before[1].c2.y + 10 }, 1e-6));
  assert.ok(near(after[2].c1, { x: before[2].c1.x + 10, y: before[2].c1.y + 10 }, 1e-6));
  for (let i = 0; i <= 12; i += 1) assert.ok(near(moved[i], pts[i], 1e-6), 'span 0 untouched');
});

test('a hand-bent curve: adding a corner keeps the shape, removing joins the spans', () => {
  const pts = moveSplineHandle(sampleSpline(corners, SPLINE_STEP), SPLINE_STEP, 1, 'c2', { x: 90, y: -60 });
  const mid = splineSpanMidpoint(pts, SPLINE_STEP, 1);
  const added = insertSplineCorner(pts, SPLINE_STEP, 1, mid, true);
  assert.equal(added.length, pts.length + SPLINE_STEP);
  assert.ok(near(added[2 * SPLINE_STEP], mid, 1e-3));
  // Split curve: its samples sit on the original span.
  const orig = splineSpans(pts, SPLINE_STEP)[1];
  const atT = (t) => {
    const mt = 1 - t;
    return {
      x: mt ** 3 * orig.from.x + 3 * mt * mt * t * orig.c1.x + 3 * mt * t * t * orig.c2.x + t ** 3 * orig.to.x,
      y: mt ** 3 * orig.from.y + 3 * mt * mt * t * orig.c1.y + 3 * mt * t * t * orig.c2.y + t ** 3 * orig.to.y,
    };
  };
  assert.ok(near(added[SPLINE_STEP + 6], atT(0.25), 1e-3));
  const removed = removeSplineCorner(added, SPLINE_STEP, 2 * SPLINE_STEP, true);
  assert.equal(removed.length, pts.length);
  assert.deepEqual(splineCorners(removed, SPLINE_STEP), corners);
});

test('the bent mark flag lives on data.spline and the edit helpers honour it', () => {
  const obj = curved();
  assert.equal(isBezierSpline(obj), false);
  const data = markBezierSpline(obj.data);
  assert.deepEqual(data.spline, { step: SPLINE_STEP, bezier: true });
  assert.equal(markBezierSpline(data), data);
  const bent = { ...obj, points: moveSplineHandle(obj.points, SPLINE_STEP, 0, 'c1', { x: 0, y: 60 }), data };
  assert.equal(isBezierSpline(bent), true);
  const two = removePolyVertex(bent, 3 * SPLINE_STEP);
  assert.ok(two);
  // Span 0's hand-set handle is still there after removing the last corner.
  assert.ok(near(splineSpans(two.points, SPLINE_STEP)[0].c1, { x: 0, y: 60 }, 1e-6));
  const plus = insertPolyVertex(bent, 6, 0.5);
  assert.ok(plus);
  // The side clicked is dense side 6 at its middle: t = 6.5 / 12 of span 0,
  // so the split's first handle sits that far along the old one.
  assert.ok(near(splineSpans(plus.points, SPLINE_STEP)[0].c1, { x: 0, y: 60 * (6.5 / 12) }, 1e-3));
});
