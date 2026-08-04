import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMobileEdgeSwipeBack,
  isMobileEdgeSwipeClaim,
  mobileEdgeSwipeCommitDistance,
  mobileEdgeSwipeProgress,
  mobileEdgeSwipeSettleDuration,
  shouldCompleteMobileEdgeSwipe,
} from '../src/home/useMobileEdgeSwipeBack.js';

test('mobile edge swipe requires a start at the left screen edge', () => {
  assert.equal(isMobileEdgeSwipeBack({ startX: 8, startY: 300, x: 120, y: 304, viewportWidth: 390 }), true);
  assert.equal(isMobileEdgeSwipeBack({ startX: 30, startY: 300, x: 160, y: 300, viewportWidth: 390 }), false);
});

test('mobile edge swipe ignores short and mostly vertical gestures', () => {
  assert.equal(isMobileEdgeSwipeClaim({ startX: 8, startY: 300, x: 24, y: 302 }), true);
  assert.equal(isMobileEdgeSwipeBack({ startX: 8, startY: 300, x: 50, y: 300, viewportWidth: 390 }), false);
  assert.equal(isMobileEdgeSwipeBack({ startX: 8, startY: 300, x: 90, y: 410, viewportWidth: 390 }), false);
});

test('mobile edge swipe commit distance stays practical across phone widths', () => {
  assert.equal(mobileEdgeSwipeCommitDistance(320), 64);
  assert.equal(mobileEdgeSwipeCommitDistance(390), 70.2);
  assert.equal(mobileEdgeSwipeCommitDistance(900), 96);
});

test('mobile edge swipe progress follows the finger and stays bounded', () => {
  assert.equal(mobileEdgeSwipeProgress(97.5, 390), 0.25);
  assert.equal(mobileEdgeSwipeProgress(-20, 390), 0);
  assert.equal(mobileEdgeSwipeProgress(500, 390), 1);
});

test('mobile edge swipe can complete by distance or forward velocity', () => {
  assert.equal(shouldCompleteMobileEdgeSwipe({ distance: 80, velocityX: 0, viewportWidth: 390 }), true);
  assert.equal(shouldCompleteMobileEdgeSwipe({ distance: 35, velocityX: 0.5, viewportWidth: 390 }), true);
  assert.equal(shouldCompleteMobileEdgeSwipe({ distance: 35, velocityX: 0.1, viewportWidth: 390 }), false);
  assert.equal(shouldCompleteMobileEdgeSwipe({ distance: 100, velocityX: -0.2, viewportWidth: 390 }), true);
});

test('mobile edge swipe settle timing is bounded and direction-aware', () => {
  assert.equal(mobileEdgeSwipeSettleDuration({ distance: 80, viewportWidth: 390, velocityX: 1, complete: true }), 310);
  assert.equal(mobileEdgeSwipeSettleDuration({ distance: 80, viewportWidth: 390, velocityX: 1, complete: false }), 120);
  assert.equal(mobileEdgeSwipeSettleDuration({ distance: 20, viewportWidth: 1000, velocityX: 0, complete: true }), 540);
});
