/**
 * Selection handle hit pads — geometry contract.
 *
 * Intended UX: the dot you SEE keeps its size; an invisible pad behind it
 * catches the click. On a mouse the pad is the grabber plus 4 CSS px all round,
 * never under 20 x 20; 44 x 44 on a finger (Apple HIG). The pad is
 * screen-constant, so it must come out the same number of screen pixels at
 * every zoom level.
 *
 * RULED 2026-09-28 (w63, owner-directed): the mouse pad went from 32 to 20.
 * The 32 px pad (Drawboard's 34) reached 16 px out from a corner, so a
 * box-select started just outside a selected mark resized it instead. The
 * expectations below that read 32 off the mouse constant were changed to 20
 * for that reason — deliberately, not to make a failing test pass. Tests that
 * pass their own 32 base pad into the crowding rule are unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDLE_HIT_PAD_COARSE_PX,
  HANDLE_HIT_PAD_FINE_MARGIN_PX,
  HANDLE_HIT_PAD_FINE_PX,
  MARK_HIT_STROKE_COARSE_PX,
  MARK_HIT_STROKE_FINE_PX,
  getHandleHitPadPx,
  getMarkHitStrokePx,
  resolveHandleHitPadPageSize,
  resolveHandleHitPadSize,
} from '../src/utils/handleHitPad.js';

test('a mouse gets a 20px pad and a finger gets 44px', () => {
  assert.equal(HANDLE_HIT_PAD_FINE_PX, 20);
  assert.equal(HANDLE_HIT_PAD_COARSE_PX, 44);
  assert.equal(getHandleHitPadPx(false), 20);
  assert.equal(getHandleHitPadPx(true), 44);
});

test('the transparent stroke along a mark doubles on a coarse pointer', () => {
  assert.equal(MARK_HIT_STROKE_FINE_PX, 12);
  assert.equal(MARK_HIT_STROKE_COARSE_PX, 24);
  assert.equal(getMarkHitStrokePx(false), 12);
  assert.equal(getMarkHitStrokePx(true), 24);
});

test('a roomy shape keeps the full pad', () => {
  assert.equal(resolveHandleHitPadSize({
    basePadPx: 32,
    neighbourSpacingPx: 200,
    minPadPx: 11,
  }), 32);
});

test('crowded handles shrink their pads to the spacing so they tile, not overlap', () => {
  // Two handles 20 px apart: each pad reaches 10 px either side, so they meet
  // exactly and a click always resolves to the nearer handle.
  assert.equal(resolveHandleHitPadSize({
    basePadPx: 32,
    neighbourSpacingPx: 20,
    minPadPx: 11,
  }), 20);
});

test('a pad never shrinks below the grabber the user can see', () => {
  assert.equal(resolveHandleHitPadSize({
    basePadPx: 32,
    neighbourSpacingPx: 3,
    minPadPx: 11,
  }), 11);
});

test('unknown spacing falls back to the full pad', () => {
  assert.equal(resolveHandleHitPadSize({ basePadPx: 44, minPadPx: 11 }), 44);
  assert.equal(resolveHandleHitPadSize({
    basePadPx: 44,
    neighbourSpacingPx: Number.NaN,
    minPadPx: 11,
  }), 44);
  assert.equal(resolveHandleHitPadSize({
    basePadPx: 44,
    neighbourSpacingPx: 0,
    minPadPx: 11,
  }), 44);
});

test('a bad base pad yields nothing to draw', () => {
  assert.equal(resolveHandleHitPadSize({ basePadPx: 0 }), 0);
  assert.equal(resolveHandleHitPadSize({ basePadPx: Number.NaN }), 0);
});

test('the pad is the same size on screen at every zoom', () => {
  // inverseScale is page-units-per-screen-px. 2 = zoomed out to 50 %,
  // 0.5 = zoomed in to 200 %. The page-unit pad must divide back to 20 px.
  for (const inverseScale of [0.25, 0.5, 1, 2, 4]) {
    const pagePad = resolveHandleHitPadPageSize({
      isCoarsePointer: false,
      inverseScale,
      neighbourSpacingPageUnits: 1000 * inverseScale,
      minPadPageUnits: 11 * inverseScale,
    });
    assert.equal(
      Math.round((pagePad / inverseScale) * 1000) / 1000,
      20,
      `pad drifted off 20 screen px at inverseScale ${inverseScale}`,
    );
  }
});

test('the crowding rule is measured in screen px, not page units', () => {
  // A 16-page-unit gap at 200 % zoom (inverseScale 0.5) is 32 SCREEN px, which
  // is roomy — the full (20 px) mouse pad survives. The same 16 page units at 50 % zoom
  // (inverseScale 2) is only 8 screen px, so the pad must shrink to match.
  const zoomedIn = resolveHandleHitPadPageSize({
    isCoarsePointer: false,
    inverseScale: 0.5,
    neighbourSpacingPageUnits: 16,
    minPadPageUnits: 0,
  });
  assert.equal(zoomedIn / 0.5, 20);

  const zoomedOut = resolveHandleHitPadPageSize({
    isCoarsePointer: false,
    inverseScale: 2,
    neighbourSpacingPageUnits: 16,
    minPadPageUnits: 0,
  });
  assert.equal(zoomedOut / 2, 8);
});

test('a finger pad also survives the page-unit round trip', () => {
  const pagePad = resolveHandleHitPadPageSize({
    isCoarsePointer: true,
    inverseScale: 1.5,
    neighbourSpacingPageUnits: 500,
    minPadPageUnits: 11,
  });
  assert.equal(Math.round((pagePad / 1.5) * 1000) / 1000, 44);
});

test('a missing inverse scale is treated as 1, not as a divide by zero', () => {
  assert.equal(resolveHandleHitPadPageSize({
    isCoarsePointer: false,
    inverseScale: 0,
    neighbourSpacingPageUnits: 500,
  }), 20);
  assert.equal(resolveHandleHitPadPageSize({
    isCoarsePointer: false,
    inverseScale: undefined,
    neighbourSpacingPageUnits: 500,
  }), 20);
});

test('w63: a mouse pad reaches only a few px past the grabber you can see', () => {
  // The 11 px corner dot: pad 20, so it reaches 4.5 px past the dot's edge and
  // 10 px from its centre — a box-select started 12 px out misses it.
  for (const inverseScale of [0.5, 1, 2]) {
    const pad = resolveHandleHitPadPageSize({
      isCoarsePointer: false,
      inverseScale,
      minPadPageUnits: 11 * inverseScale,
    }) / inverseScale;
    assert.ok(pad / 2 <= 11 / 2 + HANDLE_HIT_PAD_FINE_MARGIN_PX + 0.5, `pad ${pad} too loose`);
    assert.ok(pad / 2 < 12, `a press 12 px out would still hit the handle (pad ${pad})`);
  }
  // A bigger grabber (the 20 px rotate dot) still gets its 4 px margin.
  assert.equal(resolveHandleHitPadPageSize({
    isCoarsePointer: false,
    inverseScale: 1,
    minPadPageUnits: 20,
  }), 28);
});

test('w63: a finger keeps the full 44 pt pad', () => {
  assert.equal(resolveHandleHitPadPageSize({
    isCoarsePointer: true,
    inverseScale: 1,
    minPadPageUnits: 11,
  }), 44);
  assert.equal(resolveHandleHitPadPageSize({
    isCoarsePointer: true,
    inverseScale: 1,
    minPadPageUnits: 20,
  }), 44);
});
