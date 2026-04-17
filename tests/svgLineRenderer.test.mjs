// tests/svgLineRenderer.test.mjs
// Phase 15 Wave 0 scaffold — svg line renderer contract.
//
// UX: these tests lock the renderer contract Plan 15-02 will implement.
// `buildLineRenderSpec(obj)` is a pure-data helper living at
// `src/utils/lineRenderHelpers.js` — it returns a plain spec tree that
// the `.jsx` renderer in svgAnnotationRenderers.jsx wraps 1:1 via
// React.createElement. Testing the pure spec lets Node's native test
// runner verify the contract without needing to load .jsx modules (Phase 14
// calloutRenderer.test.mjs precedent).
//
// Plan 15-02 un-skipped the file-level describe below — lineRenderHelpers.js
// now lands with this plan. The dynamic `await import(...)` inside the
// describe body still resolves at describe-execution time.

import test from 'node:test';
import assert from 'node:assert/strict';

test.describe('svgLineRenderer (Plan 15-02 target)', async () => {
  const { buildLineRenderSpec } = await import('../src/utils/lineRenderHelpers.js');

  test('buildLineRenderSpec: straight line (no data.midpoint) returns kind "straight" with line attrs (x1, y1, x2, y2, stroke, strokeWidth)', () => {
    const obj = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 0,
      x1: -50, y1: 0, x2: 50, y2: 0,
      stroke: '#f00', strokeWidth: 2,
      tool: 'line',
    };
    const spec = buildLineRenderSpec(obj);
    assert.equal(spec.kind, 'straight');
    assert.equal(spec.line.x1, 0);
    assert.equal(spec.line.x2, 100);
    assert.equal(spec.line.y1, 0);
    assert.equal(spec.line.y2, 0);
    assert.equal(spec.line.stroke, '#f00');
    assert.equal(spec.line.strokeWidth, 2);
    assert.equal(spec.arrowhead.kind, 'none');
  });

  test('buildLineRenderSpec: straight arrow (tool=arrow, no data.arrowheadStyle) returns kind "straight" + arrowhead.kind === "solidTriangle" (FALLBACK)', () => {
    const obj = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 0,
      x1: -50, y1: 0, x2: 50, y2: 0,
      stroke: '#f00', strokeWidth: 2,
      tool: 'arrow',
    };
    const spec = buildLineRenderSpec(obj);
    assert.equal(spec.kind, 'straight');
    assert.equal(spec.arrowhead.kind, 'solidTriangle');
    assert.equal(spec.arrowhead.tipX, 100);
    assert.equal(spec.arrowhead.tipY, 0);
    assert.equal(spec.arrowhead.angleDeg, 0);
    assert.equal(spec.arrowhead.color, '#f00');
    assert.equal(spec.arrowhead.sw, 2);
  });

  test('buildLineRenderSpec: curved line (data.midpoint present, distance > 1px from baseline) returns kind "curved" with path.d starting "M" and containing " Q "', () => {
    const obj = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 100,
      x1: -50, y1: -50, x2: 50, y2: -50,
      stroke: '#000', strokeWidth: 3,
      tool: 'line',
      data: { midpoint: { x: 50, y: 50 } },
    };
    const spec = buildLineRenderSpec(obj);
    // Invariant: spec.kind === 'curved' for midpoint distance > 1px hysteresis
    assert.equal(spec.kind, 'curved');
    assert.ok(spec.path.d.startsWith('M 0,0 Q'), `expected path.d to start with "M 0,0 Q", got "${spec.path.d}"`);
    assert.ok(spec.path.d.includes(' 100,0'), `expected path.d to include " 100,0", got "${spec.path.d}"`);
    assert.equal(spec.path.stroke, '#000');
    assert.equal(spec.path.fill, 'none');
    assert.equal(spec.path.strokeWidth, 3);
  });

  test('buildLineRenderSpec: render hysteresis — data.midpoint set but distance ≤ 1px renders "straight"', () => {
    // Same geometry as straight line, but data.midpoint sits 0.5px off baseline.
    // The 1px hysteresis clamp keeps the renderer on the <line> branch.
    const obj = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 0,
      x1: -50, y1: 0, x2: 50, y2: 0,
      stroke: '#f00', strokeWidth: 2,
      tool: 'line',
      data: { midpoint: { x: 50, y: 0.5 } },
    };
    const spec = buildLineRenderSpec(obj);
    assert.equal(spec.kind, 'straight');
  });

  test('buildLineRenderSpec: curved arrow uses getCurveEndAngle (tangent at t=1), NOT Math.atan2(dy, dx)', () => {
    // With midpoint at (50, 50) in page coords and start/end on the baseline,
    // control point = (2*50 - 0 - 50, 2*50 - 0 - 0) = (50, 100). Tangent at
    // t=1 = atan2(0 - 100, 100 - 50) ≈ -63.4349°. Straight atan2 would be 0°.
    const obj = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 100,
      x1: -50, y1: -50, x2: 50, y2: -50,
      stroke: '#000', strokeWidth: 2,
      tool: 'arrow',
      data: { midpoint: { x: 50, y: 50 } },
    };
    const spec = buildLineRenderSpec(obj);
    // Branch guard: spec.kind === 'curved' so the angle-derivation path is the
    // bezier tangent, not the linear atan2 fallback.
    assert.equal(spec.kind, 'curved');
    assert.ok(
      Math.abs(spec.arrowhead.angleDeg - (-63.43494882292201)) < 1e-6,
      `expected arrowhead.angleDeg ≈ -63.4349, got ${spec.arrowhead.angleDeg}`
    );
    assert.notEqual(spec.arrowhead.angleDeg, 0, 'curved tangent must differ from straight-angle atan2');
  });

  test('buildLineRenderSpec: curved line uses tool-based arrowhead fallback; arrowheadStyle override wins when provided', () => {
    // Override: tool=line + data.arrowheadStyle=vShape → arrowhead.kind=vShape.
    const override = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 100,
      x1: -50, y1: -50, x2: 50, y2: -50,
      stroke: '#000', strokeWidth: 2,
      tool: 'line',
      data: { midpoint: { x: 50, y: 50 }, arrowheadStyle: 'vShape' },
    };
    const specOverride = buildLineRenderSpec(override);
    assert.equal(specOverride.arrowhead.kind, 'vShape');

    // Fallback: tool=arrow + no data.arrowheadStyle → arrowhead.kind=solidTriangle.
    const fallback = {
      type: 'line',
      left: 0, top: 0, width: 100, height: 0,
      x1: -50, y1: 0, x2: 50, y2: 0,
      stroke: '#000', strokeWidth: 2,
      tool: 'arrow',
    };
    const specFallback = buildLineRenderSpec(fallback);
    assert.equal(specFallback.arrowhead.kind, 'solidTriangle');
  });
});
