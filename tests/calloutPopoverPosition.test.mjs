// Move or copy's card opens beside its button with a tail at the button
// (owner 2026-10-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCalloutPopoverPosition } from '../src/utils/calloutPopoverPosition.js';

const anchor = (left, top, size = 20) => ({ left, top, right: left + size, bottom: top + size, width: size, height: size });
const base = { cardWidth: 200, cardHeight: 180, viewportWidth: 1400, viewportHeight: 900, gap: 10, margin: 8 };

test('opens to the right of the button, centred on it, tail at its middle', () => {
  const spot = computeCalloutPopoverPosition({ ...base, anchorRect: anchor(230, 400) });
  assert.equal(spot.side, 'right');
  assert.equal(spot.left, 260);
  assert.equal(spot.top, 410 - 90);
  assert.equal(spot.tail, 90);
});

test('near the top it slides down to stay inside, and the tail still points at the button', () => {
  const spot = computeCalloutPopoverPosition({ ...base, anchorRect: anchor(230, 50) });
  assert.equal(spot.top, 8);
  assert.equal(spot.tail, 60 - 8);
});

test('the tail stays off the rounded corners', () => {
  const spot = computeCalloutPopoverPosition({ ...base, anchorRect: anchor(230, 0, 10) });
  assert.equal(spot.top, 8);
  assert.equal(spot.tail, 14);
});

test('no room on the right: it opens to the left', () => {
  const spot = computeCalloutPopoverPosition({ ...base, anchorRect: anchor(1300, 400) });
  assert.equal(spot.side, 'left');
  assert.equal(spot.left, 1300 - 10 - 200);
});

test('no room either side: it opens under the button', () => {
  const spot = computeCalloutPopoverPosition({ ...base, viewportWidth: 300, anchorRect: anchor(140, 100) });
  assert.equal(spot.side, 'bottom');
  assert.equal(spot.top, 130);
  assert.equal(spot.left, 50);
  assert.equal(spot.tail, 100);
});
