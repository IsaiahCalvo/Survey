-- Phase 31 - Migration Cutover Seal
--
-- Adds documents.cutover_completed_at - the timestamp at which a document's
-- legacy `document_annotations` rows were verified-copied into its Y.Doc
-- snapshot (per `crdtBackfill.runBackfill` in Plan 31-04). Once this column
-- is non-null for a given document, the live save path stops writing to
-- `document_annotations` and reads/writes via the Y.Doc only.
--
-- Source:
--   - .planning/phases/31-migration-cutover-seal/31-CONTEXT.md
--     "Files in Scope" bullet 6 (cutover_completed_at column on documents).
--   - .planning/phases/31-migration-cutover-seal/31-CONTEXT.md
--     "Acceptance Criteria" bullet 1 (the timestamp is set after a verified
--     count match between legacy rows and Y.Doc Y.Map entries).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS keeps reapplication safe. The
-- column is NULL by default - pre-cutover documents read as un-cutover
-- (Plan 31-04's hydrate path branches on NOT NULL).
--
-- Forward migration is purely additive. No backfill of existing rows; the
-- per-doc lazy backfill in Plan 31-04 sets the timestamp on first
-- post-cutover open of each document.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS cutover_completed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.documents.cutover_completed_at IS
  'Phase 31 - set when crdtBackfill.runBackfill verifies the legacy document_annotations rows have been copied into the Y.Doc snapshot. NULL = pre-cutover (live save path still writes to document_annotations). NOT NULL = post-cutover (live save path is CRDT-only; reads come from the Y.Doc; document_annotations is read-only legacy storage).';
