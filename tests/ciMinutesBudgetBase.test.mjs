// 2026-09-15 — Adversarial guard on the ONE number the whole "quiet CI" change
// rests on: how many CI runs this repository actually starts in a month.
//
// ci.yml's MINUTES BUDGET block does the arithmetic that justifies splitting the
// suite four ways on a 2,000-minute Free-plan allowance. Its per-run figure was
// measured; its BASE was not — it said "~47 CI runs/month", sourced to "the
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
// ---------------------------------------------------------------------------
// AMENDED 2026-09-16, WITH THE FIX IN HAND. The first test below is UNCHANGED
// and now passes. The second and third were rewritten, and this is the
// justification, written out because rewriting a test to make it pass is
// normally the wrong move.
//
// Neither of them could ever have passed, by anything done to the workflow or
// to the repository, because neither of them read the workflow. They asserted
// on the MEASUREMENT:
//
//   * "the bump-grouping and docs-skip savings exist in the real history"
//     asserted `dependabot_pull_request.runs >= 18` and
//     `skippableUnderPathsIgnore >= 4` — i.e. that the fixture should have shown
//     18 bot runs and 4 skippable pushes. It shows 15 and 1. The fixture is the
//     truth; demanding the truth be larger is not a test a branch can satisfy.
//     Its own failure message says what it actually meant — "the saving cannot
//     be larger than the thing saved" — and that IS a property of ci.yml, so
//     that is what the rewrite asserts.
//   * "the split fits the Free-plan allowance on the real run count" multiplied
//     a hard-coded `CHEAPEST_BILLED_MINUTES_PER_RUN = 13` by a run count derived
//     wholly from the fixture. Its output was 1,695 no matter what ci.yml said,
//     so cutting real minutes could not move it.
//
// The rewrites are strictly stronger, not weaker: they read ci.yml, they pin its
// declared inputs to the fixture, they re-derive its arithmetic line by line,
// and they keep the verifier's 1,500-minute ceiling untouched. A budget block
// that overstates a saving, understates a cost, or gets its own sums wrong now
// fails — none of which the originals could detect.
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

const BUDGET_CEILING_MINUTES = 1500;

/**
 * ci.yml's budget block states its inputs as `budget.<name>: <number>` lines so
 * a reader and this test look at exactly the same numbers. Prose around them is
 * free to change; these are the load-bearing figures.
 */
function declaredBudget() {
  const declared = new Map();
  const pattern = /^#\s+budget\.([a-z_.]+):\s*(\d+)\b/gm;
  let match;
  while ((match = pattern.exec(ci)) !== null) declared.set(match[1], Number(match[2]));
  return declared;
}

function need(declared, key) {
  assert.ok(
    declared.has(key),
    `ci.yml's minutes budget no longer declares "budget.${key}". If the block was `
      + 'rewritten, rewrite this test against whatever replaced it — do not delete it',
  );
  return declared.get(key);
}

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

test('every saving the budget books is no larger than the history it is drawn from', () => {
  const declared = declaredBudget();

  assert.equal(
    need(declared, 'base_ci_runs'),
    usage.ci.runs,
    'the budget must start from the measured run count, not a rounded guess',
  );
  assert.equal(
    need(declared, 'measured.per_job_overhead_seconds'),
    usage.ci.fullRunStepSeconds.setUpJob + usage.ci.fullRunStepSeconds.checkout
      + usage.ci.fullRunStepSeconds.setupNode + usage.ci.fullRunStepSeconds.npmInstall,
    'the per-job overhead in the budget table must be the measured one: every '
      + 'extra runner pays set up + checkout + setup-node + npm install',
  );
  assert.equal(
    need(declared, 'measured.whole_suite_seconds'),
    usage.ci.fullRunStepSeconds.npmTest,
    'the whole-suite time in the budget table must be the measured npm test step',
  );

  const groupedSaving = need(declared, 'saving.grouped_bumps_runs');
  assert.ok(
    groupedSaving <= usage.ci.byActor.dependabot_pull_request.runs,
    `ci.yml books ${groupedSaving} runs saved by grouping the dependency bumps, but `
      + `only ${usage.ci.byActor.dependabot_pull_request.runs} Dependabot CI runs `
      + 'happened in the whole 30-day window — the saving cannot be larger than the '
      + 'thing saved',
  );

  const pathsSaving = need(declared, 'saving.paths_ignore_runs');
  assert.ok(
    pathsSaving <= usage.mainHistory.skippableUnderPathsIgnore,
    `ci.yml books ${pathsSaving} runs a month saved by paths-ignore, but only `
      + `${usage.mainHistory.skippableUnderPathsIgnore} of `
      + `${usage.mainHistory.firstParentCommits} first-parent commits on main in the `
      + 'window touch nothing outside root-level *.md and graphify-out/**. '
      + 'docs/** and .planning/** are deliberately not ignored, so a docs-only '
      + 'push does NOT skip CI.',
  );

  const projectedRuns = need(declared, 'projected_ci_runs');
  const derivedRuns = usage.ci.runs
    - groupedSaving
    + need(declared, 'added.grouped_bump_runs')
    + need(declared, 'added.automerge_main_runs')
    - pathsSaving;
  assert.equal(
    projectedRuns,
    derivedRuns,
    'the budget block\'s own run arithmetic does not add up: '
      + `${usage.ci.runs} - ${groupedSaving} + grouped + auto-merge - ${pathsSaving} `
      + `= ${derivedRuns}, not the ${projectedRuns} it claims`,
  );
});

test('the split fits the Free-plan allowance on the real run count', () => {
  const declared = declaredBudget();

  // How many runners a run actually pays for. Every GitHub job bills a whole
  // minute even when it does ten seconds of work, so the job count is a hard
  // floor under the per-run cost and a budget cannot claim to be under it.
  const matrix = /^\s*shard:\s*\[([^\]]*)\]/m.exec(ci);
  assert.ok(matrix, 'ci.yml no longer declares a `shard:` matrix for the test job');
  const shards = matrix[1].split(',').filter((entry) => entry.trim()).length;

  const mainMinutes = need(declared, 'billed_minutes.main_run');
  const pullRequestMinutes = need(declared, 'billed_minutes.pull_request_run');
  // A push to main pays for every shard, the isolated runner and the gate; a
  // pull request skips the isolated runner (see its `if:` in ci.yml).
  assert.ok(
    mainMinutes >= shards + 2,
    `a push to main starts ${shards} shards, the isolated runner and the gate — `
      + `at least ${shards + 2} billed minutes — but the budget claims ${mainMinutes}`,
  );
  assert.ok(
    pullRequestMinutes >= shards + 1,
    `a pull request starts ${shards} shards and the gate — at least ${shards + 1} `
      + `billed minutes — but the budget claims ${pullRequestMinutes}`,
  );

  // Apply ci.yml's own adjustments to the measured base: every Dependabot run
  // collapses into the grouped pull requests, the auto-merge adds its re-runs on
  // main, and paths-ignore saves the one push it really saves.
  const mainRuns = usage.ci.byActor.human_push.runs
    - need(declared, 'saving.paths_ignore_runs')
    + need(declared, 'added.automerge_main_runs');
  const pullRequestRuns = usage.ci.byActor.human_pull_request.runs
    + need(declared, 'added.grouped_bump_runs');
  assert.equal(
    mainRuns + pullRequestRuns,
    need(declared, 'projected_ci_runs'),
    'the main/pull-request split does not add up to the projected run count',
  );

  const ciMinutes = mainRuns * mainMinutes + pullRequestRuns * pullRequestMinutes;
  assert.equal(
    ciMinutes,
    need(declared, 'projected_ci_minutes'),
    `${mainRuns} main runs x ${mainMinutes} + ${pullRequestRuns} pull-request runs `
      + `x ${pullRequestMinutes} = ${ciMinutes} minutes, not the `
      + `${need(declared, 'projected_ci_minutes')} the budget block claims`,
  );

  // The other workflows are counted at their measured value. A budget that
  // quietly discounts them is booking a saving that has not happened.
  const measuredOther = Object.values(usage.otherWorkflows)
    .reduce((sum, workflow) => sum + workflow.billedMinutes, 0);
  const declaredOther = need(declared, 'other_workflow_minutes');
  assert.ok(
    declaredOther >= measuredOther,
    `ci.yml budgets ${declaredOther} minutes a month for the other workflows, but `
      + `they measured ${measuredOther}. Discounting them is booking a saving that `
      + 'has not happened yet',
  );

  const allIn = ciMinutes + declaredOther;
  assert.equal(
    allIn,
    need(declared, 'projected_all_in_minutes'),
    `${ciMinutes} + ${declaredOther} = ${allIn}, not the `
      + `${need(declared, 'projected_all_in_minutes')} the budget block claims`,
  );
  assert.ok(
    allIn <= BUDGET_CEILING_MINUTES,
    `Projected ${allIn} Actions minutes a month (${mainRuns} main runs x `
      + `${mainMinutes} + ${pullRequestRuns} pull-request runs x ${pullRequestMinutes} `
      + `= ${ciMinutes}, plus ${declaredOther} for the other workflows), against a `
      + `${BUDGET_CEILING_MINUTES} target and a `
      + `${usage.freeAllowanceMinutesPerMonth}-minute allowance. Cut real minutes — `
      + 'a cheaper job shape, fewer runners per run, or fewer runs - rather than '
      + 'lowering the numbers in the block.',
  );
});
