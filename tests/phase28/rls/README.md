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
