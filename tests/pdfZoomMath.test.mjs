import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getClampedZoomTranslation,
  getDocumentMinimumScale,
  getWheelZoomScale,
  WHEEL_NOTCH_STEP_FACTOR,
} from '../src/utils/pdfZoomMath.js';

// 2026-09-16: the notch rate moved from 1.1 to 1.3 per notch to match
// Drawboard (see WHEEL_NOTCH_STEP_FACTOR). Every assertion below that used to
// hard-code 1.1 now derives from the exported constant instead, so the
// invariants they guard — chunk independence, reverse symmetry, which regime an
// event lands in, the per-event cap — keep testing exactly what they did.
const NOTCH_RATE = Math.log(WHEEL_NOTCH_STEP_FACTOR) / 100;

test('small trackpad ticks match Drawboard and reverse symmetrically', () => {
  const zoomedIn = getWheelZoomScale(0.74, {
    deltaY: -8,
    deltaMode: 0,
    viewportHeight: 643,
    minimumScale: 0.01,
  });
  const zoomedBackOut = getWheelZoomScale(zoomedIn, {
    deltaY: 8,
    deltaMode: 0,
    viewportHeight: 643,
    minimumScale: 0.01,
  });

  assert.ok(zoomedIn > 0.756 && zoomedIn < 0.759, "expected Drawboard's measured small-tick speed");
  assert.ok(Math.abs(zoomedBackOut - 0.74) < 1e-9, `expected a reversible step, got ${zoomedBackOut}`);
});

test('one full mouse-wheel notch moves a Drawboard-sized step', () => {
  const zoomedOut = getWheelZoomScale(0.76, {
    deltaY: 100,
    deltaMode: 0,
    minimumScale: 0.01,
  });

  assert.ok(
    Math.abs(zoomedOut - 0.76 / WHEEL_NOTCH_STEP_FACTOR) < 1e-12,
    `expected one notch to divide by ${WHEEL_NOTCH_STEP_FACTOR}, got ${zoomedOut}`,
  );
});

test('a single notch takes 100% to 130% and back, and is never clipped', () => {
  // The live viewer passes maximumDelta: 1000, so one notch is never capped —
  // whether the browser reports the notch as 100px (spec) or 120px (Chrome).
  const inOneNotch = getWheelZoomScale(1, { deltaY: -100, maximumDelta: 1000 });
  assert.ok(Math.abs(inOneNotch - WHEEL_NOTCH_STEP_FACTOR) < 1e-12, `got ${inOneNotch}`);
  assert.ok(Math.abs(inOneNotch - 1.3) < 1e-12, 'one notch must land on 130%');

  const backOut = getWheelZoomScale(inOneNotch, { deltaY: 100, maximumDelta: 1000 });
  assert.ok(Math.abs(backOut - 1) < 1e-12, `expected a reversible notch, got ${backOut}`);

  const chromeNotch = getWheelZoomScale(1, { deltaY: -120, maximumDelta: 1000 });
  assert.ok(
    Math.abs(chromeNotch - Math.pow(WHEEL_NOTCH_STEP_FACTOR, 1.2)) < 1e-12,
    `a 120px notch must not be clipped, got ${chromeNotch}`,
  );
});

test('a trackpad pinch stream keeps its own gentle rate, unchanged by the notch rate', () => {
  // Small pixel deltas (< 50px, pixel mode) are a pinch, not a wheel detent:
  // they must still move at the measured Drawboard trackpad rate of 0.0029/px.
  for (const delta of [4, 8, 16, 32, 49]) {
    const pinched = getWheelZoomScale(1, { deltaY: -delta, deltaMode: 0 });
    assert.ok(
      Math.abs(pinched - Math.exp(delta * 0.0029)) < 1e-12,
      `a ${delta}px pinch tick must keep the trackpad rate, got ${pinched}`,
    );
    assert.ok(pinched < 1.16, 'a pinch tick must stay far below a wheel notch');
  }
  // Twelve 8px ticks are Drawboard's measured 74% -> 97% pinch travel.
  let scale = 0.74;
  for (let i = 0; i < 12; i += 1) scale = getWheelZoomScale(scale, { deltaY: -8, deltaMode: 0 });
  assert.ok(scale > 0.96 && scale < 0.98, `expected Drawboard's pinch travel, got ${scale}`);
});

test('one event cannot collapse zoom even when a device reports an enormous delta', () => {
  const oneNotch = getWheelZoomScale(0.76, { deltaY: 100, minimumScale: 0.01 });
  const enormousDelta = getWheelZoomScale(0.76, { deltaY: 10_000, minimumScale: 0.01 });

  assert.equal(enormousDelta, oneNotch);
  assert.ok(Math.abs(enormousDelta - 0.76 / WHEEL_NOTCH_STEP_FACTOR) < 1e-12);
});

test('line and page wheel deltas normalize without bypassing the per-event cap', () => {
  const lineMode = getWheelZoomScale(1, { deltaY: 10, deltaMode: 1, minimumScale: 0.01 });
  const pageMode = getWheelZoomScale(1, {
    deltaY: 1,
    deltaMode: 2,
    viewportHeight: 643,
    minimumScale: 0.01,
  });
  const cappedPixelMode = getWheelZoomScale(1, { deltaY: 100, minimumScale: 0.01 });

  assert.equal(lineMode, cappedPixelMode);
  assert.equal(pageMode, cappedPixelMode);
});

test('single-page minimum keeps one page-gap above and below the page', () => {
  const minimumScale = getDocumentMinimumScale({
    viewportHeight: 643,
    pageHeights: [792],
    pageGap: 16,
  });

  assert.ok(Math.abs(minimumScale - 0.7803398058252428) < 1e-12);
});

test('narrow mobile viewport uses width as the limiting zoom-out floor', () => {
  const minimumScale = getDocumentMinimumScale({
    viewportHeight: 643,
    pageHeights: [792],
    pageGap: 16,
    viewportWidth: 346,
    pageWidths: [612],
  });

  assert.ok(Math.abs(minimumScale - (346 / 612)) < 1e-12);
});

test('multi-page minimum includes fixed insets and one outer gap per edge', () => {
  const minimumScale = getDocumentMinimumScale({
    viewportHeight: 900,
    pageHeights: [792, 792, 792],
    pageGap: 16,
    fixedTopInset: 20,
    fixedBottomInset: 20,
  });

  assert.ok(Math.abs(minimumScale - 0.3524590163934426) < 1e-12);
});

test('document minimum never drops below the absolute safety floor', () => {
  const minimumScale = getDocumentMinimumScale({
    viewportHeight: 1,
    pageHeights: [792],
    pageGap: 16,
  });

  assert.equal(minimumScale, 0.01);
});

test('zoom preview centers an axis as soon as its projected content fits', () => {
  const overflowingTranslation = getClampedZoomTranslation({
    zoomFactor: 0.84,
    anchor: 1000,
    contentStart: 0,
    contentEnd: 1200,
    viewportStart: 0,
    viewportSize: 1000,
  });
  const fittingTranslation = getClampedZoomTranslation({
    zoomFactor: 0.8,
    anchor: 1000,
    contentStart: 0,
    contentEnd: 1200,
    viewportStart: 0,
    viewportSize: 1000,
  });

  assert.equal(overflowingTranslation, 0);
  assert.equal(fittingTranslation, 20);
});


test('trackpad travel is chunk-independent within the pixel-mode regime', () => {
  for (const chunk of [4, 8, 16, 24, 48, 96, 192]) {
    let scale = 0.74;
    for (let travel = 0; travel < 192; travel += chunk) {
      scale = getWheelZoomScale(scale, { deltaY: -chunk, regime: 'trackpad', maximumDelta: 1000 });
    }
    assert.ok(Math.abs(scale - 0.74 * Math.exp(0.0029 * 192)) < 1e-12);
    for (let travel = 0; travel < 192; travel += chunk) {
      scale = getWheelZoomScale(scale, { deltaY: chunk, regime: 'trackpad', maximumDelta: 1000 });
    }
    assert.ok(Math.abs(scale - 0.74) < 1e-12);
  }
});

test('each event selects its rate by normalized delta and mode before capping', () => {
  for (const direction of [-1, 1]) {
    for (const [deltaY, deltaMode, viewportHeight, exponent] of [
      [49, 0, 800, 49 * 0.0029],
      [50, 0, 800, 0.5 * Math.log(WHEEL_NOTCH_STEP_FACTOR)],
      [0.5, 1, 800, 0.08 * Math.log(WHEEL_NOTCH_STEP_FACTOR)],
      [0.01, 2, 800, 0.08 * Math.log(WHEEL_NOTCH_STEP_FACTOR)],
    ]) {
      const scale = getWheelZoomScale(1, { deltaY: direction * deltaY, deltaMode, viewportHeight });
      assert.ok(Math.abs(scale - Math.exp(-direction * exponent)) < 1e-12);
    }
  }
  const capped = getWheelZoomScale(1, { deltaY: -100, maximumDelta: 8 });
  assert.ok(Math.abs(capped - Math.pow(WHEEL_NOTCH_STEP_FACTOR, 0.08)) < 1e-12);
});

test('browser mouse events keep a constant notch rate, reverse symmetry and 1000px cap', () => {
  for (const delta of [100, 200, 1000, 10000]) {
    const options = { maximumDelta: 1000 };
    const scale = getWheelZoomScale(0.74, { ...options, deltaY: -delta });
    assert.ok(Math.abs(scale - 0.74 * Math.pow(WHEEL_NOTCH_STEP_FACTOR, Math.min(delta, 1000) / 100)) < 1e-12);
    const reversed = getWheelZoomScale(scale, { ...options, deltaY: delta });
    assert.ok(Math.abs(reversed - 0.74) < 1e-12);
  }
  const once = getWheelZoomScale(0.74, { deltaY: -200, maximumDelta: 1000 });
  const twice = getWheelZoomScale(getWheelZoomScale(0.74, { deltaY: -100 }), { deltaY: -100 });
  assert.ok(Math.abs(once - twice) < 1e-12);
});


test('explicit gesture regime overrides event size and mode in both directions', () => {
  for (const regime of ['trackpad', 'notch']) {
    const rate = regime === 'trackpad' ? 0.0029 : NOTCH_RATE;
    for (const delta of [8, 48, 49, 50, 51, 100, 192, 200]) {
      for (const direction of [-1, 1]) {
        for (const deltaMode of [0, 1, 2]) {
          const deltaY = direction * delta / (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
          const scale = getWheelZoomScale(0.74, { deltaY, deltaMode, regime, maximumDelta: 1000 });
          assert.ok(Math.abs(scale - 0.74 * Math.exp(-direction * delta * rate)) < 1e-12);
        }
      }
    }
  }
});

test('slow trackpad in and fast out returns to the starting scale', () => {
  let scale = 0.74;
  for (let i = 0; i < 48; i++) scale = getWheelZoomScale(scale, { deltaY: -4, regime: 'trackpad', maximumDelta: 1000 });
  scale = getWheelZoomScale(scale, { deltaY: 192, regime: 'trackpad', maximumDelta: 1000 });
  assert.ok(Math.abs(scale - 0.74) < 1e-12);
});

test('both gesture rates keep an unclamped cursor fixed through a round trip', () => {
  for (const regime of ['trackpad', 'notch']) {
    const factor = getWheelZoomScale(1, { deltaY: -192, regime, maximumDelta: 1000 });
    const anchor = 800;
    const translate = getClampedZoomTranslation({ zoomFactor: factor, anchor,
      contentStart: -150, contentEnd: 2000, viewportStart: 0, viewportSize: 1200 });
    assert.ok(Math.abs(anchor * factor + translate - anchor) < 1e-12);
    const reverseFactor = getWheelZoomScale(1, { deltaY: 192, regime, maximumDelta: 1000 });
    const reverseTranslate = getClampedZoomTranslation({ zoomFactor: reverseFactor, anchor,
      contentStart: -150 * factor + translate, contentEnd: 2000 * factor + translate,
      viewportStart: 0, viewportSize: 1200 });
    assert.ok(Math.abs(translate * reverseFactor + reverseTranslate) < 1e-12);
  }
});
