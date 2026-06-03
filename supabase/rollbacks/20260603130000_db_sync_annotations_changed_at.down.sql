-- Rollback for 20260603130000_db_sync_annotations_changed_at.sql
-- Removes the per-document annotation change marker, its triggers, and function.

DROP TRIGGER IF EXISTS trg_doc_annotations_changed_ins ON public.document_annotations;
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_upd ON public.document_annotations;
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_del ON public.document_annotations;

DROP FUNCTION IF EXISTS public.bump_doc_annotations_changed_at();

ALTER TABLE public.documents
  DROP COLUMN IF EXISTS annotations_changed_at;
