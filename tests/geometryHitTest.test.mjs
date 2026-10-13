import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doesRectIntersectPath,
  doesRectIntersectObject,
  getCounterHitGeometry,
  isPointOnPath,
  isPointOnObject,
} from '../src/utils/geometryHitTest.js';
import { getCounterRenderGeometry } from '../src/utils/counterGeometry.js';
import { createInkPathAffine } from '../src/utils/inkGeometryTransform.js';
import { getAnnotationBBox, getAnnotationWorldAABB } from '../src/utils/svgBoundingBox.js';

test('persisted ink hit testing follows the exact SVG affine through flip and skew', () => {
  const path = {
    type: 'path',
    path: [
      ['M', 10, 20],
      ['L', 50, 20],
    ],
    left: 150,
    top: 90,
    width: 40,
    height: 0,
    pathOffset: { x: 30, y: 20 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    scaleX: 2,
    scaleY: 1.5,
    angle: 31,
    flipX: true,
    skewX: 24,
    skewY: -9,
    stroke: '#d11b2d',
    strokeWidth: 4,
    fill: 'none',
  };
  const affine = createInkPathAffine(path, path.path);
  const renderedPoint = affine.point(12, 20);

  assert.equal(isPointOnPath(renderedPoint, path, 0.5), true);
  assert.equal(
    doesRectIntersectPath({
      left: renderedPoint.x - 1,
      top: renderedPoint.y - 1,
      right: renderedPoint.x + 1,
      bottom: renderedPoint.y + 1,
    }, path),
    true,
  );

  // The pre-fix fallback ignored flip/skew and searched on the opposite side.
  const staleUnflippedPoint = { x: 114, y: 68 };
  assert.equal(isPointOnPath(staleUnflippedPoint, path, 0.5), false);
});

test('persisted ink bbox contains the rendered affine geometry and normalizes legacy arcs', () => {
  const path = {
    type: 'path',
    path: [
      ['M', 20, 40],
      ['A', 30, 20, 25, 0, 1, 100, 40],
    ],
    left: 200,
    top: 100,
    width: 80,
    height: 40,
    pathOffset: { x: 60, y: 40 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    scaleX: 1.6,
    scaleY: 0.8,
    angle: 17,
    flipY: true,
    skewX: 30,
    stroke: '#111',
    strokeWidth: 2,
    fill: 'none',
  };
  const affine = createInkPathAffine(path, path.path);
  const bbox = getAnnotationBBox(path);
  const worldBBox = getAnnotationWorldAABB(path);
  const corners = [
    affine.point(affine.bounds.minX, affine.bounds.minY),
    affine.point(affine.bounds.maxX, affine.bounds.minY),
    affine.point(affine.bounds.maxX, affine.bounds.maxY),
    affine.point(affine.bounds.minX, affine.bounds.maxY),
  ];

  assert.equal(bbox.angle, path.angle);
  for (const point of corners) {
    assert.ok(point.x >= worldBBox.left - 1e-9);
    assert.ok(point.x <= worldBBox.left + worldBBox.width + 1e-9);
    assert.ok(point.y >= worldBBox.top - 1e-9);
    assert.ok(point.y <= worldBBox.top + worldBBox.height + 1e-9);
  }

  const renderedArcEnd = affine.point(100, 40);
  assert.equal(
    isPointOnPath(renderedArcEnd, path, 0.5),
    true,
    'legacy A/a commands hit-test on their rendered endpoint',
  );
});

test('path hit radius stays in page units across extreme affine scales', () => {
  const fixture = (scale) => ({
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 200,
    top: 150,
    width: 100,
    height: 0,
    pathOffset: { x: 50, y: 0 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    scaleX: scale,
    scaleY: scale,
    angle: 37,
    skewX: 25,
    stroke: '#111',
    strokeWidth: 2,
    strokeLineCap: 'round',
    fill: 'none',
  });
  const probeNormal = (path, distance) => {
    const affine = createInkPathAffine(path, path.path);
    const start = affine.point(0, 0);
    const end = affine.point(100, 0);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    return {
      x: (start.x + end.x) / 2 - dy / length * distance,
      y: (start.y + end.y) / 2 + dx / length * distance,
    };
  };

  const tiny = fixture(0.01);
  assert.equal(
    isPointOnPath(probeNormal(tiny, 5), tiny, 8),
    true,
    '8-page-unit eraser reaches a tiny transformed stroke',
  );

  const huge = fixture(100);
  assert.equal(
    isPointOnPath(probeNormal(huge, 500), huge, 8),
    false,
    'page tolerance is not magnified by a huge object transform',
  );
});

test('live Fabric path hit testing inverts microscopic transforms instead of using identity', () => {
  const livePath = {
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    pathOffset: { x: 0, y: 0 },
    stroke: '#111',
    strokeWidth: 2,
    fill: 'none',
    calcTransformMatrix: () => [1e-6, 0, 0, 1e-6, 0, 0],
  };

  assert.equal(isPointOnPath({ x: 50e-6, y: 0.5e-6 }, livePath, 0), true);
  assert.equal(isPointOnPath({ x: 50e-6, y: 5e-6 }, livePath, 0), false);
});

test('plain path hit testing honors butt caps and dash gaps', () => {
  const butt = {
    type: 'path',
    path: [['M', 0, 0], ['L', 100, 0]],
    stroke: '#111',
    strokeWidth: 10,
    strokeLineCap: 'butt',
    fill: 'none',
  };
  assert.equal(isPointOnPath({ x: -1, y: 0 }, butt, 0), false);
  assert.equal(isPointOnPath({ x: 0, y: 0 }, butt, 0), true);

  const dashed = {
    ...butt,
    strokeLineCap: 'butt',
    strokeDashArray: [10, 10],
  };
  assert.equal(isPointOnPath({ x: 5, y: 0 }, dashed, 0), true);
  assert.equal(isPointOnPath({ x: 15, y: 0 }, dashed, 0), false);
});

test('polygon-backed mixed fill and stroke hit-tests the visible stroke fringe', () => {
  const mixed = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['Z'],
    ],
    polygons: [[[
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ]]],
    fill: '#f00',
    stroke: '#00f',
    strokeWidth: 10,
    strokeLineCap: 'butt',
    strokeLineJoin: 'miter',
  };

  assert.equal(isPointOnPath({ x: 10, y: 10 }, mixed, 0), true, 'fill interior');
  assert.equal(isPointOnPath({ x: 23, y: 10 }, mixed, 0), true, 'stroke fringe');
  assert.equal(isPointOnPath({ x: 27, y: 10 }, mixed, 0), false, 'outside both paints');
});

test('long ordinary round strokes avoid first-hit polygon-union latency', () => {
  const path = [['M', 0, 0]];
  for (let index = 1; index <= 5_000; index += 1) {
    path.push(['L', index, Math.sin(index / 25) * 20]);
  }
  const stroke = {
    type: 'path',
    path,
    stroke: '#111',
    strokeWidth: 4,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    fill: 'none',
  };

  const startedAt = performance.now();
  assert.equal(isPointOnPath({ x: 2_500, y: Math.sin(100) * 20 }, stroke, 2), true);
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 500, `first hit took ${elapsed.toFixed(1)}ms`);
});

test('unfilled rect selects stroke but not blank interior', () => {
  const rect = {
    type: 'rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: 'transparent',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), false);
  assert.equal(isPointOnObject({ x: 10, y: 50 }, rect, 2), true);
});

test('filled rect selects blank-looking interior only when fill is real', () => {
  const rect = {
    type: 'rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: '#ffee00',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), true);
});

test('unfilled circle selects stroke but not center', () => {
  const circle = {
    type: 'circle',
    left: 50,
    top: 50,
    radius: 30,
    fill: 'none',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 80, y: 80 }, circle, 2), false);
  assert.equal(isPointOnObject({ x: 80, y: 50 }, circle, 2), true);
});

test('filled polygon selects interior; unfilled polygon does not', () => {
  const base = {
    type: 'polygon',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 40, y: 40 }, { ...base, fill: 'none' }, 2), false);
  assert.equal(isPointOnObject({ x: 40, y: 40 }, { ...base, fill: '#00aa55' }, 2), true);
  assert.equal(isPointOnObject({ x: 0, y: 40 }, { ...base, fill: 'none' }, 2), true);
});

test('crossing marquee respects filled polygon interior but not unfilled blank interior', () => {
  const base = {
    type: 'polygon',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    stroke: '#111',
    strokeWidth: 4,
  };
  const tinyInteriorMarquee = { left: 35, top: 35, right: 45, bottom: 45 };

  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, { ...base, fill: 'none' }), false);
  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, { ...base, fill: '#00aa55' }), true);
});

test('crossing marquee respects unfilled circle blank interior', () => {
  const circle = {
    type: 'circle',
    left: 80,
    top: 80,
    originX: 'center',
    originY: 'center',
    radius: 30,
    fill: 'none',
    stroke: '#111',
    strokeWidth: 4,
  };
  const tinyInteriorMarquee = { left: 75, top: 75, right: 85, bottom: 85 };
  const topStrokeMarquee = { left: 75, top: 47, right: 85, bottom: 53 };

  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, circle), false);
  assert.equal(doesRectIntersectObject(topStrokeMarquee, circle), true);
});

test('group arrow hit testing follows children, not group bbox', () => {
  const arrow = {
    type: 'group',
    left: 100,
    top: 100,
    width: 120,
    height: 80,
    stroke: '#111',
    strokeWidth: 4,
    objects: [
      { type: 'line', x1: 0, y1: 0, x2: 120, y2: 80, stroke: '#111', strokeWidth: 4 },
      { type: 'triangle', name: 'arrowHead', left: 120, top: 80, width: 12, height: 12, fill: '#111' },
    ],
  };

  assert.equal(isPointOnObject({ x: 110, y: 170 }, arrow, 2), false);
  assert.equal(isPointOnObject({ x: 160, y: 140 }, arrow, 2), true);
  assert.equal(doesRectIntersectObject({ left: 108, top: 168, right: 118, bottom: 178 }, arrow), false);
  assert.equal(doesRectIntersectObject({ left: 155, top: 135, right: 165, bottom: 145 }, arrow), true);
});

test('legacy empty-group counters hit-test where their SVG bubble is visible', () => {
  const counter = {
    type: 'group',
    left: 100,
    top: 120,
    width: 44,
    height: 44,
    data: {
      type: 'counter',
      displayNumber: 2,
      color: '#ef4444',
    },
  };

  // renderCounter uses its default 14 radius for this legacy storage shape.
  assert.equal(isPointOnObject({ x: 114, y: 134 }, counter, 0), true);
  assert.equal(isPointOnObject({ x: 140, y: 160 }, counter, 0), false);
  assert.equal(
    doesRectIntersectObject({ left: 110, top: 130, right: 118, bottom: 138 }, counter),
    true,
  );
});

test('counter tangent nub hit-tests outside its circle at 2x scale with an east pointer', () => {
  const counter = {
    type: 'circle',
    left: 100,
    top: 120,
    radius: 14,
    scaleX: 2,
    data: {
      type: 'counter',
      pointerAngle: 0,
      displayNumber: 2,
    },
  };
  const geometry = getCounterHitGeometry(counter);
  assert.deepEqual(geometry.center, { x: 128, y: 148 });
  assert.deepEqual(geometry.tip, { x: 170, y: 148 });
  assert.ok(
    Math.hypot(
      geometry.tip.x - geometry.center.x,
      geometry.tip.y - geometry.center.y,
    ) > geometry.radius + 2,
    'tiny eraser at the nub cannot hit the old circle-only fallback',
  );
  assert.equal(isPointOnObject({ x: 169, y: 148 }, counter, 2), true);
  assert.equal(isPointOnObject({ x: 174, y: 148 }, counter, 2), false);
  assert.equal(
    doesRectIntersectObject({ left: 168, top: 147, right: 170, bottom: 149 }, counter),
    true,
  );
  assert.equal(
    doesRectIntersectObject({ left: 173, top: 147, right: 175, bottom: 149 }, counter),
    false,
  );
});

test('counter hit geometry matches render semantics across transforms and pointer angles', () => {
  const cases = [
    {
      name: 'default northwest',
      counter: {
        type: 'circle',
        left: 100,
        top: 120,
        radius: 14,
        data: { type: 'counter', pointerAngle: 225 },
      },
    },
    {
      name: 'east with positive scale',
      counter: {
        type: 'circle',
        left: 20,
        top: 30,
        radius: 14,
        scaleX: 2,
        scaleY: 0.25,
        angle: 137,
        data: { type: 'counter', pointerAngle: 0 },
      },
    },
    {
      name: 'south with fractional scale',
      counter: {
        type: 'circle',
        left: -12,
        top: 8,
        radius: 20,
        scaleX: 0.5,
        scaleY: 3,
        angle: -44,
        data: { type: 'counter', pointerAngle: 90 },
      },
    },
    {
      name: 'west with negative scale',
      counter: {
        type: 'circle',
        left: 60,
        top: 70,
        radius: 18,
        scaleX: -1.5,
        scaleY: -2,
        angle: 270,
        data: { type: 'counter', pointerAngle: 180 },
      },
    },
    {
      name: 'zero scale uses the renderer fallback',
      counter: {
        type: 'circle',
        left: 0,
        top: 0,
        radius: 14,
        scaleX: 0,
        scaleY: 0,
        angle: 99,
        data: { type: 'counter', pointerAngle: 270 },
      },
    },
    {
      name: 'oblique angle near wrap',
      counter: {
        type: 'circle',
        left: 5,
        top: -6,
        radius: 9,
        scaleX: 3,
        scaleY: 0.2,
        angle: 177,
        data: { type: 'counter', pointerAngle: 359 },
      },
    },
    {
      name: 'legacy group carrier',
      counter: {
        type: 'group',
        left: 200,
        top: 210,
        radius: 17,
        scaleX: 1.2,
        scaleY: 7,
        angle: 45,
        objects: [],
        data: { type: 'counter', pointerAngle: 37 },
      },
    },
  ];

  for (const { name, counter } of cases) {
    // renderCounter deliberately uses scaleX for a circular badge and models
    // rotation through data.pointerAngle. scaleY and obj.angle do not alter
    // its path, so hit geometry must follow that same contract.
    const radius = (Number(counter.radius) || 14)
      * Math.abs(Number(counter.scaleX) || 1);
    const expected = getCounterRenderGeometry(
      (Number(counter.left) || 0) + radius,
      (Number(counter.top) || 0) + radius,
      radius,
      counter.data.pointerAngle,
    );
    const actual = getCounterHitGeometry(counter);

    assert.deepEqual(actual, expected, name);
    assert.equal(isPointOnObject(actual.center, counter, 0), true, `${name}: body`);
    assert.equal(isPointOnObject(actual.tip, counter, 0), true, `${name}: nub tip`);
  }

  const base = {
    type: 'circle',
    left: 42,
    top: 64,
    radius: 16,
    scaleX: 1.75,
    data: { type: 'counter', pointerAngle: 37 },
  };
  const baseline = getCounterHitGeometry(base);
  assert.deepEqual(
    getCounterHitGeometry({ ...base, scaleY: 0.01, angle: 173 }),
    baseline,
    'scaleY and obj.angle stay ignored exactly as renderCounter ignores them',
  );
});

test('counter rectangle intersection follows the tangent nub and rejects beyond every tip', () => {
  for (const pointerAngle of [0, 37, 90, 180, 225, 270, 359]) {
    const counter = {
      type: 'circle',
      left: 100,
      top: 120,
      radius: 14,
      scaleX: 2,
      scaleY: 0.125,
      angle: 123,
      data: { type: 'counter', pointerAngle },
    };
    const geometry = getCounterHitGeometry(counter);
    const radians = (pointerAngle * Math.PI) / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const tipDistance = Math.hypot(
      geometry.tip.x - geometry.center.x,
      geometry.tip.y - geometry.center.y,
    );
    const nubInteriorDistance = geometry.radius
      + (tipDistance - geometry.radius) / 2;
    const nubInterior = {
      x: geometry.center.x + direction.x * nubInteriorDistance,
      y: geometry.center.y + direction.y * nubInteriorDistance,
    };
    const beyondTip = {
      x: geometry.tip.x + direction.x * 2,
      y: geometry.tip.y + direction.y * 2,
    };
    const around = (point, halfSize = 0.2) => ({
      left: point.x - halfSize,
      top: point.y - halfSize,
      right: point.x + halfSize,
      bottom: point.y + halfSize,
    });

    assert.equal(
      doesRectIntersectObject(around(nubInterior), counter),
      true,
      `${pointerAngle}° rectangle must hit nub interior`,
    );
    assert.equal(
      doesRectIntersectObject(around(geometry.tip), counter),
      true,
      `${pointerAngle}° rectangle must hit nub tip`,
    );
    assert.equal(
      doesRectIntersectObject(around(beyondTip), counter),
      false,
      `${pointerAngle}° rectangle beyond tip must miss`,
    );
    assert.equal(
      isPointOnObject(beyondTip, counter, 0),
      false,
      `${pointerAngle}° point beyond tip must miss`,
    );
  }
});

test('legacy empty-group counter uses the same visible tangent nub geometry', () => {
  const counter = {
    type: 'group',
    left: 100,
    top: 120,
    data: {
      type: 'counter',
      pointerAngle: 90,
      displayNumber: 2,
    },
    objects: [],
  };
  const { tip, center, radius } = getCounterHitGeometry(counter);
  assert.ok(Math.hypot(tip.x - center.x, tip.y - center.y) > radius + 1);
  assert.equal(isPointOnObject({ x: tip.x, y: tip.y - 1 }, counter, 1), true);
  assert.equal(
    doesRectIntersectObject({
      left: tip.x - 1,
      top: tip.y - 1,
      right: tip.x + 1,
      bottom: tip.y + 1,
    }, counter),
    true,
  );
});

test('fabric-7 capitalized serialized types hit-test identically to lowercase', () => {
  // fabric 7 toObject() emits class names ('Textbox', 'Rect', 'IText', …);
  // fabric 5 saves are lowercase. Both must hit. The capitalized forms were
  // silently un-hittable (case-sensitive switch), which made the eraser
  // unable to erase text boxes and newer shapes.
  const textbox = {
    type: 'Textbox',
    left: 10,
    top: 20,
    width: 100,
    height: 30,
    fill: '#000',
  };
  assert.equal(isPointOnObject({ x: 50, y: 35 }, textbox, 2), true);
  assert.equal(isPointOnObject({ x: 300, y: 300 }, textbox, 2), false);

  const itext = { ...textbox, type: 'IText' };
  assert.equal(isPointOnObject({ x: 50, y: 35 }, itext, 2), true);

  const rect = {
    type: 'Rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: '#ffee00',
    stroke: '#111',
    strokeWidth: 4,
  };
  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), true);
  assert.equal(
    doesRectIntersectObject({ left: 0, top: 0, right: 15, bottom: 25 }, rect),
    true,
  );
});

// ---------------------------------------------------------------------------
// Recovered from the July coverage commit 90f10085 (KAL-370).
// ---------------------------------------------------------------------------

test('isPointOnObject covers line/textbox/triangle/path/group/polyline', () => {
  assert.equal(
    isPointOnObject({ x: 10, y: 10 }, {
      type: 'line', left: 0, top: 0, x1: 0, y1: 10, x2: 40, y2: 10, strokeWidth: 4,
    }, 2),
    true,
  );
  assert.equal(
    isPointOnObject({ x: 12, y: 12 }, {
      type: 'textbox', left: 10, top: 10, width: 40, height: 20, text: 'hi', fill: '#000',
    }, 4),
    true,
  );
  assert.equal(
    isPointOnObject({ x: 20, y: 15 }, {
      type: 'triangle', left: 0, top: 0, width: 40, height: 40, fill: '#f00', stroke: '#000', strokeWidth: 2,
    }, 4),
    true,
  );
  assert.equal(
    isPointOnObject({ x: 5, y: 0 }, {
      type: 'path',
      left: 0,
      top: 0,
      path: [['M', 0, 0], ['L', 20, 0]],
      stroke: '#000',
      strokeWidth: 4,
    }, 3),
    true,
  );
  assert.equal(
    isPointOnObject({ x: 5, y: 0 }, {
      type: 'polyline',
      left: 0,
      top: 0,
      points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      stroke: '#000',
      strokeWidth: 4,
    }, 3),
    true,
  );
  assert.equal(
    isPointOnObject({ x: 5, y: 0 }, {
      type: 'group',
      left: 0,
      top: 0,
      objects: [{ type: 'line', left: 0, top: 0, x1: 0, y1: 0, x2: 20, y2: 0, strokeWidth: 4 }],
    }, 3),
    true,
  );
  assert.equal(isPointOnObject({ x: 0, y: 0 }, null), false);
  assert.equal(isPointOnObject({ x: 0, y: 0 }, { type: 'unknown', containsPoint: () => true }), true);
});

test('doesRectIntersectObject covers line/textbox/ellipse/group', () => {
  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 8, right: 30, bottom: 12 },
      { type: 'line', left: 0, top: 0, x1: 0, y1: 10, x2: 40, y2: 10, strokeWidth: 2 },
    ),
    true,
  );
  assert.equal(
    doesRectIntersectObject(
      { left: 12, top: 12, right: 18, bottom: 18 },
      { type: 'textbox', left: 10, top: 10, width: 40, height: 20, text: 'x' },
    ),
    true,
  );
  assert.equal(
    doesRectIntersectObject(
      { left: 45, top: 45, right: 55, bottom: 55 },
      {
        type: 'ellipse',
        left: 50,
        top: 50,
        originX: 'center',
        originY: 'center',
        rx: 20,
        ry: 10,
        fill: '#0f0',
      },
    ),
    true,
  );
  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 5, bottom: 5 },
      {
        type: 'group',
        left: 0,
        top: 0,
        objects: [{ type: 'rect', left: 0, top: 0, width: 20, height: 20, fill: '#f00' }],
      },
    ),
    true,
  );
});

test('path hit/intersect covers cubic and quadratic commands', () => {
  const cubicPath = {
    type: 'path',
    left: 0,
    top: 0,
    stroke: '#000',
    strokeWidth: 3,
    path: [
      ['M', 0, 0],
      ['C', 10, 20, 20, 20, 30, 0],
      ['Q', 40, -10, 50, 0],
      ['Z'],
    ],
  };
  assert.equal(isPointOnObject({ x: 0, y: 0 }, cubicPath, 4), true);
  assert.equal(
    doesRectIntersectObject({ left: 10, top: -5, right: 40, bottom: 15 }, cubicPath),
    true,
  );

  const filledPath = {
    type: 'path',
    left: 0,
    top: 0,
    fill: '#f00',
    stroke: 'none',
    path: [
      ['M', 0, 0],
      ['L', 40, 0],
      ['L', 40, 40],
      ['L', 0, 40],
      ['Z'],
    ],
  };
  assert.equal(isPointOnObject({ x: 20, y: 20 }, filledPath, 1), true);
  assert.equal(
    doesRectIntersectObject({ left: -2, top: -2, right: 5, bottom: 5 }, filledPath),
    true,
  );
});

test('isObjectFullyInRect and getObjectGeometryBounds for common shapes', async () => {
  const {
    isObjectFullyInRect,
    getObjectGeometryBounds,
  } = await import('../src/utils/geometryHitTest.js');

  const rect = { type: 'rect', left: 10, top: 10, width: 20, height: 15, fill: '#0f0' };
  const bounds = getObjectGeometryBounds(rect);
  assert.ok(bounds);
  assert.ok(bounds.right > bounds.left);
  assert.equal(
    isObjectFullyInRect({ left: 0, top: 0, right: 100, bottom: 100 }, rect),
    true,
  );
  assert.equal(
    isObjectFullyInRect({ left: 0, top: 0, right: 15, bottom: 15 }, rect),
    false,
  );
  assert.equal(isObjectFullyInRect({ left: 0, top: 0, right: 10, bottom: 10 }, null), false);
  assert.equal(getObjectGeometryBounds(null), null);

  const line = { type: 'line', left: 0, top: 0, x1: 0, y1: 0, x2: 40, y2: 0, strokeWidth: 2 };
  const lineBounds = getObjectGeometryBounds(line);
  assert.ok(lineBounds.width === undefined || lineBounds.right >= lineBounds.left);

  const path = {
    type: 'path',
    left: 0,
    top: 0,
    path: [['M', 0, 0], ['L', 10, 0], ['L', 10, 10]],
    stroke: '#000',
    strokeWidth: 1,
  };
  assert.ok(getObjectGeometryBounds(path));
});

test('relative path commands and invisible fill/stroke paint rules', () => {
  const relative = {
    type: 'path',
    left: 0,
    top: 0,
    stroke: '#000',
    strokeWidth: 4,
    path: [
      ['m', 0, 0],
      ['l', 30, 0],
      ['c', 5, 10, 10, 10, 15, 0],
      ['q', 5, -5, 10, 0],
      ['z'],
    ],
  };
  assert.equal(isPointOnObject({ x: 5, y: 0 }, relative, 3), true);
  assert.equal(
    doesRectIntersectObject({ left: 0, top: -2, right: 40, bottom: 8 }, relative),
    true,
  );

  // Stroke paint invisible → stroke-only distance branch at end of isPointOnPath
  const strokeInvisible = {
    type: 'path',
    left: 0,
    top: 0,
    fill: 'none',
    stroke: 'rgba(0,0,0,0)',
    strokeWidth: 0,
    path: [['M', 0, 0], ['L', 20, 0]],
  };
  assert.equal(isPointOnObject({ x: 10, y: 0 }, strokeInvisible, 3), true);

  // 4/8-digit hex alpha paints (invisible alpha still uses no-paint path)
  assert.equal(
    isPointOnObject(
      { x: 15, y: 15 },
      { type: 'rect', left: 10, top: 10, width: 20, height: 20, fill: '#f00f', stroke: 'none' },
      1,
    ),
    true,
  );
  assert.equal(
    isPointOnObject(
      { x: 200, y: 200 },
      { type: 'rect', left: 10, top: 10, width: 20, height: 20, fill: '#0000', stroke: 'none' },
      1,
    ),
    false,
  );
  assert.equal(
    isPointOnObject(
      { x: 200, y: 200 },
      { type: 'rect', left: 10, top: 10, width: 20, height: 20, fill: '#ff000000', stroke: 'none' },
      1,
    ),
    false,
  );
});

test('getObjectGeometryBounds covers ellipse/textbox/group/polyline/fallback', async () => {
  const {
    getObjectGeometryBounds,
    isObjectFullyInRect,
  } = await import('../src/utils/geometryHitTest.js');

  const ellipse = {
    type: 'ellipse',
    left: 50,
    top: 40,
    originX: 'center',
    originY: 'center',
    rx: 20,
    ry: 10,
    strokeWidth: 2,
  };
  assert.ok(getObjectGeometryBounds(ellipse));

  const circle = {
    type: 'circle',
    left: 0,
    top: 0,
    radius: 15,
    strokeWidth: 2,
  };
  assert.ok(getObjectGeometryBounds(circle));

  const text = {
    type: 'textbox',
    left: 5,
    top: 5,
    width: 40,
    height: 20,
    originX: 'center',
    originY: 'center',
  };
  assert.ok(getObjectGeometryBounds(text));

  const poly = {
    type: 'polyline',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 25 }],
    stroke: '#111',
    strokeWidth: 2,
  };
  assert.ok(getObjectGeometryBounds(poly));

  const cubicPath = {
    type: 'path',
    left: 0,
    top: 0,
    path: [
      ['M', 0, 0],
      ['C', 10, 20, 20, 20, 30, 0],
      ['Q', 40, -10, 50, 0],
      ['m', 0, 0],
      ['l', 5, 5],
      ['c', 1, 2, 2, 2, 3, 0],
      ['q', 1, -1, 2, 0],
    ],
    strokeWidth: 2,
  };
  const pathBounds = getObjectGeometryBounds(cubicPath);
  assert.ok(pathBounds);
  assert.equal(
    isObjectFullyInRect(
      { left: pathBounds.left - 1, top: pathBounds.top - 1, right: pathBounds.right + 1, bottom: pathBounds.bottom + 1 },
      cubicPath,
    ),
    true,
  );

  const group = {
    type: 'group',
    left: 0,
    top: 0,
    objects: [{ type: 'rect', left: 0, top: 0, width: 10, height: 10, fill: '#0f0' }],
  };
  assert.ok(getObjectGeometryBounds(group));

  const fallback = {
    type: 'custom-widget',
    getBoundingRect: () => ({ left: 1, top: 2, width: 3, height: 4 }),
  };
  assert.deepEqual(getObjectGeometryBounds(fallback), { left: 1, top: 2, right: 4, bottom: 6 });

  const throwFallback = {
    type: 'custom-widget',
    getBoundingRect: () => { throw new Error('nope'); },
  };
  assert.equal(getObjectGeometryBounds(throwFallback), null);
});

test('doesRectIntersectRect covers fill/stroke/empty and nested marquees', () => {
  const filled = {
    type: 'rect',
    left: 0,
    top: 0,
    width: 100,
    height: 80,
    fill: '#0af',
    stroke: '#000',
    strokeWidth: 4,
  };
  // Selection fully inside object (allCornersInside)
  assert.equal(doesRectIntersectObject({ left: 20, top: 20, right: 40, bottom: 40 }, filled), true);
  // Object fully inside selection
  assert.equal(doesRectIntersectObject({ left: -10, top: -10, right: 200, bottom: 200 }, filled), true);
  // Crossing edge without containing vertices (edge sample / segment)
  assert.equal(doesRectIntersectObject({ left: 90, top: 30, right: 110, bottom: 50 }, filled), true);

  const strokeOnly = {
    type: 'rect',
    left: 0,
    top: 0,
    width: 100,
    height: 80,
    fill: 'none',
    stroke: '#111',
    strokeWidth: 6,
  };
  // Interior miss for stroke-only
  assert.equal(doesRectIntersectObject({ left: 40, top: 30, right: 50, bottom: 40 }, strokeOnly), false);
  // Hit top stroke
  assert.equal(doesRectIntersectObject({ left: 40, top: -2, right: 60, bottom: 4 }, strokeOnly), true);
  // Hit via selection edge near stroke (wide stroke)
  assert.equal(doesRectIntersectObject({ left: 98, top: 20, right: 120, bottom: 40 }, strokeOnly), true);

  const emptyPaint = {
    type: 'rect',
    left: 10,
    top: 10,
    width: 50,
    height: 40,
    fill: 'transparent',
    stroke: 'none',
  };
  assert.equal(doesRectIntersectObject({ left: 20, top: 20, right: 30, bottom: 30 }, emptyPaint), true);
  assert.equal(doesRectIntersectObject({ left: 200, top: 200, right: 210, bottom: 210 }, emptyPaint), false);

  const rotated = {
    type: 'rect',
    left: 50,
    top: 50,
    width: 40,
    height: 20,
    angle: 45,
    originX: 'center',
    originY: 'center',
    fill: '#f00',
    stroke: 'none',
  };
  assert.equal(doesRectIntersectObject({ left: 45, top: 45, right: 55, bottom: 55 }, rotated), true);

  // The old file also expected an unpainted plain-JSON rect to hit through a
  // fake getBoundingRect far from its geometry. Since d07b6e2f6 (KAL-366)
  // plain JSON objects are hit on their stored geometry only.
});

test('doesRectIntersectPath relative curves and doesRectIntersect text/line/unknown', () => {
  const relPath = {
    type: 'path',
    left: 0,
    top: 0,
    stroke: '#000',
    strokeWidth: 3,
    path: [
      ['m', 0, 0],
      ['c', 10, 20, 20, 20, 30, 0],
      ['q', 10, -10, 20, 0],
      ['l', 10, 10],
    ],
  };
  assert.equal(doesRectIntersectObject({ left: 5, top: -5, right: 45, bottom: 15 }, relPath), true);

  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 50, bottom: 30 },
      { type: 'textbox', left: 5, top: 5, width: 40, height: 20, text: 'hi', originX: 'center', originY: 'center' },
    ),
    true,
  );

  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 8, right: 40, bottom: 12 },
      { type: 'line', left: 0, top: 0, x1: 0, y1: 10, x2: 50, y2: 10, strokeWidth: 4, stroke: '#000' },
    ),
    true,
  );

  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 10, bottom: 10 },
      {
        type: 'mystery',
        getBoundingRect: () => ({ left: 2, top: 2, width: 5, height: 5 }),
      },
    ),
    true,
  );
  assert.equal(doesRectIntersectObject({ left: 0, top: 0, right: 1, bottom: 1 }, null), false);
});

test('ellipse/line/textbox marquee edge cases', () => {
  // Tiny selection fully inside large filled ellipse
  assert.equal(
    doesRectIntersectObject(
      { left: 48, top: 48, right: 52, bottom: 52 },
      {
        type: 'ellipse',
        left: 50,
        top: 50,
        originX: 'center',
        originY: 'center',
        rx: 40,
        ry: 30,
        fill: '#0f0',
        stroke: 'none',
      },
    ),
    true,
  );

  // Stroke-only ellipse: corner on ring
  assert.equal(
    doesRectIntersectObject(
      { left: 88, top: 48, right: 92, bottom: 52 },
      {
        type: 'ellipse',
        left: 50,
        top: 50,
        originX: 'center',
        originY: 'center',
        rx: 40,
        ry: 30,
        fill: 'none',
        stroke: '#111',
        strokeWidth: 6,
      },
    ),
    true,
  );

  // Line from path coords when x1/y1 missing
  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: -2, right: 30, bottom: 2 },
      {
        type: 'line',
        left: 0,
        top: 0,
        strokeWidth: 2,
        path: [['M', 0, 0], ['L', 40, 0]],
      },
    ),
    true,
  );

  // (Dropped: line hit through a fake getBoundingRect; plain JSON lines are
  // hit on their stored endpoints only since ad8291526.)

  // Textbox edge cross without containing vertices (large rotated-ish via scale)
  assert.equal(
    doesRectIntersectObject(
      { left: 35, top: -5, right: 45, bottom: 5 },
      {
        type: 'i-text',
        left: 0,
        top: 0,
        width: 80,
        height: 40,
        text: 'hello',
      },
    ),
    true,
  );

  // calcTransformMatrix throw falls through to manual matrix
  assert.equal(
    isPointOnObject(
      { x: 5, y: 5 },
      {
        type: 'rect',
        left: 0,
        top: 0,
        width: 20,
        height: 20,
        fill: '#f00',
        calcTransformMatrix: () => { throw new Error('boom'); },
      },
      1,
    ),
    true,
  );
});

test('group getObjects and stroke-only triangle/polyline', () => {
  assert.equal(
    isPointOnObject(
      { x: 5, y: 0 },
      {
        type: 'group',
        left: 0,
        top: 0,
        getObjects: () => [
          { type: 'line', left: 0, top: 0, x1: 0, y1: 0, x2: 20, y2: 0, strokeWidth: 4, stroke: '#000' },
        ],
      },
      3,
    ),
    true,
  );

  assert.equal(
    isPointOnObject(
      { x: 0, y: 20 },
      {
        type: 'triangle',
        left: 0,
        top: 0,
        width: 40,
        height: 40,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 4,
      },
      3,
    ),
    true,
  );

  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: -2, right: 30, bottom: 2 },
      {
        type: 'polyline',
        left: 0,
        top: 0,
        points: [{ x: 0, y: 0 }, { x: 40, y: 0 }],
        fill: 'none',
        stroke: '#111',
        strokeWidth: 4,
      },
    ),
    true,
  );
});

test('circle/ellipse/textbox/group remaining miss and hit branches', () => {
  // Filled triangle interior
  assert.equal(
    isPointOnObject(
      { x: 0, y: 0 },
      {
        type: 'triangle',
        left: 0,
        top: 0,
        width: 40,
        height: 40,
        fill: '#0f0',
        stroke: 'none',
      },
      1,
    ),
    true,
  );

  // Empty paint triangle expanded tolerance
  assert.equal(
    isPointOnObject(
      { x: 0, y: 0 },
      {
        type: 'triangle',
        left: 0,
        top: 0,
        width: 40,
        height: 40,
        fill: 'none',
        stroke: 'none',
      },
      8,
    ),
    true,
  );

  // Circle stroke-only center miss
  assert.equal(
    isPointOnObject(
      { x: 50, y: 50 },
      {
        type: 'circle',
        left: 50,
        top: 50,
        originX: 'center',
        originY: 'center',
        radius: 30,
        fill: 'none',
        stroke: '#111',
        strokeWidth: 4,
      },
      1,
    ),
    false,
  );

  // Empty group with getObjects
  assert.equal(
    isPointOnObject(
      { x: 0, y: 0 },
      { type: 'group', left: 0, top: 0, getObjects: () => [] },
      2,
    ),
    false,
  );

  // Textbox crossing edge (selection overlaps top edge only)
  assert.equal(
    doesRectIntersectObject(
      { left: 10, top: -2, right: 30, bottom: 2 },
      { type: 'textbox', left: 0, top: 0, width: 40, height: 20, text: 'x' },
    ),
    true,
  );

  // Path with only relative move (no drawable stroke distance) returns false far away
  assert.equal(
    isPointOnObject(
      { x: 100, y: 100 },
      {
        type: 'path',
        left: 0,
        top: 0,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 2,
        path: [['M', 0, 0]],
      },
      1,
    ),
    false,
  );
});

test('ellipse fill/empty paint + quadratic path marquee + textbox/line/group edges', async () => {
  const { getObjectGeometryBounds } = await import('../src/utils/geometryHitTest.js');

  // Filled ellipse (type ellipse, not circle) center hit. The SVG renderer
  // draws a plain JSON ellipse centred at (left + rx, top + ry) whatever its
  // originX/originY, and the hit test follows what is drawn, so the centre
  // here is (80, 60). (The old file expected a hit at (50, 40).)
  assert.equal(
    isPointOnObject(
      { x: 80, y: 60 },
      {
        type: 'ellipse',
        left: 50,
        top: 40,
        originX: 'center',
        originY: 'center',
        rx: 30,
        ry: 20,
        fill: '#0af',
        stroke: 'none',
      },
      1,
    ),
    true,
  );

  // Empty paint ellipse: expanded tolerance around ring
  assert.equal(
    isPointOnObject(
      { x: 50, y: 40 },
      {
        type: 'ellipse',
        left: 50,
        top: 40,
        originX: 'center',
        originY: 'center',
        rx: 20,
        ry: 12,
        fill: 'none',
        stroke: 'none',
      },
      25,
    ),
    true,
  );

  // Tiny marquee fully inside filled ellipse (all-corners-inside + center)
  assert.equal(
    doesRectIntersectObject(
      { left: 48, top: 38, right: 52, bottom: 42 },
      {
        type: 'ellipse',
        left: 50,
        top: 40,
        originX: 'center',
        originY: 'center',
        rx: 40,
        ry: 30,
        fill: '#111',
        stroke: 'none',
      },
    ),
    true,
  );

  // Quadratic absolute + relative path stroke marquee
  const quadPath = {
    type: 'path',
    left: 0,
    top: 0,
    fill: 'none',
    stroke: '#000',
    strokeWidth: 4,
    path: [
      ['M', 0, 0],
      ['Q', 20, 40, 40, 0],
      ['q', 10, -20, 20, 0],
    ],
  };
  assert.equal(doesRectIntersectObject({ left: 18, top: 15, right: 22, bottom: 25 }, quadPath), true);

  // text / i-text aliases
  assert.equal(
    isPointOnObject(
      { x: 5, y: 5 },
      { type: 'text', left: 0, top: 0, width: 40, height: 20, text: 'hi', fill: '#000' },
      1,
    ),
    true,
  );
  assert.equal(
    isPointOnObject(
      { x: 5, y: 5 },
      { type: 'i-text', left: 0, top: 0, width: 40, height: 20, text: 'hi', fill: '#000' },
      1,
    ),
    true,
  );

  // Polyline miss past last segment
  assert.equal(
    isPointOnObject(
      { x: 100, y: 100 },
      {
        type: 'polyline',
        left: 0,
        top: 0,
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        stroke: '#000',
        strokeWidth: 2,
      },
      1,
    ),
    false,
  );

  // Line marquee far from the drawn line. The old file expected a hit through
  // a fake getBoundingRect; since ad8291526 ("line marquee geometry") a plain
  // JSON line is hit on its stored endpoints only, so this is a miss.
  assert.equal(
    doesRectIntersectObject(
      { left: 80, top: 80, right: 90, bottom: 90 },
      {
        type: 'line',
        left: 0,
        top: 0,
        x1: 0,
        y1: 0,
        x2: 40,
        y2: 0,
        stroke: '#000',
        strokeWidth: 2,
        getBoundingRect: () => ({ left: 70, top: 70, width: 30, height: 30 }),
      },
    ),
    false,
  );

  // Rotated textbox: selection crosses one edge without containing vertices
  assert.equal(
    doesRectIntersectObject(
      { left: 18, top: -5, right: 22, bottom: 5 },
      {
        type: 'textbox',
        left: 20,
        top: 20,
        width: 40,
        height: 20,
        angle: 45,
        originX: 'center',
        originY: 'center',
        text: 'edge',
      },
    ),
    true,
  );

  // Group child that throws during intersect — skip that child, still check siblings
  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 20, bottom: 20 },
      {
        type: 'group',
        left: 0,
        top: 0,
        _objects: [
          {
            type: 'rect',
            left: 0,
            top: 0,
            width: 10,
            height: 10,
            fill: '#f00',
            calcTransformMatrix() { throw new Error('bad child'); },
          },
          {
            type: 'rect',
            left: 0,
            top: 0,
            width: 30,
            height: 30,
            fill: '#0f0',
          },
        ],
      },
    ),
    true,
  );

  // Bounds fallback when transform matrix is incomplete
  assert.ok(
    getObjectGeometryBounds({
      type: 'rect',
      left: 10,
      top: 10,
      width: 20,
      height: 20,
      calcTransformMatrix: () => [1, 0, 0],
      getBoundingRect: () => ({ left: 10, top: 10, width: 20, height: 20 }),
    }),
  );

  // Bounds catch → fallback when transform throws after type switch entry
  assert.ok(
    getObjectGeometryBounds({
      type: 'circle',
      left: 0,
      top: 0,
      radius: 10,
      get calcTransformMatrix() {
        throw new Error('matrix boom');
      },
      getBoundingRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
    }),
  );
});

test('doesRectIntersectEllipse / polygon / textbox remaining interior and miss paths', () => {
  // Stroke-only ellipse: selection overlaps top of ring
  assert.equal(
    doesRectIntersectObject(
      { left: 48, top: 8, right: 52, bottom: 14 },
      {
        type: 'ellipse',
        left: 50,
        top: 50,
        originX: 'center',
        originY: 'center',
        rx: 40,
        ry: 40,
        fill: 'none',
        stroke: '#111',
        strokeWidth: 6,
      },
    ),
    true,
  );

  // Filled polygon: selection contains a vertex
  assert.equal(
    doesRectIntersectObject(
      { left: -1, top: -1, right: 1, bottom: 1 },
      {
        type: 'polygon',
        left: 0,
        top: 0,
        fill: '#0f0',
        stroke: 'none',
        points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }],
      },
    ),
    true,
  );

  // Filled polygon: edge crosses selection without vertex inside
  assert.equal(
    doesRectIntersectObject(
      { left: 18, top: -2, right: 22, bottom: 2 },
      {
        type: 'polygon',
        left: 0,
        top: 0,
        fill: '#0f0',
        stroke: 'none',
        points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }],
      },
    ),
    true,
  );

  // Wrong type rejected
  assert.equal(
    isPointOnObject({ x: 0, y: 0 }, { type: 'not-text', left: 0, top: 0, width: 10, height: 10 }, 1),
    false,
  );

  // Group with typed child
  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 20, bottom: 20 },
      {
        type: 'group',
        left: 0,
        top: 0,
        _objects: [
          {
            type: 'rect',
            left: 0,
            top: 0,
            width: 30,
            height: 30,
            fill: '#0f0',
          },
        ],
      },
    ),
    true,
  );
});

test('geometryHitTest covers textbox type guard, ellipse interior, and bounds catch', async () => {
  const { isPointOnTextbox, doesRectIntersectEllipse, getObjectGeometryBounds, doesRectIntersectObject } = await import('../src/utils/geometryHitTest.js');

  assert.equal(isPointOnTextbox({ x: 1, y: 1 }, { type: 'rect' }, 2), false);

  // Large filled ellipse: selection fully inside → allCornersInside path
  assert.equal(
    doesRectIntersectEllipse(
      { left: 45, top: 45, right: 55, bottom: 55 },
      50, 50, 40, 40,
      true,
      0,
    ),
    true,
  );

  // getObjectGeometryBounds outer catch → fallback when path geometry throws
  const boom = {
    type: 'path',
    get path() { throw new Error('path-boom'); },
    getBoundingRect() { return { left: 1, top: 2, width: 3, height: 4 }; },
  };
  assert.deepEqual(getObjectGeometryBounds(boom), {
    left: 1, top: 2, right: 4, bottom: 6,
  });

  // Stroke-only ellipse center fill skip (hasFill false, center in rect)
  assert.equal(
    doesRectIntersectObject(
      { left: 48, top: 48, right: 52, bottom: 52 },
      {
        type: 'ellipse',
        left: 50,
        top: 50,
        rx: 30,
        ry: 30,
        fill: 'transparent',
        stroke: '#000',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
      },
    ),
    false,
  );
});

test('isPointOnGroup restores missing type and swallows child hit errors', async () => {
  const { isPointOnGroup } = await import('../src/utils/geometryHitTest.js');
  const child = {};
  Object.defineProperty(child, 'type', { value: 'rect', enumerable: false });
  Object.defineProperty(child, 'left', { value: 0, enumerable: true });
  Object.defineProperty(child, 'top', { value: 0, enumerable: true });
  Object.defineProperty(child, 'width', { value: 20, enumerable: true });
  Object.defineProperty(child, 'height', { value: 20, enumerable: true });
  Object.defineProperty(child, 'fill', { value: '#000', enumerable: true });

  assert.equal(
    isPointOnGroup({ x: 5, y: 5 }, {
      type: 'group',
      left: 0,
      top: 0,
      objects: [child],
    }, 2),
    true,
  );

  // getBoundingRect throws outside containsPoint's inner try → group catch
  const throwing = {
    type: 'unknown-shape',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    getBoundingRect() { throw new Error('child-hit-boom'); },
  };
  assert.equal(
    isPointOnGroup({ x: 1, y: 1 }, {
      type: 'group',
      left: 0,
      top: 0,
      objects: [throwing],
    }, 2),
    false,
  );
});

test('geometryHitTest chips path miss-continue, ellipse center-in-rect, line bounds throw', async () => {
  const {
    doesRectIntersectPath,
    doesRectIntersectEllipse,
    doesRectIntersectLine,
    doesRectIntersectTextbox,
    doesRectIntersectObject,
    getObjectGeometryBounds,
  } = await import('../src/utils/geometryHitTest.js');

  // Relative + absolute L: first segment misses so currentX/Y update, second hits
  assert.equal(
    doesRectIntersectPath(
      { left: 90, top: 90, right: 110, bottom: 110 },
      {
        type: 'path',
        left: 0,
        top: 0,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        path: [
          ['M', 0, 0],
          ['l', 5, 0],
          ['L', 100, 100],
        ],
      },
    ),
    true,
  );

  // Cubic then quadratic: first curves miss selection; later segment hits
  assert.equal(
    doesRectIntersectPath(
      { left: 95, top: 95, right: 105, bottom: 105 },
      {
        type: 'path',
        left: 0,
        top: 0,
        stroke: '#000',
        strokeWidth: 2,
        fill: 'none',
        path: [
          ['M', 0, 0],
          ['C', 1, 0, 2, 0, 3, 0],
          ['c', 1, 0, 2, 0, 3, 0],
          ['Q', 1, 0, 2, 0],
          ['q', 1, 0, 2, 0],
          ['L', 100, 100],
        ],
      },
    ),
    true,
  );

  // Path that never intersects → final return false
  assert.equal(
    doesRectIntersectPath(
      { left: 500, top: 500, right: 510, bottom: 510 },
      {
        type: 'path',
        left: 0,
        top: 0,
        stroke: '#000',
        strokeWidth: 1,
        fill: 'none',
        path: [['M', 0, 0], ['L', 10, 0]],
      },
    ),
    false,
  );

  // Large selection contains small ellipse center; corners lie outside ellipse → center branch
  assert.equal(
    doesRectIntersectEllipse(
      { left: 0, top: 0, right: 100, bottom: 100 },
      50, 50, 8, 8,
      true,
      0,
    ),
    true,
  );

  // Stroke-only: tiny selection on ring between perimeter samples
  assert.equal(
    doesRectIntersectEllipse(
      { left: 89.4, top: 51.4, right: 90.5, bottom: 52.5 },
      50, 50, 40, 40,
      false,
      6,
    ),
    true,
  );

  // Filled: selection outside left tip whose edge enters ellipse
  assert.equal(
    doesRectIntersectEllipse(
      { left: 5, top: 49, right: 15, bottom: 51 },
      50, 50, 40, 40,
      true,
      0,
    ),
    true,
  );

  // Line miss + getBoundingRect throw → catch in fallback
  assert.equal(
    doesRectIntersectLine(
      { left: 200, top: 200, right: 210, bottom: 210 },
      {
        type: 'line',
        left: 0,
        top: 0,
        x1: 0,
        y1: 0,
        x2: 10,
        y2: 0,
        strokeWidth: 1,
        getBoundingRect() { throw new Error('line-bb'); },
      },
    ),
    false,
  );

  assert.equal(
    doesRectIntersectTextbox({ left: 0, top: 0, right: 10, bottom: 10 }, { type: 'rect' }),
    false,
  );

  // Short calcTransformMatrix → getObjectTransformMatrix falls through; geometry bounds still works
  const shortMatrixObj = {
    type: 'rect',
    left: 2,
    top: 3,
    width: 4,
    height: 5,
    fill: '#000',
    calcTransformMatrix() { return [1, 0]; },
    getBoundingRect() { return { left: 2, top: 3, width: 4, height: 5 }; },
  };
  assert.ok(getObjectGeometryBounds(shortMatrixObj));

  assert.equal(
    doesRectIntersectObject(
      { left: 0, top: 0, right: 5, bottom: 5 },
      {
        type: 'polygon',
        left: 0,
        top: 0,
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }],
        fill: 'none',
        stroke: '#000',
        strokeWidth: 2,
      },
    ),
    true,
  );
});


test('group type restore + child intersect throw', async () => {
  const { doesRectIntersectGroup } = await import('../src/utils/geometryHitTest.js');

  const typeless = Object.create(null);
  Object.defineProperty(typeless, 'type', { value: 'rect', enumerable: false });
  Object.assign(typeless, {
    left: 0, top: 0, width: 20, height: 20, fill: '#000',
  });
  assert.equal(
    doesRectIntersectGroup(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { type: 'group', left: 0, top: 0, _objects: [typeless] },
    ),
    true,
  );

  // Unknown type: getBoundingRect throws inside doesRectIntersectObject → catch continue
  const bad = {
    type: 'custom-widget',
    left: 0,
    top: 0,
    getBoundingRect() { throw new Error('bbox-boom'); },
  };
  assert.equal(
    doesRectIntersectGroup(
      { left: 0, top: 0, right: 5, bottom: 5 },
      { type: 'group', left: 0, top: 0, objects: [bad, typeless] },
    ),
    true,
  );
});
