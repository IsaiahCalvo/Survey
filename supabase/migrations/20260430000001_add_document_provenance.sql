-- Add document provenance columns
--
-- Captures metadata at the moment a document is first uploaded / opened so
-- support and analytics can answer:
--   - which platform did this user upload on (mac / windows / web / mobile)?
--   - what tier were they on when they uploaded?
--   - what app version produced this row?
--
-- The "who" (user_id) and "when" (created_at) already live on documents.
-- These three columns add device, tier, and app_version snapshots.
--
-- All columns are nullable so legacy rows continue to load. New uploads
-- populate all three via src/utils/documentProvenance.js.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS first_opened_device TEXT,
  ADD COLUMN IF NOT EXISTS first_opened_user_tier TEXT,
  ADD COLUMN IF NOT EXISTS first_opened_app_version TEXT;

COMMENT ON COLUMN public.documents.first_opened_device IS
  'Platform string captured at upload: mac / windows / linux / web / dev / mobile / unknown';
COMMENT ON COLUMN public.documents.first_opened_user_tier IS
  'Subscription tier snapshot at upload: free / pro / enterprise / developer';
COMMENT ON COLUMN public.documents.first_opened_app_version IS
  'App semver string from package.json at upload time, e.g. 0.1.43';
