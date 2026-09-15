// Adversarial verification of the 2026-09-15 "quiet CI" change
// (claude/ci-integration: ci.yml + dependabot-auto-merge.yml).
//
// Each test below encodes one promise the new workflows make ABOUT THEMSELVES,
// in their own comments, and each currently FAILS. They are written as source
// assertions over the workflow YAML for the same reason the PDFViewer contract
// tests read PDFViewer.jsx as text: the behaviour lives in GitHub's evaluation
// of these strings, and nothing else in the repo can observe it.
//
// 2026-09-15, second pass: the five findings all stood and all are fixed. TWO
// ASSERTIONS WERE DELIBERATELY REWRITTEN while fixing them, and neither was
// weakened -- each original encoded one particular remedy rather than the
// promise itself, and the remedy it named was the wrong one for this repository.
// The reasoning is written out at each site (the GITHUB_TOKEN one and the
// concurrency one). Nothing else in this file changed.
//
// References (GitHub documentation, read 2026-09-15):
//   * Triggering a workflow -- "events triggered by the GITHUB_TOKEN will not
//     create a new workflow run", the exceptions being workflow_dispatch and
//     repository_dispatch.
//   * Contexts -- github.actor is "the username of the user that triggered the
//     initial workflow run. If the workflow run is a re-run, this value may
//     differ from github.triggering_actor."

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, '.github', 'workflows', name), 'utf8');

const ci = read('ci.yml');
const autoMerge = read('dependabot-auto-merge.yml');
const releaseIntegrity = readFileSync(join(root, 'scripts', 'release-integrity.mjs'), 'utf8');

test('a human re-run of a bot bump actually runs the slow isolated suites', () => {
  // ci.yml promises: "A human re-run of a bot PR flips github.actor back to the
  // person, so re-running a bump by hand gives you these suites on demand."
  // GitHub documents the opposite: github.actor stays the actor of the INITIAL
  // run (dependabot[bot]); github.triggering_actor is the one that changes. As
  // written, SKIP_TIMING_SUITES stays '1' on every re-run, so the documented
  // escape hatch cannot be used and the CRDT convergence suite
  // (tests/annotationDocConcurrency.test.mjs, a yjs gate) never runs for a yjs
  // bump -- not on the PR, and not by re-running it.
  const skipLine = /SKIP_TIMING_SUITES:.*$/m.exec(ci);
  assert.ok(skipLine, 'ci.yml no longer sets SKIP_TIMING_SUITES');
  assert.match(
    skipLine[0],
    /github\.triggering_actor/,
    'SKIP_TIMING_SUITES must key off github.triggering_actor -- github.actor does '
      + 'not change on a re-run, so the "re-run it by hand" escape hatch is dead',
  );
});

test('auto-merging a bump re-runs the full suite on main and can reach production', () => {
  // The finding: dependabot-auto-merge.yml promised "Merging pushes main, which
  // re-runs the full suite -- timing tests included -- and only a green run
  // there can deploy to production." A push made with secrets.GITHUB_TOKEN
  // creates no workflow run at all, so "Build and tests" never ran on that main
  // commit, the two skipped isolated suites ran nowhere, and
  // deploy-production.yml (workflow_run on "Build and tests") never fired. The
  // bump silently never shipped. That finding stands and the comment is fixed.
  //
  // AMENDED 2026-09-15, with the fix in hand. The assertion here was
  // `doesNotMatch(/GH_TOKEN: secrets.GITHUB_TOKEN/)` -- i.e. "use a personal
  // access token or a GitHub App token instead". That is not the only remedy
  // and it is the wrong one for this repository: there is no PAT, and minting a
  // long-lived credential with write access to main to work around a
  // notification rule is a worse trade than the bug. GitHub's own exception is
  // enough ("Trigger a workflow" -> "Triggering a workflow from a workflow"):
  // "events triggered by the GITHUB_TOKEN will not create a new workflow run,
  // with the following exceptions: workflow_dispatch and repository_dispatch
  // events always create workflow runs."
  //
  // So the contract is not "do not use GITHUB_TOKEN"; it is "the merge must
  // leave a real CI run on main behind it". That is what is asserted below, and
  // it is strictly stronger than the original: the old assertion could be
  // satisfied by swapping the token while leaving the re-run to a push event
  // that a PAT happens to allow, whereas these fail the moment the explicit
  // re-dispatch, its --ref, or ci.yml's trigger for it goes away.
  assert.match(
    autoMerge,
    /gh workflow run ci\.yml[^\n]*--ref main/,
    'after merging, the workflow must explicitly start "Build and tests" on '
      + 'main -- the merge push itself creates no workflow run, so without this '
      + 'the bump is never tested on main and never deploys',
  );
  assert.match(
    ci,
    /^ {2}workflow_dispatch:/m,
    'ci.yml must accept a manual dispatch, or the re-run above cannot happen',
  );
  assert.ok(
    autoMerge.indexOf('gh pr merge') < autoMerge.indexOf('gh workflow run ci.yml'),
    'the re-dispatch must come AFTER the merge, or it tests the wrong commit',
  );
});

test('a robot merge that goes wrong does not become a failure email', () => {
  // dependabot-auto-merge.yml promises: "this workflow must never turn a
  // robot's housekeeping into another failure email." The step runs under
  // `set -euo pipefail` with `gh pr list` and `gh pr merge` unguarded, so any
  // API hiccup -- or a second bump whose package-lock.json no longer merges
  // after the first one landed -- exits non-zero and reds the run. Failure
  // notification for this repository is a repo-wide ci_activity subscription,
  // so a red run of ANY workflow emails the owner.
  const guarded = /continue-on-error:\s*true/.test(autoMerge)
    || /gh pr merge[^\n]*\|\|/.test(autoMerge);
  assert.ok(
    guarded,
    'the merge step must not be able to fail the job: give the job '
      + 'continue-on-error: true, or handle a non-zero `gh pr merge` explicitly',
  );
});

test('two bumps going green together cannot race each other into a red run', () => {
  // Every open auto-mergeable bump edits package.json and package-lock.json, and
  // Dependabot opens them in one weekly batch, so several "Build and tests" runs
  // finish within seconds of each other. With no concurrency group these merge
  // jobs run at once: the first merges, the rest attempt a merge whose base has
  // moved.
  //
  // AMENDED 2026-09-15: the original anchored on /^concurrency:/m, i.e. a
  // WORKFLOW-level group. That placement is actively wrong here. This workflow
  // is triggered by every completion of "Build and tests" -- every human pull
  // request included -- and a workflow-level group is joined by the RUN, before
  // the job's `if:` is evaluated, so all those skipped runs would queue too.
  // GitHub cancels a previously pending run when a newer one queues, so an
  // unrelated pull request finishing its CI could silently cancel a bump's
  // pending merge. The group therefore belongs on the job, under the `if:`, and
  // that is what is asserted: a group exists, AND it is indented.
  const group = /^(\s*)concurrency:\s*$/m.exec(autoMerge);
  assert.ok(
    group,
    'dependabot-auto-merge.yml needs a concurrency group so simultaneous green '
      + 'bumps serialise instead of racing',
  );
  assert.ok(
    group[1].length > 0,
    'the concurrency group must be JOB level, under the `if:` -- a '
      + 'workflow-level group is entered by runs whose merge job is skipped, and '
      + 'those can cancel a pending real merge',
  );
  assert.match(
    autoMerge,
    /cancel-in-progress:\s*false/,
    'a merge already in flight must never be cancelled part-way',
  );
});

test('the workflow-name pairing guard covers every workflow_run consumer', () => {
  // release-integrity.mjs asserts ci.yml's `name:` matches the workflows[] entry
  // in deploy-production.yml, precisely so a rename cannot silently switch a
  // downstream workflow off. dependabot-auto-merge.yml hard-codes the same
  // display name and is not covered, so a rename would silently stop every
  // auto-merge with no signal at all.
  assert.match(
    releaseIntegrity,
    /dependabot-auto-merge\.yml/,
    'release-integrity.mjs must pin dependabot-auto-merge.yml to the CI '
      + 'workflow name too -- it matches on the display name, same as deploy',
  );
});
