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
-- What changes for people: no mark on any page. Version History's saved
-- versions made after this count only Survey Markers ("N annotations" shows
-- smaller numbers); restoring an OLDER saved version (kal48_restore_revision)
-- writes its legacy rows back into this table (still invisible; it also
-- rewrites that document's Survey Marker rows, as it always did). The hidden
-- old Y.Doc backfill finds nothing to import for documents it had not already
-- migrated; leftover old dual-write queue entries in a browser's localStorage
-- may re-add a few legacy rows (harmless, invisible).
--
-- Rollback: none. A Free-plan project may have no restorable backup (check
-- Database > Backups in the dashboard), so export the rows first:
--   COPY (SELECT * FROM public.document_annotations
--          WHERE annotation_type NOT IN ('survey-marker', 'highlight'))
--     TO STDOUT WITH CSV HEADER;   -- (psql \copy from a laptop)

BEGIN;

-- 0. Side effects of a big DELETE here (w36 review B):
--    * trg_doc_annotations_changed_del updates documents.annotations_changed_at
--      for the 52 documents, and documents' own update_documents_updated_at
--      trigger would then show all 52 as "edited today" in the Documents list:
--      switched off for this statement only;
--    * the table is in the supabase_realtime publication with REPLICA IDENTITY
--      FULL, so each delete would write the whole old row (~100+ MB) to the
--      Postgres WAL for Realtime to decode. No live code subscribes to this
--      table (the viewer's subscription returns early; the other has no
--      callers), so the default identity (primary key only) is enough.
ALTER TABLE public.document_annotations REPLICA IDENTITY DEFAULT;
ALTER TABLE public.document_annotations DISABLE TRIGGER trg_doc_annotations_changed_del;

-- 1. Legacy marks. Survey Markers ('survey-marker', and the legacy
--    'highlight' spelling) stay.
DELETE FROM public.document_annotations
 WHERE annotation_type NOT IN ('survey-marker', 'highlight');

ALTER TABLE public.document_annotations ENABLE TRIGGER trg_doc_annotations_changed_del;

-- 2. The 61 MB GIN index over annotation_data. The one live jsonb query (the
--    Templates editor's checklist count) filters annotation_data->checklistResponses,
--    which this index cannot serve; with ~500 rows left a scan is instant.
DROP INDEX IF EXISTS public.idx_document_annotations_data;

-- 3. The unused gzip Y.Doc cache.
TRUNCATE TABLE public.doc_yjs_state;

COMMIT;

-- 4. Give the space back (separately, SQL editor, at a quiet moment). It
--    takes an exclusive lock that blocks reads AND writes of this table for
--    a few seconds at these sizes; requests queued behind it can hit the 8 s
--    statement timeout, so pick a moment nobody is working:
--   VACUUM (FULL, ANALYZE) public.document_annotations;
--
-- Later (separate decision, not in this file): drop doc_yjs_state and the
-- dead code around it (snapshotStore.js, agent-cli commands) once the
-- agent-cli tools no longer need it; retire the Survey Marker copy in
-- document_annotations once the Templates checklist count reads markers from
-- the Yjs store.
