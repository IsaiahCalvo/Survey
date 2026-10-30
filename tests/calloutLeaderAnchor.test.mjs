// Callout leader attach point and segment grabbers (owner 2026-10-26):
// calloutGeometry textBoxAnchor + utils/calloutLeaderGrabbers.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCalloutConnection,
  calloutAnchorSidesForKnee,
  calloutBoxAnchorPoint,
  normalizeCalloutBoxAnchor,
  projectPointToCalloutBoxAnchor,
} from '../src/utils/calloutGeometry.js';
import {
  layoutCalloutLeaderGrabbers,
  leaderGrabberHitRadius,
} from '../src/utils/calloutLeaderGrabbers.js';
import {
  buildPdfCalloutMetadata,
  parsePdfCalloutMetadata,
  serializePdfCalloutMetadata,
} from '../src/utils/pdfCalloutMetadata.js';

// Box 100..200 x 100..150; knee to its left, arrow further left.
const BOX = [100, 100, 100, 50];
const KNEE_LEFT = { x: 60, y: 130 };
const ARROW = { x: 20, y: 170 };

test('without a pin the line meets the box nearest the knee (unchanged)', () => {
  const conn = calculateCalloutConnection(...BOX, KNEE_LEFT, ARROW, 0);
  assert.deepEqual(conn.line1Start, { x: 100, y: 130 });
  const same = calculateCalloutConnection(...BOX, KNEE_LEFT, ARROW, 0, null);
  assert.deepEqual(same, conn);
});

test('a pin on a side the knee is outside of moves where the line meets the box', () => {
  const conn = calculateCalloutConnection(...BOX, KNEE_LEFT, ARROW, 0, { side: 'left', t: 0.2 });
  assert.deepEqual(conn.line1Start, { x: 100, y: 110 });
  assert.deepEqual(conn.effectiveKnee, KNEE_LEFT);
  assert.equal(conn.shouldHideLine1, false);
});

test('a pin on a side the knee is not outside of is ignored (the line would cut the box)', () => {
  const conn = calculateCalloutConnection(...BOX, KNEE_LEFT, ARROW, 0, { side: 'right', t: 0.5 });
  assert.deepEqual(conn.line1Start, { x: 100, y: 130 });
  const top = calculateCalloutConnection(...BOX, KNEE_LEFT, ARROW, 0, { side: 'top', t: 0.5 });
  assert.deepEqual(top.line1Start, { x: 100, y: 130 });
});

test('a knee inside the box keeps the re-routed default, pin or not', () => {
  const inside = { x: 150, y: 125 };
  const auto = calculateCalloutConnection(...BOX, inside, ARROW, 0);
  const pinned = calculateCalloutConnection(...BOX, inside, ARROW, 0, { side: 'left', t: 0 });
  assert.deepEqual(pinned, auto);
});

test('a diagonal knee may pin on either side that faces it', () => {
  assert.deepEqual(calloutAnchorSidesForKnee({ x: 60, y: 60 }, 100, 100, 200, 150).sort(), ['left', 'top']);
  const knee = { x: 60, y: 60 };
  const onTop = calculateCalloutConnection(...BOX, knee, ARROW, 0, { side: 'top', t: 0.5 });
  assert.deepEqual(onTop.line1Start, { x: 150, y: 100 });
});

test('dragging the attach grabber snaps to the nearest allowed side', () => {
  const knee = { x: 60, y: 60 };
  assert.deepEqual(projectPointToCalloutBoxAnchor({ x: 170, y: 80 }, knee, 100, 100, 200, 150), { side: 'top', t: 0.7 });
  assert.deepEqual(projectPointToCalloutBoxAnchor({ x: 90, y: 140 }, knee, 100, 100, 200, 150), { side: 'left', t: 0.8 });
  // Past the end of a side clamps to its corner.
  assert.deepEqual(projectPointToCalloutBoxAnchor({ x: 400, y: 90 }, knee, 100, 100, 200, 150), { side: 'top', t: 1 });
  // The far sides are never offered: the pointer on the right side still
  // lands on an allowed one.
  const far = projectPointToCalloutBoxAnchor({ x: 205, y: 125 }, knee, 100, 100, 200, 150);
  assert.ok(far.side === 'top' || far.side === 'left');
  // Knee inside the box: nowhere to pin.
  assert.equal(projectPointToCalloutBoxAnchor({ x: 90, y: 140 }, { x: 150, y: 120 }, 100, 100, 200, 150), null);
});

test('stored pins are cleaned: unknown sides dropped, t clamped', () => {
  assert.equal(normalizeCalloutBoxAnchor({ side: 'middle', t: 0.5 }), null);
  assert.equal(normalizeCalloutBoxAnchor({ side: 'top', t: 'x' }), null);
  assert.deepEqual(normalizeCalloutBoxAnchor({ side: 'bottom', t: 3 }), { side: 'bottom', t: 1 });
  assert.deepEqual(calloutBoxAnchorPoint({ side: 'bottom', t: 0.25 }, 100, 100, 200, 150), { x: 125, y: 150 });
});

test('the pin rides through PDF export metadata', () => {
  const callout = {
    id: 'c1',
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.1 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.05,
    textBoxAnchor: { side: 'left', t: 0.3 },
  };
  const parsed = parsePdfCalloutMetadata(serializePdfCalloutMetadata(callout, 1));
  assert.deepEqual(parsed.textBoxAnchor, { side: 'left', t: 0.3 });
  const { textBoxAnchor, ...unpinned } = callout;
  assert.equal(textBoxAnchor.side, 'left');
  assert.equal('textBoxAnchor' in buildPdfCalloutMetadata(unpinned, 1), false);
});

// --- grabber layout --------------------------------------------------------

const R = 5.5;
const RS = 4;
const corners = [
  { x: 100, y: 100 }, { x: 150, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 125 },
  { x: 200, y: 150 }, { x: 150, y: 150 }, { x: 100, y: 150 }, { x: 100, y: 125 },
];

test('the attach grabber sits where the line meets the box when that spot is free', () => {
  const knee = { x: 60, y: 137.5 };
  const conn = calculateCalloutConnection(...BOX, knee, { x: 0, y: 260 }, 0);
  const g = layoutCalloutLeaderGrabbers({
    conn, knee, arrowTip: { x: 0, y: 260 }, boxGrabbers: corners, radius: R, secondaryRadius: RS,
  });
  assert.deepEqual(g.attach, { x: 100, y: 137.5 }, 'the box point itself (12.5 from the nearest box grabbers)');
  assert.ok(g.segBox && g.segTip, 'both lines are long enough for a segment grabber');
  assert.deepEqual(g.segBox, { x: 80, y: 137.5 });
  assert.deepEqual(g.segTip, { x: 30, y: 198.75 });
});

test('an attach point on a box grabber steps out along its line until clear', () => {
  const knee = { x: 40, y: 125 };
  const conn = calculateCalloutConnection(...BOX, knee, { x: 0, y: 260 }, 0);
  assert.deepEqual(conn.line1Start, { x: 100, y: 125 }, 'exactly on the left-edge grabber');
  const g = layoutCalloutLeaderGrabbers({
    conn, knee, arrowTip: { x: 0, y: 260 }, boxGrabbers: corners, radius: R, secondaryRadius: RS,
  });
  assert.equal(g.attach.y, 125);
  assert.ok(100 - g.attach.x >= 2 * R - 1e-6, 'clear of the left-edge grabber');
  assert.ok(100 - g.attach.x <= 2 * R + R / 2, 'but no further than it has to');
});

test('a line too short for a grabber clear of its ends shows none', () => {
  const knee = { x: 92, y: 130 };
  const arrow = { x: 84, y: 136 };
  const conn = calculateCalloutConnection(...BOX, knee, arrow, 0);
  const g = layoutCalloutLeaderGrabbers({
    conn, knee, arrowTip: arrow, boxGrabbers: corners, radius: R, secondaryRadius: RS,
  });
  assert.equal(g.segTip, null);
  assert.equal(g.segBox, null);
  assert.equal(g.attach, null, 'no room between the box and the knee');
});

test('a knee the attach cannot move for hides the attach grabber', () => {
  const conn = calculateCalloutConnection(...BOX, KNEE_LEFT, { x: 0, y: 260 }, 0);
  const g = layoutCalloutLeaderGrabbers({
    conn, knee: KNEE_LEFT, arrowTip: { x: 0, y: 260 }, boxGrabbers: corners, radius: R, secondaryRadius: RS, attachMovable: false,
  });
  assert.equal(g.attach, null);
});

test('press pads shrink between close grabbers but never below the dot', () => {
  const at = { x: 0, y: 0 };
  assert.equal(leaderGrabberHitRadius(at, 16, 4, [{ x: 100, y: 0 }]), 16);
  assert.equal(leaderGrabberHitRadius(at, 16, 4, [{ x: 20, y: 0 }]), 10);
  assert.equal(leaderGrabberHitRadius(at, 16, 4, [{ x: 4, y: 0 }]), 4);
});
