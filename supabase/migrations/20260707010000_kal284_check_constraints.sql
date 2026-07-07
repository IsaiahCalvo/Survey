-- KAL-284 (partial) — mechanical safety-net CHECK constraints.
--
-- Scope note: the partial UNIQUE INDEX on documents(user_id, name) WHERE NOT archived
-- from the same ticket is deliberately NOT included — it hard-blocks same-name
-- re-uploads at the DB layer, which is the open product decision in KAL-277/KAL-290.
-- Add it only after that decision lands.
--
-- Constraints are added NOT VALID first (protects all NEW writes immediately),
-- then validated. If VALIDATE fails on a hand-applied environment, legacy rows
-- violate the rule — fix those rows, then re-run the VALIDATE statements.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_file_size_positive'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_file_size_positive
      CHECK (file_size > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_annotations_page_number_positive'
      AND conrelid = 'public.document_annotations'::regclass
  ) THEN
    ALTER TABLE public.document_annotations
      ADD CONSTRAINT document_annotations_page_number_positive
      CHECK (page_number > 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.documents VALIDATE CONSTRAINT documents_file_size_positive;
ALTER TABLE public.document_annotations VALIDATE CONSTRAINT document_annotations_page_number_positive;
