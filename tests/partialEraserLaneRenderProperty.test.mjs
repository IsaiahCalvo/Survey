// w38 (2026-09-25) property test: random strokes x random eraser gestures,
// through the real lane store and both renderers.
//
// What it guards (each found broken on real data, see
// eraserLaneCompositionRealData.test.mjs):
//   * two writer sessions erasing the same stroke compose to exactly
//     "base minus every gesture" (was a Martinez intersection of two survivors
//     sharing edges: painted-back dabs, dropped blocks, slivers, hairlines);
//   * the same spot erased twice (identical eraser circles) stays exact;
//   * a stroked authored curve (imported/legacy ink) is painted by the canvas
//     painter with the same clip the SVG layer uses (the canvas clipped with
//     bounds-minus-cuts, a second boolean that painted slivers into holes).
//
// Invariants checked on every case:
//   1. no ink outside the original stroke;
//   2. the erased region is fully cleared (no sliver, of any width: every
//      survivor vertex must lie on the stroke's outline or on an eraser rim);
//   3. no ink lost outside the eraser (grid over the whole stroke);
//   4. shown area <= original area;
//   5. every screen converges byte-for-byte;
//   6. canvas and SVG clip the source with the same rings (the survivor).
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import * as Y from 'yjs';

import {
  docToByPage,
  readAnnotationObject,
  syncByPageToDoc,
  writeAnnotationMark,
} from '../src/services/annotationDocStore.js';
import { drawAnnotationObject } from '../src/utils/annotationCanvasPainter.js';
import {
  erasePageAnnotations,
  intersectErasedPathSurvivors,
} from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

const CASES = Number(process.env.ERASER_PROPERTY_CASES) || 14;
const RIM_TOLERANCE = 0.06; // eraser disk facets are <= 0.02 units off the rim
const GRID_TOLERANCE = 0.12;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

const rings = (polygons) => (polygons || []).flat();

function evenOdd(ringList, x, y) {
  let inside = false;
  for (const ring of ringList) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Signed distance to the union of the swept eraser disks (negative inside).
function eraserDistance(p, gestures) {
  let best = Infinity;
  for (const { points, radius } of gestures) {
    let d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    for (let i = 1; i < points.length; i += 1) d = Math.min(d, segmentDistance(p, points[i - 1], points[i]));
    best = Math.min(best, d - radius);
  }
  return best;
}

function ringEdgeDistance(p, ringList) {
  let best = Infinity;
  for (const ring of ringList) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, segmentDistance(
        p,
        { x: ring[i - 1][0], y: ring[i - 1][1] },
        { x: ring[i][0], y: ring[i][1] },
      ));
    }
  }
  return best;
}

function polygonArea(polygons) {
  let total = 0;
  for (const ring of rings(polygons)) {
    let twice = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    total += twice / 2;
  }
  return Math.abs(total);
}

function boundsOf(ringList) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of ringList) {
    for (const [x, y] of ring) {
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    }
  }
  return box;
}

/**
 * Check a shown survivor against the exact answer.
 * `inBase(p)` is the painted original; `baseEdge(p)` the distance from p to
 * the boundary the eraser pipeline cuts from (the stroke's outline polygon).
 */
function assertExactErase({ label, shownPolygons, baseRings, gestures, baseArea }) {
  const shownRings = rings(shownPolygons);
  // 2 + 1: every survivor vertex sits on the original outline or an eraser rim.
  for (const ring of shownRings) {
    for (const [x, y] of ring) {
      const onOutline = ringEdgeDistance({ x, y }, baseRings) <= RIM_TOLERANCE;
      const onRim = Math.abs(eraserDistance({ x, y }, gestures)) <= RIM_TOLERANCE;
      assert.ok(
        onOutline || onRim,
        `${label}: survivor vertex (${x}, ${y}) is on neither the stroke outline nor an eraser rim `
        + `(outline ${ringEdgeDistance({ x, y }, baseRings).toFixed(3)}, rim ${eraserDistance({ x, y }, gestures).toFixed(3)})`,
      );
      assert.ok(
        evenOdd(baseRings, x, y) || ringEdgeDistance({ x, y }, baseRings) <= RIM_TOLERANCE,
        `${label}: survivor vertex (${x}, ${y}) lies outside the original stroke`,
      );
    }
  }
  // 4.
  assert.ok(polygonArea(shownPolygons) <= baseArea + 1e-6, `${label}: shown area grew`);
  // 1 + 2 + 3 on a grid over the whole stroke.
  const [minX, minY, maxX, maxY] = boundsOf(baseRings);
  const step = 0.5;
  for (let y = minY - 1; y <= maxY + 1; y += step) {
    for (let x = minX - 1; x <= maxX + 1; x += step) {
      const shown = evenOdd(shownRings, x, y);
      const inBase = evenOdd(baseRings, x, y);
      const eraser = eraserDistance({ x, y }, gestures);
      if (shown) {
        assert.ok(
          inBase || ringEdgeDistance({ x, y }, baseRings) <= GRID_TOLERANCE,
          `${label}: ink at (${x}, ${y}) outside the original stroke`,
        );
        assert.ok(eraser >= -GRID_TOLERANCE, `${label}: ink left inside the eraser at (${x}, ${y})`);
      } else if (inBase && eraser > GRID_TOLERANCE) {
        assert.ok(
          ringEdgeDistance({ x, y }, baseRings) <= GRID_TOLERANCE,
          `${label}: ink lost at (${x}, ${y}), ${eraser.toFixed(2)} outside the eraser`,
        );
      }
    }
  }
}

// A mark may vanish only when the eraser covered all of it.
function assertFullyCovered(label, baseRings, gestures) {
  const [minX, minY, maxX, maxY] = boundsOf(baseRings);
  for (let y = minY; y <= maxY; y += 0.5) {
    for (let x = minX; x <= maxX; x += 0.5) {
      if (!evenOdd(baseRings, x, y) || ringEdgeDistance({ x, y }, baseRings) <= GRID_TOLERANCE) continue;
      assert.ok(
        eraserDistance({ x, y }, gestures) <= GRID_TOLERANCE,
        `${label}: the whole mark vanished but (${x}, ${y}) was never under the eraser`,
      );
    }
  }
}

const shiftPolygons = (polygons, dx, dy) => polygons.map((polygon) => polygon.map((ring) => (
  ring.map(([x, y]) => [x + dx, y + dy])
)));
const shiftGesture = (gesture, dx, dy) => ({
  ...gesture,
  points: gesture.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
});

function randomStroke(random, id) {
  const points = [];
  let x = 40 + random() * 40;
  let y = 40 + random() * 40;
  let heading = random() * Math.PI * 2;
  const count = 3 + Math.floor(random() * 10);
  for (let i = 0; i < count; i += 1) {
    points.push({ x, y });
    heading += (random() - 0.5) * 2.2;
    const step = 4 + random() * 14;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
  }
  return createProductionPaperInk({
    id,
    tool: 'pen',
    points,
    color: '#ff0000',
    width: 3 + random() * 30,
  });
}

function randomGesture(random, stroke, polygons = stroke.polygons) {
  // Aim at the stroke: start on its outline's own vertices.
  const outline = rings(polygons)[0];
  const start = outline[Math.floor(random() * outline.length)];
  const radius = 2 + random() * 12;
  const points = [{ x: start[0] + (random() - 0.5) * 6, y: start[1] + (random() - 0.5) * 6 }];
  if (random() < 0.5) {
    const heading = random() * Math.PI * 2;
    const steps = 1 + Math.floor(random() * 12);
    for (let i = 1; i <= steps; i += 1) {
      points.push({
        x: points[0].x + Math.cos(heading) * i * 1.7,
        y: points[0].y + Math.sin(heading) * i * 1.7,
      });
    }
  }
  return { points, radius };
}

function commitErase(doc, gesture, writerId, id) {
  const before = docToByPage(doc);
  const result = erasePageAnnotations({
    pageAnnotations: before[1],
    eraserPoints: gesture.points,
    eraserRadius: gesture.radius,
    mode: 'partial',
  });
  if (!result.didChange) return false;
  syncByPageToDoc(doc, {
    ...before,
    1: {
      ...result.pageAnnotations,
      eraserMutation: {
        id,
        pageNumber: 1,
        points: gesture.points,
        radius: gesture.radius,
        mode: 'partial',
        touchedIds: result.touchedIds,
        changedIds: result.changedIds,
        deletedIds: result.deletedIds,
        objectMutations: result.objectMutations,
      },
    },
  }, { prevByPage: before, eraserWriterId: writerId });
  return true;
}

const cloneDoc = (source) => {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
};

test('two writer sessions erasing one pen stroke compose exactly (random strokes, gestures, moves)', () => {
  const random = mulberry32(0x5eed38);
  for (let n = 0; n < CASES; n += 1) {
    const stroke = randomStroke(random, `stroke-${n}`);
    const seed = new Y.Doc();
    syncByPageToDoc(seed, { 1: { objects: [stroke] } });
    const writerA = cloneDoc(seed);
    let applied = [];
    const gestureCountA = 1 + Math.floor(random() * 2);
    for (let g = 0; g < gestureCountA; g += 1) {
      const gesture = randomGesture(random, stroke);
      if (commitErase(writerA, gesture, 'writer-a:session-1', `eraser:a:${n}:${g}`)) applied.push(gesture);
    }
    // Sometimes the stroke is moved between the sessions: every earlier bite
    // must move with it.
    let dx = 0;
    let dy = 0;
    if (random() < 0.4) {
      dx = Math.round((random() - 0.5) * 60);
      dy = Math.round((random() - 0.5) * 60);
      const base = readAnnotationObject(writerA, stroke.id);
      writerA.transact(() => {
        writeAnnotationMark(writerA, stroke.id, 1, { ...structuredClone(base), left: dx, top: dy }, { base, basePage: 1 });
      });
      applied = applied.map((gesture) => shiftGesture(gesture, dx, dy));
    }
    const movedPolygons = shiftPolygons(stroke.polygons, dx, dy);
    // Writer B is a later session: it sees A's result, then erases.
    const writerB = cloneDoc(writerA);
    const gestureCountB = 1 + Math.floor(random() * 2);
    for (let g = 0; g < gestureCountB; g += 1) {
      const gesture = g === 0 && random() < 0.3 && applied.length
        ? structuredClone(applied[0]) // the very same spot again
        : randomGesture(random, stroke, movedPolygons);
      if (commitErase(writerB, gesture, 'writer-b:session-2', `eraser:b:${n}:${g}`)) applied.push(gesture);
    }
    Y.applyUpdate(writerA, Y.encodeStateAsUpdate(writerB));
    const shownA = docToByPage(writerA);
    assert.deepEqual(docToByPage(writerB), shownA, `case ${n}: screens diverge`);
    const shown = shownA[1]?.objects?.find((object) => object?.data?.id === stroke.id);
    if (!shown) {
      assertFullyCovered(`case ${n}`, rings(movedPolygons), applied);
      continue;
    }
    assertExactErase({
      label: `case ${n}${dx || dy ? ` (moved ${dx},${dy})` : ''}`,
      shownPolygons: shown.polygons,
      baseRings: rings(movedPolygons),
      gestures: applied,
      baseArea: polygonArea(stroke.polygons),
    });
  }
});

// Three or four sessions on one stroke: every lane shares the stroke's box, so
// a nudge that ignored the running result landed the third lane exactly on
// the second lane's nudged edges and Martinez ran out of memory (w38 review
// D). Gestures here are dabs and curved drags (straight evenly sampled drags
// have their own, separate open defect).
test('three and four writer sessions on one stroke compose exactly', () => {
  const random = mulberry32(0x3a4e5);
  for (let n = 0; n < Math.ceil(CASES / 2); n += 1) {
    const stroke = randomStroke(random, `many-${n}`);
    let shared = new Y.Doc();
    syncByPageToDoc(shared, { 1: { objects: [stroke] } });
    const applied = [];
    const writers = 3 + (n % 2);
    for (let w = 0; w < writers; w += 1) {
      const session = cloneDoc(shared);
      const gestureCount = 1 + Math.floor(random() * 3);
      for (let g = 0; g < gestureCount; g += 1) {
        const aim = randomGesture(random, stroke);
        const start = aim.points[0];
        const gesture = random() < 0.5
          ? { points: [start], radius: aim.radius }
          : {
            radius: aim.radius,
            points: Array.from({ length: 8 }, (_, i) => ({
              x: start.x + Math.cos(i / 3) * i * 1.3,
              y: start.y + Math.sin(i / 3) * i * 1.3,
            })),
          };
        if (commitErase(session, gesture, `writer-${w}:session-${w}`, `eraser:${n}:${w}:${g}`)) applied.push(gesture);
      }
      shared = session;
    }
    // (A runaway composition shows up as this file's own timeout, not as a
    // wall-clock assertion: blocking CI jobs must not assert on elapsed time.)
    const shown = docToByPage(shared)[1]?.objects?.find((object) => object?.data?.id === stroke.id);
    if (!shown) {
      assertFullyCovered(`many ${n}`, rings(stroke.polygons), applied);
      continue;
    }
    assertExactErase({
      label: `many ${n} (${writers} writers)`,
      shownPolygons: shown.polygons,
      baseRings: rings(stroke.polygons),
      gestures: applied,
      baseArea: polygonArea(stroke.polygons),
    });
  }
});

// The exact dense mark that ran out of memory in review D (seed 104: a
// 120-point wavy pen stroke, three lanes of 12 bites each).
test('a dense three-lane mark composes without running away (review D seed 104)', () => {
  const random = mulberry32(104);
  const points = [];
  let x = 100 + random() * 50;
  let y = 300;
  const amplitude = 20 + random() * 50;
  const period = 3 + random() * 6;
  for (let i = 0; i < 120; i += 1) {
    points.push({ x, y });
    x += 2;
    y = 300 + Math.sin(i / period) * amplitude;
  }
  const base = createProductionPaperInk({ id: 's', tool: 'pen', points, color: '#f00', width: 8 + random() * 20 });
  const lanes = [];
  const gestures = [];
  for (let lane = 0; lane < 3; lane += 1) {
    let object = base;
    for (let bite = 0; bite < 12; bite += 1) {
      const p = points[Math.floor(random() * points.length)];
      const drag = random() < 0.4;
      const gesture = [{ x: p.x + (random() - 0.5) * 20, y: p.y + (random() - 0.5) * 20 }];
      if (drag) {
        const heading = random() * 6.28;
        for (let k = 1; k < 12; k += 1) {
          gesture.push({ x: gesture[0].x + Math.cos(heading) * k * 1.5, y: gesture[0].y + Math.sin(heading) * k * 1.5 });
        }
      }
      const radius = 2 + random() * 5;
      const next = erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: gesture,
        eraserRadius: radius,
        mode: 'partial',
      }).pageAnnotations.objects[0];
      if (next) object = next;
      gestures.push({ points: gesture, radius });
    }
    lanes.push(object);
  }
  // Used to run Martinez out of memory (~4 GB); now ~0.1 s. A regression
  // shows up as a crash or this file's timeout.
  const composed = intersectErasedPathSurvivors(lanes, { outlineArea: polygonArea(base.polygons) });
  assert.ok(composed?.polygons?.length, 'the mark is still shown');
  const areas = lanes.map((lane) => polygonArea(lane.polygons));
  assert.ok(polygonArea(composed.polygons) <= Math.min(...areas) + 1e-6);
});

test('erasing the exact same spot twice leaves exactly one clean hole', () => {
  const random = mulberry32(0xd0b1e);
  for (let n = 0; n < Math.ceil(CASES / 2); n += 1) {
    const stroke = randomStroke(random, `twice-${n}`);
    const gesture = randomGesture(random, stroke);
    for (const writers of [['w1:s', 'w1:s'], ['w1:s', 'w2:s']]) {
      const doc = new Y.Doc();
      syncByPageToDoc(doc, { 1: { objects: [stroke] } });
      commitErase(doc, gesture, writers[0], `eraser:${n}:first`);
      commitErase(doc, structuredClone(gesture), writers[1], `eraser:${n}:second`);
      const shown = docToByPage(doc)[1]?.objects?.[0];
      if (!shown) {
        assertFullyCovered(`same-spot ${n}`, rings(stroke.polygons), [gesture]);
        continue;
      }
      assertExactErase({
        label: `same-spot ${n} ${writers.join('/')}`,
        shownPolygons: shown.polygons,
        baseRings: rings(stroke.polygons),
        gestures: [gesture],
        baseArea: polygonArea(stroke.polygons),
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Stroked authored curves: canvas painter vs SVG layer paint the same thing.
// ---------------------------------------------------------------------------

let vite = null;
let svgRenderers = null;

before(async () => {
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    ssr: { external: ['@survey/shared'] },
  });
  svgRenderers = await vite.ssrLoadModule('/src/utils/svgAnnotationRenderers.jsx');
});

after(async () => { await vite?.close(); });

function recordingContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  const context = new Proxy({ calls }, {
    get(target, key) {
      if (key === 'calls') return calls;
      if (key in target) return target[key];
      return record(String(key));
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return context;
}

// Rings traced before the painter's first clip() call.
function canvasClipRings(calls) {
  const clipIndex = calls.findIndex(([name]) => name === 'clip');
  assert.ok(clipIndex >= 0, 'the canvas painter clips an erased authored curve');
  assert.deepEqual(calls[clipIndex], ['clip', 'evenodd']);
  const out = [];
  let current = null;
  for (const [name, ...args] of calls.slice(0, clipIndex)) {
    if (name === 'beginPath') { out.length = 0; current = null; }
    if (name === 'moveTo') { current = [[args[0], args[1]]]; out.push(current); }
    if (name === 'lineTo') current.push([args[0], args[1]]);
    if (name === 'rect') out.push(['rect', ...args]);
  }
  return out;
}

function svgClipRings(markup) {
  const clip = markup.match(/<clipPath[^>]*>\s*<path d="([^"]+)"[^>]*clip-rule="evenodd"/);
  assert.ok(clip, 'the SVG layer clips an erased authored curve (even-odd)');
  const out = [];
  let current = null;
  for (const [, op, x, y] of clip[1].matchAll(/([MLZ])\s*(-?[\d.e+-]+)?\s*(-?[\d.e+-]+)?/g)) {
    if (op === 'M') { current = [[Number(x), Number(y)]]; out.push(current); }
    if (op === 'L') current.push([Number(x), Number(y)]);
  }
  return out;
}

const withoutClosingPoint = (ring) => (
  ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ? ring.slice(0, -1)
    : ring
);

test('a partially erased stroked curve paints the same clip on canvas and in SVG, and it is exact', () => {
  const random = mulberry32(0xc0ffee);
  for (let n = 0; n < Math.ceil(CASES / 2); n += 1) {
    const width = 3 + random() * 18;
    const path = [['M', 60, 60]];
    let x = 60; let y = 60;
    for (let i = 0; i < 3; i += 1) {
      const cx = x + (random() - 0.5) * 70;
      const cy = y + (random() - 0.5) * 70;
      x += (random() - 0.5) * 90;
      y += (random() - 0.5) * 90;
      path.push(['Q', cx, cy, x, y]);
    }
    const object = {
      type: 'path', path, stroke: '#ff0000', strokeWidth: width, fill: null,
      left: 0, top: 0, scaleX: 1, scaleY: 1, strokeLineCap: 'round', strokeLineJoin: 'round',
      tool: 'pen', data: { id: `curve-${n}`, tool: 'pen' },
    };
    // Aim at a point on the curve.
    const t = random();
    const [, c1x, c1y, e1x, e1y] = path[1];
    const hit = {
      x: (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * c1x + t * t * e1x,
      y: (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * c1y + t * t * e1y,
    };
    const gesture = { points: [hit], radius: 3 + random() * 10 };
    const erased = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: gesture.points,
      eraserRadius: gesture.radius,
      mode: 'partial',
    });
    const survivor = erased.pageAnnotations.objects[0];
    if (!survivor?.paperSourceStroke) continue;

    const context = recordingContext();
    drawAnnotationObject(context, survivor, 1);
    const canvasRings = canvasClipRings(context.calls);
    assert.equal(canvasRings.some((ring) => ring[0] === 'rect'), false, `curve ${n}: no bounds-minus-cuts clip`);
    const svgMarkup = renderToStaticMarkup(
      React.createElement(React.Fragment, null, svgRenderers.renderPath(survivor, 0)),
    );
    const svgRings = svgClipRings(svgMarkup);
    assert.deepEqual(
      canvasRings.map(withoutClosingPoint),
      svgRings.map(withoutClosingPoint),
      `curve ${n}: canvas and SVG clip the source with different geometry`,
    );
    assert.deepEqual(
      canvasRings.map(withoutClosingPoint),
      rings(survivor.polygons).map(withoutClosingPoint),
      `curve ${n}: the clip is the survivor itself`,
    );
    // What both renderers paint = the true round stroke of the source curve
    // inside that clip. Nothing inside the eraser; nothing lost outside it
    // (beyond the outline polygon's own curve tolerance).
    const centerline = [{ x: 60, y: 60 }];
    for (let i = 1; i < path.length; i += 1) {
      const p0 = centerline.at(-1);
      const [, cx, cy, ex, ey] = path[i];
      for (let k = 1; k <= 96; k += 1) {
        const u = k / 96;
        centerline.push({
          x: (1 - u) * (1 - u) * p0.x + 2 * (1 - u) * u * cx + u * u * ex,
          y: (1 - u) * (1 - u) * p0.y + 2 * (1 - u) * u * cy + u * u * ey,
        });
      }
    }
    const strokeDistance = (p) => {
      let d = Infinity;
      for (let i = 1; i < centerline.length; i += 1) d = Math.min(d, segmentDistance(p, centerline[i - 1], centerline[i]));
      return d - width / 2;
    };
    const clipRings = rings(survivor.polygons);
    // Losses are judged against the TRUE round stroke. (w38 judged them
    // against the outline the eraser cut from while that outline fell short
    // at very tight turns — seed 0xc0ffee case 21 at 150 cases; w39 fixed the
    // outline builder, tests/roundStrokeOutlineTightTurns.test.mjs.)
    const step = 0.25;
    const reach = gesture.radius + width;
    for (let py = hit.y - reach; py <= hit.y + reach; py += step) {
      for (let px = hit.x - reach; px <= hit.x + reach; px += step) {
        const inStroke = strokeDistance({ x: px, y: py });
        if (inStroke > 0) continue;
        const painted = evenOdd(clipRings, px, py);
        const eraser = eraserDistance({ x: px, y: py }, [gesture]);
        if (painted) {
          assert.ok(eraser >= -GRID_TOLERANCE, `curve ${n}: ink painted inside the eraser at (${px}, ${py})`);
        } else if (eraser > GRID_TOLERANCE && inStroke < -GRID_TOLERANCE) {
          assert.fail(`curve ${n}: ink lost at (${px}, ${py}), ${eraser.toFixed(2)} outside the eraser`);
        }
      }
    }
  }
});
