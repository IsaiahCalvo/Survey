// Revision clouds: hover/hit on the crowns, selection chrome outside the
// humps (Drawboard PDF behaviour), for every cloud shape.
//
// Reference: the approved revision-cloud studio (d1abe78) and Drawboard PDF -
// the studio locks each corner crown's apex to its vertex (polygon vertex
// handles live there); Drawboard's hover glow hugs the scallops and stays on
// while the cloud is selected, its dashed frame clears the humps by a stroke
// width, and its eight grabbers sit on that frame's corners and edge
// midpoints - outside the cloud, never on the inner box it was drawn from,
// never stacked on a shared crown.
//
// Contract change 2026-09-09 (rev 2): the earlier "handles snap to the
// nearest cusp" assertions were replaced on purpose - measured against
// Drawboard, cusp-snapped handles sat 18 units inside the frame corners and
// doubled up whenever fewer than eight crowns existed.
//
// Contract change 2026-09-10 (round 4, defect 8): the eight ANCHORS this file
// pins are still the frame's corners and edge midpoints, unchanged. What
// changed is what the overlay DRAWS on them when the frame is too thin for the
// 28-unit edge pills: corner-sized dots, stepped outward along the frame
// normal so they cannot overlap their neighbours, instead of no grabber at
// all. The anchor is the resize reference; the outset is presentation only.
// Those rules live in tests/cloudChromeDrawboardParity.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLOUD_FRAME_PAD_STROKE_RATIO,
  CLOUD_HOVER_GLOW_OPACITY,
  CLOUD_HOVER_GLOW_WIDTH_RATIO,
  cloudHoverGlowWidth,
  cloudOutlineBounds,
  cloudSelectionChrome,
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
} from '../src/utils/cloudAnnotationGeometry.js';
import { doesRectIntersectObject, isPointOnCloud, isPointOnObject } from '../src/utils/geometryHitTest.js';
import { buildCloudGlowPaint } from '../src/utils/cloudSvgPaint.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const CLOUD = { strokeWidth: 2.5, stroke: '#c42747', fill: 'transparent', data: { pdfCloudIntensity: 2 } };
const shapes = {
  rect: { type: 'rect', left: 100, top: 100, width: 300, height: 200, ...CLOUD },
  ellipse: { type: 'ellipse', left: 100, top: 100, rx: 120, ry: 80, ...CLOUD },
  circle: { type: 'circle', left: 100, top: 100, radius: 90, ...CLOUD },
  polygon: {
    type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 200, y: 20 }, { x: 180, y: 150 }, { x: 40, y: 120 }, { x: 90, y: 70 }],
    ...CLOUD,
  },
  polyline: {
    type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 200, y: 20 }, { x: 180, y: 150 }, { x: 40, y: 120 }],
    ...CLOUD,
  },
};
const HANDLE_IDS = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'];

const worldOutlinePoints = (obj) => {
  const geometry = resolveCloudAnnotationGeometry(obj);
  const points = [];
  for (const subpath of sampleCloudCommands(geometry.outline, 12)) {
    for (const point of subpath) points.push({ x: point.x + geometry.origin.x, y: point.y + geometry.origin.y });
  }
  return { geometry, points };
};
const distanceToPoints = (points, p) => Math.min(...points.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));

// Signed "how far outside the base shape" a page point is (>= -eps means on or
// outside the inner box/ellipse/polygon the cloud was built from).
const outsideBase = (name, obj, p) => {
  // Fabric scaleX/scaleY are baked into the base shape (the chrome is always
  // computed in the unrotated frame, so angle is ignored here on purpose).
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const x = p.x - obj.left;
  const y = p.y - obj.top;
  if (name === 'rect') return Math.max(-x, x - obj.width * sx, -y, y - obj.height * sy);
  if (name === 'ellipse') return Math.hypot((x - obj.rx * sx) / (obj.rx * sx), (y - obj.ry * sy) / (obj.ry * sy)) - 1;
  if (name === 'circle') return Math.hypot((x - obj.radius * sx) / (obj.radius * sx), (y - obj.radius * sy) / (obj.radius * sy)) - 1;
  // polygon / polyline: distance to the nearest base edge, negative when
  // strictly inside a closed polygon.
  const pts = obj.points.map((pt) => ({ x: pt.x * sx, y: pt.y * sy }));
  const edges = name === 'polygon' ? pts.length : pts.length - 1;
  let best = Infinity;
  for (let i = 0; i < edges; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  if (name !== 'polygon') return best;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y)
      && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside ? -best : best;
};

// Where each of the eight grabbers must sit on a frame (Drawboard: corners +
// edge midpoints of the dashed frame, 0.00px off them).
const framePoints = (frame) => {
  const right = frame.left + frame.width;
  const bottom = frame.top + frame.height;
  const midX = frame.left + frame.width / 2;
  const midY = frame.top + frame.height / 2;
  return {
    tl: { x: frame.left, y: frame.top }, mt: { x: midX, y: frame.top }, tr: { x: right, y: frame.top },
    mr: { x: right, y: midY }, br: { x: right, y: bottom }, mb: { x: midX, y: bottom },
    bl: { x: frame.left, y: bottom }, ml: { x: frame.left, y: midY },
  };
};
const hullOf = (obj) => {
  const { points } = worldOutlinePoints(obj);
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};
const assertDrawboardChrome = (name, obj, kind = name) => {
  const chrome = cloudSelectionChrome(obj);
  assert.ok(chrome, `${name}: cloud chrome resolves`);
  const hull = hullOf(obj);
  const pad = obj.strokeWidth * CLOUD_FRAME_PAD_STROKE_RATIO;
  assert.equal(chrome.pad, pad, `${name}: frame padding is 1.5 stroke widths (ink outer edge + a full stroke of clear air) in page units`);
  // Frame = outer hull of the humps + one stroke width on every side, so the
  // dashes clear the crowns' outer half-stroke instead of crossing it.
  assert.ok(Math.abs(chrome.frame.left - (hull.left - pad)) < 0.5, `${name}: frame left`);
  assert.ok(Math.abs(chrome.frame.top - (hull.top - pad)) < 0.5, `${name}: frame top`);
  assert.ok(Math.abs(chrome.frame.left + chrome.frame.width - (hull.right + pad)) < 0.5, `${name}: frame right`);
  assert.ok(Math.abs(chrome.frame.top + chrome.frame.height - (hull.bottom + pad)) < 0.5, `${name}: frame bottom`);
  // Handles ON the frame corners / edge midpoints - outside the cloud, never
  // on the inner base shape.
  const expected = framePoints(chrome.frame);
  for (const id of HANDLE_IDS) {
    const anchor = chrome.anchors[id];
    assert.ok(anchor, `${name}.${id} anchor`);
    const gap = Math.hypot(anchor.x - expected[id].x, anchor.y - expected[id].y);
    assert.ok(gap < 1e-9, `${name}.${id} handle is ${gap.toFixed(3)} units off its frame point`);
    assert.ok(outsideBase(kind, obj, anchor) > 0,
      `${name}.${id} handle at (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)}) is not outside the base shape`);
    const { points } = worldOutlinePoints(obj);
    assert.ok(distanceToPoints(points, anchor) >= pad - 0.5,
      `${name}.${id} handle sits closer than a stroke width to the ink`);
  }
  // Never stacked: eight distinct grabbers.
  const keys = new Set(HANDLE_IDS.map((id) => `${chrome.anchors[id].x.toFixed(3)},${chrome.anchors[id].y.toFixed(3)}`));
  assert.equal(keys.size, HANDLE_IDS.length, `${name}: handles share a point`);
  return chrome;
};

for (const [name, obj] of Object.entries(shapes)) {
  test(`${name} cloud: dashed frame is the hull of the humps padded by one stroke width, eight grabbers on its corners + midpoints`, () => {
    const chrome = assertDrawboardChrome(name, obj);
    if (name === 'rect') {
      // The humps bulge a full crown depth past the drawn box on every side,
      // and the frame clears them by the stroke width on top of that.
      assert.ok(chrome.frame.left < obj.left - 5 - obj.strokeWidth && chrome.frame.top < obj.top - 5 - obj.strokeWidth);
      assert.ok(chrome.frame.left + chrome.frame.width > obj.left + obj.width + 5 + obj.strokeWidth);
    }
  });

  test(`${name} cloud: a thicker stroke pushes the frame + grabbers further out by exactly the pad difference`, () => {
    const thin = cloudSelectionChrome({ ...obj, strokeWidth: 1 });
    const thick = cloudSelectionChrome({ ...obj, strokeWidth: 6 });
    // The crowns' CENTRELINE does not move with the stroke, so the frame grows
    // by the pad difference on each side. Contract change 2026-09-09: the pad
    // is measured from the ink's OUTER edge (hull + sw/2) plus a full stroke
    // width of clear air, i.e. 1.5 stroke widths from the sampled centreline
    // hull — previously 1.0, which left the 2px dashes kissing the humps at
    // 100%. The expected deltas are derived from the constant so the numbers
    // move with the contract instead of pinning the old ratio.
    const padDelta = (6 - 1) * CLOUD_FRAME_PAD_STROKE_RATIO;
    assert.ok(Math.abs((thin.frame.left - thick.frame.left) - padDelta) < 0.5, `${name}: frame left grows by ${padDelta}`);
    assert.ok(Math.abs((thick.frame.width - thin.frame.width) - padDelta * 2) < 1, `${name}: frame width grows by ${padDelta * 2}`);
    assert.ok(Math.abs((thick.anchors.tl.x - thin.anchors.tl.x) + padDelta) < 0.5, `${name}: tl handle moves out by ${padDelta}`);
  });

  test(`${name} cloud: the dashed frame clears the PAINTED outer edge of the crowns by a full stroke width`, () => {
    // Defect 5 (Drawboard parity): cloudOutlineBounds samples the stroke's
    // centreline, so the painted crown reaches sw/2 past it. The gap between
    // the frame and the painted edge must be a full stroke width, not sw/2.
    for (const strokeWidth of [1, 2.5, 6]) {
      const chrome = cloudSelectionChrome({ ...obj, strokeWidth });
      const hull = hullOf({ ...obj, strokeWidth });
      const paintedLeft = hull.left - strokeWidth / 2;
      const gap = paintedLeft - chrome.frame.left;
      assert.ok(Math.abs(gap - strokeWidth) < 0.5,
        `${name}@sw${strokeWidth}: painted edge clears the frame by ${gap.toFixed(3)}, want ${strokeWidth}`);
    }
  });
}

test('scaled clouds (Fabric scaleX/scaleY baked in) keep the grabbers on the padded frame', () => {
  for (const [name, obj] of Object.entries(shapes)) {
    assertDrawboardChrome(`${name}@scaled`, { ...obj, scaleX: 1.6, scaleY: 0.7 }, name);
  }
});

test('short 2-point polyline cloud + tiny polygon cloud (fewer than 8 crowns): grabbers never stack', () => {
  const line = { type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 150, y: 60 }], ...CLOUD };
  assert.ok(resolveCloudAnnotationGeometry(line).cusps.length < 8, 'fixture must have fewer than 8 crowns');
  assertDrawboardChrome('polyline-2pt', line, 'polyline');
  const tiny = { type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 24 }, { x: 0, y: 24 }], ...CLOUD };
  assertDrawboardChrome('polygon-tiny', tiny, 'polygon');
});

test('hover glow: 2.85x the stroke width at 0.666 opacity (Drawboard PDF proportions), in page units', () => {
  assert.equal(CLOUD_HOVER_GLOW_WIDTH_RATIO, 2.85);
  assert.equal(CLOUD_HOVER_GLOW_OPACITY, 0.666);
  assert.ok(Math.abs(cloudHoverGlowWidth(2) - 5.7) < 1e-9, 'Drawboard: stroke 2 -> glow 5.699');
  assert.ok(Math.abs(cloudHoverGlowWidth(2.5) - 7.125) < 1e-9);
  assert.equal(cloudHoverGlowWidth(undefined), 0);
  // The painted glow reads the same ratio, and carries the ink-band knockout
  // that keeps a translucent stroke its own colour (round 4, defect 10).
  for (const [name, obj] of Object.entries(shapes)) {
    const glow = buildCloudGlowPaint(resolveCloudAnnotationGeometry(obj));
    assert.ok(glow, `${name}: glow paint resolves`);
    assert.ok(Math.abs(glow.glowWidth - cloudHoverGlowWidth(obj.strokeWidth)) < 1e-9, `${name}: glow width`);
    assert.equal(glow.inkWidth, obj.strokeWidth, `${name}: knockout is the ink band`);
    assert.ok(glow.mask, `${name}: knockout mask emitted`);
    assert.ok(glow.mask.width > 0 && glow.mask.height > 0, `${name}: mask region is real`);
  }
});

test('polygon / polyline cloud vertices are the visual corner lobes the engine reports (studio moveVertex contract)', () => {
  for (const name of ['polygon', 'polyline']) {
    const obj = shapes[name];
    const { geometry, points } = worldOutlinePoints(obj);
    for (const vertex of geometry.points) {
      const world = { x: vertex.x + geometry.origin.x, y: vertex.y + geometry.origin.y };
      assert.ok(distanceToPoints(points, world) < 1e-3, `${name} vertex handle at (${world.x}, ${world.y}) is off its corner lobe`);
    }
    // Every convex corner crown apex IS the vertex (the polygon fixture has one
    // concave corner, which the engine turns into a valley; an open polyline's
    // two tips are crown ENDS, not apexes).
    const cusps = geometry.cusps;
    const hits = geometry.points.filter((v) => cusps.some((c) => Math.hypot(c.x - v.x, c.y - v.y) < 1e-6)).length;
    const expected = name === 'polygon' ? geometry.points.length - 1 : geometry.points.length - 2;
    assert.ok(hits >= expected, `${name}: only ${hits} vertices are crown apexes`);
  }
});

test('rotated cloud: chrome rotates about the same pivot the cloud does and stays in the unrotated frame', () => {
  for (const [name, base] of Object.entries(shapes)) {
    const rotated = { ...base, angle: 30 };
    const chrome = assertDrawboardChrome(`${name}@30deg`, rotated, name);
    const flat = cloudSelectionChrome(base);
    assert.equal(chrome.angle, 30);
    assert.deepEqual(chrome.rotationCenter, flat.rotationCenter);
    for (const id of HANDLE_IDS) {
      assert.ok(Math.abs(chrome.anchors[id].x - flat.anchors[id].x) < 1e-9);
      assert.ok(Math.abs(chrome.anchors[id].y - flat.anchors[id].y) < 1e-9);
    }
  }
  assert.deepEqual(cloudSelectionChrome({ ...shapes.rect, angle: 30 }).rotationCenter, { x: 250, y: 200 });
  // Rotated AND scaled: still eight distinct grabbers on the padded frame.
  assertDrawboardChrome('rect@rotated+scaled', { ...shapes.rect, angle: 45, scaleX: 1.5, scaleY: 0.6 }, 'rect');
});

test('hit test: an unfilled cloud hits on its crowns only - the inner box off the outline misses', () => {
  const rect = shapes.rect;
  const hull = cloudOutlineBounds(resolveCloudAnnotationGeometry(rect));
  assert.equal(isPointOnObject({ x: 250, y: 200 }, rect), false, 'box centre');
  assert.equal(isPointOnObject({ x: 250, y: 108 }, rect), false, 'inside the box, 8 units under the top edge, off every crown');
  assert.equal(isPointOnObject({ x: 250, y: 100 + hull.top }, rect), true, 'top-mid crown peak');
  assert.equal(isPointOnCloud({ x: 100, y: 100 }, rect), true, 'corner crown apex (the vertex)');
  assert.equal(isPointOnObject({ x: 250, y: 100 + hull.top - 8 }, rect), false, 'clear above the humps');
  const ellipse = shapes.ellipse;
  assert.equal(isPointOnObject({ x: 220, y: 180 }, ellipse), false, 'ellipse centre');
  const chrome = cloudSelectionChrome(ellipse);
  const topPeak = chrome.cusps.reduce((best, c) => (c.y < best.y ? c : best));
  assert.equal(isPointOnObject(topPeak, ellipse), true, 'ellipse top peak');
  // The grabbers now sit a stroke width OUTSIDE the ink: not a hit on the cloud.
  assert.equal(isPointOnObject(chrome.anchors.tl, ellipse), false, 'ellipse tl grabber is off the ink');
  const polygon = shapes.polygon;
  assert.equal(isPointOnObject({ x: 200, y: 180 }, polygon), false, 'polygon interior');
  const rightPeak = cloudSelectionChrome(polygon).cusps.reduce((best, c) => (c.x > best.x ? c : best));
  assert.equal(isPointOnObject(rightPeak, polygon), true, 'polygon peak');
});

test('hit test: a filled cloud also hits across its scalloped interior, humps included', () => {
  const filled = { ...shapes.rect, fill: 'rgba(255,0,0,0.3)' };
  assert.equal(isPointOnObject({ x: 250, y: 200 }, filled), true, 'box centre');
  assert.equal(isPointOnObject({ x: 250, y: 95 }, filled), true, 'inside a top hump, above the drawn box');
  assert.equal(isPointOnObject({ x: 250, y: 80 }, filled), false, 'above the humps');
  // Open polylines never fill, so a paint value cannot grow them a hit area.
  const paintedPolyline = { ...shapes.polyline, fill: '#ff0000' };
  assert.equal(isPointOnObject({ x: 200, y: 180 }, paintedPolyline), false);
});

test('marquee: a rectangle fully inside an unfilled cloud does not select it; crossing a crown or a filled interior does', () => {
  const rect = shapes.rect;
  assert.equal(doesRectIntersectObject({ left: 200, top: 150, right: 300, bottom: 250 }, rect), false);
  assert.equal(doesRectIntersectObject({ left: 200, top: 80, right: 300, bottom: 120 }, rect), true);
  const filled = { ...rect, fill: '#ff0000' };
  assert.equal(doesRectIntersectObject({ left: 200, top: 150, right: 300, bottom: 250 }, filled), true);
});

test('SVG layer: cloud hover halo + hit target are the crowns; glow stays on while selected; overlay receives frame anchors', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-shape-hit-target="cloud"/);
  assert.match(layer, /data-shape-hit-target="cloud-fill"/);
  // Drawboard keeps the scallop glow on while the cloud is selected; the
  // shared annotationIsHovered flag alone drops it on selection.
  //
  // Contract change 2026-09-09 (defect 2): the glow moved OUT of the
  // hit-target group and into an underlay painted BEFORE the ink, so a
  // selected red cloud stays red with a blue rim instead of reading blue. The
  // two assertions below were rewritten to the underlay's code shape — the
  // hover-OR-selected condition and the cloudHoverGlowWidth sizing they were
  // guarding are both still asserted, they just no longer live next to a
  // local `sw` inside the hit group. Paint order itself is pinned in
  // tests/cloudChromeDrawboardParity.test.mjs.
  // Contract change 2026-10-06 (owner Test 45): the glow geometry is the cloud
  // shape's own OR a clouded text box's rectangle stand-in (markBorderOutline);
  // the hover-OR-selected gate is unchanged.
  assert.match(layer, /const cloudGlowGeometry = cloudRenderGeometry\s*\|\|/);
  assert.match(layer, /const cloudGlowVisible = !!cloudGlowGeometry && \(annotationIsHovered \|\| annotationIsSelected\);/);
  // CONTRACT CHANGE 2026-09-10 (round 4, defect 10): the glow's geometry moved
  // out of inline JSX and into the shared paint model (cloudSvgPaint's
  // buildCloudGlowPaint) so the RING — the ink band knocked out of the glow —
  // is described in one place and node-testable. The two assertions this
  // replaces pinned the same 2.85x width and the same hover-OR-selected gate,
  // they just read them off local expressions that no longer exist. The ring
  // itself is asserted in tests/cloudChromeDrawboardParity.test.mjs.
  assert.match(layer, /\{cloudGlowPaint && \(/);
  assert.match(layer, /strokeOpacity=\{CLOUD_HOVER_GLOW_OPACITY\}/);
  assert.match(layer, /strokeWidth=\{cloudGlowPaint\.glowWidth\}/,
    'the visible glow is still the 2.85x band cloudHoverGlowWidth computes');
  assert.match(layer, /strokeWidth=\{cloudGlowPaint\.inkWidth\}/,
    'and the knockout is the ink band, so a translucent stroke keeps its colour');
  // Owner Test 45: the chrome comes from markBorderCloudChrome, which is
  // cloudSelectionChrome(obj) for a cloud shape and the same chrome built on
  // the rectangle stand-in for a clouded text box.
  assert.match(layer, /markBorderCloudChrome\(selectionChromeObj\)/);
  assert.match(layer, /handleAnchors=\{cloudChrome \? cloudChrome\.anchors : null\}/);
  assert.match(layer, /frameRect=\{cloudChrome \? cloudChrome\.frame : null\}/);
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /\.\.\.getHandlePositions\(bbox, padding\), \.\.\.\(handleAnchors \|\| \{\}\)/);
  assert.match(overlay, /const frame = frameRect \|\| \{ left, top, width, height \}/);
});
