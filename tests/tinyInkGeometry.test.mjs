import { cullInkSliverPolygons } from './helpers/legacyInkSliverCull.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eraseAnnotations,
  sweptDiskPolygon,
} from '../src/utils/paperAnnotationGeometry.js';

function pointInRing([x, y], ring) {
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

function pointInPolygonSet(point, polygons) {
  return polygons.some(([outer, ...holes]) => (
    pointInRing(point, outer)
    && !holes.some((hole) => pointInRing(point, hole))
  ));
}

test('tiny swept ink preserves an interior bend instead of joining only its endpoints', () => {
  const geometry = sweptDiskPolygon([
    { x: 0, y: 0 },
    { x: 0.01, y: 0.01 },
    { x: 0.02, y: 0 },
  ], 0.002);

  assert.equal(pointInPolygonSet([0.01, 0.01], geometry), true);
  assert.equal(pointInPolygonSet([0.01, 0], geometry), false);
});

test('sliver cleanup keeps a legitimate sub-0.08 page-unit pen dot', () => {
  const width = 0.02;
  const radius = width / 2;
  const dot = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    dot.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  dot.push([...dot[0]]);

  assert.equal(cullInkSliverPolygons([[dot]], width).length, 1);
});

test('tiny eraser gesture preserves its bend when selecting touched ink', () => {
  const tinyFilledMark = {
    id: 'tiny-filled-mark',
    type: 'ink',
    cmds: [
      ['M', 0.009, 0.009],
      ['L', 0.011, 0.009],
      ['L', 0.011, 0.011],
      ['L', 0.009, 0.011],
      ['Z'],
    ],
    fill: '#f00',
    stroke: null,
    strokeWidth: 0,
    sourceWidth: 0.002,
    bounds: { x: 0.009, y: 0.009, w: 0.002, h: 0.002 },
  };

  const result = eraseAnnotations(
    [tinyFilledMark],
    [
      { x: 0, y: 0 },
      { x: 0.01, y: 0.01 },
      { x: 0.02, y: 0 },
    ],
    0.002,
    'full',
  );

  assert.deepEqual(result.deletedIds, ['tiny-filled-mark']);
  assert.equal(result.annotations.length, 0);
});

test('partial erase keeps healthy pieces of a sub-0.08 page-unit filled stroke', () => {
  const tinyStroke = {
    id: 'tiny-partial-stroke',
    type: 'ink',
    cmds: [
      ['M', 0, -0.01],
      ['L', 0.2, -0.01],
      ['L', 0.2, 0.01],
      ['L', 0, 0.01],
      ['Z'],
    ],
    fill: '#f00',
    stroke: null,
    strokeWidth: 0,
    sourceWidth: 0.02,
    bounds: { x: 0, y: -0.01, w: 0.2, h: 0.02 },
  };

  const result = eraseAnnotations(
    [tinyStroke],
    [{ x: 0.1, y: -0.03 }, { x: 0.1, y: 0.03 }],
    0.01,
    'partial',
  );

  assert.deepEqual(result.changedIds, ['tiny-partial-stroke']);
  assert.equal(result.annotations.length, 1);
  assert.equal(pointInPolygonSet([0.02, 0], result.annotations[0].polygons), true);
  assert.equal(pointInPolygonSet([0.1, 0], result.annotations[0].polygons), false);
  assert.equal(pointInPolygonSet([0.18, 0], result.annotations[0].polygons), true);
});

test('unknown-width imported outline is never culled using an invented 1-unit pen width', () => {
  const importedOutline = {
    id: 'unknown-width-imported-outline',
    type: 'ink',
    cmds: [
      ['M', 0, -0.01],
      ['L', 0.2, -0.01],
      ['L', 0.2, 0.01],
      ['L', 0, 0.01],
      ['Z'],
    ],
    fill: '#f00',
    stroke: null,
    strokeWidth: 0,
    bounds: { x: 0, y: -0.01, w: 0.2, h: 0.02 },
  };

  const result = eraseAnnotations(
    [importedOutline],
    [{ x: 0.1, y: -0.03 }, { x: 0.1, y: 0.03 }],
    0.01,
    'partial',
  );

  assert.equal(result.annotations.length, 1);
  assert.equal(pointInPolygonSet([0.02, 0], result.annotations[0].polygons), true);
  assert.equal(pointInPolygonSet([0.1, 0], result.annotations[0].polygons), false);
  assert.equal(pointInPolygonSet([0.18, 0], result.annotations[0].polygons), true);
});
