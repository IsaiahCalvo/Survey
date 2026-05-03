-- Phase 31 hotfix recovery v2 (2026-05-03)
--
-- The first unseal migration (20260503154950) reset cutover_completed_at to
-- NULL so the next open could re-run the now-paginated import loop. But the
-- pre-fix runBackfill code short-circuited when the per-user `backfill_done`
-- marker in Y.Map.meta was set, even when the caller was requesting
-- markCutoverComplete. So the next open hit the short-circuit, skipped the
-- import loop, and re-sealed the same truncated Y.Map (yMapSize:1066,
-- captured in Logs/2026-05-03_15-58-54).
--
-- A second hotfix to crdtBackfill.js (commit follow-up) makes the doneKey
-- short-circuit defer to markCutoverComplete: when the caller is requesting
-- a seal, fall through to the paginated SELECT regardless of doneKey state.
-- Bridge idempotency keeps re-runs cheap on already-imported rows.
--
-- Re-unseal Package 2 so the next open with the new code re-imports the
-- missing ~22,000 rows and seals on a verified count.

UPDATE documents
SET cutover_completed_at = NULL
WHERE id = '70dadd86-35f0-432b-925f-c59e919a4e4d';
