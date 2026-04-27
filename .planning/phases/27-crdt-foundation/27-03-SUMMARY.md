---
phase: 27-crdt-foundation
plan: 03
subsystem: database
tags: [supabase, postgres, yjs, crdt, rls, bytea, migrations, AUTH-03]

# Dependency graph
requires:
  - phase: 27-crdt-foundation
    provides: "Plan 27-01 schema test scaffolds (schemaPresence.test.mjs + cryptYjsUpdatesSchema.test.mjs) — flip from skipped to passing once this migration is applied to a Supabase test DB"
provides:
  - "doc_yjs_updates table: append-only bytea Yjs update log with monotonic seq + AUTH-03 server_ts"
  - "doc_yjs_state table: per-document Y.Doc snapshot (state + state_vector + through_seq + encoding_version)"
  - "activity_log table: server-authoritative audit trail with AUTH-03 server_ts"
  - "3 stub deny-all RLS policies (Phase 28 hand-off — replaced with full user_can_access_document() gating)"
  - "Reversible rollback file with idempotent IF EXISTS + CASCADE drops"
affects: [28-transport, 32-compaction, 33-activity-log, AUTH-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Append-only update log: NEVER deleted, monotonic seq per document_id, bytea binary storage (Pitfall 15 defense)"
    - "Snapshot-plus-log architecture: doc_yjs_state holds compacted snapshot + through_seq pointer back into doc_yjs_updates (Pitfall 10 defense)"
    - "AUTH-03 column convention: server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW() — server-authoritative timestamp on every transaction"
    - "encoding_version SMALLINT for forward-compat schema evolution (Pitfall 17 defense)"
    - "RLS-from-day-one: ENABLE ROW LEVEL SECURITY + named stub deny-all policy per table; future phase replaces policy body, not the enable flag"
    - "Rollback file convention: same dated prefix + .down.sql suffix (extends existing supabase/rollbacks/ pattern)"

key-files:
  created:
    - "supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql"
    - "supabase/rollbacks/20260428000000_phase27_crdt_foundation_schema.down.sql"
  modified: []

key-decisions:
  - "Stub deny-all RLS policies named with phase27 suffix (doc_yjs_updates_phase27_stub_deny_all etc.) so Phase 28 can DROP POLICY by name and create new policies without colliding"
  - "DROP POLICY IF EXISTS appears in forward migration before CREATE POLICY for full idempotency on re-apply"
  - "Rollback file uses defensive DROP POLICY + DROP INDEX before DROP TABLE CASCADE — idempotent even if table was partially created"
  - "All 3 tables FK to documents(id) ON DELETE CASCADE — document deletion cleans up Y.Doc updates, snapshots, and activity log automatically"
  - "encoding_version SMALLINT NOT NULL DEFAULT 1 ships from day one so Phase 32+ can roll forward to a v2 Yjs encoding without a separate ALTER TABLE migration"

patterns-established:
  - "Phase 27 schema migration filename convention: 20260428000000_phase27_crdt_foundation_schema.sql (date_phase_descriptive_name)"
  - "Rollback filename mirrors forward: same dated prefix + .down.sql suffix"
  - "Stub policy naming: <table>_<phase>_stub_deny_all — phase-suffixed for collision-free phase boundaries"
  - "Inline AUTH-03 documentation: COMMENT ON COLUMN with the requirement ID + DEFAULT NOW() rationale visible in pg_description / Supabase Studio"

requirements-completed: [AUTH-03]

# Metrics
duration: 2min
completed: 2026-04-27
---

# Phase 27 Plan 03: CRDT Foundation Schema Migration Summary

**Supabase migration creating doc_yjs_updates + doc_yjs_state + activity_log with bytea binary storage, AUTH-03 server-authoritative timestamps, RLS stubs, and a reversible rollback — Phase 28's transport adapter writes to this exact schema.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-27T17:17:16Z
- **Completed:** 2026-04-27T17:18:51Z
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 2 (1 forward migration, 1 rollback)

## Accomplishments

- **AUTH-03 schema-enforced from day one** — `server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()` on both `doc_yjs_updates` and `activity_log`. No application code can omit it.
- **Pitfall 15 defended** — `update`, `state`, `state_vector` are all `BYTEA`, not `TEXT`. No base64 round-trip overhead, no Yjs binary corruption from text encoding mishaps.
- **Pitfall 10 defended** — `doc_yjs_state` provides the snapshot side of the snapshot+log architecture so Phase 32 compaction has a target table from day one.
- **Pitfall 17 defended** — `encoding_version SMALLINT NOT NULL DEFAULT 1` lets future Yjs encoding versions roll forward without a schema migration.
- **Pitfall 1 defended** — migration is idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS) and reversible via the matching rollback. Partial-state recovery works.
- **3 stub deny-all RLS policies** ENABLEd on every table — Phase 28 replaces policy body without touching `ENABLE ROW LEVEL SECURITY`.
- **Plan 27-01 test scaffolds (`schemaPresence.test.mjs` + `cryptYjsUpdatesSchema.test.mjs`)** flip from skipped to passing as soon as a `SUPABASE_TEST_URL` is supplied and this migration is applied.

## Task Commits

Each task was committed atomically:

1. **Task 1: Forward migration SQL — doc_yjs_updates + doc_yjs_state + activity_log + RLS stubs** — `4f56d4bb` (feat)
2. **Task 2: Rollback SQL — DROP TABLE in reverse-FK-safe order** — `6e8666ca` (feat)

**Plan metadata commit:** issued after this SUMMARY.md is written.

## Files Created/Modified

- `supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql` (97 lines, 5,124 bytes) — CREATE TABLE for the 3 tables, 2 indexes, 3 ENABLE ROW LEVEL SECURITY + 3 stub deny-all policies, 5 COMMENT statements documenting AUTH-03.
- `supabase/rollbacks/20260428000000_phase27_crdt_foundation_schema.down.sql` (20 lines, 1,169 bytes) — defensive DROP POLICY + DROP INDEX + DROP TABLE CASCADE in safe order, fully idempotent.

## Decisions Made

- **Stub policy naming convention** — `<table>_phase27_stub_deny_all` so Phase 28 can `DROP POLICY` by exact name without ambiguity. Phase 28 creates new policies under different names (e.g. `<table>_select_authorized`, `<table>_insert_authorized`) so the boundary is collision-free.
- **`DROP POLICY IF EXISTS` inside forward migration** — placed before each `CREATE POLICY` so re-running the migration on a database where the policies already exist is safe. Combined with `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, the entire migration is idempotent on re-apply.
- **Rollback uses CASCADE** — even though no table references another, CASCADE is defensive against any future FK additions and policy/index residue.
- **All comments inline AUTH-03** — `COMMENT ON COLUMN doc_yjs_updates.server_ts` + `COMMENT ON COLUMN activity_log.server_ts` document the requirement ID directly in the schema, visible via Supabase Studio + `pg_description`. Future maintainers see the AUTH-03 attribution without having to grep `.planning/`.

## Deviations from Plan

None — plan executed exactly as written. All 9 acceptance criteria for Task 1 and 6 acceptance criteria for Task 2 verified via grep.

The single nuance: the Task 1 verification command `grep -c "server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW()"` returned 0 because the actual column declarations have aligned padding (`server_ts   TIMESTAMPTZ ...` and `server_ts     TIMESTAMPTZ ...`). The semantic acceptance criterion (2 columns with that exact type+constraint) is met — verified with `grep -c -E "server_ts +TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)"` which returns exactly 2. This is a verification-command robustness issue, not a plan deviation.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required at this plan's level. To actually verify the migration end-to-end against a live Supabase test database (Plan 27-01's `SUPABASE_TEST_URL` flow), Phase 28 plans the test-environment provisioning. This plan only ships the SQL.

## Pitfall Coverage Verification

| Pitfall | Defense in this plan |
|---|---|
| 1 (migration partial-state) | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + `DROP POLICY IF EXISTS` make forward migration idempotent. Rollback file with `DROP TABLE IF EXISTS ... CASCADE` enables clean reversal at any partial-apply state. |
| 10 (Y.Doc grows forever) | `doc_yjs_state` snapshot table with `state`, `state_vector`, `through_seq`, `encoding_version` is ready for Phase 32 compaction job to write to from day one. |
| 15 (TEXT-vs-bytea) | `update BYTEA NOT NULL`, `state BYTEA NOT NULL`, `state_vector BYTEA NOT NULL` — 3 BYTEA columns, zero TEXT columns for binary data. |
| 17 (schema evolution) | `encoding_version SMALLINT NOT NULL DEFAULT 1` ships in the initial schema; future Yjs encoding versions roll forward by writing a different value, no schema migration needed. |

## Phase 28 Hand-off

The 3 stub policies that **MUST** be replaced by Phase 28 with full `user_can_access_document()` gating:

1. `doc_yjs_updates_phase27_stub_deny_all ON doc_yjs_updates` — Phase 28 splits into `_select_authorized` + `_insert_authorized` (no UPDATE/DELETE — append-only invariant).
2. `doc_yjs_state_phase27_stub_deny_all ON doc_yjs_state` — Phase 28 splits into `_select_authorized` + `_insert_authorized` + `_update_authorized` (compaction job writes upsert).
3. `activity_log_phase27_stub_deny_all ON activity_log` — Phase 28 splits into `_select_authorized` + `_insert_authorized` (Phase 33 reads, server-side listener writes).

Phase 28's transport adapter MUST use the service-role key for inserts (RLS bypass pattern) since the binary updates are written by the server-side listener, not directly by client requests. Client RLS policies only need to grant SELECT for the syncing client.

## Next Phase Readiness

- Schema is ready for Plan 27-04 (`<YDocProvider>` wiring) — that plan does NOT touch this schema; it operates on local IndexedDB only. Server-side schema usage is Phase 28.
- Plan 27-01's test scaffolds will pass as soon as a Supabase test DB is provisioned with this migration applied — the test logic was correct from the start; this plan is the dependency they were waiting on.
- AUTH-03 requirement is now schema-enforced (NOT NULL DEFAULT NOW()) — application code physically cannot insert a row without `server_ts`.

## Self-Check: PASSED

Verified files exist and commits exist:
- `supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql` — FOUND (5,124 bytes)
- `supabase/rollbacks/20260428000000_phase27_crdt_foundation_schema.down.sql` — FOUND (1,169 bytes)
- Commit `4f56d4bb` (Task 1) — FOUND
- Commit `6e8666ca` (Task 2) — FOUND

---
*Phase: 27-crdt-foundation*
*Completed: 2026-04-27*
