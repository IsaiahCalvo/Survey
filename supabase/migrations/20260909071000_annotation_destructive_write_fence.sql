-- Complete the SQL source lock for destructive modern-annotation operations.
-- Ordinary clients still cannot delete the append-only WAL. Existing owner-run
-- cleanup/definer functions and document FK cascades keep their authority, but
-- now serialize with accepted appends, snapshots and future source captures.
-- WAL receipts have no supported UPDATE path, including privileged definers:
-- changes to their bytes, actor or identity would invalidate accepted receipts.
-- This is a source lock, NOT a PDF generation or a snapshot-incarnation token.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION survey_private.guard_annotation_source_delete()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Annotation source deletion requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  -- DELETE already owns the child tuple. Waiting here could deadlock a writer
  -- that owns the advisory lock and needs that tuple. Fail the whole statement
  -- instead; this also makes multi-document deletion rollback on contention.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(OLD.document_id::text,0)) THEN
    RAISE EXCEPTION 'Annotation source delete contention' USING ERRCODE='40001';
  END IF;
  -- No parent lookup or new auth policy: an own document-deletion cascade may
  -- already have removed its parent. Existing grants/RLS/checked definers own
  -- authorization; this trigger grants none and exposes no source rows.
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.reject_annotation_source_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Use row deletion so annotation source locking remains complete' USING ERRCODE='42501';
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.reject_annotation_wal_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'Annotation WAL rows are immutable' USING ERRCODE='42501';
END;
$$;

ALTER FUNCTION survey_private.guard_annotation_source_delete() OWNER TO postgres;
ALTER FUNCTION survey_private.reject_annotation_source_truncate() OWNER TO postgres;
ALTER FUNCTION survey_private.reject_annotation_wal_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.guard_annotation_source_delete(),
  survey_private.reject_annotation_source_truncate(),survey_private.reject_annotation_wal_update()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE TRUNCATE ON public.annotation_updates,public.annotation_snapshots
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE TRIGGER a_annotation_source_delete
  BEFORE DELETE ON public.annotation_updates
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_source_delete();
CREATE OR REPLACE TRIGGER a_annotation_wal_no_update
  BEFORE UPDATE ON public.annotation_updates
  FOR EACH ROW EXECUTE FUNCTION survey_private.reject_annotation_wal_update();
CREATE OR REPLACE TRIGGER a_annotation_source_delete
  BEFORE DELETE ON public.annotation_snapshots
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_source_delete();
CREATE OR REPLACE TRIGGER annotation_source_no_truncate
  BEFORE TRUNCATE ON public.annotation_updates
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_annotation_source_truncate();
CREATE OR REPLACE TRIGGER annotation_source_no_truncate
  BEFORE TRUNCATE ON public.annotation_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_annotation_source_truncate();

COMMIT;
