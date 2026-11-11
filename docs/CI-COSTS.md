# Private repository CI costs

Checked 2026-11-11. The owner confirmed GitHub Free and asked to keep builds
on GitHub, keep the test suites and release checks, and cut repeat work first.
**These cuts do not establish that private CI fits the included allowance.**

## What changed

- Core CI still runs on PRs and main. Its required check is still **Build the
  app and gate the run**. All Node shards, blocking isolated checks, the web
  build, function checks and release checks remain.
- Same-repo PR native and signed-in suites start after core CI succeeds. A
  planner checks the current open PR head, draft state and full changed-file
  list. It pins the merge commit, includes both paths of renames, and runs all
  suites if the file list is incomplete. Failed API reads fail visibly.
- Native checks wait until a PR is ready. Core CI runs on `ready_for_review`
  too, so moving a draft to ready always starts the follow-up checks. An
  iOS-only change needs only iOS checks; an Android-only change needs only
  Android checks. Shared web changes still need both platforms.
- Forks retain read-only `pull_request` runs. No fork code is run in the
  default-branch `workflow_run` context. Build jobs have read-only tokens and
  do not save checkout credentials. Separate trusted jobs post pending and
  final results to the PR head. Signed-in E2E remains informational.
- The long daily iOS walk has its own serialized workflow. New main CI runs
  cannot cancel it. Actions job history allows at most one automatic started
  attempt per UTC day, including a failed or cancelled attempt. A manual run
  can retry. Skipped jobs and jobs that never got a runner do not count. The
  full signed-in, export and offline relaunch assertions remain.
- Passing PR native screenshots/logs expire after one day; failure evidence
  and signed-in E2E traces keep their seven-day window.
- Production selection, backend alerts, the live journey and crash summary
  retain their schedules and main CI fallback. PR CI completions no longer
  start these background workflows just to find there is nothing to do.

Manual native runs still include the long iOS walk by default. Set
`full_walk=false` to run only the PR native checks. The daily workflow also
has its own manual run button. E2E perf inputs and all six suite shards remain.

## Measured starting point

The audit read all 2,893 workflow runs created on **2026-11-10 UTC** and the
latest-attempt jobs of all non-skipped runs. It found 4,042 allocated jobs:
16,001 Linux minutes and 2,090 macOS minutes. Each job was rounded up to the
next minute. At current standard private-runner rates, that is **$225.59 of
compute for that busy day**, before storage. Public standard runners are free;
this is a private-repo estimate, not a bill and not a monthly forecast.
Private Linux runner capacity can differ too, so these public-run durations
are a starting point rather than a promise of private-run times.

| Workflow | Private compute equivalent that day |
| --- | ---: |
| Native iOS and Android | $144.02 |
| Signed-in E2E | $54.31 |
| Core build and tests | $14.86 |
| Other checks, deploys and monitors | $12.40 |
| Total | $225.59 |

Of the native spend, the slow daily iOS walk alone used 641 Mac minutes over
15 attempts: **$39.74**, with no passing attempt. Under the new automatic policy
one attempt is bounded by its existing 200-minute timeout, or **$12.40** of Mac
compute. This removes the automatic restart loop; a failed attempt still stays red.
The full walk has since [passed on Nov 11](https://github.com/IsaiahCalvo/Survey/actions/runs/43074130902),
before this policy change: 65 rounded Mac minutes, or about **$4.03 per run**
at private rates. Keeping that daily frequency alone would exceed Free's
monthly included compute; that is still a budget constraint.

Separately, **$50.38** of PR native/E2E jobs were on revisions for which that
day's core CI receipts had no successful run. Starting follow-ups after a
current green core run targets that waste. This is an observation, not a
promised net saving: later green runs, new planner/report jobs, changed queue
times, and future work can change the total. Draft, platform and background
filter savings have not been assigned a dollar value.

Core CI alone used more than a full month's Free included compute in this
one busy day. Keeping the same volume of green PRs, full native checks and
scheduled walks on hosted runners cannot honestly be promised to fit the
allowance merely by removing duplicate starts. Measure complete days after
rollout before a visibility change; do not disable checks or raise spend to
make a budget assertion pass. The old September budget comments/fixture in
`ci.yml` describe a much smaller historical workload, not this audit.

Artifacts were also checked: 1,180 live artifacts used about **2.92 GiB**;
cache usage was about **10.38 GiB** at the audit instant. These are current
usage snapshots, not accrued charges. Existing reports were not deleted.

## Plan and rates

GitHub's current docs list **$12/month** of included compute on Free and
**$18/month** on Pro, shared with other eligible compute. Storage has separate
allowances. Standard x64 Linux is $0.006/minute, Windows $0.010 and macOS
$0.062. Private repository rulesets require Pro for a personal repository.
No plan, billing setting or visibility was changed as part of this work.

Sources, checked 2026-11-11:

- [Actions billing and included compute](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Runner rates and rounding](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Workflow run events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)

## Validation

The offline policy tests cover stale and closed PRs, drafts, forks, failed and
cancelled core runs, changed-head races, platform changes, renames, incomplete
and paged file lists, API failures, missing results, and once-daily history.
Use `node --test tests/ciFollowup.test.mjs`. Run `actionlint` on the changed
workflows, `npx vite build` and `node scripts/run-node-tests.mjs` before merge.
Check real hosted manual runs too; offline fixtures cannot prove a hosted
simulator, Docker stack or browser suite passes.
