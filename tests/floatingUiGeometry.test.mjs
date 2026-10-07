import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampFloatingMenuPosition,
  fitMenuInBand,
  getPageViewportBounds,
  placeAnchoredMenu,
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

// Owner 2026-10-01: the Pages panel page menu opens beside the thumbnail it acts
// on, inside the band between the top bar and the dock, and scrolls when taller.
const phoneBand = { left: 0, top: 34, right: 390, bottom: 797 };
const coverOf = (pos, w, h, r) => Math.max(0, Math.min(pos.left + w, r.right) - Math.max(pos.left, r.left))
  * Math.max(0, Math.min(pos.top + h, r.bottom) - Math.max(pos.top, r.top));

test('page menu opens beside a left-column thumbnail without covering it', () => {
  const card = { left: 16, top: 448, right: 189, bottom: 669 };
  const anchor = { left: 153, top: 633, right: 183, bottom: 663 };
  const pos = placeAnchoredMenu({ anchor, avoid: card, width: 188, height: 407, bounds: phoneBand });
  assert.deepEqual(pos, { left: 194, top: 256, maxHeight: null });
  assert.equal(coverOf(pos, 188, 407, card), 0);
});

test('page menu opens to the left of a right-column thumbnail', () => {
  const card = { left: 201, top: 448, right: 374, bottom: 669 };
  const anchor = { left: 338, top: 633, right: 368, bottom: 663 };
  const pos = placeAnchoredMenu({ anchor, avoid: card, width: 188, height: 407, bounds: phoneBand });
  assert.deepEqual(pos, { left: 8, top: 256, maxHeight: null });
  assert.equal(coverOf(pos, 188, 407, card), 0);
});

test('page menu stays above the dock and below the top bar, and scrolls when taller', () => {
  const lowCard = { left: 16, top: 600, right: 189, bottom: 821 };
  const lowAnchor = { left: 153, top: 785, right: 183, bottom: 815 };
  const low = placeAnchoredMenu({ anchor: lowAnchor, avoid: lowCard, width: 188, height: 407, bounds: phoneBand });
  assert.equal(low.top + 407 <= 797 - 8, true);
  const tall = placeAnchoredMenu({ anchor: lowAnchor, avoid: lowCard, width: 188, height: 900, bounds: phoneBand });
  assert.deepEqual(tall, { left: 194, top: 42, maxHeight: 747 });
});

test('on a 375px phone the menu covers only a sliver of the thumbnail', () => {
  const card = { left: 16, top: 271, right: 182, bottom: 482 };
  const anchor = { left: 146, top: 446, right: 176, bottom: 476 };
  const pos = placeAnchoredMenu({ anchor, avoid: card, width: 188, height: 407, bounds: { left: 0, top: 34, right: 375, bottom: 620 } });
  assert.equal(pos.left, 179);
  assert.ok(coverOf(pos, 188, 407, card) <= 3 * 211);
});

test('a right-click menu opens at the pointer and flips at the window edges', () => {
  const bounds = { left: 0, top: 0, right: 1400, bottom: 900 };
  assert.deepEqual(placeAnchoredMenu({ anchor: { left: 200, top: 300 }, width: 180, height: 307, bounds }), { left: 200, top: 300, maxHeight: null });
  assert.deepEqual(placeAnchoredMenu({ anchor: { left: 1350, top: 880 }, width: 180, height: 307, bounds }), { left: 1170, top: 573, maxHeight: null });
});

// Polish round 6: measured on a 375x667 phone — the ten-row mark menu (496px)
// opened at top 134 and ran to 630, 25px over the dock (top 605).
test('phone mark menu is pushed above the dock, and scrolls when taller than the band', () => {
  const band = { top: 34, bottom: 605 };
  const fit = fitMenuInBand({ top: 134, height: 496, band });
  assert.equal(fit.maxHeight, null);
  assert.ok(fit.top + 496 <= band.bottom - 8, `bottom ${fit.top + 496} clears the dock`);
  assert.ok(fit.top >= band.top + 8);

  const tall = fitMenuInBand({ top: 200, height: 700, band });
  assert.equal(tall.top, band.top + 8);
  assert.equal(tall.maxHeight, band.bottom - band.top - 16);

  const roomy = fitMenuInBand({ top: 120, height: 200, band });
  assert.deepEqual(roomy, { top: 120, maxHeight: null });
});
