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

test('canvas parity: a cloud shape fills its own body, never the cloud outline', { skip }, () => {
  // The contract rect clouds have always followed: body filled with the
  // shape's own geometry, crowns stroked with fill:none.
  const ellipse = recordingContext();
  drawAnnotationObject(ellipse, {
    type: 'ellipse', left: 0, top: 0, width: 300, height: 200, rx: 150, ry: 100,
    scaleX: 1, scaleY: 1, strokeWidth: 1, stroke: '#c42747', fill: '#ffcc00',
    data: { pdfCloudIntensity: 2 },
  }, 1);
  assert.ok(ellipse.calls.some(([verb]) => verb === 'ellipse'), 'the body is an ellipse, not its box');
  assert.equal(ellipse.calls.filter(([verb]) => verb === 'fill').length, 1, 'exactly one fill: the body');

  const polyline = recordingContext();
  drawAnnotationObject(polyline, {
    type: 'polyline', left: 0, top: 0, scaleX: 1, scaleY: 1, strokeWidth: 1,
    stroke: '#c42747', fill: '#ffcc00', points: POLYLINES.zigzag,
    data: { pdfCloudIntensity: 2 },
  }, 1);
  assert.equal(polyline.calls.filter(([verb]) => verb === 'fill').length, 0,
    'an OPEN cloud has no interior, so it never fills');

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
