// The single source of truth for "which test files must never share a machine
// with other tests".
//
// These suites assert real wall-clock budgets or multi-second transport timing.
// Neighbouring load changes their result, so they are:
//   * excluded from every sharded (parallel) CI job, and
//   * run alone, one process at a time, on a runner of their own.
//
// This list is the UNION. Which job a file lands in is decided by whether it
// also appears in CI_PERF_TEST_FILES (scripts/ci-perf-tests.mjs):
//   * on that list  -> the NON-BLOCKING performance-budgets step
//     (`--only-perf`). Those files
//     assert millisecond budgets, and a timing reading taken on a loaded hosted
//     runner must never be able to veto a merge or a deploy.
//   * not on it     -> the BLOCKING first step of the `isolated` job
//     (`--only-timing-sensitive`). annotationDocConcurrency and
//     svgPathTransformFidelity are correctness gates that merely happen to be
//     slow, so they keep their teeth.
// `scripts/run-node-tests.mjs` asserts CI_PERF_TEST_FILES is a subset of this
// list, so a perf file can never drift into a shard.
//
// Import this constant instead of re-typing the list — the shards, the two
// isolated jobs and `scripts/run-node-tests.mjs` must agree exactly, or a file
// silently runs twice or not at all.
//
// A path listed here that no longer exists on disk is filtered out by the
// runner, so deleting a test file cannot break CI; pruning this list is still
// the right follow-up.
export const TIMING_SENSITIVE_TEST_FILES = [
  'src/lib/collab/__tests__/crdtBackfillLoserLatency.test.mjs',
  'tests/annotationDocConcurrency.test.mjs',
  'tests/annotationFieldSyncPerf.test.mjs',
  'tests/cloudStrokeBandPathologicalBudget.test.mjs',
  'tests/partialEraseCurveLocality.test.mjs',
  'tests/partialEraserComplexity.test.mjs',
  'tests/roundStrokeOutlinePerformance.test.mjs',
  'tests/svgPathTransformFidelity.test.mjs',
];
