-- Decision 6 (DECISION-BATCH-2026-07-07) — same content under a different name
-- reuses the existing document and OFFERS to keep the new name as an alias.
-- Aliases are extra display/search names only; `name` stays the primary.
--
-- Client writes go through the existing "Users can update own documents"
-- policy — no new RLS needed. The file_path immutability trigger is untouched.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS name_aliases TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.documents.name_aliases IS
  'Alternate file names this document was uploaded under (decision 6: same content, different name -> reuse + alias). Display/search only.';
