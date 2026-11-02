// Speed budgets for tests/e2e-speed/first-page.spec.mjs, in milliseconds, for
// the best of three runs (cold, except tabBack) on a GitHub-hosted runner. They are set well
// above today's times so only a big slowdown fails: shared runners are noisy.
// Today's times are printed on every run's summary page.
export const SPEED_BUDGET_MS = {
  home: 3_000,
  firstPage: 4_000,
  bigFirstPage: 5_000,
  bigMarks: 6_000,
  // Going back from Home to an open document's tab: the click to the first
  // frame that shows the document. About 50 ms today; a stall shows here.
  tabBack: 500,
};
