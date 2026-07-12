import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCalloutConnection,
  findClosestBorderPoint,
  isPointInsideBox,
  isPointOnBorder,
  arePointsStacked,
  distanceToBoxEdge,
  constrainKneePosition,
  MIN_TEXTBOX_TO_ARROW_DISTANCE,
  MIN_SEGMENT_LENGTH,
} from '../src/utils/calloutGeometry.js';

test('helpers classify points relative to a box', () => {
  assert.equal(isPointInsideBox({ x: 5, y: 5 }, 0, 0, 10, 10), true);
  assert.equal(isPointInsideBox({ x: 15, y: 5 }, 0, 0, 10, 10), false);
  assert.equal(isPointOnBorder({ x: 0, y: 5 }, 0, 0, 10, 10), true);
  assert.equal(isPointOnBorder({ x: 5, y: 5 }, 0, 0, 10, 10), false);
  assert.equal(arePointsStacked({ x: 1, y: 1 }, { x: 1.5, y: 1.5 }), true);
  assert.equal(arePointsStacked({ x: 0, y: 0 }, { x: 20, y: 20 }), false);
});

test('findClosestBorderPoint and distanceToBoxEdge', () => {
  assert.deepEqual(findClosestBorderPoint({ x: 5, y: 5 }, 0, 0, 10, 10), { x: 0, y: 5 });
  assert.deepEqual(findClosestBorderPoint({ x: 20, y: 5 }, 0, 0, 10, 10), { x: 10, y: 5 });
  assert.equal(distanceToBoxEdge({ x: 5, y: 5 }, 0, 0, 10, 10), 5);
  assert.ok(distanceToBoxEdge({ x: 20, y: 5 }, 0, 0, 10, 10) > 0);
});

test('constrainKneePosition keeps knee between border and arrow', () => {
  const border = { x: 10, y: 5 };
  const arrow = { x: 80, y: 5 };
  const knee = constrainKneePosition({ x: 40, y: 40 }, arrow, 0, 0, 10, 10, border);
  assert.ok(knee.x > border.x);
  assert.ok(knee.x < arrow.x);
});

test('calculateCalloutConnection snaps line1 to nearest border for external knee', () => {
  const result = calculateCalloutConnection(0, 0, 100, 40, { x: 150, y: 20 }, { x: 200, y: 20 });
  assert.equal(result.line1Start.x, 100);
  assert.equal(result.shouldHideLine1, false);
  assert.ok(result.effectiveKnee.x >= 100);
});

test('calculateCalloutConnection recovers when knee is inside the box', () => {
  const result = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 200, y: 20 },
  );
  assert.ok(result.effectiveKnee.x > 100);
  assert.equal(result.shouldHideLine1, false);
  assert.ok(MIN_TEXTBOX_TO_ARROW_DISTANCE > MIN_SEGMENT_LENGTH);
});

test('calculateCalloutConnection handles missing arrow tip', () => {
  const result = calculateCalloutConnection(10, 10, 50, 20, { x: 80, y: 20 });
  assert.ok(result.line1Start);
  assert.ok(result.effectiveKnee);
});

test('calculateCalloutConnection hides line1 when knee is inside and no arrow', () => {
  const result = calculateCalloutConnection(0, 0, 100, 40, { x: 50, y: 20 });
  assert.equal(result.shouldHideLine1, true);
});

test('calculateCalloutConnection recovers from knee stacked on arrow', () => {
  const tip = { x: 180, y: 20 };
  const result = calculateCalloutConnection(0, 0, 100, 40, tip, tip);
  assert.ok(result.effectiveKnee);
  assert.equal(result.shouldHideLine1, false);
});

test('calculateCalloutConnection handles tight arrow near border', () => {
  // Arrow almost on the right edge while knee is inside → squeeze path.
  const result = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 105, y: 20 },
  );
  assert.ok(result.effectiveKnee.x >= 100);
  assert.ok(result.line1Start);
});

test('calculateCalloutConnection re-routes when knee-to-arrow segment crosses the box', () => {
  // Knee above the box, arrow below — segment pierces the textbox.
  const result = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: -30 },
    { x: 50, y: 80 },
  );
  assert.ok(result.line1Start);
  assert.ok(result.effectiveKnee);
  assert.equal(typeof result.shouldHideLine1, 'boolean');
});

test('calculateCalloutConnection crossing path with arrow near the border', () => {
  // Outside knee with a crossing segment and arrow close to the edge.
  const result = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: -40 },
    { x: 102, y: 20 },
  );
  assert.ok(result.effectiveKnee);
  assert.ok(result.line1Start);
});

test('isPointOnBorder detects vertical edges', () => {
  assert.equal(isPointOnBorder({ x: 10, y: 5 }, 0, 0, 10, 10), true);
  assert.equal(isPointOnBorder({ x: 0, y: 50 }, 0, 0, 10, 10), false);
});

test('findClosestBorderPoint prefers nearest edge for interior points', () => {
  assert.deepEqual(findClosestBorderPoint({ x: 1, y: 5 }, 0, 0, 10, 10), { x: 0, y: 5 });
  assert.deepEqual(findClosestBorderPoint({ x: 9, y: 5 }, 0, 0, 10, 10), { x: 10, y: 5 });
  assert.deepEqual(findClosestBorderPoint({ x: 5, y: 1 }, 0, 0, 10, 10), { x: 5, y: 0 });
  assert.deepEqual(findClosestBorderPoint({ x: 5, y: 9 }, 0, 0, 10, 10), { x: 5, y: 10 });
});

test('constrainKneePosition handles arrow too close to border', () => {
  const border = { x: 10, y: 5 };
  const arrow = { x: 14, y: 5 }; // closer than min segment + knee-to-arrow
  const knee = constrainKneePosition({ x: 12, y: 5 }, arrow, 0, 0, 10, 10, border);
  assert.ok(Number.isFinite(knee.x));
  assert.ok(Number.isFinite(knee.y));
});

test('isPointOnBorder covers top/bottom edges', () => {
  assert.equal(isPointOnBorder({ x: 5, y: 0 }, 0, 0, 10, 10), true);
  assert.equal(isPointOnBorder({ x: 5, y: 10 }, 0, 0, 10, 10), true);
});

test('calculateCalloutConnection pushes knee when arrow sits on the border', () => {
  const result = calculateCalloutConnection(
    0,
    0,
    100,
    40,
    { x: 50, y: 20 },
    { x: 100, y: 20 }, // exactly on right border → distance≈0 branch
  );
  assert.ok(result.effectiveKnee);
  assert.ok(result.line1Start);
  assert.equal(result.shouldHideLine1, false);
});

test('constrainKneePosition moves knee when too close to arrow after border clamp', () => {
  // Place knee nearly on the arrow while border is far enough to allow retreat.
  const border = { x: 0, y: 0 };
  const arrow = { x: 100, y: 0 };
  const knee = constrainKneePosition({ x: 99, y: 0 }, arrow, -10, -10, 10, 10, border);
  assert.ok(knee.x < arrow.x);
});

test('constrainKneePosition final safety moves knee away from arrow and short edge segment', () => {
  // Arrow close enough that clamped knee lands inside MIN_KNEE_TO_ARROW after float clamp.
  const border = { x: 10, y: 5 };
  const arrow = { x: 10 + MIN_SEGMENT_LENGTH + 11, y: 5 }; // ~21px from border
  const nearArrow = constrainKneePosition(
    { x: arrow.x - 0.5, y: 5 },
    arrow,
    0, 0, 10, 10,
    border,
  );
  assert.ok(nearArrow.x < arrow.x);

  // Diagonal: projection min distance along line can still leave Euclidean edge distance short.
  const diagBorder = { x: 10, y: 5 };
  const diagArrow = { x: 80, y: 60 };
  const shortEdge = constrainKneePosition(
    { x: 12, y: 6 },
    diagArrow,
    0, 0, 10, 10,
    diagBorder,
  );
  assert.ok(Number.isFinite(shortEdge.x) && Number.isFinite(shortEdge.y));
});

test('constrainKneePosition retreats when float clamp leaves knee inside arrow clearance', () => {
  // Barely past the early-return threshold so clamp can leave Euclidean dist < MIN_KNEE.
  const border = { x: 0, y: 0 };
  const arrow = { x: MIN_SEGMENT_LENGTH + 11.0000001, y: 0 };
  const knee = constrainKneePosition(
    { x: arrow.x - 1e-9, y: 0 },
    arrow,
    -20, -20, 0, 0,
    border,
  );
  assert.ok(knee.x < arrow.x);
  assert.ok(knee.x >= border.x);
});

test('constrainKneePosition keeps knee at least MIN_KNEE from arrow after clamp', () => {
  const border = { x: 0, y: 0 };
  const arrow = { x: 40, y: 0 };
  const knee = constrainKneePosition({ x: 39, y: 0 }, arrow, -5, -5, 5, 5, border);
  const dist = Math.hypot(arrow.x - knee.x, arrow.y - knee.y);
  assert.ok(dist + 1e-9 >= 11);
});
