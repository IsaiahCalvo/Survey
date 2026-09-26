// w39 (2026-09-25): defects the w38 final review found in the shared eraser
// lane code, each with its repro.
//   1. Lanes erased with very different eraser radii: the intersection's area
//      check used a base outline built at another curve tolerance, rejected
//      the correct answer and preferred MORE ink.
//   2. When every intersection attempt threw, the composition returned []
//      and hid the whole mark on every screen.
//   3. Re-erasing a spot this writer already erased (another session's lane
//      on the stroke) threw "partial eraser lane could not be replayed".
//   4. The exact source only rode along when the cut mask was non-empty, so
//      a failed or empty cut boolean switched the mark to polygon rendering.
//   7. Canvas and SVG disagreed on a survivor made only of degenerate
//      closed 3-point rings.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import * as Y from 'yjs';

import {
  deriveWriterEraserLane,
  docToByPage,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';
import { drawAnnotationObject } from '../src/utils/annotationCanvasPainter.js';
import {
  erasePageAnnotations,
  intersectErasedPathSurvivors,
  pathObjectToPagePolygons,
} from '../src/utils/pageSpaceEraser.js';
import { polygonSetArea } from '../src/utils/paperAnnotationGeometry.js';

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

const evenOdd = (polygons, x, y) => {
  let inside = false;
  for (const polygon of polygons || []) for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x; const dy = b.y - a.y; const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

const ringEdgeDistance = (p, polygons) => {
  let best = Infinity;
  for (const polygon of polygons) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, segmentDistance(p, { x: ring[i - 1][0], y: ring[i - 1][1] }, { x: ring[i][0], y: ring[i][1] }));
    }
  }
  return best;
};

function commitErase(doc, gesture, writerId, id) {
  const before = docToByPage(doc);
  const result = erasePageAnnotations({
    pageAnnotations: before[1], eraserPoints: gesture.points, eraserRadius: gesture.radius, mode: 'partial',
  });
  if (!result.didChange) return false;
  syncByPageToDoc(doc, {
    ...before,
    1: {
      ...result.pageAnnotations,
      eraserMutation: {
        id, pageNumber: 1, points: gesture.points, radius: gesture.radius, mode: 'partial',
        touchedIds: result.touchedIds, changedIds: result.changedIds, deletedIds: result.deletedIds,
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

test('1: two sessions erasing with very different radii compose to the exact answer', () => {
  const random = mulberry32(0x5151);
  for (let n = 0; n < 12; n += 1) {
    const width = 3 + random() * 10;
    const path = [['M', 60, 60]];
    let x = 60; let y = 60;
    for (let i = 0; i < 3; i += 1) {
      const cx = x + (random() - 0.5) * 60;
      const cy = y + (random() - 0.5) * 60;
      x += (random() - 0.5) * 70;
      y += (random() - 0.5) * 70;
      path.push(['Q', cx, cy, x, y]);
    }
    const stroke = {
      type: 'path', path, stroke: '#ff0000', strokeWidth: width, fill: null, left: 0, top: 0,
      scaleX: 1, scaleY: 1, strokeLineCap: 'round', strokeLineJoin: 'round',
      tool: 'pen', data: { id: `lane-${n}`, tool: 'pen' },
    };
    const a = { points: [{ x: path[1][3], y: path[1][4] }], radius: 0.4 };
    const b = { points: [{ x: path[2][3], y: path[2][4] }], radius: 6 };
    const seed = new Y.Doc();
    syncByPageToDoc(seed, { 1: { objects: [stroke] } });
    const writerA = cloneDoc(seed);
    const writerB = cloneDoc(seed);
    assert.ok(commitErase(writerA, a, 'writer-a:s1', `eraser:a:${n}`), `case ${n}: A bites`);
    assert.ok(commitErase(writerB, b, 'writer-b:s2', `eraser:b:${n}`), `case ${n}: B bites`);
    Y.applyUpdate(writerA, Y.encodeStateAsUpdate(writerB));
    const shown = docToByPage(writerA)[1]?.objects?.find((object) => object?.data?.id === stroke.data.id);
    assert.ok(shown?.polygons?.length, `case ${n}: the stroke is still shown`);
    // Exact answer: the finest outline (the one lane A cut) minus both disks.
    const outline = pathObjectToPagePolygons(stroke, a.radius);
    const inEraser = (p) => [a, b].some(({ points: [c], radius }) => Math.hypot(p.x - c.x, p.y - c.y) < radius);
    const nearRim = (p) => [a, b].some(({ points: [c], radius }) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - radius) < 0.08);
    for (const { points: [c], radius } of [a, b]) {
      const reach = radius + width;
      const step = Math.max(0.05, radius / 12);
      for (let py = c.y - reach; py <= c.y + reach; py += step) {
        for (let px = c.x - reach; px <= c.x + reach; px += step) {
          const p = { x: px, y: py };
          if (nearRim(p) || ringEdgeDistance(p, outline) < 0.08) continue;
          const expected = evenOdd(outline, px, py) && !inEraser(p);
          assert.equal(evenOdd(shown.polygons, px, py), expected, `case ${n}: (${px}, ${py})`);
        }
      }
    }
  }
});

test('2: when every intersection attempt throws, the mark is not hidden', () => {
  // A box extent this small cannot be put on the boolean grid: every attempt
  // throws. Before: [] -> the whole mark disappeared on every screen.
  const tiny = 1e-300;
  const survivor = (id, size) => ({
    type: 'path', data: { id }, fill: '#000', strokeWidth: 0,
    polygons: [[[[0, 0], [size, 0], [size, size], [0, size], [0, 0]]]],
    path: [['M', 0, 0], ['L', size, 0], ['L', size, size], ['L', 0, size], ['Z']],
  });
  const first = survivor('first', 3 * tiny);
  const second = survivor('second', 2 * tiny);
  const result = intersectErasedPathSurvivors([first, second]);
  // (Both areas underflow to 0 at this size, so which lane is shown is a
  // tie; the point is that one is shown.)
  assert.ok(result === first || result === second, 'a lane survivor is shown, not nothing');
});

test('3: a gesture that removes nothing from this writer\'s own survivor keeps its lane instead of throwing', () => {
  const base = {
    type: 'path', path: [['M', 0, 50], ['L', 100, 50]], stroke: '#000', strokeWidth: 12, fill: null,
    left: 0, top: 0, scaleX: 1, scaleY: 1, strokeLineCap: 'round', strokeLineJoin: 'round',
    tool: 'pen', data: { id: 'again', tool: 'pen' },
  };
  const gesture = { points: [{ x: 50, y: 50 }], radius: 5, mode: 'partial' };
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [base] }, eraserPoints: gesture.points, eraserRadius: gesture.radius, mode: 'partial',
  });
  const firstSurvivor = first.objectMutations[0].survivor;
  const previousLane = {
    base, deleted: false, survivor: firstSurvivor, gestures: [gesture],
  };
  // On this writer's own survivor the gesture removes nothing (in the app:
  // the other session's lane made the shared view differ; here simply a
  // gesture that misses what this writer still has). Before: a throw.
  const idle = { points: [{ x: 50, y: 90 }], radius: 5, mode: 'partial' };
  let lane;
  assert.doesNotThrow(() => {
    lane = deriveWriterEraserLane({
      writerId: 'writer-a:s1', storageKey: 'again', pageNumber: 1, operationId: 'eraser:again:2',
      baseObject: base, previousLane, gesture: idle,
    });
  });
  assert.equal(lane.deleted, false);
  assert.equal(lane.gestures.length, 2, 'the gesture is recorded');
  assert.ok(
    Math.abs(polygonSetArea(lane.survivor.polygons) - polygonSetArea(firstSurvivor.polygons)) < 1e-9,
    'the lane keeps exactly its earlier survivor',
  );
});

test('4: the exact source rides along with every survivor, even when the cut mask is empty', () => {
  const base = {
    type: 'path', path: [['M', 0, 50], ['Q', 50, 0, 100, 50]], stroke: '#000', strokeWidth: 8, fill: null,
    left: 0, top: 0, scaleX: 1, scaleY: 1, strokeLineCap: 'round', strokeLineJoin: 'round',
    tool: 'pen', data: { id: 'source', tool: 'pen' },
  };
  const bitten = erasePageAnnotations({
    pageAnnotations: { objects: [base] }, eraserPoints: [{ x: 50, y: 25 }], eraserRadius: 2, mode: 'partial',
  }).objectMutations[0].survivor;
  assert.ok(bitten.paperSourceStroke, 'fixture: a bitten curve carries its source');
  // A survivor whose polygons are the whole source outline has an empty cut
  // mask (outline minus survivor). It must still carry the source.
  const whole = { ...bitten, polygons: pathObjectToPagePolygons(base) };
  const composed = intersectErasedPathSurvivors([whole, structuredClone(whole)]);
  assert.ok(composed.polygons.length > 0);
  assert.ok(composed.paperSourceStroke, 'the source stays attached');
});

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

test('7: canvas and SVG agree on a survivor made only of degenerate closed rings', () => {
  const object = {
    type: 'path', path: [['M', 0, 0], ['L', 10, 0]], left: 0, top: 0, scaleX: 1, scaleY: 1,
    fill: '#ff0000', stroke: 'transparent', strokeWidth: 0, fillRule: 'evenodd',
    // [a, b, a]: three entries, two distinct points — a line, no area.
    polygons: [[[[0, 0], [10, 0], [0, 0]]]],
    paperSourceStroke: {
      path: [['M', 0, 0], ['L', 10, 0]], matrix: [1, 0, 0, 1, 0, 0], paintMode: 'stroke',
      stroke: '#ff0000', strokeWidth: 2, strokeLineCap: 'round', strokeLineJoin: 'round',
    },
    data: { id: 'degenerate' },
  };
  const calls = [];
  const context = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push([String(key), ...args]);
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  drawAnnotationObject(context, object, 1);
  const svg = renderToStaticMarkup(React.createElement(React.Fragment, null, svgRenderers.renderPath(object, 0)));
  const canvasClips = calls.some(([name]) => name === 'clip');
  const svgClips = /<clipPath/.test(svg);
  assert.equal(canvasClips, svgClips, 'both clip the source, or neither does');
  assert.equal(svgClips, false, 'a line-only survivor is no clip');
});
