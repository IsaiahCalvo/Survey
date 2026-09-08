-- The old combined trigger and the two dedicated triggers call the same
-- incremental function, so each document INSERT/DELETE writes its legacy
-- subscription counter twice. UPDATE calls the combined function but does
-- nothing. Actual byte quotas and the app meter read storage.objects instead.
-- Remove only that duplicate callback; do not backfill or change any counter.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  expected record;
BEGIN
  -- Verified against the tracked incremental body and the live catalog. Pin
  -- the body so a later function with real UPDATE behavior requires review
  -- rather than silently losing its only UPDATE trigger. Configuration,
  -- owner, grants, helper functions, and views are intentionally left intact.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.update_user_storage()'::regprocedure
      AND pg_catalog.md5(p.prosrc) = '62d343bc3f1ba4d97e3b675cc9145838'
  ) THEN
    RAISE EXCEPTION 'Unexpected legacy storage-counter function; inspect before removing its combined trigger';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('update_storage_on_insert', 5),
    ('update_storage_on_delete', 9)
  ) AS checks(trigger_name, trigger_type)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.documents'::regclass
        AND t.tgname = expected.trigger_name AND t.tgtype = expected.trigger_type
        AND t.tgfoid = 'public.update_user_storage()'::regprocedure
        AND t.tgenabled = 'O' AND NOT t.tgisinternal
        AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgattr = ''::pg_catalog.int2vector
    ) THEN
      RAISE EXCEPTION 'Unexpected dedicated storage-counter trigger: %', expected.trigger_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.documents'::regclass
      AND t.tgname = 'trigger_update_storage_on_document_change'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.documents'::regclass
        AND t.tgname = 'trigger_update_storage_on_document_change' AND t.tgtype = 29
        AND t.tgfoid = 'public.update_user_storage()'::regprocedure
        AND t.tgenabled = 'O' AND NOT t.tgisinternal
        AND t.tgnargs = 0 AND t.tgqual IS NULL AND t.tgattr = ''::pg_catalog.int2vector
    ) THEN
      RAISE EXCEPTION 'Unexpected combined storage-counter trigger; inspect before removing it';
    END IF;
    DROP TRIGGER trigger_update_storage_on_document_change ON public.documents;
  END IF;
END;
$$;

COMMIT;
