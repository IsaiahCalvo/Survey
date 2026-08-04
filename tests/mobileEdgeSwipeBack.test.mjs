import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMobileEdgeSwipeBack,
  isMobileEdgeSwipeClaim,
  mobileEdgeSwipeCommitDistance,
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
