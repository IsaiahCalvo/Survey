-- DB-sync audit (2026-06-03) optimization #1 — cheap, delete-safe fast-open probe.
--
-- The fast-open path skips the ~25-trip durable annotation re-read when the
-- row-sourced snapshot is provably current. The first implementation compared a
-- (rowCount, maxUpdatedAt) watermark, but the exact COUNT scans every owned row
-- under RLS (per-row user_can_access_document check) and hit the Postgres
-- statement timeout on large docs (~3.7s at 22k rows, 57014 on the biggest).
--
-- This adds a denormalized per-document change marker so the probe becomes a
-- single ~200ms read of ONE documents row that also catches deletes:
--   documents.annotations_changed_at  — bumped to now() by a STATEMENT-level
--   trigger on every INSERT / UPDATE / DELETE of that document's annotations.
--
-- The app stamps each snapshot with the marker value read BEFORE its durable
-- read; on the next open it compares the live marker and skips the durable read
-- only on an exact match. Any insert/update/delete moves the marker, so a match
-- proves nothing changed — the wrong-page source-of-truth heal is preserved.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS annotations_changed_at timestamptz;

COMMENT ON COLUMN public.documents.annotations_changed_at IS
  'Denormalized "last time any of this document''s annotations changed" marker, '
  'maintained by the bump_doc_annotations_changed_at trigger on document_annotations. '
  'Used by the fast-open path to skip the durable annotation re-read when unchanged.';

-- Backfill so existing snapshots can match on the next open. max(updated_at) of a
-- doc''s annotations is index-served (cheap); fall back to now() for empty docs.
UPDATE public.documents d
SET annotations_changed_at = COALESCE(
  (SELECT max(a.updated_at) FROM public.document_annotations a WHERE a.document_id = d.id),
  now()
)
WHERE d.annotations_changed_at IS NULL;

-- SECURITY DEFINER is REQUIRED: the annotation writer may be a collaborator whose
-- RLS does not permit updating the documents row. Definer (owner) rights ensure
-- the marker ALWAYS bumps regardless of who wrote the annotation; otherwise a
-- collaborator's edit would leave the marker stale and another viewer could skip
-- the durable read and see stale data. search_path is pinned for definer safety.
CREATE OR REPLACE FUNCTION public.bump_doc_annotations_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.documents d
  SET annotations_changed_at = now()
  FROM (SELECT DISTINCT document_id FROM changed WHERE document_id IS NOT NULL) c
  WHERE d.id = c.document_id;
  RETURN NULL;
END;
$$;

-- Lock ordering is always annotation rows -> documents row (never the reverse),
-- so these single-row, id-keyed updates cannot deadlock with each other; same-doc
-- concurrent writers just serialize briefly on the one documents row.
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_ins ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_ins
  AFTER INSERT ON public.document_annotations
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();

DROP TRIGGER IF EXISTS trg_doc_annotations_changed_upd ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_upd
  AFTER UPDATE ON public.document_annotations
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();

DROP TRIGGER IF EXISTS trg_doc_annotations_changed_del ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_del
  AFTER DELETE ON public.document_annotations
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();
