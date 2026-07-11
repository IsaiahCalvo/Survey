import test from 'node:test';
import assert from 'node:assert/strict';

import { booleanErasePath } from '../src/utils/geometryEraser.js';

const identityPath = (path, strokeWidth = 10) => ({
  path,
  strokeWidth,
  pathOffset: { x: 0, y: 0 },
  calcTransformMatrix: () => [1, 0, 0, 1, 0, 0],
});

test('fast eraser movement subtracts the swept space between sparse pointer samples', () => {
  const stroke = identityPath([['M', 0, 0], ['L', 100, 0]]);
  const result = booleanErasePath(stroke, {
    points: [{ x: 50, y: -30 }, { x: 50, y: 30 }],
  }, 6);

  assert.ok(result && !Array.isArray(result));
  const moveCommands = result.pathData.filter((command) => command[0] === 'M');
  assert.equal(moveCommands.length, 2, 'continuous swipe should split the horizontal stroke into two pieces');
});

test('single-point partial erase still behaves as a circular bite', () => {
  const stroke = identityPath([['M', 0, 0], ['L', 100, 0]]);
  const result = booleanErasePath(stroke, { points: [{ x: 50, y: 0 }] }, 6);

  assert.ok(result && !Array.isArray(result));
  assert.equal(result.pathData.filter((command) => command[0] === 'M').length, 2);
});

test('first partial erase preserves the original stroke round caps', () => {
  const stroke = identityPath([['M', 0, 0], ['L', 100, 0]], 10);
  const result = booleanErasePath(stroke, { points: [{ x: 50, y: -7 }] }, 3);

  assert.ok(result && !Array.isArray(result));
  const xs = result.pathData.flatMap((command) => {
    const values = [];
    for (let index = 1; index + 1 < command.length; index += 2) values.push(command[index]);
    return values;
  });
  assert.ok(Math.min(...xs) <= -4.9, 'round start cap must extend by half the stroke width');
  assert.ok(Math.max(...xs) >= 104.9, 'round end cap must extend by half the stroke width');
});
