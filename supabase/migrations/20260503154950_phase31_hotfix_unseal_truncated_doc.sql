-- Phase 31 hotfix recovery (2026-05-03)
--
-- The cutover backfill ran a bare `.select('*')` against `document_annotations`
-- pre-2026-05-03 hotfix. Supabase / PostgREST applies a server-side
-- `max_rows = 1000` cap on any `.select()` that does not paginate via
-- `.range()`. supabase/config.toml line 18 keeps this default. Any doc with
-- more than 1000 non-highlight legacy rows backfilled only the first ~1000
-- rows; the verified-count gate (`yMapSize >= imported`) was satisfied with
-- truncated input and the doc sealed (cutover_completed_at set on the
-- documents row) on a partial Y.Doc snapshot. Once sealed, the post-cutover
-- hydrate path read state from Y.Doc only and the missing rows never
-- rendered.
--
-- The hotfix paginates the SELECT with BACKFILL_PAGE_SIZE = 1000 and a
-- `.range()` loop. To recover affected docs, we reset
-- `cutover_completed_at = NULL` so the next open re-runs the (now-paginated)
-- backfill loop. The Phase 30 bridge's CREATE-branch idempotency check
-- (meta.authorId existence sentinel) means rows already imported into Y.Map
-- become EDIT-branch no-ops on re-run; only the missing rows (~22,000 in the
-- captured Package 2 case) get added on the second pass. The new gate then
-- re-seals on a complete count.
--
-- Conservative scope — only Package 2 - Rev 4 -- IC.pdf, the doc captured in
-- the 2026-05-03_15-20-12 console-log regression. Any other doc with >1000
-- non-highlight rows that opened post-Phase 31 deploy is also potentially
-- affected; if so, run a broader sweep keyed on
-- `(SELECT document_id FROM document_annotations WHERE annotation_type IN
-- (...non-highlight...) GROUP BY document_id HAVING COUNT(*) > 1000)`
-- after this hotfix lands and Package 2 is verified.

UPDATE documents
SET cutover_completed_at = NULL
WHERE id = '70dadd86-35f0-432b-925f-c59e919a4e4d';
