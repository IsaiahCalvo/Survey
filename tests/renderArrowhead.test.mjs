// tests/renderArrowhead.test.mjs
// Phase 15 Wave 0 scaffold — 6-style arrowhead dispatch contract (ARROW-04).
//
// UX: renderArrowhead is the single dispatch for all 6 styles. Head-size uses
// max(8, sw*3) to match existing svgAnnotationRenderers.jsx:163 formula — NOT
// the legacy PAL createArrowhead max(12, sw*3) formula. Preserves pre-Phase-15
// arrow visuals per UI-SPEC §D (Head-Size Formula Reconciliation).
//
// Plan 15-02 un-skipped the file-level describe below — `src/utils/lineRenderHelpers.js`
// now lands with this plan and exports `buildArrowheadRenderSpec`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ARROWHEAD_STYLES } from '../src/components/Callout/types.js';

test.describe('renderArrowhead (Plan 15-02 target)', async () => {
  const { buildArrowheadRenderSpec } = await import('../src/utils/lineRenderHelpers.js');

  test('NONE: returns { kind: "none" } and renders nothing', () => {
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.NONE, 100, 50, 0, '#f00', 2);
    assert.equal(s.kind, 'none');
  });

  test('SOLID_TRIANGLE: polygon points match (-h/3,-h/2) (h*2/3,0) (-h/3,h/2) for headSize=8 (sw=1)', () => {
    // sw=1 → headSize = max(8, 3) = 8. Points: -8/3,-4  16/3,0  -8/3,4
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 100, 50, 0, '#f00', 1);
    assert.equal(s.kind, 'solidTriangle');
    assert.equal(s.polygon.points, '-2.6666666666666665,-4 5.333333333333333,0 -2.6666666666666665,4');
    assert.equal(s.polygon.fill, '#f00');
    assert.equal(s.polygon.transform, 'translate(100,50) rotate(0)');
  });

  test('SOLID_TRIANGLE at sw=4: headSize = max(8, 12) = 12 (scales with strokeWidth)', () => {
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 100, 50, 45, '#000', 4);
    assert.equal(s.polygon.points, '-4,-6 8,0 -4,6');
    assert.equal(s.polygon.transform, 'translate(100,50) rotate(45)');
  });

  test('OPEN_TRIANGLE: same geometry as SOLID_TRIANGLE but fill="none" + stroke=color + strokeWidth=max(2, sw)', () => {
    const s1 = buildArrowheadRenderSpec(ARROWHEAD_STYLES.OPEN_TRIANGLE, 0, 0, 0, '#0f0', 1);
    assert.equal(s1.kind, 'openTriangle');
    assert.equal(s1.polygon.fill, 'none');
    assert.equal(s1.polygon.stroke, '#0f0');
    assert.equal(s1.polygon.strokeWidth, 2); // max(2, 1) = 2

    const s5 = buildArrowheadRenderSpec(ARROWHEAD_STYLES.OPEN_TRIANGLE, 0, 0, 0, '#0f0', 5);
    assert.equal(s5.polygon.strokeWidth, 5); // max(2, 5) = 5
  });

  test('OPEN_CIRCLE: returns { circle: { cx, cy, r: headSize/2, fill: "none", stroke, strokeWidth: max(2,sw) } }', () => {
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.OPEN_CIRCLE, 100, 50, 0, '#f0f', 2);
    assert.equal(s.kind, 'openCircle');
    assert.equal(s.circle.cx, 100);
    assert.equal(s.circle.cy, 50);
    assert.equal(s.circle.r, 4); // headSize = max(8, 6) = 8, 8/2 = 4
    assert.equal(s.circle.fill, 'none');
    assert.equal(s.circle.stroke, '#f0f');
    assert.equal(s.circle.strokeWidth, 2);
  });

  test('V_SHAPE: returns polyline with 3 points (arm1, tip, arm2), fill="none", strokeLinecap="round", strokeLinejoin="round"', () => {
    // angleDeg=0 → angleRad=0. armLength=headSize=8. armSpread=π/6 (30°).
    // arm1 = (tipX - armLen*cos(-π/6), tipY - armLen*sin(-π/6)) = (-8*√3/2, +4) = (-6.928..., 4)
    // arm2 = (tipX - armLen*cos(+π/6), tipY - armLen*sin(+π/6)) = (-6.928..., -4)
    // Tip at (0, 0).
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.V_SHAPE, 0, 0, 0, '#000', 1);
    assert.equal(s.kind, 'vShape');
    assert.equal(s.polyline.fill, 'none');
    assert.equal(s.polyline.strokeLinecap, 'round');
    assert.equal(s.polyline.strokeLinejoin, 'round');
    // Three comma-separated pairs separated by spaces; middle pair is the tip (0,0).
    assert.match(s.polyline.points, /^-?\d+\.?\d*(?:e-?\d+)?,-?\d+\.?\d*(?:e-?\d+)? 0,0 -?\d+\.?\d*(?:e-?\d+)?,-?\d+\.?\d*(?:e-?\d+)?$/);
  });

  test('HORIZONTAL_LINE: returns line perpendicular to arrow direction with strokeLinecap="round"', () => {
    // angleDeg=0 → perpendicular direction is π/2 (vertical). halfL = headSize/2 = 4.
    // x1 = tipX + halfL*cos(π/2) = 100 + 0 = 100. y1 = tipY + halfL*sin(π/2) = 50 + 4 = 54.
    // x2 = tipX - halfL*cos(π/2) = 100. y2 = tipY - halfL*sin(π/2) = 50 - 4 = 46.
    const s = buildArrowheadRenderSpec(ARROWHEAD_STYLES.HORIZONTAL_LINE, 100, 50, 0, '#000', 1);
    assert.equal(s.kind, 'horizontalLine');
    assert.ok(Math.abs(s.line.x1 - 100) < 1e-9, `expected x1≈100, got ${s.line.x1}`);
    assert.ok(Math.abs(s.line.y1 - 54) < 1e-9, `expected y1≈54, got ${s.line.y1}`);
    assert.ok(Math.abs(s.line.x2 - 100) < 1e-9, `expected x2≈100, got ${s.line.x2}`);
    assert.ok(Math.abs(s.line.y2 - 46) < 1e-9, `expected y2≈46, got ${s.line.y2}`);
    assert.equal(s.line.strokeLinecap, 'round');
  });

  test('headSize formula: max(8, sw*3) — NOT max(12, sw*3) — preserves pre-Phase-15 arrow visuals', () => {
    // sw=1: max(8, 3) = 8. Extract headSize from SOLID_TRIANGLE polygon points:
    // leftmost point is (-h/3, -h/2), so abs(first y) * 2 = h.
    const s1 = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 0, 0, 0, '#000', 1);
    const firstY1 = Number(s1.polygon.points.split(' ')[0].split(',')[1]);
    assert.ok(Math.abs(Math.abs(firstY1) * 2 - 8) < 1e-9, `at sw=1 expected headSize 8, derived ${Math.abs(firstY1) * 2}`);

    // sw=2: max(8, 6) = 8 (NOT 6 — the 8-floor is the Phase-15 contract, not PAL's 12-floor).
    const s2 = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 0, 0, 0, '#000', 2);
    const firstY2 = Number(s2.polygon.points.split(' ')[0].split(',')[1]);
    assert.ok(Math.abs(Math.abs(firstY2) * 2 - 8) < 1e-9, `at sw=2 expected headSize 8, derived ${Math.abs(firstY2) * 2}`);

    // sw=4: max(8, 12) = 12.
    const s4 = buildArrowheadRenderSpec(ARROWHEAD_STYLES.SOLID_TRIANGLE, 0, 0, 0, '#000', 4);
    const firstY4 = Number(s4.polygon.points.split(' ')[0].split(',')[1]);
    assert.ok(Math.abs(Math.abs(firstY4) * 2 - 12) < 1e-9, `at sw=4 expected headSize 12, derived ${Math.abs(firstY4) * 2}`);
  });
});
