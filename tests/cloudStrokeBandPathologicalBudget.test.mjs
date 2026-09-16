// The wall-clock half of the 2026-09-10 cloud stroke-band regression.
//
// WHY IT LIVES IN ITS OWN FILE (2026-09-15)
// -----------------------------------------
// The budget used to sit inside tests/cloudFillKnockout.test.mjs, which runs in
// a BLOCKING CI test shard. A shard going red reds the whole run, and
// deploy-production.yml gates on that run's conclusion — so a 5000ms reading
// taken on a busy shared runner could stop a production deploy, the exact
// failure the perf lane was built to remove (CI run 34094848036 did precisely
// that on a 250ms budget). tests/ciBlockingPathWallClockBudgets.test.mjs now
// guards that no blocking shard file asserts on elapsed time at all.
//
// Nothing was relaxed to get here. The budget is the same 5000ms, the shapes
// are the same objects (tests/fixtures/pathologicalCloudShapes.mjs), and the
// well-formedness assertions stayed BLOCKING in cloudFillKnockout. Only the
// stopwatch moved, and in the lane it is scaled by perfBudgetMs() exactly like
// every other budget there. A genuine hang — the bug this defends — still
// trips the runner's own 120s per-file timeout wherever it runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { perfBudgetMs } from '../scripts/ci-perf-tests.mjs';
import { PATHOLOGICAL_CLOUD_SHAPES } from './fixtures/pathologicalCloudShapes.mjs';

const {
  cloudStrokeBandRings,
  resolveCloudAnnotationGeometry,
} = await import('../src/utils/cloudAnnotationGeometry.js');

// Generous on purpose: 200x the ~30ms these take. It fails long before a person
// would call the export broken, and long after ordinary runner weather.
const BAND_BUDGET_MS = 5_000;

for (const [name, shape] of Object.entries(PATHOLOGICAL_CLOUD_SHAPES)) {
  test(`stroke band finishes on the ${name}`, () => {
    const cloud = resolveCloudAnnotationGeometry(shape);
    assert.ok(cloud, 'the cloud resolves');
    const started = Date.now();
    const band = cloudStrokeBandRings(cloud);
    const elapsed = Date.now() - started;
    assert.ok(band && band.rings.length >= 1, 'a band came back');
    assert.ok(
      elapsed < perfBudgetMs(BAND_BUDGET_MS),
      `took ${elapsed}ms, budget ${perfBudgetMs(BAND_BUDGET_MS)}ms`,
    );
  });
}
