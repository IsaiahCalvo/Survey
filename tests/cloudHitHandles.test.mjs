// Revision clouds: hover/hit on the crowns, selection handles on the outer
// scallop cusps (Drawboard PDF behaviour), for every cloud shape.
//
// Reference: the approved revision-cloud studio (d1abe78) and Drawboard PDF -
// the studio locks each corner crown's apex to its vertex and puts its corner
// handles there; Drawboard's hover glow hugs the scallops and its grabbers sit
// on the outer peaks, never on the inner box the cloud was drawn from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cloudOutlineBounds,
  cloudSelectionChrome,
  resolveCloudAnnotationGeometry,
  sampleCloudCommands,
} from '../src/utils/cloudAnnotationGeometry.js';
import { doesRectIntersectObject, isPointOnCloud, isPointOnObject } from '../src/utils/geometryHitTest.js';

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
  const x = p.x - obj.left;
  const y = p.y - obj.top;
  if (name === 'rect') return Math.max(-x, x - obj.width, -y, y - obj.height);
  if (name === 'ellipse') return Math.hypot((x - obj.rx) / obj.rx, (y - obj.ry) / obj.ry) - 1;
  if (name === 'circle') return Math.hypot(x - obj.radius, y - obj.radius) / obj.radius - 1;
  // polygon / polyline: distance to the nearest base edge, negative when
  // strictly inside a closed polygon.
  const pts = obj.points;
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

for (const [name, obj] of Object.entries(shapes)) {
  test(`${name} cloud: all eight selection handles sit ON the outline and never inside the base shape`, () => {
    const chrome = cloudSelectionChrome(obj);
    assert.ok(chrome, 'cloud chrome resolves');
    const { points } = worldOutlinePoints(obj);
    for (const id of HANDLE_IDS) {
      const anchor = chrome.anchors[id];
      assert.ok(anchor, `${id} anchor`);
      const gap = distanceToPoints(points, anchor);
      assert.ok(gap < 0.25, `${name}.${id} handle is ${gap.toFixed(3)} units off the scalloped outline`);
      // Cusps are the crowns' apexes: on the base shape only where the studio
      // locks a corner crown to its vertex, otherwise a full bump outside it.
      assert.ok(outsideBase(name, obj, anchor) >= -1e-6,
        `${name}.${id} handle at (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)}) is inside the base shape`);
    }
    // Each grabber owns its own cusp - no two handles stacked on one peak.
    const keys = new Set(HANDLE_IDS.map((id) => `${chrome.anchors[id].x.toFixed(3)},${chrome.anchors[id].y.toFixed(3)}`));
    assert.equal(keys.size, HANDLE_IDS.length, `${name}: handles share a cusp`);
  });

  test(`${name} cloud: the selection frame is the outer hull of the humps, not the inner box`, () => {
    const chrome = cloudSelectionChrome(obj);
    const { points } = worldOutlinePoints(obj);
    const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
    assert.ok(Math.abs(chrome.frame.left - Math.min(...xs)) < 0.5);
    assert.ok(Math.abs(chrome.frame.top - Math.min(...ys)) < 0.5);
    assert.ok(Math.abs(chrome.frame.left + chrome.frame.width - Math.max(...xs)) < 0.5);
    assert.ok(Math.abs(chrome.frame.top + chrome.frame.height - Math.max(...ys)) < 0.5);
    if (name === 'rect') {
      // The humps bulge a full crown depth past the drawn box on every side.
      assert.ok(chrome.frame.left < obj.left - 5 && chrome.frame.top < obj.top - 5);
      assert.ok(chrome.frame.left + chrome.frame.width > obj.left + obj.width + 5);
    }
  });
}

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
  const rotated = { ...shapes.rect, angle: 30 };
  const chrome = cloudSelectionChrome(rotated);
  const flat = cloudSelectionChrome(shapes.rect);
  assert.equal(chrome.angle, 30);
  assert.deepEqual(chrome.rotationCenter, { x: 250, y: 200 });
  for (const id of HANDLE_IDS) {
    assert.ok(Math.abs(chrome.anchors[id].x - flat.anchors[id].x) < 1e-9);
    assert.ok(Math.abs(chrome.anchors[id].y - flat.anchors[id].y) < 1e-9);
  }
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
  assert.equal(isPointOnObject(chrome.anchors.mt, ellipse), true, 'ellipse top peak');
  const polygon = shapes.polygon;
  assert.equal(isPointOnObject({ x: 200, y: 180 }, polygon), false, 'polygon interior');
  assert.equal(isPointOnObject(cloudSelectionChrome(polygon).anchors.mr, polygon), true, 'polygon peak');
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

test('SVG layer: cloud hover halo + hit target are the crowns; overlay receives cusp anchors and the hull frame', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-shape-hit-target="cloud"/);
  assert.match(layer, /data-shape-hit-target="cloud-fill"/);
  assert.match(layer, /cloudSelectionChrome\(selectionChromeObj\)/);
  assert.match(layer, /handleAnchors=\{cloudChrome \? cloudChrome\.anchors : null\}/);
  assert.match(layer, /frameRect=\{cloudChrome \? cloudChrome\.frame : null\}/);
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /\.\.\.getHandlePositions\(bbox, padding\), \.\.\.\(handleAnchors \|\| \{\}\)/);
  assert.match(overlay, /const frame = frameRect \|\| \{ left, top, width, height \}/);
});
