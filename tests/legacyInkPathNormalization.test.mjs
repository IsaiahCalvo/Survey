import test from 'node:test';
import assert from 'node:assert/strict';

import {
  erasePageAnnotations,
  normalizeFabricPath,
} from '../src/utils/pageSpaceEraser.js';

test('legacy smooth cubic and quadratic commands preserve their reflected controls', () => {
  assert.deepEqual(
    normalizeFabricPath([
      ['M', 0, 0],
      ['C', 10, 0, 20, 10, 30, 10],
      ['S', 50, 20, 60, 0],
      ['Q', 70, -10, 80, 0],
      ['T', 100, 0],
    ]),
    [
      ['M', 0, 0],
      ['C', 10, 0, 20, 10, 30, 10],
      ['C', 40, 10, 50, 20, 60, 0],
      ['Q', 70, -10, 80, 0],
      ['Q', 90, 10, 100, 0],
    ],
  );
});

test('legacy relative commands normalize to the same absolute geometry', () => {
  assert.deepEqual(
    normalizeFabricPath([
      ['m', 10, 10],
      ['l', 20, 0],
      ['q', 10, 10, 20, 0],
      ['c', 5, -5, 15, -5, 20, 0],
    ]),
    [
      ['M', 10, 10],
      ['L', 30, 10],
      ['Q', 40, 20, 50, 10],
      ['C', 55, 5, 65, 5, 70, 10],
    ],
  );
});

test('legacy SVG arc normalizes to curves and erases on the arc, not its invisible chord', () => {
  const path = [
    ['M', 0, 0],
    ['A', 50, 50, 0, 0, 1, 100, 0],
  ];
  const normalized = normalizeFabricPath(path);
  assert.equal(normalized[0][0], 'M');
  assert.ok(normalized.slice(1).every((command) => command[0] === 'C'));
  assert.deepEqual(normalized.at(-1).slice(-2), [100, 0]);

  const annotation = {
    type: 'path',
    id: 'legacy-arc',
    tool: 'pen',
    path,
    left: 0,
    top: 0,
    stroke: '#111111',
    strokeWidth: 10,
    fill: null,
  };
  const chord = erasePageAnnotations({
    pageAnnotations: { objects: [annotation] },
    eraserPoints: [{ x: 50, y: 0 }],
    eraserRadius: 3,
    mode: 'partial',
  });
  const upperArc = erasePageAnnotations({
    pageAnnotations: { objects: [annotation] },
    eraserPoints: [{ x: 50, y: -50 }],
    eraserRadius: 3,
    mode: 'partial',
  });
  const lowerArc = erasePageAnnotations({
    pageAnnotations: { objects: [annotation] },
    eraserPoints: [{ x: 50, y: 50 }],
    eraserRadius: 3,
    mode: 'partial',
  });

  assert.equal(chord.didChange, false);
  assert.equal(
    upperArc.didChange || lowerArc.didChange,
    true,
    'one sweep orientation must hit the authored semicircle',
  );
});

test('microscopic legacy SVG arcs remain curves instead of collapsing to a line', () => {
  const scale = 1e-15;
  const unitArc = normalizeFabricPath([
    ['M', 0, 0],
    ['A', 1, 1, 0, 0, 1, 2, 0],
  ]);
  const tinyArc = normalizeFabricPath([
    ['M', 0, 0],
    ['A', scale, scale, 0, 0, 1, 2 * scale, 0],
  ]);

  assert.equal(tinyArc.length, unitArc.length);
  assert.ok(tinyArc.slice(1).every((command) => command[0] === 'C'));
  assert.deepEqual(tinyArc.at(-1).slice(-2), [2 * scale, 0]);
  for (let commandIndex = 1; commandIndex < tinyArc.length; commandIndex += 1) {
    for (let valueIndex = 1; valueIndex < tinyArc[commandIndex].length; valueIndex += 1) {
      const scaledValue = tinyArc[commandIndex][valueIndex] / scale;
      assert.ok(Number.isFinite(scaledValue));
      assert.ok(
        Math.abs(scaledValue - unitArc[commandIndex][valueIndex]) <= 1e-12,
        `coordinate ${commandIndex}:${valueIndex} must preserve the unit arc shape`,
      );
    }
  }
});

test('huge legacy SVG arcs avoid squared-coordinate overflow', () => {
  const scale = 1e154;
  const hugeArc = normalizeFabricPath([
    ['M', 0, 0],
    ['A', scale, scale, 0, 0, 1, 2 * scale, 0],
  ]);

  assert.ok(hugeArc.length > 1);
  assert.ok(hugeArc.slice(1).every((command) => command[0] === 'C'));
  assert.deepEqual(hugeArc.at(-1).slice(-2), [2 * scale, 0]);
  assert.ok(
    hugeArc.flatMap((command) => command.slice(1)).every(Number.isFinite),
    'all emitted control and endpoint coordinates stay finite',
  );
});

test('same-sign huge arc coordinates avoid midpoint-sum overflow', () => {
  const hugeArc = normalizeFabricPath([
    ['M', 1e308, 1e308],
    ['A', 1e307, 1e307, 0, 0, 1, 1.1e308, 1e308],
  ]);

  assert.ok(hugeArc.length > 1);
  assert.deepEqual(hugeArc.at(-1).slice(-2), [1.1e308, 1e308]);
  assert.ok(
    hugeArc.flatMap((command) => command.slice(1)).every(Number.isFinite),
    'representable source arcs never emit infinite controls',
  );
});

test('SVG radii correction keeps tiny and subnormal authored radii finite', () => {
  for (const radius of [1e-160, Number.MIN_VALUE]) {
    const corrected = normalizeFabricPath([
      ['M', 0, 0],
      ['A', radius, radius, 0, 0, 1, 2, 0],
    ]);
    assert.ok(corrected.length > 1, `radius ${radius} remains an arc`);
    assert.ok(corrected.slice(1).every((command) => command[0] === 'C'));
    assert.deepEqual(corrected.at(-1).slice(-2), [2, 0]);
    assert.ok(
      corrected.flatMap((command) => command.slice(1)).every(Number.isFinite),
      `radius ${radius} emits only finite corrected controls`,
    );
  }
});

test('subnormal radii correct against a near-maximum finite endpoint without collapsing', () => {
  const corrected = normalizeFabricPath([
    ['M', 0, 0],
    ['A', Number.MIN_VALUE, Number.MIN_VALUE, 0, 0, 1, 1e308, 0],
  ]);

  assert.ok(corrected.length > 1);
  assert.ok(corrected.slice(1).every((command) => command[0] === 'C'));
  assert.deepEqual(corrected.at(-1).slice(-2), [1e308, 0]);
  assert.ok(corrected.flatMap((command) => command.slice(1)).every(Number.isFinite));
  assert.ok(
    corrected.slice(1).some((command) => command[2] !== 0 || command[4] !== 0),
    'the corrected arc retains curvature instead of falling back to its chord',
  );
});

test('extreme rotated aspect-ratio radii remain a finite curved arc', () => {
  const corrected = normalizeFabricPath([
    ['M', 0, 0],
    ['A', 1e-200, 1e-10, 33, 0, 1, 1, 1 / 3],
  ]);

  assert.ok(corrected.length > 1);
  assert.ok(corrected.slice(1).every((command) => command[0] === 'C'));
  assert.deepEqual(corrected.at(-1).slice(-2), [1, 1 / 3]);
  assert.ok(corrected.flatMap((command) => command.slice(1)).every(Number.isFinite));
  assert.ok(
    corrected.slice(1).some((command) => (
      command[2] !== command[6] / 3
      || command[4] !== command[6] * 2 / 3
    )),
    'the curve controls are not a straight-line substitute',
  );
});
