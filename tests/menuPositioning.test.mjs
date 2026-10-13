import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateViewportSafePosition } from '../src/utils/menuPositioning.js';

function withWindow(size, fn) {
  const original = globalThis.window;
  globalThis.window = { innerWidth: size.width, innerHeight: size.height };
  try {
    return fn();
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
}

test('calculateViewportSafePosition keeps in-bounds clicks', () => {
  withWindow({ width: 1000, height: 800 }, () => {
    assert.deepEqual(
      calculateViewportSafePosition(100, 120, { estimatedWidth: 200, estimatedHeight: 100 }),
      { x: 100, y: 120 },
    );
  });
});

test('calculateViewportSafePosition clamps near the right and bottom edges', () => {
  withWindow({ width: 400, height: 300 }, () => {
    const pos = calculateViewportSafePosition(390, 280, {
      estimatedWidth: 200,
      estimatedHeight: 100,
      padding: 10,
      preferAbove: false,
    });
    assert.equal(pos.x, 190); // 400 - 10 - 200
    assert.equal(pos.y, 190); // 300 - 10 - 100
  });
});

test('calculateViewportSafePosition prefers above when overflowing bottom', () => {
  withWindow({ width: 800, height: 400 }, () => {
    const pos = calculateViewportSafePosition(50, 350, {
      estimatedWidth: 100,
      estimatedHeight: 120,
      preferAbove: true,
      padding: 10,
    });
    assert.equal(pos.y, 230); // 350 - 120
  });
});

test('calculateViewportSafePosition honors constraintRect width/height fallbacks', () => {
  withWindow({ width: 1000, height: 800 }, () => {
    const pos = calculateViewportSafePosition(900, 50, {
      estimatedWidth: 200,
      estimatedHeight: 50,
      padding: 5,
      constraintRect: { left: 100, top: 40, width: 300, height: 200 },
    });
    assert.ok(pos.x <= 200); // constrained right = 400, minus width 200
    assert.ok(pos.x >= 100);
    assert.ok(pos.y >= 40);
  });
});

test('calculateViewportSafePosition clamps left/top underflow', () => {
  withWindow({ width: 500, height: 500 }, () => {
    const pos = calculateViewportSafePosition(-20, -30, {
      estimatedWidth: 50,
      estimatedHeight: 50,
      padding: 8,
    });
    assert.equal(pos.x, 8);
    assert.equal(pos.y, 8);
  });
});
