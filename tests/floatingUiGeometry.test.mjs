import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampFloatingMenuPosition,
  getPageViewportBounds,
  viewportClampDelta,
} from '../src/utils/floatingUiGeometry.js';

test('tooltip correction keeps every edge inside the viewport margin', () => {
  const topRightDelta = viewportClampDelta(
    { left: 1160, top: -4, right: 1319.2, bottom: 22, width: 159.2, height: 26 },
    1280,
    720,
  );
  assert.ok(Math.abs(topRightDelta.x - (-47.2)) < 0.000001);
  assert.equal(topRightDelta.y, 12);

  assert.deepEqual(
    viewportClampDelta(
      { left: -19, top: 706, right: 101, bottom: 732, width: 120, height: 26 },
      1280,
      720,
    ),
    { x: 27, y: -20 },
  );
});

test('page bounds are cut to the viewport and leave room for the desktop right rail', () => {
  assert.deepEqual(
    getPageViewportBounds(
      { left: -320, top: 40, right: 1720, bottom: 1040, width: 2040, height: 1000 },
      1280,
      800,
      48,
    ),
    { left: 0, top: 40, right: 1232, bottom: 800, width: 1232, height: 760 },
  );
});

test('context menu flips and clamps inside the visible part of a zoomed page', () => {
  const bounds = getPageViewportBounds(
    { left: -320, top: 40, right: 1720, bottom: 1040, width: 2040, height: 1000 },
    1280,
    800,
    48,
  );

  assert.deepEqual(
    clampFloatingMenuPosition({ x: 1220, y: 770, width: 160, height: 210, bounds }),
    { left: 1060, top: 560 },
  );
});
