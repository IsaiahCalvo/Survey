-- PROPOSED — NOT APPLIED. OWNER DECISION. Kept OUT of supabase/migrations/
-- (deploy-production.yml runs `supabase db push`). Apply by hand in the SQL
-- editor only after the owner says yes; take/confirm a backup first.
--
-- w36 (2026-09-25): the database is 318 MB of Free's 500 MB (read-only at the
-- cap). 211 MB of it is two tables the current annotation store no longer uses
-- for anything a person sees. Evidence (read-only queries on prod "Survey",
-- 2026-09-25, and a code trace of every reference):
--
-- document_annotations — 193 MB total: 102 MB table, 15 MB toast, 86 MB
--   indexes (61 MB of that is one GIN index, idx_document_annotations_data,
--   used 11 times since statistics began). 12,029 live rows:
--     11,506 legacy marks (ink 9,337, square 1,905, others 264) in 52
--            documents, last written 2026-08-21. Annotations have been read
--            from the Yjs store (annotation_updates + annotation_snapshots)
--            since June; nothing current writes these rows, and what the
--            screen shows never comes from them. Remaining readers: the old
--            Y.Doc backfill in YDocProvider (a hidden copy that is not what
--            the viewer shows), and kal48_create_revision, which copies them
--            into saved revisions whose Restore only writes this table back.
--        523 Survey Marker rows (16 documents) — STILL LIVE: the viewer
--            re-upserts every marker here ~2 s after a marker change, and the
--            Templates editor counts them before deleting a checklist item.
--            KEEP THESE.
--   The row data itself is ~20 MB; the rest is dead space from ~60k deletes
--   and ~26k updates in the old dual-write era, plus the GIN index.
--
-- doc_yjs_state — 18 MB (112 rows). No live code path: its only reader,
--   src/lib/collab/snapshotStore.js, is imported by nothing but a test; no
--   trigger, RPC or edge function uses it. agent-cli debug tools read it.
--
-- What this frees: ~190 MB of document_annotations (it shrinks to ~1 MB of
-- Survey Markers) + 18 MB of doc_yjs_state = ~208 MB, taking the database
-- from ~318 MB to ~110 MB (22% of Free). The size Supabase measures only
-- drops after the VACUUM FULL at the bottom (run separately; it cannot run
-- inside a transaction).
--
-- What changes for people: nothing visible. Saved revisions made after this
-- hold only Survey Markers from this table (restoring a revision never changed
-- what the viewer shows anyway). The hidden old Y.Doc backfill finds nothing
-- to import for documents it had not already migrated.
--
-- Rollback: none. A Free-plan project may have no restorable backup (check
-- Database > Backups in the dashboard), so export the rows first:
--   COPY (SELECT * FROM public.document_annotations
--          WHERE annotation_type NOT IN ('survey-marker', 'highlight'))
--     TO STDOUT WITH CSV HEADER;   -- (psql \copy from a laptop)

BEGIN;

-- 1. Legacy marks. Survey Markers ('survey-marker', and the legacy
--    'highlight' spelling) stay.
DELETE FROM public.document_annotations
 WHERE annotation_type NOT IN ('survey-marker', 'highlight');

-- 2. The 61 MB GIN index over annotation_data. The one live jsonb query (the
--    Templates editor's checklist count) filters annotation_data->checklistResponses,
--    which this index cannot serve; with ~500 rows left a scan is instant.
DROP INDEX IF EXISTS public.idx_document_annotations_data;

-- 3. The unused gzip Y.Doc cache.
TRUNCATE TABLE public.doc_yjs_state;

COMMIT;

-- 4. Give the space back (separately, SQL editor, at a quiet moment; takes
--    an exclusive lock for a second or two at these sizes):
--   VACUUM (FULL, ANALYZE) public.document_annotations;
--
-- Later (separate decision, not in this file): drop doc_yjs_state and the
-- dead code around it (snapshotStore.js, agent-cli commands) once the
-- agent-cli tools no longer need it; retire the Survey Marker copy in
-- document_annotations once the Templates checklist count reads markers from
-- the Yjs store.
