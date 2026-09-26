// w39 (2026-09-25): eraser booleans on an exact integer grid (Clipper2, via
// src/utils/polygonBooleans.js) instead of Martinez.
//
// 1. Ink islands inside a straight wipe: evenly spaced straight-drag samples
//    turn by float noise (~7.5e-15 at page coordinates ~100); the eraser
//    mask fell back to a union of per-segment capsules and Martinez merged
//    their near-collinear sides into a mask with false holes, so the wipe
//    left islands of ink.
// 2. A second drag along the same line puts the new mask's sides exactly on
//    the first hole's edges; Martinez re-divided those edges without end
//    (about 4 GB, tab crash).
// 3. Any geometry failure on one mark leaves that mark exactly as it was
//    (with a diagnostic) and never blocks the erase of other marks.
//
// Anything that could run away runs in a child process with a hard timeout
// and a small heap, so a regression fails this file instead of the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function runChild(source, timeoutMs) {
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    ['--max-old-space-size=512', '--input-type=module', '-e', source],
    { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
  );
  return {
    ...child,
    elapsedMs: Date.now() - started,
    timedOut: child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGKILL',
  };
}

const lastJsonLine = (stdout) => {
  const line = String(stdout || '').trim().split('\n').filter(Boolean).at(-1);
  return line ? JSON.parse(line) : null;
};

// Shared child-side helpers: erase drags from a filled square with the
// production eraseAnnotations, then judge the survivor on a grid against the
// exact answer (square minus the union of the drags' swept disks).
const CHILD_PRELUDE = `
  import { eraseAnnotations, polygonSetToCommands, boundsOfCommands } from './src/utils/paperAnnotationGeometry.js';
  const square = (cx, cy, side) => {
    const h = side / 2;
    return [[[[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]]]];
  };
  const inkOf = (polygons) => {
    const cmds = polygonSetToCommands(polygons);
    return { id: 'sq', type: 'ink', cmds, polygons, fill: '#000', stroke: null, strokeWidth: 0, bounds: boundsOfCommands(cmds) };
  };
  const evenOdd = (polygons, x, y) => {
    let inside = false;
    for (const polygon of polygons) for (const ring of polygon) {
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
  // Signed distance to the union of the drags' swept disks (negative inside).
  const eraserDistance = (p, drags) => {
    let best = Infinity;
    for (const { points, radius } of drags) {
      let d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
      for (let i = 1; i < points.length; i += 1) d = Math.min(d, segmentDistance(p, points[i - 1], points[i]));
      best = Math.min(best, d - radius);
    }
    return best;
  };
  const eraseDrags = (subject, drags) => {
    let annotation = inkOf(subject);
    for (const { points, radius } of drags) {
      const result = eraseAnnotations([annotation], points, radius, 'partial');
      if (result.failures?.length) return { failed: result.failures };
      annotation = result.annotations[0] || null;
      if (!annotation) return { polygons: [] };
    }
    return { polygons: annotation.polygons };
  };
  // Grid over the drags (plus a margin): islands = ink deeper than rimSlack
  // inside the eraser; losses = no ink deeper than rimSlack outside it.
  const judge = (polygons, drags, rimSlack, step) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const { points, radius } of drags) for (const p of points) {
      minX = Math.min(minX, p.x - radius - 1); maxX = Math.max(maxX, p.x + radius + 1);
      minY = Math.min(minY, p.y - radius - 1); maxY = Math.max(maxY, p.y + radius + 1);
    }
    let islands = 0; let losses = 0; let worstIsland = null; let worstLoss = null;
    for (let y = minY; y <= maxY; y += step) for (let x = minX; x <= maxX; x += step) {
      const d = eraserDistance({ x, y }, drags);
      const ink = evenOdd(polygons, x, y);
      if (ink && d < -rimSlack) { islands += 1; if (!worstIsland || d < worstIsland.d) worstIsland = { x, y, d }; }
      if (!ink && d > rimSlack) { losses += 1; if (!worstLoss || d > worstLoss.d) worstLoss = { x, y, d }; }
    }
    return { islands, losses, worstIsland, worstLoss };
  };
`;

test('regression: a straight wipe leaves no ink islands inside its path', () => {
  const child = runChild(`${CHILD_PRELUDE}
    const points = [
      { x: 63.78823524426548, y: 97.49773715983547 }, { x: 65.28891592949951, y: 98.29645956528401 },
      { x: 66.78959661473354, y: 99.09518197073257 }, { x: 68.29027729996757, y: 99.89390437618111 },
      { x: 69.7909579852016, y: 100.69262678162967 }, { x: 71.29163867043563, y: 101.49134918707821 },
      { x: 72.79231935566966, y: 102.29007159252677 }, { x: 74.29300004090369, y: 103.08879399797532 },
      { x: 75.79368072613772, y: 103.88751640342387 },
    ];
    const drags = [{ points, radius: 4.199109545908868 }];
    const started = performance.now();
    const { polygons, failed } = eraseDrags(square(100, 100, 400), drags);
    const ms = performance.now() - started;
    console.log(JSON.stringify({ ms, failed, components: polygons?.length, rings: polygons?.map((p) => p.length), ...judge(polygons || [], drags, 0.05, 0.1) }));
  `, 60_000);
  assert.equal(child.timedOut, false, `the wipe ran for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.equal(result.failed, undefined, JSON.stringify(result.failed));
  assert.deepEqual(result.rings, [2], 'one square with one hole, no island polygons (was 5 islands)');
  assert.equal(result.islands, 0, JSON.stringify(result.worstIsland));
  assert.equal(result.losses, 0, JSON.stringify(result.worstLoss));
  assert.ok(result.ms < 5_000, `erase took ${result.ms.toFixed(0)} ms`);
});

test('regression: a second drag along the same line finishes and cuts exactly (was out of memory)', () => {
  const child = runChild(`${CHILD_PRELUDE}
    const out = [];
    for (const angle of [0.4, 0, Math.PI / 2]) {
      const line = (start) => Array.from({ length: 14 }, (_, i) => ({
        x: 100 + Math.cos(angle) * (start + i * 1.3),
        y: 100 + Math.sin(angle) * (start + i * 1.3),
      }));
      const drags = [{ points: line(0), radius: 6.683 }, { points: line(0.5), radius: 6.683 }];
      const started = performance.now();
      const { polygons, failed } = eraseDrags(square(100, 100, 400), drags);
      out.push({ angle, ms: performance.now() - started, failed, rings: polygons?.map((p) => p.length), ...judge(polygons || [], drags, 0.05, 0.1) });
    }
    console.log(JSON.stringify(out));
  `, 60_000);
  assert.equal(child.timedOut, false, `retraced drags ran for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  for (const result of lastJsonLine(child.stdout)) {
    const label = `angle ${result.angle}`;
    assert.equal(result.failed, undefined, `${label}: ${JSON.stringify(result.failed)}`);
    assert.deepEqual(result.rings, [2], `${label}: one hole`);
    assert.equal(result.islands, 0, `${label}: ${JSON.stringify(result.worstIsland)}`);
    assert.equal(result.losses, 0, `${label}: ${JSON.stringify(result.worstLoss)}`);
    assert.ok(result.ms < 5_000, `${label}: took ${result.ms.toFixed(0)} ms`);
  }
});

test('property: random straight and retraced drags at small and large page coordinates cut exactly', () => {
  const cases = Number(process.env.ERASER_DRAG_CASES) || 40;
  const child = runChild(`${CHILD_PRELUDE}
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
    const random = mulberry32(0xd3a9);
    const centers = [1, 100, 1000, 5000, 10000];
    const failures = [];
    let slowest = 0;
    for (let n = 0; n < ${cases}; n += 1) {
      const center = centers[n % centers.length];
      const angle = random() < 0.3 ? [0, Math.PI / 2, Math.PI / 4][Math.floor(random() * 3)] : random() * Math.PI * 2;
      const spacing = 0.3 + random() * 2;
      const count = 3 + Math.floor(random() * 20);
      const radius = 1 + random() * 8;
      const ox = center + (random() - 0.5) * 20;
      const oy = center + (random() - 0.5) * 20;
      const line = (start, direction = 1) => Array.from({ length: count }, (_, i) => ({
        x: ox + Math.cos(angle) * direction * (start + i * spacing),
        y: oy + Math.sin(angle) * direction * (start + i * spacing),
      }));
      const drags = [{ points: line(0), radius }];
      const retraces = Math.floor(random() * 3);
      for (let r = 0; r < retraces; r += 1) {
        // Same line: exactly the same samples, a shifted start, or reversed.
        const kind = Math.floor(random() * 3);
        drags.push({
          points: kind === 0 ? line(0) : kind === 1 ? line(random() * spacing) : line(0).slice().reverse(),
          radius: random() < 0.5 ? radius : 1 + random() * 8,
        });
      }
      const started = performance.now();
      const { polygons, failed } = eraseDrags(square(center, center, 400), drags);
      slowest = Math.max(slowest, performance.now() - started);
      const verdict = judge(polygons || [], drags, 0.05, 0.2);
      if (failed || verdict.islands || verdict.losses) {
        failures.push({ n, center, angle, spacing, count, drags: drags.map((d) => ({ first: d.points[0], last: d.points.at(-1), radius: d.radius })), failed, ...verdict });
      }
    }
    console.log(JSON.stringify({ slowest, failures }));
  `, 300_000);
  assert.equal(child.timedOut, false, `the property run ran for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.deepEqual(result.failures, [], JSON.stringify(result.failures).slice(0, 2000));
  assert.ok(result.slowest < 10_000, `slowest erase took ${result.slowest.toFixed(0)} ms`);
});

test('a long drag over a small mark still cuts it (the grid follows the mark, not the drag)', () => {
  // w39 review: a grid sized to the joint box of mark + drag made the snap
  // larger than the containment proof's allowance, so long drags were
  // rejected and the ink came back at release (4 of 10 at 700 units, ~50% of
  // 800-unit swipes over a 60-unit stroke, every 800-unit swipe over a
  // 1-unit mark).
  const warn = console.warn;
  console.warn = () => {};
  try {
    const pen = (cx, cy) => ({
      type: 'path', tool: 'pen', data: { id: 'p', tool: 'pen' },
      path: [['M', cx - 40, cy], ['Q', cx - 20, cy - 25, cx, cy], ['Q', cx + 20, cy + 25, cx + 40, cy]],
      left: 0, top: 0, stroke: '#d11b2d', strokeWidth: 3, fill: null, strokeLineCap: 'round', strokeLineJoin: 'round',
    });
    for (const [cx, cy] of [[300, 400], [80, 80]]) {
      for (const length of [400, 700, 1500]) {
        for (let j = 0; j < 10; j += 1) {
          const x = cx - 20 + j * 4.1;
          const points = Array.from({ length: 51 }, (_, i) => ({
            x: x + 0.3 * Math.sin(i * 0.7 + j),
            y: cy - length / 2 + (length * i) / 50,
          }));
          const result = erasePageAnnotations({
            pageAnnotations: { objects: [pen(cx, cy)] }, eraserPoints: points, eraserRadius: 5, mode: 'partial',
          });
          assert.equal(result.didChange, true, `(${cx},${cy}) ${length}-unit drag #${j}`);
          assert.deepEqual(result.failedStages, [], `(${cx},${cy}) ${length}-unit drag #${j}`);
        }
      }
    }
  } finally {
    console.warn = warn;
  }
});

test('filled imported ink keeps its own fill rule through a bite (evenodd star stays hollow, nonzero star stays solid)', () => {
  const star = Array.from({ length: 5 }, (_, k) => {
    const a = Math.PI / 2 + (k * 4 * Math.PI) / 5;
    return [200 + 50 * Math.cos(a), 300 + 50 * Math.sin(a)];
  });
  const path = [['M', ...star[0]], ...star.slice(1).map((point) => ['L', ...point]), ['Z']];
  const evenOdd = (polygons, x, y) => {
    let inside = false;
    for (const polygon of polygons) for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const [fillRule, centreFilled] of [['evenodd', false], ['nonzero', true]]) {
      const object = {
        type: 'path', id: 's', annotationId: 's', path, left: 0, top: 0,
        fill: '#123456', stroke: null, strokeWidth: 0, fillRule, pdfAnnotationType: 'Ink',
      };
      // A bite at the top tip, 46 units from the centre.
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: [{ x: 200, y: 346 }, { x: 200.5, y: 347 }],
        eraserRadius: 3,
        mode: 'partial',
      });
      const survivor = result.pageAnnotations.objects[0];
      assert.equal(result.didChange, true, fillRule);
      // Stored polygons are painted even-odd.
      assert.equal(evenOdd(survivor.polygons, 200, 300), centreFilled, `${fillRule}: centre`);
      assert.equal(evenOdd(survivor.polygons, 200, 346), false, `${fillRule}: bite`);
      assert.equal(evenOdd(survivor.polygons, 233.3, 310.8), true, `${fillRule}: a far arm keeps its ink`);
    }
  } finally {
    console.warn = warn;
  }
});

test('a mark whose geometry throws is left as it was; the other marks still erase', () => {
  const base = {
    type: 'path', tool: 'pen', stroke: '#f00', fill: null, strokeWidth: 4,
    strokeLineCap: 'round', strokeLineJoin: 'round', left: 0, top: 0, scaleX: 1, scaleY: 1,
  };
  const broken = {
    ...base,
    data: { id: 'broken', tool: 'pen' },
    path: [['M', 0, 0], ['L', 10, 0]],
    // Stands in for any geometry failure (a thrown boolean, bad data).
    get strokeDashArray() { throw new Error('geometry failure'); },
  };
  const healthy = { ...base, data: { id: 'healthy', tool: 'pen' }, path: [['M', 0, 2], ['L', 10, 2]] };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  let partial;
  try {
    partial = erasePageAnnotations({
      pageAnnotations: { objects: [broken, healthy] },
      eraserPoints: [{ x: 5, y: 1 }],
      eraserRadius: 2,
      mode: 'partial',
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(partial.pageAnnotations.objects[0], broken, 'the failing mark is untouched');
  assert.deepEqual(partial.changedIds, ['healthy'], 'the healthy mark is still bitten');
  assert.deepEqual(
    partial.failedStages.filter((failure) => failure.skipped),
    [{ annotationId: 'broken', failedStages: { outline: 1 }, recovered: false, skipped: true }],
  );
  assert.ok(warnings.some((text) => text.startsWith('[EraserSkippedMark]')), 'a diagnostic is logged');
});
