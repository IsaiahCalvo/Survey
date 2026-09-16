// The two filled polygon clouds that broke the old stroke-band subtraction
// (regression fixed 2026-09-10): one hung it for over ten minutes, the other
// threw "reading depth". Both are plain shapes a user can draw in one drag.
//
// 2026-09-15 — the fixtures moved here because two suites now need exactly the
// same shapes and must not drift apart:
//
//   * tests/cloudFillKnockout.test.mjs — BLOCKING. Asserts the band comes back
//     and every ring is well formed.
//   * tests/cloudStrokeBandPathologicalBudget.test.mjs — the non-blocking CI
//     perf lane. Asserts the identical call finishes inside its wall-clock
//     budget, which is the half that must never be able to veto a deploy.
//
// This file is deliberately NOT named *.test.mjs: scripts/run-node-tests.mjs
// collects test files by that suffix, so a fixture module here is never run as
// a suite of its own.
export const PATHOLOGICAL_CLOUD_SHAPES = Object.freeze({
  'convex quad (hung the old subtraction for >10 min)': Object.freeze({
    type: 'polygon', left: 40, top: 30, strokeWidth: 6,
    stroke: 'rgba(196,39,71,1)', fill: 'rgba(0,0,255,0.3)',
    points: [{ x: 0, y: 0 }, { x: 210, y: 20 }, { x: 180, y: 160 }, { x: 30, y: 130 }],
    data: { pdfCloudIntensity: 2 },
  }),
  'self-crossing hexagon (threw "reading depth" in the old subtraction)': Object.freeze({
    type: 'polygon', left: 40, top: 30, strokeWidth: 6,
    stroke: 'rgba(196,39,71,1)', fill: 'rgba(0,0,255,0.3)',
    points: [{ x: 92, y: 69 }, { x: 180, y: 28 }, { x: 35, y: 51 }, { x: 83, y: 81 }, { x: 214, y: 75 }, { x: 166, y: 36 }],
    data: { pdfCloudIntensity: 2 },
  }),
});
