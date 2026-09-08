-- Retire document identities on every DELETE, including FK cascades. A delayed
-- upload or older client cannot publish the same UUID after its row is gone.
-- Retain only opaque IDs: no user/project FKs, names, paths, hashes or timestamps.
-- Account deletion must not remove this fence. No backfill or purge is needed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS survey_private.document_identity_guards (
  document_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  deleted boolean NOT NULL
);
ALTER TABLE survey_private.document_identity_guards OWNER TO postgres;
ALTER TABLE survey_private.document_identity_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_identity_guards FROM PUBLIC, anon, authenticated, service_role;

-- TRUNCATE skips row DELETE triggers. Application roles must use DELETE so
-- retirement remains atomic, even when broad default table grants exist.
REVOKE TRUNCATE ON public.documents FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_document_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  identity_id uuid;
  retired boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Existing annotation, share and revision rows refer to this stable key.
    -- No service/JWT exception: an ID change must not bypass its retirement.
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'DOCUMENT_ID_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  -- DELETE already holds the document tuple; INSERT has not acquired it yet.
  -- Never wait for the reverse tuple/guard order. A hash collision merely asks
  -- the caller to retry; this transaction lock lasts through commit/rollback.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('survey:document_identity:' || identity_id::text, 0)
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_ID_BUSY' USING ERRCODE = '55P03';
  END IF;

  -- An actual write (not SELECT alone) also fences old REPEATABLE READ and
  -- SERIALIZABLE snapshots. INSERT never clears a previously retired identity.
  INSERT INTO survey_private.document_identity_guards AS g (document_id, revision, deleted)
    VALUES (identity_id, 1, TG_OP = 'DELETE')
    ON CONFLICT (document_id) DO UPDATE
      SET revision = g.revision + 1, deleted = g.deleted OR EXCLUDED.deleted
    RETURNING deleted INTO retired;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document identity guard did not persist' USING ERRCODE = '40001';
  END IF;
  IF TG_OP = 'INSERT' AND retired THEN
    RAISE EXCEPTION 'DOCUMENT_ID_RETIRED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.guard_document_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.guard_document_identity() FROM PUBLIC, anon, authenticated, service_role;

-- Sort before allocation guards on INSERT. Metadata, archive/revive and share
-- edits do not write an identity guard; assigning the same ID is also a no-op.
DROP TRIGGER IF EXISTS a_document_identity_guard ON public.documents;
CREATE TRIGGER a_document_identity_guard
  BEFORE INSERT OR DELETE OR UPDATE OF id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_identity();

COMMENT ON TABLE survey_private.document_identity_guards IS
  'Opaque document UUID retirement fence; intentionally no lifecycle FKs or personal metadata. Do not purge retired identities.';
COMMIT;
