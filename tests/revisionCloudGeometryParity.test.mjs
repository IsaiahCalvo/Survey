// Revision-cloud fidelity harness.
//
// The owner approved the revision-cloud design in a standalone studio
// prototype (tests/fixtures/reference/cloud-v17.ts, commit d1abe78, tag
// cloud-final-short-gap). This suite is the contract that the app draws
// EXACTLY that cloud — not a lookalike.
//
// Two layers are checked:
//   1. Engine parity  — src/utils/revisionCloudGeometry.js must be a faithful
//      port of the reference module (same runs, same `d`, same lobes).
//   2. Render parity  — buildCloudPathCommands(), the single funnel that the
//      SVG layer, the canvas painter, the pdf-lib flattener and the importer
//      all draw through, must emit the reference module's *rendered* outline.
//      That is `run.d` (overlap-trimmed crowns with their separator tails),
//      NOT the raw untrimmed `run.lobes`.
//
// Node strips TypeScript types natively from v22.18/v24 on, so the reference
// .ts imports directly under `node --test`. On an older runtime the whole
// suite skips rather than reporting a false failure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REFERENCE = join(here, 'fixtures/reference/cloud-v17.ts');

let reference = null;
let referenceError = null;
try {
  reference = await import(REFERENCE);
} catch (error) {
  referenceError = error;
}

const app = await import('../src/utils/revisionCloudGeometry.js');
const {
  buildCloudPathCommands,
  cloudRadiusForIntensity,
  ellipseCloudPoints,
  resolveAnnotationCloudSpec,
  toolSupportsCloudBorderStyle,
} = await import('../src/utils/pdfAnnotationAppearance.js');
const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');

const skip = reference
  ? false
  : `reference cloud-v17.ts could not be imported on ${process.version} `
    + `(needs native TypeScript type stripping): ${referenceError?.message}`;

// The studio stores roundness on a legacy 2-40 scale and maps it to a real
// depth inside cloudRuns (`size * (0.24 + 0.4 * depth/40)`). 12 is the
// approved default the studio shipped with, and the app exposes no roundness
// control, so every app cloud must use exactly this value. Passing a
// size-relative depth here instead silently changes roundness with size.
const APPROVED_DEPTH = 12;

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const POLYGONS = {
  triangle: [{ x: 100, y: 100 }, { x: 300, y: 120 }, { x: 180, y: 320 }],
  // Concave: exercises joinConcave + the re-entrant corner blend.
  concave: [
    { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 },
    { x: 200, y: 200 }, { x: 100, y: 300 },
  ],
  // Ten-point star: many alternating convex/concave corners.
  star: [
    { x: 200, y: 60 }, { x: 224, y: 150 }, { x: 320, y: 150 }, { x: 244, y: 206 },
    { x: 272, y: 300 }, { x: 200, y: 242 }, { x: 128, y: 300 }, { x: 156, y: 206 },
    { x: 80, y: 150 }, { x: 176, y: 150 },
  ],
  // The v17 headline case: short convex gaps between adjacent vertices, which
  // drive runBetween's shortCap branch and the corner-to-corner bridge.
  shortGapConvex: [
    { x: 100, y: 100 }, { x: 112, y: 98 }, { x: 126, y: 104 }, { x: 140, y: 100 },
    { x: 300, y: 140 }, { x: 280, y: 300 }, { x: 110, y: 280 },
  ],
  shortGapTight: [
    { x: 200, y: 100 }, { x: 206, y: 99 }, { x: 213, y: 101 }, { x: 219, y: 99 },
    { x: 226, y: 102 }, { x: 320, y: 220 }, { x: 140, y: 240 },
  ],
  // Counter-clockwise winding: makeShape must pick side = -1.
  counterClockwise: [
    { x: 100, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 100 }, { x: 100, y: 100 },
  ],
  tiny: [
    { x: 100, y: 100 }, { x: 106, y: 101 }, { x: 110, y: 107 }, { x: 103, y: 110 },
  ],
};

const commandsToPathData = (commands) =>
  commands.map((segment) => segment.join(' ')).join(' ');

// What the studio actually paints: one <path d> per run, concatenated. Every
// run is a sequence of M-started open subpaths stroked with fill:none, so
// concatenating them is visually identical to separate elements.
const referenceRenderedPath = (kind, points, size) => {
  const shape = reference.makeShape(kind, points, 'survey-cloud', {
    size,
    depth: APPROVED_DEPTH,
  });
  return reference
    .cloudRuns(shape, new Map(), 0, false)
    .map((run) => run.d)
    .filter(Boolean)
    .join(' ');
};

const appRenderedPath = (points, intensity, strokeWidth, unitScale, kind) => {
  const commands = buildCloudPathCommands(points, intensity, strokeWidth, unitScale, kind);
  return Array.isArray(commands) ? commandsToPathData(commands) : '';
};

// ---------------------------------------------------------------------------
// Layer 1 - the engine port is byte-faithful to the approved reference.
// ---------------------------------------------------------------------------

test('revisionCloudGeometry.js exposes the reference module surface', { skip }, () => {
  assert.deepEqual(Object.keys(app).sort(), Object.keys(reference).sort());
});

test('engine parity: every fixture produces the reference runs', { skip }, () => {
  const cases = [];
  for (const [w, h] of [[300, 200], [40, 30], [600, 18], [25, 25], [120, 400], [1000, 700]]) {
    for (const size of [8, 14, 28, 60, 120]) {
      for (const depth of [2, 12, 25, 40]) {
        for (const kind of ['rectangle', 'ellipse', 'polygon']) {
          cases.push({ kind, points: rect(100, 100, w, h), style: { size, depth } });
        }
      }
    }
  }
  for (const points of Object.values(POLYGONS)) {
    for (const size of [10, 28, 55]) {
      for (const depth of [2, 12, 40]) {
        cases.push({ kind: 'polygon', points, style: { size, depth } });
      }
    }
  }
  for (const kind of ['polyline', 'freehand']) {
    cases.push({ kind, points: POLYGONS.shortGapConvex, style: { size: 28, depth: 12 } });
  }

  for (const { kind, points, style } of cases) {
    const label = `${kind} size=${style.size} depth=${style.depth} n=${points.length}`;
    const expected = reference.cloudRuns(
      reference.makeShape(kind, points, 'x', style), new Map(), 0, false,
    );
    const actual = app.cloudRuns(
      app.makeShape(kind, points, 'x', style), new Map(), 0, false,
    );
    assert.equal(actual.length, expected.length, `run count for ${label}`);
    for (let i = 0; i < expected.length; i += 1) {
      assert.equal(actual[i].id, expected[i].id, `run id for ${label}`);
      assert.equal(actual[i].d, expected[i].d, `run d for ${label}`);
      assert.equal(actual[i].lobes.length, expected[i].lobes.length, `lobes for ${label}`);
    }
  }
});

test('engine parity: a held vertex drag tracks the reference step for step', { skip }, () => {
  let expectedShape = reference.makeShape('polygon', POLYGONS.star, 'z', { size: 28, depth: 12 });
  let actualShape = app.makeShape('polygon', POLYGONS.star, 'z', { size: 28, depth: 12 });
  const expectedStates = new Map();
  const actualStates = new Map();
  for (let step = 0; step < 40; step += 1) {
    const p = { x: 320 + step * 3.7, y: 150 - step * 2.3 };
    expectedShape = reference.moveVertex(expectedShape, 2, p);
    actualShape = app.moveVertex(actualShape, 2, p);
    const expected = reference.cloudRuns(expectedShape, expectedStates, step, true).map((r) => r.d);
    const actual = app.cloudRuns(actualShape, actualStates, step, true).map((r) => r.d);
    assert.deepEqual(actual, expected, `vertex drag step ${step}`);
  }
});

// ---------------------------------------------------------------------------
// Layer 2 - the app renders the reference outline, not a rebuild of raw lobes.
// ---------------------------------------------------------------------------

test('render parity: rectangle clouds match the studio outline at every size', { skip }, () => {
  for (const [w, h] of [[300, 200], [40, 30], [600, 18], [120, 400], [1000, 700], [25, 25]]) {
    for (const intensity of [1, 2, 3, 5]) {
      for (const strokeWidth of [0.5, 1, 3, 8]) {
        for (const unitScale of [1, 1.5, 2.75]) {
          const points = rect(0, 0, w, h);
          const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
          assert.equal(
            appRenderedPath(points, intensity, strokeWidth, unitScale, 'rectangle'),
            referenceRenderedPath('rectangle', points, size),
            `rect ${w}x${h} intensity=${intensity} stroke=${strokeWidth} unitScale=${unitScale}`,
          );
        }
      }
    }
  }
});

test('render parity: polygon clouds match the studio outline', { skip }, () => {
  for (const [name, points] of Object.entries(POLYGONS)) {
    for (const intensity of [1, 2, 4]) {
      for (const strokeWidth of [1, 4]) {
        for (const unitScale of [1, 2]) {
          const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
          assert.equal(
            appRenderedPath(points, intensity, strokeWidth, unitScale, 'polygon'),
            referenceRenderedPath('polygon', points, size),
            `${name} intensity=${intensity} stroke=${strokeWidth} unitScale=${unitScale}`,
          );
        }
      }
    }
  }
});

test('render parity: resizing a cloud rectangle recomputes the studio outline', { skip }, () => {
  // Corner-anchored resize: the top-left stays put and the box grows, which is
  // how the app drags a cloud rect. Counts must follow the v17 schedule at
  // every intermediate size, with no jump or stale path.
  for (let step = 0; step <= 40; step += 1) {
    const w = 30 + step * 24.5;
    const h = 20 + step * 11.25;
    const points = rect(0, 0, w, h);
    const size = cloudRadiusForIntensity(2, 1, 1) * 2;
    assert.equal(
      appRenderedPath(points, 2, 1, 1, 'rectangle'),
      referenceRenderedPath('rectangle', points, size),
      `resize step ${step} (${w}x${h})`,
    );
  }
});

test('render parity: dragging a polygon vertex recomputes the studio outline', { skip }, () => {
  for (let step = 0; step < 40; step += 1) {
    const points = POLYGONS.star.map((p, i) => (
      i === 2 ? { x: 320 + step * 3.7, y: 150 - step * 2.3 } : p
    ));
    const size = cloudRadiusForIntensity(2, 1, 1) * 2;
    assert.equal(
      appRenderedPath(points, 2, 1, 1, 'polygon'),
      referenceRenderedPath('polygon', points, size),
      `vertex drag step ${step}`,
    );
  }
});

test('render parity: roundness stays on the approved 2-40 scale', { skip }, () => {
  // Regression guard for the original port bug: passing `size * (12/28)` as
  // depth happens to be right at the default scallop size and drifts at every
  // other one, so imported clouds (scaled scallops) drew rounder than drawn
  // ones. Only a constant legacy depth of 12 is scale-invariant.
  const points = rect(0, 0, 400, 260);
  for (const intensity of [1, 2, 3, 5]) {
    for (const unitScale of [1, 2, 3]) {
      const size = cloudRadiusForIntensity(intensity, 1, unitScale) * 2;
      const drift = referenceRenderedPath('rectangle', points, size)
        === referenceRenderedPath('rectangle', points, size); // sanity
      assert.ok(drift);
      assert.equal(
        appRenderedPath(points, intensity, 1, unitScale, 'rectangle'),
        referenceRenderedPath('rectangle', points, size),
        `roundness at intensity=${intensity} unitScale=${unitScale} (size=${size})`,
      );
    }
  }
});

test('render parity: an imported cloud and a drawn cloud of the same physical size agree', { skip }, () => {
  // An imported cloud carries pdfCloudUnitScale from the import; a drawn one
  // defaults to 1. At the same physical scallop size the outlines must be the
  // same shape, so the two can never look like different tools.
  const points = rect(0, 0, 360, 240);
  const drawn = appRenderedPath(points, 2, 1, 1, 'rectangle');
  const drawnSize = cloudRadiusForIntensity(2, 1, 1) * 2;
  // intensity 1 at unitScale 2 lands on the same 28-unit scallop as intensity
  // 2 at unitScale 1, so the two paths must be identical.
  const importedSize = cloudRadiusForIntensity(1, 1, 2) * 2;
  assert.equal(importedSize, drawnSize, 'fixture must compare equal scallop sizes');
  assert.equal(appRenderedPath(points, 1, 1, 2, 'rectangle'), drawn);
});

test('buildCloudPathCommands rejects degenerate input', { skip }, () => {
  assert.equal(buildCloudPathCommands(null, 2, 1, 1, 'rectangle'), null);
  assert.equal(buildCloudPathCommands([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2, 1, 1, 'polygon'), null);
  assert.equal(
    buildCloudPathCommands([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 2, y: 2 }], 2, 1, 1, 'polygon'),
    null,
  );
});

test('buildCloudPathCommands emits only absolute M and C segments', { skip }, () => {
  const commands = buildCloudPathCommands(rect(0, 0, 300, 200), 2, 1, 1, 'rectangle');
  assert.ok(Array.isArray(commands) && commands.length > 0);
  assert.equal(commands[0][0], 'M');
  for (const segment of commands) {
    assert.ok(segment[0] === 'M' || segment[0] === 'C', `unexpected verb ${segment[0]}`);
    assert.equal(segment.length, segment[0] === 'M' ? 3 : 7);
    for (const value of segment.slice(1)) {
      assert.equal(typeof value, 'number');
      assert.ok(Number.isFinite(value));
    }
  }
});

// ---------------------------------------------------------------------------
// Layer 2b - every SHAPE the Cloud style is offered on renders the reference
// outline, not just the rectangle and polygon the style shipped with.
//
// UX 2026-09-09: Cloud is a REGION marker, so it is offered on rectangle,
// ellipse/circle, polygon and (open) polyline, and never on arrow, counter or a
// single straight line. These tests are what stop a new shape from growing its
// own lookalike cloud instead of asking the approved engine for one.
// ---------------------------------------------------------------------------

// Open runs: the studio's own polyline sizes, including a degenerate two-point
// path (the smallest open cloud the app can commit).
const POLYLINES = {
  twoPoint: [{ x: 40, y: 40 }, { x: 320, y: 210 }],
  zigzag: [
    { x: 40, y: 260 }, { x: 120, y: 90 }, { x: 210, y: 250 },
    { x: 300, y: 80 }, { x: 380, y: 240 },
  ],
  shallow: [{ x: 20, y: 100 }, { x: 180, y: 108 }, { x: 340, y: 96 }],
};

test('render parity: ellipse clouds match the studio outline at every size', { skip }, () => {
  for (const [w, h] of [[300, 200], [40, 30], [600, 18], [120, 400], [1000, 700], [25, 25]]) {
    for (const intensity of [1, 2, 3, 5]) {
      for (const strokeWidth of [0.5, 1, 3, 8]) {
        for (const unitScale of [1, 1.5, 2.75]) {
          const points = ellipseCloudPoints(0, 0, w, h);
          const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
          assert.equal(
            appRenderedPath(points, intensity, strokeWidth, unitScale, 'ellipse'),
            referenceRenderedPath('ellipse', points, size),
            `ellipse ${w}x${h} intensity=${intensity} stroke=${strokeWidth} unitScale=${unitScale}`,
          );
        }
      }
    }
  }
});

test('render parity: a circle asks for the same engine geometry as an ellipse', { skip }, () => {
  // A fabric circle and a fabric ellipse are the same drawing to the engine;
  // if they ever diverge, one of the two shapes is drawing a lookalike.
  for (const [w, h] of [[240, 240], [500, 120], [33, 47]]) {
    const points = ellipseCloudPoints(0, 0, w, h);
    const size = cloudRadiusForIntensity(2, 1, 1) * 2;
    assert.equal(
      appRenderedPath(points, 2, 1, 1, 'circle'),
      referenceRenderedPath('ellipse', points, size),
      `circle ${w}x${h}`,
    );
  }
});

test('render parity: open polyline clouds match the studio outline', { skip }, () => {
  for (const [name, points] of Object.entries(POLYLINES)) {
    for (const intensity of [1, 2, 4]) {
      for (const strokeWidth of [1, 4]) {
        for (const unitScale of [1, 2]) {
          const size = cloudRadiusForIntensity(intensity, strokeWidth, unitScale) * 2;
          assert.equal(
            appRenderedPath(points, intensity, strokeWidth, unitScale, 'polyline'),
            referenceRenderedPath('polyline', points, size),
            `${name} intensity=${intensity} stroke=${strokeWidth} unitScale=${unitScale}`,
          );
        }
      }
    }
  }
});

test('render parity: an open polyline cloud is NOT the closed polygon cloud', { skip }, () => {
  // The open run has to stop at both ends with the engine's rounded tails
  // instead of wrapping the last vertex back to the first.
  const points = POLYLINES.zigzag;
  assert.notEqual(
    appRenderedPath(points, 2, 1, 1, 'polyline'),
    appRenderedPath(points, 2, 1, 1, 'polygon'),
  );
  assert.ok(
    buildCloudPathCommands(POLYLINES.twoPoint, 2, 1, 1, 'polyline').length > 0,
    'a two-vertex open cloud is legal',
  );
  assert.equal(
    buildCloudPathCommands(POLYLINES.twoPoint, 2, 1, 1, 'polygon'),
    null,
    'a two-vertex CLOSED cloud is not',
  );
});

test('render parity: resizing an ellipse cloud recomputes the studio outline', { skip }, () => {
  // Corner-anchored resize, the same drag the app performs on a cloud rect:
  // the hump count has to follow the v17 schedule at every intermediate size.
  for (let step = 0; step <= 40; step += 1) {
    const w = 30 + step * 24.5;
    const h = 20 + step * 11.25;
    const points = ellipseCloudPoints(0, 0, w, h);
    const size = cloudRadiusForIntensity(2, 1, 1) * 2;
    assert.equal(
      appRenderedPath(points, 2, 1, 1, 'ellipse'),
      referenceRenderedPath('ellipse', points, size),
      `ellipse resize step ${step} (${w}x${h})`,
    );
  }
});

test('render parity: dragging a polyline vertex recomputes the studio outline', { skip }, () => {
  for (let step = 0; step < 40; step += 1) {
    const points = POLYLINES.zigzag.map((point, index) => (
      index === 2 ? { x: 210 + step * 3.1, y: 250 - step * 2.9 } : point
    ));
    const size = cloudRadiusForIntensity(2, 1, 1) * 2;
    assert.equal(
      appRenderedPath(points, 2, 1, 1, 'polyline'),
      referenceRenderedPath('polyline', points, size),
      `polyline vertex drag step ${step}`,
    );
  }
});

test('the Cloud style is offered on exactly the four region shapes', { skip }, () => {
  for (const tool of ['rect', 'rectangle', 'square', 'ellipse', 'circle', 'polygon', 'polyline']) {
    assert.equal(toolSupportsCloudBorderStyle(tool), true, `${tool} must offer Cloud`);
  }
  for (const tool of ['arrow', 'line', 'counter', 'triangle', 'text', 'textbox', 'callout', 'path', 'pen', 'highlighter', '', null, undefined]) {
    assert.equal(toolSupportsCloudBorderStyle(tool), false, `${String(tool)} must NOT offer Cloud`);
  }
  // Same predicate, resolved off a live annotation.
  assert.deepEqual(
    resolveAnnotationCloudSpec({ type: 'Ellipse', data: { pdfCloudIntensity: 3, pdfCloudUnitScale: 2 } }),
    { kind: 'ellipse', intensity: 3, unitScale: 2 },
  );
  assert.deepEqual(
    resolveAnnotationCloudSpec({ type: 'polyline', data: { pdfCloudIntensity: 2 } }),
    { kind: 'polyline', intensity: 2, unitScale: 1 },
  );
  // A counter is a circle internally; it is a pin, never a region marker.
  assert.equal(resolveAnnotationCloudSpec({ type: 'circle', data: { type: 'counter', pdfCloudIntensity: 2 } }), null);
  assert.equal(resolveAnnotationCloudSpec({ type: 'line', data: { pdfCloudIntensity: 2 } }), null);
  assert.equal(resolveAnnotationCloudSpec({ type: 'rect', data: {} }), null);
  assert.equal(resolveAnnotationCloudSpec({ type: 'rect' }), null);
});

// ---------------------------------------------------------------------------
// Layer 3 - the canvas presentation painter (the twin the app draws while
// erasing / printing to a bitmap) traces the SAME reference outline, for every
// cloud-capable shape. This drives the real painter with a recording context,
// so it is a render-path test, not a re-derivation.
// ---------------------------------------------------------------------------

const recordingContext = () => {
  const calls = [];
  const context = {
    calls,
    save: () => {}, restore: () => {},
    translate: (...a) => calls.push(['translate', ...a]),
    rotate: () => {}, scale: () => {}, transform: () => {},
    beginPath: () => {}, closePath: () => calls.push(['closePath']),
    rect: (...a) => calls.push(['rect', ...a]),
    ellipse: (...a) => calls.push(['ellipse', ...a]),
    arc: (...a) => calls.push(['arc', ...a]),
    arcTo: () => {},
    clip: () => {},
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    strokeText: () => {},
    moveTo: (...a) => calls.push(['M', ...a]),
    lineTo: (...a) => calls.push(['L', ...a]),
    quadraticCurveTo: (...a) => calls.push(['Q', ...a]),
    bezierCurveTo: (...a) => calls.push(['C', ...a]),
    setLineDash: () => {},
    stroke: () => calls.push(['stroke']),
    fill: (...a) => calls.push(['fill', ...a]),
  };
  return context;
};

const paintedCloudPath = (object) => {
  const context = recordingContext();
  drawAnnotationObject(context, object, 1);
  return context.calls
    .filter(([verb]) => verb === 'M' || verb === 'C')
    .map((segment) => segment.join(' '))
    .join(' ');
};

test('canvas parity: the presentation painter traces the studio outline for every cloud shape', { skip }, () => {
  const size = cloudRadiusForIntensity(2, 1, 1) * 2;
  const box = { left: 0, top: 0, width: 300, height: 200, scaleX: 1, scaleY: 1, strokeWidth: 1, stroke: '#c42747', fill: 'transparent' };

  assert.equal(
    paintedCloudPath({ ...box, type: 'rect', data: { pdfCloudIntensity: 2 } }),
    referenceRenderedPath('rectangle', rect(0, 0, 300, 200), size),
    'cloud rect',
  );
  assert.equal(
    paintedCloudPath({ ...box, type: 'ellipse', rx: 150, ry: 100, data: { pdfCloudIntensity: 2 } }),
    referenceRenderedPath('ellipse', ellipseCloudPoints(0, 0, 300, 200), size),
    'cloud ellipse',
  );
  assert.equal(
    paintedCloudPath({ ...box, type: 'circle', radius: 150, width: 300, height: 300, data: { pdfCloudIntensity: 2 } }),
    referenceRenderedPath('ellipse', ellipseCloudPoints(0, 0, 300, 300), size),
    'cloud circle',
  );
  assert.equal(
    paintedCloudPath({
      type: 'polygon', left: 0, top: 0, scaleX: 1, scaleY: 1, strokeWidth: 1,
      stroke: '#c42747', fill: 'transparent', points: POLYGONS.star,
      data: { pdfCloudIntensity: 2 },
    }),
    referenceRenderedPath('polygon', POLYGONS.star, size),
    'cloud polygon',
  );
  assert.equal(
    paintedCloudPath({
      type: 'polyline', left: 0, top: 0, scaleX: 1, scaleY: 1, strokeWidth: 1,
      stroke: '#c42747', fill: 'transparent', points: POLYLINES.zigzag,
      data: { pdfCloudIntensity: 2 },
    }),
    referenceRenderedPath('polyline', POLYLINES.zigzag, size),
    'cloud polyline',
  );
});

// DELIBERATE ASSERTION CHANGE (2026-09-09, cloud-studio-match): this test used
// to assert that a filled cloud paints its SOURCE body (an <ellipse> under the
// crowns, humps hollow). Professional revision clouds (Drawboard, Bluebeam)
// fill the whole region bounded by the scalloped outline, humps included, and
// that is now the app contract for every closed cloud shape in every render
// path. The old "body is an ellipse" expectation is therefore replaced, not
// weakened: the painter must fill exactly ONE path, that path must be the
// scalloped region (its extent reaches the crown apexes, past the body), it
// must be traced as curves (never a rect/ellipse primitive), and open shapes
// still never fill.
test('canvas parity: a filled cloud paints the whole scalloped region as one path', { skip }, () => {
  const ellipse = recordingContext();
  drawAnnotationObject(ellipse, {
    type: 'ellipse', left: 0, top: 0, width: 300, height: 200, rx: 150, ry: 100,
    scaleX: 1, scaleY: 1, strokeWidth: 1, stroke: '#c42747', fill: '#ffcc00',
    data: { pdfCloudIntensity: 2 },
  }, 1);
  assert.equal(ellipse.calls.filter(([verb]) => verb === 'fill').length, 1, 'exactly one fill: the scalloped region');
  assert.equal(ellipse.calls.some(([verb]) => verb === 'ellipse' || verb === 'rect'), false,
    'the fill is the scalloped region, not the body primitive');
  const fillIndex = ellipse.calls.findIndex(([verb]) => verb === 'fill');
  const filled = ellipse.calls.slice(0, fillIndex).filter(([verb]) => verb === 'M' || verb === 'C' || verb === 'L');
  const xs = filled.flatMap((segment) => segment.slice(1).filter((_, i) => i % 2 === 0));
  const ys = filled.flatMap((segment) => segment.slice(1).filter((_, i) => i % 2 === 1));
  assert.ok(Math.min(...xs) < -5 && Math.max(...xs) > 305, 'the fill reaches the crown apexes on the left/right');
  assert.ok(Math.min(...ys) < -5 && Math.max(...ys) > 205, 'the fill reaches the crown apexes on the top/bottom');
  assert.ok(ellipse.calls.some(([verb]) => verb === 'closePath'), 'the fill path is closed');

  const polyline = recordingContext();
  drawAnnotationObject(polyline, {
    type: 'polyline', left: 0, top: 0, scaleX: 1, scaleY: 1, strokeWidth: 1,
    stroke: '#c42747', fill: '#ffcc00', points: POLYLINES.zigzag,
    data: { pdfCloudIntensity: 2 },
  }, 1);
  assert.equal(polyline.calls.filter(([verb]) => verb === 'fill').length, 0,
    'an OPEN cloud has no interior, so it never fills');

  // No visible fill paint -> no fill pass at all (and no wasted contour work).
  const hollow = recordingContext();
  drawAnnotationObject(hollow, {
    type: 'rect', left: 0, top: 0, width: 300, height: 200, scaleX: 1, scaleY: 1,
    strokeWidth: 2.5, stroke: '#c42747', fill: 'rgba(255, 255, 255, 0)',
    data: { pdfCloudIntensity: 2 },
  }, 1);
  assert.equal(hollow.calls.filter(([verb]) => verb === 'fill').length, 0, 'a zero-alpha fill paints nothing');

  // A counter never becomes a cloud even if the field is somehow present.
  const counter = recordingContext();
  drawAnnotationObject(counter, {
    type: 'circle', left: 0, top: 0, radius: 14, width: 28, height: 28,
    scaleX: 1, scaleY: 1, strokeWidth: 1, stroke: '#fff', fill: '#c42747',
    data: { type: 'counter', pdfCloudIntensity: 2, displayNumber: 1 },
  }, 1);
  assert.equal(counter.calls.some(([verb]) => verb === 'C'), false,
    'counters have no scalloped edge');
});

// ---------------------------------------------------------------------------
// Layer 4 - the SVG layer and the pdf-lib flattener ask the SAME resolver which
// shapes are clouds and which engine geometry to build, so no render surface
// can keep its own list. (.jsx cannot be imported under `node --test`, so the
// SVG layer is checked at the source level, the established precedent here.)
// ---------------------------------------------------------------------------

test('every render path funnels the cloud decision through one resolver', () => {
  const svg = readFileSync(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');
  const painter = readFileSync(new URL('../src/utils/annotationCanvasPainter.js', import.meta.url), 'utf8');
  const flatten = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  const creation = readFileSync(new URL('../src/utils/annotationCreationCommit.js', import.meta.url), 'utf8');

  for (const [label, source] of [['svg', svg], ['painter', painter], ['flatten', flatten]]) {
    assert.match(source, /resolveAnnotationCloudSpec/, `${label} must use the shared resolver`);
    assert.doesNotMatch(
      source,
      /Number\.isFinite\(\s*cloudIntensity\s*\)/,
      `${label} must not re-derive its own cloud predicate`,
    );
  }
  // The four cloud-capable SVG renderers each hand the resolver's kind to the
  // funnel rather than a hard-coded geometry name.
  assert.equal((svg.match(/geometryKind=\{[a-zA-Z]*[Cc]loudSpec\.kind\}/g) || []).length, 4);
  assert.match(svg, /shapeKind="cloud-ellipse"/);
  assert.match(svg, /shapeKind="cloud-polyline"/);
  // And the toolbar/creation gate is the shared predicate, not a tool list.
  assert.match(creation, /toolSupportsCloudBorderStyle\(tool\)/);
});

// ---------------------------------------------------------------------------
// Layer 5 (2026-09-09, cloud-studio-match) - the call sites feed the engine
// exactly what the studio's page.tsx feeds lib/cloud.ts: vertices with any
// Fabric scale baked in (a resized polygon re-fits constant-size crowns),
// rotation applied to the finished crowns, moveVertex memory for single-vertex
// drags, and one scalloped fill region for every closed cloud.
// ---------------------------------------------------------------------------

const {
  cloudPolyEnginePoints,
  resolveCloudAnnotationGeometry,
  transformCloudCommandsToWorld,
} = await import('../src/utils/cloudAnnotationGeometry.js');
const {
  CLOUD_STYLE_DEFAULTS,
  buildCloudFillPathCommands,
  cloudVertexStateForPoints,
  moveCloudVertex,
} = await import('../src/utils/pdfAnnotationAppearance.js');

const studioPath = (kind, points, options = {}) => reference
  .cloudRuns(reference.makeShape(kind, points, 'x', { size: 28, depth: 12, ...options }), new Map(), 0, false)
  .map((run) => run.d)
  .filter(Boolean)
  .join(' ');

const geometryPath = (geometry) => commandsToPathData(geometry.outline);

test('call-site parity: a scaled polygon re-fits constant-size crowns from the scaled vertices', { skip }, () => {
  // A bbox resize (or an imported scale) is stored as scaleX/scaleY on the
  // Fabric polygon. The studio resizes by rewriting the vertices, so the
  // engine must see the scaled points - never a scale() transform over the
  // crowns, which stretches every scallop (the polygon/polyline regression).
  const points = POLYGONS.star;
  for (const [scaleX, scaleY] of [[1, 1], [2, 1], [1, 1.4], [2, 1.4], [0.5, 0.75]]) {
    const obj = {
      type: 'polygon', left: 40, top: 60, points, scaleX, scaleY,
      pathOffset: { x: 200, y: 180 }, strokeWidth: 2.5, stroke: '#c42747',
      data: { pdfCloudIntensity: 2 },
    };
    const geometry = resolveCloudAnnotationGeometry(obj);
    const scaled = points.map((p) => ({ x: (p.x - 200) * scaleX, y: (p.y - 180) * scaleY }));
    assert.deepEqual(cloudPolyEnginePoints(obj), scaled, `engine points at ${scaleX}x${scaleY}`);
    assert.equal(geometryPath(geometry), studioPath('polygon', scaled), `polygon crowns at ${scaleX}x${scaleY}`);
    assert.equal(geometry.transform, 'translate(40, 60)', 'placement is translate only - no scale on the crowns');
  }
  const open = {
    type: 'polyline', left: 0, top: 0, points: POLYLINES.zigzag, scaleX: 1.5, scaleY: 2,
    strokeWidth: 2.5, data: { pdfCloudIntensity: 2 },
  };
  assert.equal(
    geometryPath(resolveCloudAnnotationGeometry(open)),
    studioPath('polyline', POLYLINES.zigzag.map((p) => ({ x: p.x * 1.5, y: p.y * 2 }))),
    'a scaled polyline re-fits too',
  );
});

test('call-site parity: a rotated cloud is built un-rotated and rotated as a whole, on screen AND in print', { skip }, () => {
  // Screen: renderRect builds the axis-aligned box and rotates the <g>.
  // Print used to rotate the four corners first and hand those to the
  // engine, whose rectangle fit then saw a different box (a 60x40 rect at
  // 30 degrees printed 8 crowns of width 28 while the screen showed 12 of
  // width 18). Both now share transformCloudCommandsToWorld.
  const obj = {
    type: 'rect', left: 100, top: 150, width: 60, height: 40, scaleX: 1, scaleY: 1,
    angle: 30, strokeWidth: 2.5, stroke: '#c42747', data: { pdfCloudIntensity: 2 },
  };
  const geometry = resolveCloudAnnotationGeometry(obj);
  assert.equal(geometryPath(geometry), studioPath('rectangle', rect(0, 0, 60, 40)), 'the un-rotated box is what the engine fits');
  assert.equal(geometry.transform, 'translate(100, 150) rotate(30, 30, 20)');
  const world = transformCloudCommandsToWorld(geometry.outline, geometry);
  assert.equal(world.length, geometry.outline.length, 'every command survives the rotation');
  // The rotated corner crown apex lands on the rotated corner.
  const radians = Math.PI / 6;
  const rotate = (x, y) => ({
    x: 100 + 30 + (x - 30) * Math.cos(radians) - (y - 20) * Math.sin(radians),
    y: 150 + 20 + (x - 30) * Math.sin(radians) + (y - 20) * Math.cos(radians),
  });
  const localApex = geometry.outline.find(([verb]) => verb === 'C');
  const worldApex = world.find(([verb]) => verb === 'C');
  const expected = rotate(localApex[5], localApex[6]);
  assert.ok(Math.abs(worldApex[5] - expected.x) < 1e-9 && Math.abs(worldApex[6] - expected.y) < 1e-9);
});

test('call-site parity: a single-vertex drag replays the studio moveVertex, in frame and at rest', { skip }, () => {
  // moveVertex() re-fits ONLY the dragged vertex; the neighbours keep their
  // corner exactly. The app carries that memory on data.pdfCloudVertexState
  // and every renderer reads it back through the shared resolver, so the
  // cloud after release is the studio's, not a fresh makeShape() refit.
  const points = POLYGONS.star;
  let studio = reference.makeShape('polygon', points, 'z', { size: 28, depth: 12 });
  const state = cloudVertexStateForPoints('polygon', points);
  let moved = null;
  for (let step = 0; step < 30; step += 1) {
    const p = { x: 320 + step * 3.7, y: 150 - step * 2.3 };
    const expected = reference.cloudRuns(reference.moveVertex(studio, 2, p), new Map(), 0, false).map((r) => r.d).join(' ');
    moved = moveCloudVertex('polygon', points, state, 2, p);
    const obj = {
      type: 'polygon', left: 0, top: 0, points: moved.points, scaleX: 1, scaleY: 1,
      strokeWidth: 2.5, data: { pdfCloudIntensity: 2, pdfCloudVertexState: moved.state },
    };
    assert.equal(geometryPath(resolveCloudAnnotationGeometry(obj)), expected, `vertex drag step ${step}`);
    // And it differs from a plain refit whenever the neighbours would move.
    if (step === 29) {
      assert.notEqual(expected, studioPath('polygon', moved.points), 'the studio keeps the neighbours where they were');
    }
  }
  // A second drag starts from the REMEMBERED shape, exactly like the studio.
  studio = reference.moveVertex(studio, 2, { x: 320 + 29 * 3.7, y: 150 - 29 * 2.3 });
  const again = moveCloudVertex('polygon', moved.points, moved.state, 4, { x: 300, y: 330 });
  const expectedAgain = reference.cloudRuns(reference.moveVertex(studio, 4, { x: 300, y: 330 }), new Map(), 0, false).map((r) => r.d).join(' ');
  assert.equal(
    geometryPath(resolveCloudAnnotationGeometry({
      type: 'polygon', left: 0, top: 0, points: again.points, scaleX: 1, scaleY: 1,
      strokeWidth: 2.5, data: { pdfCloudIntensity: 2, pdfCloudVertexState: again.state },
    })),
    expectedAgain,
  );
  // A resize (scale change) invalidates the memory: the studio calls makeShape.
  const resized = {
    type: 'polygon', left: 0, top: 0, points: again.points, scaleX: 1.5, scaleY: 1,
    strokeWidth: 2.5, data: { pdfCloudIntensity: 2, pdfCloudVertexState: again.state },
  };
  assert.equal(resolveAnnotationCloudSpec(resized).vertexState, undefined, 'stale memory is ignored');
  assert.equal(
    geometryPath(resolveCloudAnnotationGeometry(resized)),
    studioPath('polygon', again.points.map((p) => ({ x: p.x * 1.5, y: p.y }))),
  );
});

test('fill parity: every closed cloud fills the scalloped region, open clouds never fill', { skip }, () => {
  const size = cloudRadiusForIntensity(2, 2.5, 1) * 2;
  const cases = [
    ['rectangle', rect(0, 0, 300, 200)],
    ['rectangle', rect(0, 0, 40, 30)],
    ['ellipse', ellipseCloudPoints(0, 0, 300, 200)],
    ['ellipse', ellipseCloudPoints(0, 0, 600, 18)],
    ...Object.entries(POLYGONS).map(([, points]) => ['polygon', points]),
  ];
  for (const [kind, points] of cases) {
    const outline = buildCloudPathCommands(points, 2, 2.5, 1, kind);
    const fill = buildCloudFillPathCommands(points, 2, 2.5, 1, kind);
    assert.ok(Array.isArray(fill) && fill.length > 0, `${kind} n=${points.length} has a fill region`);
    assert.equal(fill[0][0], 'M');
    assert.ok(fill.every(([verb]) => verb === 'M' || verb === 'L' || verb === 'C' || verb === 'Z'));
    assert.ok(fill.some(([verb]) => verb === 'Z'), 'the region is closed');
    // The region's extent is the crowns' extent (sampled geometry, not
    // control points), not the body's.
    const bounds = (commands) => {
      const samples = [];
      let cursor = null;
      for (const command of commands) {
        if (command[0] === 'M' || command[0] === 'L') {
          cursor = { x: command[1], y: command[2] };
          samples.push(cursor);
        } else if (command[0] === 'C') {
          const cubic = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
          for (let step = 1; step <= 20; step += 1) {
            const t = step / 20;
            samples.push({
              x: cubic(cursor.x, command[1], command[3], command[5], t),
              y: cubic(cursor.y, command[2], command[4], command[6], t),
            });
          }
          cursor = { x: command[5], y: command[6] };
        }
      }
      const xs = samples.map((p) => p.x);
      const ys = samples.map((p) => p.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const [ox0, oy0, ox1, oy1] = bounds(outline);
    const [fx0, fy0, fx1, fy1] = bounds(fill);
    for (const [a, b] of [[ox0, fx0], [oy0, fy0], [ox1, fx1], [oy1, fy1]]) {
      assert.ok(Math.abs(a - b) < 0.01, `${kind} n=${points.length} fill extent tracks the crown extent (${a} vs ${b})`);
    }
    // The outline itself is unchanged by asking for the fill.
    assert.equal(commandsToPathData(outline), studioPath(kind, points, { size }));
  }
  for (const points of Object.values(POLYLINES)) {
    assert.equal(buildCloudFillPathCommands(points, 2, 2.5, 1, 'polyline'), null);
  }
  // The resolver only builds the fill when there is visible fill paint.
  const hollow = resolveCloudAnnotationGeometry({
    type: 'rect', left: 0, top: 0, width: 300, height: 200, strokeWidth: 2.5,
    fill: 'transparent', data: { pdfCloudIntensity: 2 },
  });
  assert.equal(hollow.fill, null);
  const filled = resolveCloudAnnotationGeometry({
    type: 'rect', left: 0, top: 0, width: 300, height: 200, strokeWidth: 2.5,
    fill: 'rgba(0, 0, 255, 0.3)', data: { pdfCloudIntensity: 2 },
  });
  assert.ok(Array.isArray(filled.fill) && filled.fill.length > 0);
});

test('studio defaults: the Cloud style paints a 2.5-unit #c42747 line and scallop size ignores the line width', { skip }, () => {
  assert.deepEqual(CLOUD_STYLE_DEFAULTS, { strokeColor: '#c42747', strokeWidth: 2.5, strokeOpacity: 100 });
  const defaults = reference.makeShape('rectangle', rect(0, 0, 10, 10), 'd');
  assert.equal(defaults.stroke, CLOUD_STYLE_DEFAULTS.strokeWidth);
  assert.equal(defaults.color, CLOUD_STYLE_DEFAULTS.strokeColor);
  assert.equal(cloudRadiusForIntensity(2, 0.5, 1) * 2, defaults.size, 'Bump 2 is the studio default 28');
  for (const strokeWidth of [0.5, 2.5, 6, 8, 20]) {
    assert.equal(cloudRadiusForIntensity(1, strokeWidth, 1), 7, `Bump 1 stays 14 units at stroke ${strokeWidth}`);
    assert.equal(cloudRadiusForIntensity(2, strokeWidth, 1), 14, `Bump 2 stays 28 units at stroke ${strokeWidth}`);
  }
  assert.equal(cloudRadiusForIntensity(6, 1, 1) * 2, 80, 'the studio maximum caps the ladder');
});

test('every render path and the hit target resolve clouds through the shared geometry resolver', () => {
  const svg = readFileSync(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');
  const painter = readFileSync(new URL('../src/utils/annotationCanvasPainter.js', import.meta.url), 'utf8');
  const flatten = readFileSync(new URL('../src/utils/pdfAnnotationsPdfLib.js', import.meta.url), 'utf8');
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const interaction = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  const creation = readFileSync(new URL('../src/utils/annotationCreationCommit.js', import.meta.url), 'utf8');
  for (const [label, source] of [['svg', svg], ['painter', painter], ['flatten', flatten], ['layer', layer]]) {
    assert.match(source, /resolveCloudAnnotationGeometry\(/, `${label} must use the shared cloud geometry resolver`);
    assert.doesNotMatch(source, /buildCloudPathCommands\(/, `${label} must not build its own crowns`);
  }
  // Ink: fill region under the crowns, crowns stroked with round caps/joins.
  assert.match(svg, /fillRule="nonzero"/);
  assert.match(svg, /strokeLinecap="round"\s+strokeLinejoin="round"/);
  // Hit target: the studio's transparent stroke along the crowns.
  assert.match(layer, /CLOUD_HIT_STROKE_WIDTH/);
  assert.match(layer, /data-shape-hit-target="cloud"/);
  assert.match(layer, /data-shape-hit-target="cloud-fill"/);
  // Vertex drags replay moveVertex and store the memory on the annotation.
  assert.match(interaction, /moveCloudVertex\(/);
  assert.match(interaction, /pdfCloudVertexState/);
  // Creation: a cloud keeps the exact drag box (no half-stroke inset).
  assert.match(creation, /strokeWidth: isCloud \? 0 : strokeWidth/);
});
