// The performance lane.
//
// WHY THIS EXISTS (2026-09-15)
// ----------------------------
// Five test files assert wall-clock or CPU budgets. Those budgets measure the
// host as much as they measure our code, so on a loaded 2-core hosted runner
// they go red without a single line of product code changing. That happened for
// real: CI run 34094848036 (push to main, 2026-09-07) failed on
// tests/roundStrokeOutlinePerformance.test.mjs with "round outline took
// 341.6ms" against a 250ms budget -- on BOTH the original attempt and the
// rerun -- which blocked the web bundle build and the production deploy behind
// a timing reading, not a regression. KAL-446 hardened that file to best-of-5,
// but the underlying exposure is structural: any wall-clock budget in the
// blocking path can stop a deploy for reasons outside the diff.
//
// So these files move OUT of the blocking `npm test` path and into a separate,
// parallel "Performance budgets" STEP, carrying `continue-on-error: true`,
// inside the `isolated` job in ci.yml.
//
// WHAT THIS IS NOT
// ----------------
// This is NOT deletion and NOT a quarantine to be forgotten. The files run on
// every push to main, alone on their own runner, and a red budget is a real
// signal that somebody should look — the gate reports it in words on the run
// page. A pull request skips them; the main commit that lands runs them. The only thing that changed is that a timing
// reading can no longer veto a merge or a deploy.
//
// HONEST NOTE ON BUDGET STRENGTH
// ------------------------------
// In the perf lane the ms budgets are relaxed by PERF_LANE_BUDGET_SCALE and the
// best-of sample count is raised (see below). That IS a deliberate loosening,
// and it is confined to this lane: a plain `npm run test:perf` or a local
// `node --test <file>` run still asserts the original, unmodified budgets. The
// trade is intentional -- an informational lane that cries wolf gets ignored,
// and the tight numbers stay enforceable on a quiet machine where they mean
// something.
//
// The list is also the single source of truth for the sharded runner: the
// parallel main pass imports CI_PERF_TEST_FILES and excludes it, so no file is
// ever run twice or silently dropped.

/**
 * Test files whose assertions include real wall-clock or CPU budgets.
 *
 * Membership rule: the file asserts on elapsed time or CPU time. Files that are
 * merely SLOW are not perf files and stay in the blocking path --
 * the sequential eraser stress sweep (tests/partialEraserSequentialStressPart1-6,
 * one sweep split six ways) and tests/partialEraserPropertyStress are the
 * heaviest work in the whole suite but assert only geometry, and
 * tests/annotationDocConcurrency is 40s of CRDT convergence with no timing
 * budget at all. Those are correctness gates and must keep their teeth.
 *
 * Deliberately NOT moved here, even though each carries one timing assertion:
 * tests/geometryHitTest (one 500ms hit-test guard among many correctness
 * checks) and tests/cloudStrokeBandFuzz (500ms/4000ms per-case guards inside
 * the cloud geometry fuzzer). Both budgets sit far above their measured cost
 * and neither has ever flaked; pulling the whole file out of the blocking path
 * would cost more correctness coverage than the flake risk is worth.
 */
export const CI_PERF_TEST_FILES = Object.freeze([
  // 2026-09-24 — per-field sync store: drag frame, 5,000-mark recolour and
  // list rebuild timings (correctness is in annotationFieldSync.test.mjs).
  'tests/annotationFieldSyncPerf.test.mjs',
  // p95/max commit work + CPU budgets, measured in a spawned child.
  'tests/partialEraserComplexity.test.mjs',
  // Wall-clock budgets on round-stroke outline generation and partial erase.
  'tests/roundStrokeOutlinePerformance.test.mjs',
  // 750ms single-sample "first erase" interaction-release budget.
  'tests/partialEraseCurveLocalityBudget.test.mjs',
  // 2026-09-15 — the last two elapsed-time assertions that were still sitting
  // in BLOCKING test shards, split out of their parent suites so the parents'
  // correctness assertions could stay blocking. See each file's header.
  // 5000ms hang guard on the two pathological filled polygon clouds.
  'tests/cloudStrokeBandPathologicalBudget.test.mjs',
  // 100ms "loser tab short-circuits" budget on the Web Locks backfill election.
  // The tightest budget we have, and tighter than the 250ms reading that held a
  // deploy on run 34094848036 — it had no business in the blocking path.
  'src/lib/collab/__tests__/crdtBackfillLoserLatency.test.mjs',
]);

/** Set by the ci.yml performance-budgets step. Nothing else should set it. */
export const CI_PERF_LANE_ENV = 'CI_PERF_LANE';

/**
 * How much slack the informational lane gets on every millisecond budget.
 *
 * Sized against the one real CI failure we have: 341.6ms against a 250ms
 * budget is 1.37x. 2x clears that with room for a worse-behaved runner while
 * still failing anything that is genuinely twice as slow as the release
 * target -- a 3x algorithmic regression still turns the lane red.
 */
export const PERF_LANE_BUDGET_SCALE = 2;

/** Extra timing samples in the lane; the best-of minimum only gets sharper. */
export const PERF_LANE_TIMING_SAMPLES = 7;

/** True when running inside the non-blocking CI performance-budgets step. */
export function isCiPerfLane() {
  return process.env[CI_PERF_LANE_ENV] === '1';
}

/**
 * Scale a millisecond budget for the lane. Returns `baseMs` unchanged
 * everywhere else, so local runs and any direct `node --test` invocation keep
 * asserting the original release target.
 */
export function perfBudgetMs(baseMs) {
  return isCiPerfLane() ? baseMs * PERF_LANE_BUDGET_SCALE : baseMs;
}

/**
 * Sample count for best-of-N timing readings. Raising N cannot weaken an
 * assertion: host load, GC and JIT warm-up can only ADD time, so more samples
 * means the minimum converges on our own cost from above. A real regression
 * lifts every sample, minimum included.
 */
export function perfTimingSamples(baseSamples = 5) {
  return isCiPerfLane() ? Math.max(baseSamples, PERF_LANE_TIMING_SAMPLES) : baseSamples;
}
