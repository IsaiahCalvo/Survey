# When production breaks: rollback runbook

Use this when surveytool.app is down or a release broke something. The
production monitor (`.github/workflows/monitor.yml`) opens a GitHub issue
labelled `alert` when the site stops answering, a deploy fails, or the
post-deploy smoke test fails. Each issue links here.

Pick the first step that fits. Each one is faster and smaller than the next.

## 1. One feature is broken: switch it off

If the broken thing sits behind a feature flag, open
https://surveytool.app/flags and set it to **Off**. People get the change on
their next page load. No deploy and no code change are needed. See
`docs/RELEASE-CHANNELS.md` for how flags work.

## 2. A release broke the web app: revert the PR

1. Find the PR that caused it (`git log origin/main`, or the commit in the
   alert issue).
2. Open a revert PR. GitHub's **Revert** button works, or run
   `git revert <merge sha>` on a branch.
3. Merge it once CI is green. The normal pipeline ("Build and tests", then
   "Deploy production") ships it in about 10 minutes, including Supabase
   functions.

This is the default path. It keeps `main` and the live site in step, and
agents can do it without dashboard access.

**Migrations are not undone by a revert.** If the bad PR added a migration,
the revert removes the file from `main`, but the change stays in the
database. Fix the database with a new, later migration (step 4). Deleting a
migration that was already applied makes `supabase db push` fail on the next
deploy ("Remote migration versions not found"). In that case keep the file,
and revert only the app code.

## 3. The site is down right now: Vercel instant rollback

When there is no time for CI (about 10 minutes), point surveytool.app back at
the last good deployment:

- Vercel dashboard → project → **Deployments**, pick the last good
  production deployment, then **Instant Rollback**. Or with a signed-in CLI:
  `vercel rollback <deployment-url> --scope team_uLSMMTmD4LhtDBm9qJ8DV59v`.
- This takes seconds and touches only the web files. The database and
  Supabase functions stay as they are.
- After a rollback, Vercel stops moving surveytool.app to new deployments by
  itself. Once the fix has merged and deployed, use **Undo Rollback** or
  `vercel promote <good-deployment-url>`, and check that
  https://surveytool.app/release.json shows the new commit.
- Then do step 2 anyway, so `main` matches what is live.

This needs the owner's Vercel login. The CI token can deploy, but it is not
meant for hand rollbacks.

## 4. The database is wrong

- **Bad schema change:** write a new migration with a later timestamp that
  puts it back (CI's migration-order check enforces the timestamp). Never edit
  or delete a migration that production has applied.
- **Lost or damaged data:** the project is on Supabase's Pro plan, which
  takes one backup a day and keeps the last 7. Restoring one means dashboard →
  Database → Backups and needs the owner. A restore rewinds every table to
  that day's snapshot, so anything written since is lost; prefer fixing the
  rows by hand when the damage is small.
- **Point-in-time restore** (rewind to any minute, not just the daily copy)
  is a paid add-on the owner turns on in the dashboard. It was not confirmed
  as on when this page was written; check Database → Backups before relying
  on it.

## 5. The phone apps

The iPhone and Android apps carry their own copy of the web app. A web
rollback does not reach them. Steps 1 and 4 do, because flags and the
database are shared. A broken app build needs a new build through the stores
(TestFlight / Play internal testing first).

## After it's fixed

- Close the `alert` issue (the monitor also closes it on the next healthy
  check), and note what happened and what fixed it.
- If a check would have caught it sooner, add one to `scripts/prod-smoke.mjs`
  or to CI.
