// 2026-09-15 — Adversarial guard on the ONE number the whole "quiet CI" change
// rests on: how many CI runs this repository actually starts in a month.
//
// ci.yml's MINUTES BUDGET block does the arithmetic that justifies splitting the
// suite four ways on a 2,000-minute Free-plan allowance. Its per-run figure is
// measured; its BASE is not — it says "~47 CI runs/month", sourced to "the
// September 2026 history".
//
// The real figure, taken the way the claim says to take it, is 116:
//
//   gh run list --workflow=ci.yml -L 1000 \
//     --json createdAt --jq '[.[] | select(.createdAt >= "2026-08-16")] | length'
//   116
//
//   gh api repos/Kal-Voe/Survey/actions/runs --paginate ... | grep -c '<TAB>CI<TAB>'
//   116     (74 human push, 27 human pull_request, 15 dependabot pull_request)
//
// tests/fixtures/ciActionsUsage30d.json carries that measurement, with billed
// minutes recomputed per job the way GitHub bills them (ceil to the minute,
// minimum one) because this account's /timing endpoint answers 0.
//
// The two savings the budget block books are also overstated against the same
// data: it books -18 runs for grouping the bumps, but only 15 bot runs exist in
// the whole window; and -4 runs for paths-ignore, where exactly 1 of 189
// first-parent commits on main touches nothing outside root-level *.md and
// graphify-out/** (docs/** and .planning/** are deliberately NOT ignored).
//
// This test fails today. It passes when either the budget block's base is
// corrected to the measured one, or the design genuinely fits the allowance.
// It is intentionally generous everywhere the branch could be right: it uses the
// LOWEST defensible per-run cost, not ci.yml's own ~23.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const usage = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'ciActionsUsage30d.json'), 'utf8'),
);

/**
 * The cheapest per-run cost the split can possibly have, derived from the
 * reference run's own measured step times rather than from ci.yml's estimate:
 *
 *   fixed per-job overhead = set up + checkout + setup-node + npm install = 27s
 *   four shards            = 27s + (381s npm test / 4) ≈ 122s  -> 2 billed min each
 *   build                  = everything but npm test ≈ 41s      -> 1 billed min
 *   slow isolated suites    ≈ 79s                               -> 2 billed min
 *   perf (informational)    ≈ 52s                               -> 1 billed min
 *   ci-gate                 ≈ 10s                               -> 1 billed min
 *
 * = 13 billed minutes for a full run. ci.yml's own block says ~23. Using 13
 * makes this test as hard to fail as it can honestly be made.
 */
const CHEAPEST_BILLED_MINUTES_PER_RUN = 13;

const BUDGET_CEILING_MINUTES = 1500;

test('ci.yml still states the run-count base its minutes budget rests on', () => {
  const stated = /≈?\s*~?(\d+)\s+CI runs\/month/.exec(ci);
  assert.ok(
    stated,
    'ci.yml no longer states a "N CI runs/month" base — if the budget block was '
      + 'rewritten, rewrite this test against whatever replaced it',
  );
  assert.ok(
    Number(stated[1]) >= usage.ci.runs * 0.8,
    `ci.yml budgets for ${stated[1]} CI runs a month. The last 30 days of real `
      + `run data show ${usage.ci.runs} (${usage.ci.byActor.human_push.runs} push, `
      + `${usage.ci.byActor.human_pull_request.runs} pull request, `
      + `${usage.ci.byActor.dependabot_pull_request.runs} Dependabot). The base is `
      + 'low by about 2.5x, so every figure derived from it is too.',
  );
});

test('the bump-grouping and docs-skip savings exist in the real history', () => {
  assert.ok(
    usage.ci.byActor.dependabot_pull_request.runs >= 18,
    'ci.yml books "-18 runs" for grouping the dependency bumps, but only '
      + `${usage.ci.byActor.dependabot_pull_request.runs} Dependabot CI runs happened `
      + 'in the whole 30-day window — the saving cannot be larger than the thing saved',
  );
  assert.ok(
    usage.mainHistory.skippableUnderPathsIgnore >= 4,
    'ci.yml books "-4 runs" a month for paths-ignore, but only '
      + `${usage.mainHistory.skippableUnderPathsIgnore} of `
      + `${usage.mainHistory.firstParentCommits} first-parent commits on main in the `
      + 'window touch nothing outside root-level *.md and graphify-out/**. '
      + 'docs/** and .planning/** are deliberately not ignored, so a docs-only '
      + 'push does NOT skip CI.',
  );
});

test('the split fits the Free-plan allowance on the real run count', () => {
  // Apply ci.yml's own adjustments to the measured base, as generously as the
  // data allows: every Dependabot run collapses to two grouped pull requests a
  // month, the auto-merge adds its two re-runs on main, and paths-ignore saves
  // the one push it really saves.
  const bumpRunsAfterGrouping = 2;
  const autoMergeRerunsOnMain = 2;
  const projectedCiRuns =
    usage.ci.runs
    - usage.ci.byActor.dependabot_pull_request.runs
    + bumpRunsAfterGrouping
    + autoMergeRerunsOnMain
    - usage.mainHistory.skippableUnderPathsIgnore;

  const ciMinutes = projectedCiRuns * CHEAPEST_BILLED_MINUTES_PER_RUN;
  const otherMinutes = Object.values(usage.otherWorkflows)
    .reduce((sum, w) => sum + w.billedMinutes, 0);
  const allIn = ciMinutes + otherMinutes;

  assert.ok(
    allIn <= BUDGET_CEILING_MINUTES,
    `Projected ${allIn} Actions minutes a month (${projectedCiRuns} CI runs x `
      + `${CHEAPEST_BILLED_MINUTES_PER_RUN} billed min = ${ciMinutes}, plus `
      + `${otherMinutes} for the other workflows), against a ${BUDGET_CEILING_MINUTES} `
      + `target and a ${usage.freeAllowanceMinutesPerMonth}-minute allowance. `
      + 'ci.yml projects ~976 all-in, but only because it starts from ~47 runs a '
      + `month instead of the measured ${usage.ci.runs}. At ci.yml's own ~23 billed `
      + `minutes per run the same projection is ${projectedCiRuns * 23 + otherMinutes} `
      + 'minutes — over the whole free allowance, not just over target.',
  );
});
