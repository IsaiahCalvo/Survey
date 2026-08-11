# KAL-431 — 30-day Archive auto-cleanup

_Written: 2026-08-11 15:20_

**Status: ENABLED on production 2026-08-11 (owner-directed).** Migration applied,
Edge Function deployed with its cron secret, and a pg_cron job
(`archive-purge-sweep`, daily 03:00 UTC, limit 100) calls it via pg_net.
Verified end to end the same day: dry-run and real bounded invokes both
succeeded through the Edge Function (runs 4-5, nothing due, nothing deleted).
Two production-only fixes were needed and are pinned in the migration: explicit
REVOKE from anon/authenticated (hosted default privileges auto-grant EXECUTE),
and TRUNCATE instead of an unfiltered scratch-table DELETE (pg-safeupdate).
Disable any time: `SELECT cron.unschedule('archive-purge-sweep');`

---

## What this is

Survey's Archive (KAL-426) gives a deleted document, project or template a
30-day grace period, then leaves it sitting there forever. Nothing ever removed
expired items. This adds the job that does.

| Piece | File | Job |
|---|---|---|
| The sweep | `supabase/migrations/20260811000000_kal431_archive_purge_sweep.sql` | Finds expired items, purges them through the existing `purge_archived_*` RPCs, logs every run |
| The scheduled caller | `supabase/functions/archive-purge-sweep/index.ts` | Runs the sweep on a schedule, then unlinks the stored PDFs it freed |

The purge itself is **not** re-implemented — the sweep calls the same
owner-enforced `purge_archived_document / _project / _template` functions the
Archive screen already uses. Those own cascade behaviour and work out which
stored files became unreferenced. Because those RPCs gate on `auth.uid()` and a
cron run has no JWT, the sweep adopts each row's owner identity for exactly the
one call, leaving the shipped RPCs byte-identical.

### Why the Edge Function exists

The purge RPCs deliberately report `orphaned_paths` and leave the unlink to the
caller. Deleting `storage.objects` rows from SQL would drop the metadata but
strand the S3 bytes forever, so the Edge Function removes them through the
Storage API instead — the same call the client services already make.

---

## ⚠️ Decision needed: a defect in KAL-426 that this job refuses to trigger

`purge_archived_project` deletes children with:

```sql
DELETE FROM public.documents WHERE project_id = p_project_id;   -- line 717
```

No owner filter, no archived filter. But `archive_project` only archives
children `WHERE project_id = p_project_id AND user_id = v_owner`.

**Consequence:** a document a collaborator added to a shared project — or any
document added after the project was archived — stays **live**, yet the
project's purge would delete it, with no archive entry, no 30-day window and no
undo for its owner.

This is pre-existing and reachable today by clicking "delete forever" on such a
project. **The sweep will not turn it into an unattended nightly loop**: it
refuses to purge any project that still holds a non-archived document, records
the reason `project_holds_live_document`, and moves on.

That refusal is a safety catch, not a fix, and it means such a project never
auto-purges. **Fixing the RPC is your call** — the natural fix is to delete
children by `archive_group_id = v_group` (exactly the set `archive_project`
stamped) instead of by `project_id`. That is a change to a live production
function, so it is deliberately not included here.

Find affected projects before enabling:

```sql
SELECT p.id, p.name, count(d.id) AS live_documents_inside
  FROM projects p JOIN documents d ON d.project_id = p.id
 WHERE p.user_archived_at IS NOT NULL AND d.user_archived_at IS NULL
 GROUP BY p.id, p.name;
```

---

## Blast radius — read this before enabling

**This job permanently deletes user data. There is no undo.**

What it can delete on each run:

- Archived **documents** past their expiry — and by cascade their marks,
  history, snapshots, revisions, invites, collaborators, presence and Excel-sync
  rows.
- Archived **projects** past their expiry — *and every document inside them*, as
  one group.
- Archived **templates** past their expiry — and their collaborators/invites.
- The **stored PDF files** left unreferenced by the above.

What it will **never** touch:

- Anything not archived (`user_archived_at IS NULL`) — live data is invisible to it.
- Anything still inside its 30-day window. Expiry is re-checked under a row lock
  immediately before each purge, so an item restored and re-archived mid-run
  keeps its fresh window instead of being deleted early.
- A document with **any** surviving parent project row — archived or live.
- A document in an archived project's group — it waits and goes with the project,
  so a project never half-purges.
- A project that still holds a live document (see the section above).
- A stored file any surviving document row still references. Shared,
  content-addressed uploads are safe, and the Edge Function re-checks each path
  immediately before deleting in case the same file was re-uploaded meanwhile.
- Anything, if invoked without the service-role key or the cron secret.

**Scale of the first real run:** every item archived more than 30 days ago
becomes due at once. Check the backlog first:

```sql
SELECT
  (SELECT count(*) FROM documents WHERE user_archived_at IS NOT NULL AND user_archive_expires_at <= now()) AS documents_due,
  (SELECT count(*) FROM projects  WHERE user_archived_at IS NOT NULL AND user_archive_expires_at <= now()) AS projects_due,
  (SELECT count(*) FROM templates WHERE user_archived_at IS NOT NULL AND user_archive_expires_at <= now()) AS templates_due;
```

The batch cap (default 50, hard max 500) drains that over several runs rather
than in one transaction.

---

## Enabling it on production

Production (`cvamwtpsuvxvjdnotbeg`) is hand-managed; apply this by hand.

### Step 0 — confirm the scheduler (owner)

Not verified by me, because verifying it would have meant querying production:

```sql
SELECT name, installed_version FROM pg_available_extensions
 WHERE name IN ('pg_cron', 'pg_net');
```

This decides which scheduling option below you can use.

### Step 1 — apply the migration

Run the full contents of
`supabase/migrations/20260811000000_kal431_archive_purge_sweep.sql`
in the SQL editor (or via the Management API `/v1/projects/<ref>/database/query`).

Creates `public.archive_purge_runs`, `public.archive_purge_failures` and
`public.sweep_expired_archives(integer, boolean)`. Adds nothing to any existing
table and changes no existing function. **Applying it deletes nothing** — the
sweep only runs when called.

Verify:

```sql
SELECT has_function_privilege('service_role','public.sweep_expired_archives(integer, boolean)','EXECUTE') AS service_ok,
       has_function_privilege('authenticated','public.sweep_expired_archives(integer, boolean)','EXECUTE') AS user_blocked;
-- expect service_ok = true, user_blocked = false
```

### Step 2 — dry run (deletes nothing)

```sql
SELECT public.sweep_expired_archives(50, true);   -- p_dry_run = true
```

Reports exactly what it would purge and **deletes nothing**. Read the `details`
array and confirm the list is what you expect before going further.

### Step 3 — a small real run

```sql
SELECT public.sweep_expired_archives(5);
SELECT * FROM public.archive_purge_runs ORDER BY started_at DESC LIMIT 1;
```

This deletes for real, bounded to 5 items. Note that called this way the DB rows
go but the stored PDFs are not yet unlinked — Step 4 is what does that.

### Step 4 — deploy the Edge Function

```bash
supabase functions deploy archive-purge-sweep --project-ref cvamwtpsuvxvjdnotbeg
supabase secrets set ARCHIVE_PURGE_CRON_SECRET="$(openssl rand -hex 32)" --project-ref cvamwtpsuvxvjdnotbeg
```

`verify_jwt = false` is already committed for this function in
`supabase/config.toml` — it authenticates the service-role key or the cron
secret itself, and an ordinary user's JWT is explicitly not sufficient.

Rehearse, then run for real:

```bash
# dry run — deletes nothing
curl -X POST "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/archive-purge-sweep" \
  -H "x-cron-secret: <the secret>" -H "Content-Type: application/json" \
  -d '{"limit": 5, "dry_run": true}'

# real, bounded
curl -X POST "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/archive-purge-sweep" \
  -H "x-cron-secret: <the secret>" -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

### Step 5 — schedule it

**Preferred — Supabase Cron → Edge Function** (storage gets unlinked):
Dashboard → Integrations → Cron → new job, daily at `0 3 * * *`, type "Edge
Function", target `archive-purge-sweep`, header `x-cron-secret`, body
`{"limit": 100}`.

**Alternative — pg_cron → Edge Function via pg_net:**

```sql
SELECT cron.schedule('archive-purge-sweep', '0 3 * * *', $$
  SELECT net.http_post(
    url     := 'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/archive-purge-sweep',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<the secret>"}'::jsonb,
    body    := '{"limit": 100}'::jsonb);
$$);
```

**SQL-only fallback** (`SELECT public.sweep_expired_archives(100)`) works and is
safe, but **strands the stored PDF bytes** — DB rows go, files stay. Only use it
if Edge Functions are unavailable, and plan a storage reconciliation.

### Step 6 — turn it off

```sql
SELECT cron.unschedule('archive-purge-sweep');
```

Or delete the Cron job in the dashboard. The function is inert when nothing
calls it.

---

## Watching it

```sql
-- Recent runs
SELECT id, started_at, dry_run, projects_purged, documents_purged, templates_purged,
       failed_count, skipped_count, over_limit_count,
       array_length(orphaned_paths,1) AS files_freed, unlinked_count,
       array_length(unlink_failed_paths,1) AS files_stranded
  FROM public.archive_purge_runs ORDER BY started_at DESC LIMIT 20;

-- Anything that refused to purge
SELECT id, started_at, jsonb_pretty(details)
  FROM public.archive_purge_runs WHERE failed_count > 0 ORDER BY started_at DESC LIMIT 5;

-- Items quarantined after repeated failures — these need a human
SELECT * FROM public.archive_purge_failures WHERE attempts >= 5 ORDER BY last_failed_at DESC;
```

`details` records each item as `purged`, `would_purge` (dry run), `skipped` (with
a reason) or `error` (with the SQL error). Skip reasons:

| Reason | Meaning |
|---|---|
| `deferred_to_project_group` | Child of an archived project; goes with the project |
| `parent_project_survives` | Some project row is still its parent |
| `project_holds_live_document` | Project contains a non-archived document (see above) |
| `no_longer_due` | Restored/re-archived mid-run; clock reset |
| `quarantined_after_repeated_failure` | Failed 5 times; needs investigation |

**A repeatedly-failing item cannot block the queue.** After 5 attempts it is
quarantined out of selection so healthy rows keep draining. Investigate, then
`DELETE` its row from `archive_purge_failures` to re-queue it.

`over_limit_count` is the eligible backlog that did not fit the batch — if it
stays high, raise the limit or the frequency.

The Edge Function logs content-free structured JSON (`sweep_start`,
`sweep_committed`, `unlink_skipped_revived`, `sweep_done`).

---

## What was proved, and how

`scripts/test-archive-purge-sweep-postgres.mjs` — **60 assertions** against a
real disposable Postgres, using the **actual** KAL-426 function bodies sliced out
of the shipped migration (no hand-copied SQL to drift):

- an item past expiry is purged; one inside its window is not; the boundary is inclusive
- a project purges with all its children as one group
- a re-run is a clean no-op, and purging is idempotent
- a stored file shared with a surviving row is **not** unlinked
- a child of an archived-but-unexpired project is skipped, then purged with the project once it expires
- a child of a live project is never purged
- a project holding a live document is refused; it purges once nothing live remains
- an item re-archived mid-run is **not** deleted early
- the batch cap holds, the oldest expiry drains first, the backlog is counted, a bad limit falls back to the default
- a deliberately unpurgeable row is recorded and its neighbours still purge — in that run and later ones
- persistent failures are quarantined and a starved healthy row then drains
- a dry run reports and deletes nothing
- an overlapping run stands down on the advisory lock; no lock is held after a run
- every run is logged; `authenticated`/`anon` cannot execute the sweep

`tests/archiveSweepSelection.test.mjs` — **24 tests** pinning the selection rules
as pure code in `src/services/archiveSweepSelection.js`, so "which rows are due"
is not buried only in SQL.

```bash
node scripts/test-archive-purge-sweep-postgres.mjs   # needs local postgres@16 on PATH
node --test tests/archiveSweepSelection.test.mjs
```

### Not proved

- **Never executed against any hosted Supabase project.** The dedicated
  `survey-test` project (`zgdkyslxbkusexmkfvgd`) has been **deleted** — the
  Management API returns "Resource has been removed", and the token now sees only
  `Survey` (production), `CB Operation` (inactive) and `walkthru`. With no safe
  cloud target, verification ran against local Postgres instead. Re-creating
  survey-test and re-running Steps 2–4 there is the missing rehearsal.
- **The Edge Function has not been deployed or invoked**, so the Storage
  `.remove()` path and the run-log write-back are unexercised. They use the same
  calls the client services already make in production, but not in this shape.
- **`auth.uid()` impersonation is proved only against a faithful local stub** of
  Supabase's function (it reads both `request.jwt.claim.sub` and
  `request.jwt.claims`, matching the real definition), never against real
  Supabase Auth.
- **`pg_cron` / `pg_net` availability on production is unconfirmed** (Step 0).
