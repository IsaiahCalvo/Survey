import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filledOutlineCommandsToPolygonSet,
} from '../src/utils/paperAnnotationGeometry.js';

const overlappingRectangles = [
  ['M', 0, 0],
  ['L', 20, 0],
  ['L', 20, 20],
  ['L', 0, 20],
  ['Z'],
  ['M', 10, 0],
  ['L', 30, 0],
  ['L', 30, 20],
  ['L', 10, 20],
  ['Z'],
];

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (
      (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return polygons.some((polygon) => (
    polygon.reduce(
      (inside, ring) => (pointInRing(point, ring) ? !inside : inside),
      false,
    )
  ));
}

test('filled outline clipping geometry respects nonzero versus evenodd overlap', () => {
  const nonzero = filledOutlineCommandsToPolygonSet(overlappingRectangles, {
    fillRule: 'nonzero',
  });
  const evenodd = filledOutlineCommandsToPolygonSet(overlappingRectangles, {
    fillRule: 'evenodd',
  });

  assert.equal(pointInPolygonSet([5, 10], nonzero), true);
  assert.equal(pointInPolygonSet([15, 10], nonzero), true);
  assert.equal(pointInPolygonSet([25, 10], nonzero), true);

  assert.equal(pointInPolygonSet([5, 10], evenodd), true);
  assert.equal(pointInPolygonSet([15, 10], evenodd), false);
  assert.equal(pointInPolygonSet([25, 10], evenodd), true);
});

test('nonzero clipping geometry preserves authored winding for nested counters', () => {
  const outer = [
    ['M', 0, 0],
    ['L', 30, 0],
    ['L', 30, 30],
    ['L', 0, 30],
    ['Z'],
  ];
  const sameDirectionInner = [
    ['M', 10, 10],
    ['L', 20, 10],
    ['L', 20, 20],
    ['L', 10, 20],
    ['Z'],
  ];
  const oppositeDirectionInner = [
    ['M', 10, 10],
    ['L', 10, 20],
    ['L', 20, 20],
    ['L', 20, 10],
    ['Z'],
  ];

  const solid = filledOutlineCommandsToPolygonSet(
    [...outer, ...sameDirectionInner],
    { fillRule: 'nonzero' },
  );
  const counter = filledOutlineCommandsToPolygonSet(
    [...outer, ...oppositeDirectionInner],
    { fillRule: 'nonzero' },
  );
  const evenodd = filledOutlineCommandsToPolygonSet(
    [...outer, ...sameDirectionInner],
    { fillRule: 'evenodd' },
  );

  assert.equal(pointInPolygonSet([15, 15], solid), true);
  assert.equal(pointInPolygonSet([15, 15], counter), false);
  assert.equal(pointInPolygonSet([15, 15], evenodd), false);
});
