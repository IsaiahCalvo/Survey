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

## 3. The site is down right now: roll back the web app

When there is no time for CI (about 10 minutes), point surveytool.app back at
the last good deployment. Claude can do this alone:

- Actions → **Roll back production** → Run workflow. Leave the target empty
  to go back one production deployment, or paste a deployment id or URL.
  Run it once with **dry run** ticked to see what will move, then again
  without it. From a terminal: `gh workflow run rollback-production.yml -f dry_run=false`.
- It moves the surveytool.app aliases with the CI token, takes seconds and
  touches only the web files. The database and Supabase functions stay as
  they are.
- The next normal production deploy takes surveytool.app back by itself, so
  there is nothing to undo. Check https://surveytool.app/release.json after.
- Then do step 2 anyway, so `main` matches what is live.

The owner can also use the Vercel dashboard (Deployments → last good one →
**Instant Rollback**). That one stops later deploys from taking the domain
until someone presses **Undo Rollback** or runs `vercel promote`, so prefer
the workflow.

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
  is a paid add-on (about $100/month for 7 days). It was off on 2026-10-21.
- **Files are not in Supabase's backups.** They hold the database only. See
  "Storage backup" below for the weekly copy of PDFs and photos (off until
  `STORAGE_BACKUP_ENABLED` is set).

### Restoring the database

Weekly proof: Actions > "Backup restore drill" checks the daily backups are
fresh and restores a fresh dump into a throwaway local stack
(`scripts/backup-drill.mjs`). It raises an `alert` issue when either fails.

To rewind production to a daily backup (owner only, site is down meanwhile):

1. Note the time of the damage. Anything saved after the chosen backup is
   lost, so export what you can first (step below).
2. Dashboard > Database > Backups > Scheduled: pick the newest copy from
   before the damage and press Restore.
3. After it finishes, re-run Actions > "Deploy production" so any migration
   newer than the backup is applied again, then run "Backup restore drill".

To copy data out without rewinding (safer for small damage), restore a dump
locally and copy back only the rows you need:

```bash
supabase link --project-ref cvamwtpsuvxvjdnotbeg
node scripts/backup-drill.mjs --linked   # proves the dump restores
supabase db dump --linked --use-copy --data-only -f data.sql   # keep off the repo
```

The drill script shows the order a manual restore must follow: roles, then
schema, then data with `session_replication_role = replica`, in one
transaction. Drop `GRANT SET ON PARAMETER` lines from the roles file and empty
`COPY` blocks from the data file; both only touch Supabase's own objects.

### Storage backup

Actions > "Storage backup" (`scripts/storage-backup.mjs`) copies every stored
file once a week into the private `storage-backup` bucket of the same project,
as `<bucket>/<path>`. The copy happens inside Supabase, so it costs no egress;
the extra space is about the size of the files (181 MB on 2026-10-21, well
inside the Pro plan's 100 GB). A file removed from its bucket moves to
`_removed/<date>/<bucket>/<path>` and is purged 30 days later, so a deleted
account's files leave the backup within about five weeks. It guards against
deleted or overwritten files, not against losing the whole project.

It runs only when the repo variable `STORAGE_BACKUP_ENABLED` is `true`.

To put files back (a whole person, one document, or one file):

```bash
SUPABASE_URL=https://cvamwtpsuvxvjdnotbeg.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/storage-backup.mjs --restore documents/<user id>/
# or a removed one: --restore _removed/2026-10-21/documents/<user id>/<file>.pdf
```

Files that exist in their bucket now are left alone. The database rows that
point at them come from the database backup (above).

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
