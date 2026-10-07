// The wall-clock half of tests/partialEraseCurveLocality.test.mjs
// (2026-10-04, test-reliability pass).
//
// It used to be the last test of that file, which made the whole file — and
// its fourteen pure-geometry tests — a perf-lane (non-blocking) file. Only the
// stopwatch lives here now; the geometry tests went back to the blocking path.
// The budget is unchanged (750 ms, scaled by perfBudgetMs() only inside the CI
// perf lane), and this file is in CI_PERF_TEST_FILES / TIMING_SENSITIVE_TEST_FILES
// in its place. In its own process the reading is now a truly first erase,
// JIT warm-up included, which is what the test always said it measured (in
// the shared file, fourteen earlier erases had already warmed it up).
import test from 'node:test';
import assert from 'node:assert/strict';

import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { perfBudgetMs } from '../scripts/ci-perf-tests.mjs';

const makeLegacyInk = (id, path, width, overrides = {}) => ({
  type: 'path',
  id,
  annotationId: id,
  tool: 'pen',
  path,
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  stroke: '#d11b2d',
  strokeWidth: width,
  fill: null,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  data: { id, tool: 'pen', isPdfImported: true },
  ...overrides,
});

test('multi-cubic first erase stays inside the interaction release budget', {
  timeout: 10_000,
}, () => {
  const path = [['M', 0, 100]];
  for (let index = 0; index < 20; index += 1) {
    const x = index * 30;
    path.push(['C', x + 8, 20, x + 22, 180, x + 30, 100]);
  }
  const started = performance.now();
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [makeLegacyInk('multi-cubic', path, 12)] },
    eraserPoints: [{ x: 315, y: 100 }],
    eraserRadius: 3,
    mode: 'partial',
  });
  const elapsed = performance.now() - started;

  assert.equal(result.didChange, true);
  // Single-sample on purpose: this measures the FIRST erase, JIT warm-up
  // included, because that is what the user feels on pointer release. Best-of-N
  // would measure a different thing. perfBudgetMs() only relaxes it inside the
  // non-blocking CI perf lane.
  assert.ok(
    elapsed < perfBudgetMs(750),
    `first erase took ${elapsed.toFixed(1)}ms, budget ${perfBudgetMs(750)}ms`,
  );
});
