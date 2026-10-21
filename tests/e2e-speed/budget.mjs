// Speed budgets for tests/e2e-speed/first-page.spec.mjs, in milliseconds, for
// the best of three cold runs on a GitHub-hosted runner. They are set well
// above today's times so only a big slowdown fails: shared runners are noisy.
// Today's times are printed on every run's summary page.
export const SPEED_BUDGET_MS = {
  home: 3_000,
  firstPage: 4_000,
};
