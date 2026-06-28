# Phase 28 RLS Test Suite

Phase 28 Wave 0 scaffold. This suite verifies the role-gated RLS policies + BEFORE INSERT trigger that Plan 28-05's migration creates on `doc_yjs_updates`. Until that migration applies, every test in this suite prints `SKIP: <reason>` per its own pre-check guard and exits cleanly — they auto-flip to `PASS` once the migration lands.

## Prerequisites

Required environment variable:

- `SUPABASE_TEST_URL` — psql connection string to a Supabase test database with the Phase 28 migration applied.

Example:

```bash
export SUPABASE_TEST_URL='postgresql://postgres:postgres@localhost:54322/postgres'
```

## Run

From the project root:

```bash
psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql
```

The aggregator runs all 4 numbered tests in order. Each test wraps its own `BEGIN; ... ROLLBACK;` so test fixtures never persist.

## Expected output

Once Plan 28-05 lands the migration:

```
Running Phase 28 RLS test suite...
NOTICE:  PASS Test 1a: owner SELECT succeeded
NOTICE:  PASS Test 1b: owner INSERT succeeded
NOTICE:  PASS Test 2: editor INSERT succeeded
NOTICE:  PASS Test 3a: viewer SELECT succeeded
NOTICE:  PASS Test 3b: viewer INSERT correctly rejected (42501)
NOTICE:  doc_yjs_updates RLS tests COMPLETE
NOTICE:  PASS: trigger overrode origin.userId to authenticated user (auth.uid())
NOTICE:  PASS: all other origin keys (source, deviceId, sessionId, clientID) preserved
NOTICE:  origin.userId override tests COMPLETE
NOTICE:  PASS: non-collaborator INSERT correctly rejected (42501) — kick UX path verified
NOTICE:  non-collaborator INSERT rejection tests COMPLETE
NOTICE:  PASS: non-viewer SELECT returned 0 rows (RLS silently filtered as expected)
NOTICE:  PASS: viewer SELECT returned 1 rows ...
NOTICE:  SELECT-gated-by-viewer tests COMPLETE
Phase 28 RLS suite PASSED
```

Failure modes:

- Any `ERROR:` line → test failed; the explicit `RAISE EXCEPTION 'FAIL: ...'` message describes the violation.
- A `SKIP:` notice → the prerequisite migration / table / function is missing; the test is non-applicable in this environment, NOT a failure.

## Status

This suite ships GREEN-OR-SKIPPED for Wave 0:

- Today (Plan 28-01): every test reports `SKIP` because Plan 28-05's migration has not yet shipped. The suite is callable and returns 0 — that's the Wave 0 contract.
- After Plan 28-05: every test reports `PASS`. No further changes to the test suite needed.

## Why not pgTAP

This project does not use [pgTAP](https://pgtap.org/) because:

1. pgTAP requires a Postgres extension install on the test DB — adding ops complexity for a tiny test suite.
2. The existing `supabase/migrations/` files use `DO $$ BEGIN ... END $$;` blocks for inline assertion logic; the same shape works perfectly for tests.
3. `RAISE EXCEPTION` and `RAISE NOTICE` are sufficient for the small number of assertions this suite needs.

If a future phase brings dozens of RLS scenarios, revisit the pgTAP decision then.

## Files

- `01_doc_yjs_updates_rls.sql` — owner / editor / viewer role gating on SELECT and INSERT
- `02_origin_userId_override.sql` — BEFORE INSERT trigger overrides client-claimed `origin.userId`
- `03_non_collaborator_insert_rejected.sql` — non-collaborator INSERT raises 42501 (kick UX path)
- `04_select_gated_viewer.sql` — non-viewer SELECT returns 0 rows (silent RLS filter)
- `run-all.sql` — aggregator invoked via `\i` from each numbered test

## How to extend

When a future plan adds a new RLS scenario, add `0N_descriptive_name.sql` and `\i` it from `run-all.sql`. Each new test file follows the same template:

1. `BEGIN;`
2. `DO $$ BEGIN IF NOT EXISTS (...) THEN RAISE NOTICE 'SKIP: ...'; RETURN; END IF; ... END $$;`
3. `ROLLBACK;`

The skip-guard pattern is what makes the suite green-or-skipped from Wave 0 forward.

## Files 05–10 — the role-permission regression suite (added 2026-06-28)

`05`–`10` extend the suite beyond `doc_yjs_updates` to the rest of the permission surface
(RLS is the app's SOLE permission layer — no app-layer fallback):

- `05_documents_rls.sql` — documents: owner full access, collaborator SELECT, viewer read-only, non-collaborator denied
- `06_document_collaborators_rls.sql` — only owner can grant/revoke/change collaborators; last-owner guard
- `07_document_annotations_rls.sql` — owner+editor write, viewer read-only, non-collaborator denied (the core data)
- `08_document_invites_rls.sql` — owner creates/revokes invites; accept-RPC gating; no forging
- `09_storage_documents_bucket_rls.sql` — private `documents` bucket; data-driven object ACL; cross-document bleed check
- `10_excel_sync_audit_immutability.sql` — append-only audit (UPDATE/DELETE blocked); client lockout

Each acts out owner/editor/viewer/non-collaborator, runs every persona under
`SET LOCAL ROLE authenticated` (so RLS actually fires), and is skip-guarded (incl. an
`auth.users` FK guard) → GREEN-OR-SKIPPED.

### Status: LIVE-PASS on survey-test (verified 2026-06-28)

All of 05–10 execute their assertions live and pass against the survey-test project. To
provision a bare test DB so they run live (instead of skipping):

```bash
# 1. provision schema (idempotent; NEVER run against production):
psql "$SUPABASE_TEST_URL" -f scripts/rls-test-db-provision.sql
psql "$SUPABASE_TEST_URL" -f scripts/rls-test-db-personas.sql
# 2. run the suite:
psql "$SUPABASE_TEST_URL" -f tests/phase28/rls/run-all.sql
# teardown: scripts/rls-test-db-teardown.sql
```

Without a psql connection string, each file's SQL can be POSTed to the Supabase
Management API `/database/query` (the `SET LOCAL ROLE authenticated` inside still makes
RLS fire); HTTP 201 = clean, HTTP 400 = a FAIL/error with the message. NOTE: `\i`/`\echo`
are psql-only, so send the individual `05`–`10` files, not `run-all.sql`, via the API.
