// w39 (2026-09-25): one partial-erase tap on a self-crossing stroked curve
// froze the app forever. Cause (measured): martinez-polygon-clipping 0.7.4's
// SweepEvent#isBelow used a float cross product while its collinearity test
// used the exact orient2d predicate; for a nearly collinear pair of events
// compareEvents(a, b) === compareEvents(b, a) === 1, so the bubble sort in
// orderEvents() swapped them forever. The app now uses a vendored copy
// (src/vendor/martinezPolygonClipping.js) with an exact isBelow and hard,
// deterministic loop bounds; a mark whose geometry still fails is left as it
// was (pageSpaceEraser skipMarkForFailedGeometry).
//
// Anything that could hang runs in a child process with a hard timeout, so a
// regression fails this file instead of freezing the whole test run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function runChild(source, timeoutMs) {
  const started = Date.now();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    ...child,
    elapsedMs: Date.now() - started,
    timedOut: child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGKILL',
  };
}

function lastJsonLine(stdout) {
  const line = String(stdout || '').trim().split('\n').filter(Boolean).at(-1);
  return line ? JSON.parse(line) : null;
}

test('app code imports polygon booleans only from the guarded vendored copy', () => {
  const offenders = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        if (name === 'node_modules' || path.endsWith(join('src', 'vendor'))) continue;
        walk(path);
      } else if (/\.(m?js|jsx|ts|tsx)$/.test(name)) {
        const text = readFileSync(path, 'utf8');
        if (/from\s+['"]martinez-polygon-clipping['"]|require\(\s*['"]martinez-polygon-clipping['"]\s*\)/.test(text)) {
          offenders.push(relative(ROOT, path));
        }
      }
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(offenders, [], 'import from src/vendor/martinezPolygonClipping.js instead');
});

test('the exact boolean that spun upstream martinez finishes on the vendored copy', () => {
  const child = runChild(`
    import { readFileSync } from 'node:fs';
    import { diff } from './src/vendor/martinezPolygonClipping.js';
    const { subject, clip } = JSON.parse(readFileSync('tests/fixtures/martinez-order-events-cycle.json', 'utf8'));
    const started = performance.now();
    const result = diff(subject, clip);
    console.log(JSON.stringify({
      ms: performance.now() - started,
      polygons: result.length,
      finite: result.flat(2).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
    }));
  `, 20_000);
  assert.equal(child.timedOut, false, `vendored diff spun for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.ok(result.polygons >= 1, 'the difference keeps the rest of the stroke');
  assert.equal(result.finite, true);
});

test('round-stroke outlines that spun upstream Martinez (same comparator bug) finish', () => {
  // w39 review: plain L paths with thick strokes and short right-angle legs;
  // upstream hung over 60 s on each (the first on the pre-w39 outline code,
  // the others on the run-split union). The exact isBelow fixes all three.
  const child = runChild(`
    import { commandsToPolygonSet, polygonSetArea } from './src/utils/paperAnnotationGeometry.js';
    const cases = [
      { w: 7.523045249283314, cmds: [['M', 11.517508374527097, -13.791708648204803], ['L', -0.016184221126025022, -13.791708648204803], ['L', -0.016184221126025022, -13.37467201933771], ['L', 2.837224922306992, -13.37467201933771]] },
      { w: 7.670327249914408, cmds: [['M', -23.64787005353719, 34.87305920571089], ['L', -0.7079482209346999, 34.87305920571089], ['L', -0.7079482209346999, 38.35764600633343], ['L', -23.64787005353719, 37.804989804818184]] },
      { w: 5.607361866161227, cmds: [['M', -13.206052780151367, -8.291816781274974], ['L', -15.54197306608598, -5.331632701126624], ['L', -12.068319979050578, -9.733603363445793], ['L', -16.466767327859774, -4.159691489091637], ['L', -15.791055086469424, 1.572889168337742], ['L', -22.144486447168525, -3.4406872846531185], ['L', -21.24070728489424, 4.226758451687058]] },
    ];
    const out = cases.map(({ w, cmds }) => {
      try {
        return { area: polygonSetArea(commandsToPolygonSet(cmds, { fill: false, strokeWidth: w, curveTolerance: 0.75 })) };
      } catch (error) {
        return { error: error.name };
      }
    });
    console.log(JSON.stringify(out));
  `, 30_000);
  assert.equal(child.timedOut, false, `outline building spun for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  for (const result of lastJsonLine(child.stdout)) {
    // Either a verified outline with real area, or an explicit refusal.
    assert.ok(result.error === 'StrokeOutlineUnionError' || result.area > 50, JSON.stringify(result));
  }
});

test('a runaway subdivision stops at the hard bound with a typed error instead of eating memory', () => {
  // Upstream re-divides these near-coincident edges forever (4 GB resident
  // after 20 s). The bound must stop it quickly and say which loop ran away.
  const child = runChild(`
    import { readFileSync } from 'node:fs';
    import { diff } from './src/vendor/martinezPolygonClipping.js';
    const { subject, clip } = JSON.parse(readFileSync('tests/fixtures/martinez-subdivide-runaway.json', 'utf8'));
    const started = performance.now();
    let outcome;
    try {
      diff(subject, clip);
      outcome = { threw: false };
    } catch (error) {
      outcome = { threw: true, name: error.name, stage: error.stage };
    }
    console.log(JSON.stringify({ ...outcome, ms: performance.now() - started }));
  `, 30_000);
  assert.equal(child.timedOut, false, `the bounded diff ran for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.deepEqual(
    { threw: result.threw, name: result.name, stage: result.stage },
    { threw: true, name: 'MartinezNonConvergenceError', stage: 'subdivide' },
  );
});

test('the bounds never stop a valid boolean with many crossings (combs, zigzag lasso merge)', async () => {
  // w39 review: a first, linear sweep budget wrongly stopped these; crossing
  // counts grow with the square of the input. Upstream finishes each.
  const { diff, intersection, union } = await import('../src/vendor/martinezPolygonClipping.js');
  const { mergeRegions } = await import('../src/utils/regionMath.js');
  const comb = (teeth, extraPerEnd, vertical) => {
    const ring = [];
    const length = teeth * 3 + 5;
    for (let t = 0; t < teeth; t += 1) {
      const x0 = t * 3;
      ring.push([x0, 0], [x0, length]);
      for (let j = 1; j <= extraPerEnd; j += 1) {
        const a = Math.PI - (Math.PI * j) / (extraPerEnd + 1);
        ring.push([x0 + 0.5 + Math.cos(a) * 0.5, length + Math.sin(a) * 0.5]);
      }
      ring.push([x0 + 1, length], [x0 + 1, 0]);
    }
    ring.push([teeth * 3, 0], [teeth * 3, -1], [0, -1], [0, 0]);
    const oriented = vertical ? ring : ring.map(([x, y]) => [y, x]);
    return [oriented.map(([x, y]) => (vertical ? [x, y] : [x + 0.37, y + 0.53]))];
  };
  for (const [teeth, extra] of [[45, 0], [80, 8]]) {
    const a = comb(teeth, extra, true);
    const b = comb(teeth, extra, false);
    for (const operation of [diff, union, intersection]) {
      assert.doesNotThrow(() => operation(a, b), `${teeth}-tooth combs, ${operation.name}`);
    }
  }
  const zigzagLasso = (count, vertical) => {
    const coordinates = [];
    for (let t = 0; t < count; t += 1) {
      const x0 = t * 8;
      coordinates.push([x0, 0], [x0 + 2, count * 8], [x0 + 4, 0]);
    }
    coordinates.push([count * 8, -5], [0, -5]);
    const points = vertical ? coordinates : coordinates.map(([x, y]) => [y, x]);
    return { operation: 'add', coordinates: points.flat() };
  };
  const error = console.error;
  console.error = () => {};
  let merged;
  try {
    merged = mergeRegions(zigzagLasso(50, true), zigzagLasso(50, false));
  } finally {
    console.error = error;
  }
  assert.ok(merged, 'two 50-tooth zigzag lassos merge');
});

test('regression: erasing where the cut mask runs away still applies the bite, promptly', () => {
  const child = runChild(`
    import { erasePageAnnotations } from './src/utils/pageSpaceEraser.js';
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    const object = {
      type: 'path', tool: 'pen', data: { id: 'c', tool: 'pen' }, stroke: '#ff0000', fill: null,
      strokeWidth: 14.655003804713488, strokeLineCap: 'round', strokeLineJoin: 'round',
      left: 0, top: 0, scaleX: 1, scaleY: 1,
      path: [
        ['M', 60, 60],
        ['Q', 85.78364934772253, 25.33304601209238, 83.92714605201036, 53.673997735604644],
        ['Q', 40.59831423452124, 66.83559869648889, 57.3008773708716, 59.73322631791234],
      ],
    };
    const started = performance.now();
    const result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: 52.70155798731139, y: 62.017914173484314 }],
      eraserRadius: 8.09759112354368,
      mode: 'partial',
    });
    const survivor = result.pageAnnotations.objects[0];
    console.log(JSON.stringify({
      ms: performance.now() - started,
      didChange: result.didChange,
      survivorPolygons: survivor?.polygons?.length ?? 0,
      skipped: warnings.filter((text) => text.includes('EraserSkippedMark') || text.includes('subtraction rejected')),
    }));
  `, 30_000);
  assert.equal(child.timedOut, false, `the erase ran for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.equal(result.didChange, true, 'the bite is applied (rendered from the exact survivor polygon)');
  assert.ok(result.survivorPolygons >= 1);
  assert.deepEqual(result.skipped, []);
  assert.ok(result.ms < 5_000, `erase took ${result.ms.toFixed(0)} ms`);
});

test('regression: partially erasing the self-crossing curve returns promptly and cuts it (w38 case 61)', () => {
  const child = runChild(`
    import { erasePageAnnotations } from './src/utils/pageSpaceEraser.js';
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    const object = {
      type: 'path', tool: 'pen', data: { id: 'c', tool: 'pen' }, stroke: '#ff0000', fill: null,
      strokeWidth: 8.836379561573267, strokeLineCap: 'round', strokeLineJoin: 'round',
      left: 0, top: 0, scaleX: 1, scaleY: 1,
      path: [
        ['M', 60, 60],
        ['Q', 58.26935863355175, 28.40988397365436, 93.30998635618016, 21.178107247687876],
        ['Q', 64.00745630962774, 52.2444921778515, 78.34488346008584, 7.286080468911678],
        ['Q', 63.4652081807144, 38.61211202805862, 106.01710964692757, -16.092873788438737],
      ],
    };
    const started = performance.now();
    const result = erasePageAnnotations({
      pageAnnotations: { objects: [object] },
      eraserPoints: [{ x: 84.56847555197905, y: 23.557397729571598 }],
      eraserRadius: 7.587628266308457,
      mode: 'partial',
    });
    const survivor = result.pageAnnotations.objects[0];
    console.log(JSON.stringify({
      ms: performance.now() - started,
      didChange: result.didChange,
      survivorPolygons: survivor?.polygons?.length ?? 0,
      hasCutMask: Array.isArray(survivor?.paperEraserCuts) && survivor.paperEraserCuts.length > 0,
      warnings,
    }));
  `, 30_000);
  assert.equal(child.timedOut, false, `the erase spun for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.equal(result.didChange, true, 'the bite is applied');
  assert.ok(result.survivorPolygons >= 1, 'the rest of the stroke survives');
  assert.deepEqual(result.warnings, [], 'no geometry stage failed or was skipped');
  // Generous: the whole erase measured ~30 ms. A hang is what this guards.
  assert.ok(result.ms < 5_000, `erase took ${result.ms.toFixed(0)} ms`);
});

test('property: partial erase of random self-crossing quadratics and cubics never hangs and never skips a mark', () => {
  const cases = Number(process.env.SELF_CROSSING_ERASE_CASES) || 40;
  const child = runChild(`
    import { erasePageAnnotations } from './src/utils/pageSpaceEraser.js';
    // A skipped mark (left unerased) is a failure. A failed cut mask is not:
    // the survivor is still exact and simply renders as its own polygon.
    const skipped = [];
    let cutMaskFallbacks = 0;
    console.warn = (...args) => {
      const text = args.map(String).join(' ');
      if (text.includes('EraserSkippedMark') || text.includes('subtraction rejected')) skipped.push(text);
      if (text.includes('cut-mask construction failed')) cutMaskFallbacks += 1;
    };
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
    const random = mulberry32(0x5e1f);
    let slowest = 0;
    let changed = 0;
    const failures = [];
    for (let n = 0; n < ${cases}; n += 1) {
      // Several curved segments packed into a small box so they cross each
      // other and themselves (loops, near-cusps, near-tangent crossings).
      const path = [['M', 60, 60]];
      let x = 60;
      let y = 60;
      const onCurve = [];
      const segments = 2 + Math.floor(random() * 4);
      for (let s = 0; s < segments; s += 1) {
        const p0 = { x, y };
        const ex = 40 + random() * 50;
        const ey = 20 + random() * 50;
        if (random() < 0.5) {
          const c = { x: 30 + random() * 70, y: 10 + random() * 70 };
          path.push(['Q', c.x, c.y, ex, ey]);
          for (const t of [0.25, 0.5, 0.75]) {
            const u = 1 - t;
            onCurve.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * ex, y: u * u * p0.y + 2 * u * t * c.y + t * t * ey });
          }
        } else {
          const c1 = { x: 20 + random() * 90, y: 0 + random() * 90 };
          const c2 = { x: 20 + random() * 90, y: 0 + random() * 90 };
          path.push(['C', c1.x, c1.y, c2.x, c2.y, ex, ey]);
          for (const t of [0.25, 0.5, 0.75]) {
            const u = 1 - t;
            onCurve.push({
              x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * ex,
              y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ey,
            });
          }
        }
        x = ex;
        y = ey;
      }
      const object = {
        type: 'path', tool: 'pen', data: { id: 'curve-' + n, tool: 'pen' }, stroke: '#ff0000', fill: null,
        strokeWidth: 2 + random() * 16, strokeLineCap: 'round', strokeLineJoin: 'round',
        left: 0, top: 0, scaleX: 1, scaleY: 1, path,
      };
      const hit = onCurve[Math.floor(random() * onCurve.length)];
      const points = [hit];
      if (random() < 0.4) {
        const heading = random() * Math.PI * 2;
        for (let i = 1; i <= 6; i += 1) points.push({ x: hit.x + Math.cos(heading) * i * 1.5, y: hit.y + Math.sin(heading) * i * 1.5 });
      }
      const before = skipped.length;
      const started = performance.now();
      const result = erasePageAnnotations({
        pageAnnotations: { objects: [object] }, eraserPoints: points,
        eraserRadius: 2 + random() * 10, mode: 'partial',
      });
      slowest = Math.max(slowest, performance.now() - started);
      if (result.didChange) changed += 1;
      const survivor = result.pageAnnotations.objects[0];
      const finite = !survivor || (survivor.polygons || []).flat(2)
        .every(([px, py]) => Number.isFinite(px) && Number.isFinite(py));
      if (skipped.length > before || !finite) {
        failures.push({ n, path, points, strokeWidth: object.strokeWidth, skipped: skipped.slice(before), finite });
      }
    }
    console.log(JSON.stringify({ slowest, changed, failures, cutMaskFallbacks }));
  `, 240_000);
  assert.equal(child.timedOut, false, `the property run spun for ${child.elapsedMs} ms`);
  assert.equal(child.status, 0, child.stderr);
  const result = lastJsonLine(child.stdout);
  assert.deepEqual(result.failures, [], 'every erase finished with valid geometry and no skipped mark');
  assert.ok(result.changed > cases / 2, `only ${result.changed} of ${cases} bites changed a stroke`);
  // Generous per-erase ceiling; the point is that nothing spins.
  assert.ok(result.slowest < 10_000, `slowest erase took ${result.slowest.toFixed(0)} ms`);
});
