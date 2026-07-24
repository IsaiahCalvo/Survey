import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doesRectIntersectObject,
  getCounterHitGeometry,
  isPointOnObject,
} from '../src/utils/geometryHitTest.js';
import { getCounterRenderGeometry } from '../src/utils/counterGeometry.js';

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
