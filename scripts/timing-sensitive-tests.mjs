// The single source of truth for "which test files must never share a machine
// with other tests".
//
// These suites assert real wall-clock budgets or multi-second transport timing.
// Neighbouring load changes their result, so they are:
//   * excluded from every sharded (parallel) CI job, and
//   * run alone, one process at a time, by the dedicated performance job.
//
// Import this constant instead of re-typing the list — the CI performance job
// and `scripts/run-node-tests.mjs` must agree exactly, or a file silently runs
// twice or not at all.
//
// A path listed here that no longer exists on disk is filtered out by the
// runner, so deleting a test file cannot break CI; pruning this list is still
// the right follow-up.
export const TIMING_SENSITIVE_TEST_FILES = [
  'tests/annotationDocConcurrency.test.mjs',
  'tests/partialEraseCurveLocality.test.mjs',
  'tests/partialEraserComplexity.test.mjs',
  'tests/roundStrokeOutlinePerformance.test.mjs',
  'tests/svgPathTransformFidelity.test.mjs',
];
