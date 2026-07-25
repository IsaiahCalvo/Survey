import assert from 'node:assert/strict';
import test from 'node:test';

import {
  erasePathWithCapsules,
  segPoint,
  segmentCircleInterval,
} from '../src/utils/paperInkEraser.js';

test('a microscopic distant eraser cannot delete a small diagonal stroke', () => {
  const pathData = [
    ['M', 0, 0],
    ['L', 1e-5, 1e-5],
  ];
  const distantPoint = { x: 1e-5, y: 0 };

  const result = erasePathWithCapsules(
    pathData,
    [{ a: distantPoint, b: distantPoint }],
    1e-12,
    0,
  );

  assert.equal(result.changed, false);
  assert.strictEqual(result.pathData, pathData);
});

test('a circle centered on a 1e150 diagonal finds its midpoint interval', () => {
  const interval = segmentCircleInterval(
    { x: 0, y: 0 },
    { x: 1e150, y: 1e150 },
    { x: 5e149, y: 5e149 },
    1e140,
  );

  assert.ok(interval, 'the normalized quadratic must not become NaN');
  assert.ok(interval[0] < 0.5);
  assert.ok(interval[1] > 0.5);
});

test('a tiny eraser hits an authored quadratic between the old 64 chords', () => {
  const quadratic = {
    kind: 'Q',
    p0: { x: 0, y: 0 },
    c: { x: 500, y: 1000 },
    p1: { x: 1000, y: 0 },
  };
  const hitPoint = segPoint(quadratic, 32.5 / 64);
  const pathData = [
    ['M', quadratic.p0.x, quadratic.p0.y],
    ['Q', quadratic.c.x, quadratic.c.y, quadratic.p1.x, quadratic.p1.y],
  ];

  const result = erasePathWithCapsules(
    pathData,
    [{ a: hitPoint, b: hitPoint }],
    1e-6,
    0,
  );

  assert.equal(result.changed, true);
  assert.ok(result.pathData.length > 0, 'a point-sized bite must not full-delete the curve');
  assert.ok(
    result.pathData.some((command) => command[0] === 'Q'),
    'survivors must remain exact authored quadratics',
  );
});

test('line and quadratic hits are scale invariant across 240 orders of magnitude', () => {
  for (const scale of [1e-120, 1e-60, 1e-12, 1, 1e12, 1e60, 1e120]) {
    const lineInterval = segmentCircleInterval(
      { x: 0, y: 0 },
      { x: 10 * scale, y: 10 * scale },
      { x: 5 * scale, y: 5 * scale },
      scale,
    );
    assert.ok(lineInterval, `line hit was lost at scale ${scale}`);

    const quadratic = {
      kind: 'Q',
      p0: { x: 0, y: 0 },
      c: { x: 500 * scale, y: 1000 * scale },
      p1: { x: 1000 * scale, y: 0 },
    };
    const hitPoint = segPoint(quadratic, 0.513271828);
    const result = erasePathWithCapsules(
      [
        ['M', 0, 0],
        ['Q', quadratic.c.x, quadratic.c.y, quadratic.p1.x, quadratic.p1.y],
      ],
      [{ a: hitPoint, b: hitPoint }],
      1e-6 * scale,
      0,
    );

    assert.equal(result.changed, true, `curve hit was lost at scale ${scale}`);
    assert.ok(
      result.pathData.some((command) => command[0] === 'Q'),
      `quadratic topology was lost at scale ${scale}`,
    );
  }
});

test('a near-miss outside a quadratic cannot become a flat-chord false bite', () => {
  const pathData = [
    ['M', -10, 0],
    ['Q', 0, 20, 10, 0],
  ];
  const nearMiss = { x: -9, y: -0.32 };

  const result = erasePathWithCapsules(
    pathData,
    [{ a: nearMiss, b: nearMiss }],
    1,
    0,
  );

  assert.equal(result.changed, false);
  assert.strictEqual(result.pathData, pathData);
});

test('separate tiny bites on a huge line preserve all three authored survivors', () => {
  const pathData = [
    ['M', 0, 0],
    ['L', 1e7, 0],
  ];

  const result = erasePathWithCapsules(
    pathData,
    [
      { a: { x: 1000, y: 0 }, b: { x: 1000, y: 0 } },
      { a: { x: 2000, y: 0 }, b: { x: 2000, y: 0 } },
    ],
    1,
    0,
  );

  assert.equal(result.changed, true);
  assert.deepEqual(
    result.pathData.map((command) => [command[0], ...command.slice(1).map((value) => Math.round(value))]),
    [
      ['M', 0, 0],
      ['L', 999, 0],
      ['M', 1001, 0],
      ['L', 1999, 0],
      ['M', 2001, 0],
      ['L', 10000000, 0],
    ],
  );
});

test('quadratic bite boundaries never remove authored curve outside the eraser', () => {
  const center = { x: 0, y: 900 };
  const radius = 100;
  const result = erasePathWithCapsules(
    [
      ['M', -1000, 0],
      ['Q', 0, 2000, 1000, 0],
    ],
    [{ a: center, b: center }],
    radius,
    0,
  );

  assert.equal(result.changed, true);
  assert.equal(result.pathData.filter((command) => command[0] === 'Q').length, 2);
  const firstSurvivorEnd = result.pathData.find((command) => command[0] === 'Q').slice(-2);
  const secondSurvivorStart = result.pathData
    .filter((command) => command[0] === 'M')
    .at(-1)
    .slice(1);

  for (const [x, y] of [firstSurvivorEnd, secondSurvivorStart]) {
    const boundaryDistance = Math.hypot(x - center.x, y - center.y);
    assert.ok(
      boundaryDistance <= radius + 1e-7,
      `untouched curve was removed outside the eraser by ${boundaryDistance - radius}`,
    );
    assert.ok(
      boundaryDistance >= radius - 0.1,
      `boundary refinement under-erased by ${radius - boundaryDistance}`,
    );
  }
});
