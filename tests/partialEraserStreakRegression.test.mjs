import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/partial-eraser-streak.json', import.meta.url),
  'utf8',
));

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
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

function pointInRenderedInk(point, polygons) {
  return (polygons || []).reduce((inside, polygon) => (
    polygon.reduce(
      (ringInside, ring) => (pointInRing(point, ring) ? !ringInside : ringInside),
      inside,
    )
  ), false);
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, (
        (point.x - a.x) * dx + (point.y - a.y) * dy
      ) / lengthSquared))
    : 0;
  return Math.hypot(
    point.x - a.x - t * dx,
    point.y - a.y - t * dy,
  );
}

function pointInTrueEraserSweep(point) {
  return fixture.points.some((end, index) => (
    distanceToSegment(
      point,
      fixture.points[Math.max(0, index - 1)],
      end,
    ) <= fixture.radius
  ));
}

test('recorded curved gesture neither paints nor removes a streak', () => {
  const object = {
    type: 'path',
    id: 'harness-pen',
    fill: '#e11d48',
    sourceWidth: 40,
    paperInkGeometry: 'v1',
    polygons: fixture.beforePolygons,
    data: { id: 'harness-pen', tool: 'pen', authorId: 'owner' },
    meta: { authorId: 'owner' },
  };
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [object] },
    eraserPoints: fixture.points,
    eraserRadius: fixture.radius,
    mode: 'partial',
  });
  const survivor = result.pageAnnotations.objects[0];
  const formerStreakPoints = [
    [504.25, 125.75],
    [525.5, 126.75],
    [529.75, 129],
    [488.5, 131.25],
    [532.75, 131.25],
    [534, 132.25],
    [547, 145],
    [550.25, 149.75],
    [518, 150.25],
    [523.5, 155.25],
    [554.25, 157.75],
  ];
  const untouchedControlPoints = [
    [550, 140],
    [545, 140],
  ];

  for (const [x, y] of formerStreakPoints) {
    const point = { x, y };
    assert.equal(pointInTrueEraserSweep(point), true);
    assert.equal(
      pointInRenderedInk(point, survivor.polygons),
      false,
      `ink remained inside the cursor at ${x},${y}`,
    );
  }
  for (const [x, y] of untouchedControlPoints) {
    const point = { x, y };
    assert.equal(pointInTrueEraserSweep(point), false);
    assert.equal(pointInRenderedInk(point, fixture.beforePolygons), true);
    assert.equal(
      pointInRenderedInk(point, survivor.polygons),
      true,
      `untouched ink was removed at ${x},${y}`,
    );
  }
});
