import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getClampedZoomTranslation,
  getDocumentMinimumScale,
  getWheelZoomScale,
} from '../src/utils/pdfZoomMath.js';

test('small trackpad ticks match Drawboard speed and reverse symmetrically', () => {
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

  assert.ok(zoomedIn > 0.756 && zoomedIn < 0.759, `expected Drawboard's measured small-tick speed, got ${zoomedIn}`);
  assert.ok(Math.abs(zoomedBackOut - 0.74) < 1e-9, `expected a reversible step, got ${zoomedBackOut}`);
});

test('one full mouse-wheel notch stays near the prior modest 1.1x step', () => {
  const zoomedOut = getWheelZoomScale(0.76, {
    deltaY: 100,
    deltaMode: 0,
    minimumScale: 0.01,
  });

  assert.ok(zoomedOut > 0.68 && zoomedOut < 0.70, `expected a modest wheel step, got ${zoomedOut}`);
});

test('one event cannot collapse zoom even when a device reports an enormous delta', () => {
  const oneNotch = getWheelZoomScale(0.76, { deltaY: 100, minimumScale: 0.01 });
  const enormousDelta = getWheelZoomScale(0.76, { deltaY: 10_000, minimumScale: 0.01 });

  assert.equal(enormousDelta, oneNotch);
  assert.ok(enormousDelta > 0.68);
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
