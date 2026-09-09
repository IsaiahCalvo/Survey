-- Complete source-object archive staging, not publication or permanent retention.
-- Only a checked 093 source member supplies the archive hash, size and identity.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

ALTER TABLE survey_private.document_generation_uploads ADD COLUMN IF NOT EXISTS archived_source_object_id uuid;
ALTER TABLE survey_private.document_generation_uploads DROP CONSTRAINT IF EXISTS generation_upload_source_binding;
ALTER TABLE survey_private.document_generation_uploads ADD CONSTRAINT generation_upload_source_binding CHECK(
  (source_id IS NULL AND purpose IS NULL AND expected_source_generation_id IS NULL AND archived_source_object_id IS NULL)
  OR (source_id IS NOT NULL AND purpose IS NOT NULL AND (
    (purpose IN('prior-pdf','candidate-pdf') AND archived_source_object_id IS NULL)
    OR (purpose='source-object-archive' AND archived_source_object_id IS NOT NULL))));

CREATE OR REPLACE FUNCTION survey_private.assert_generation_upload_source(u survey_private.document_generation_uploads)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb; object jsonb; matches integer;
BEGIN
  IF u.source_id IS NULL THEN RETURN; END IF;
  proof:=survey_private.assert_document_generation_source_bytes(u.actor_user_id,u.source_id);
  PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
  IF proof->>'state' IS DISTINCT FROM 'verified' OR proof->>'source_id' IS DISTINCT FROM u.source_id::text
    OR proof->>'actor_user_id' IS DISTINCT FROM u.actor_user_id::text OR proof->>'document_id' IS DISTINCT FROM u.document_id::text
    OR proof->>'generation_id' IS DISTINCT FROM u.expected_source_generation_id::text
    OR proof->>'source_sql_sha256' IS DISTINCT FROM u.source_sql_sha256
    OR proof->>'expires_at' IS NULL OR u.expires_at>(proof->>'expires_at')::timestamptz OR u.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation upload source is unavailable' USING ERRCODE='23514';
  END IF;
  IF u.purpose='prior-pdf' THEN
    object:=proof->'objects'->0;
    IF object->>'kind' IS DISTINCT FROM 'pdf' OR object->>'content_sha256' IS DISTINCT FROM u.content_sha256
      OR object->>'byte_length' IS DISTINCT FROM u.byte_length::text THEN
      RAISE EXCEPTION 'Prior PDF differs from the verified source' USING ERRCODE='23514';
    END IF;
  ELSIF u.purpose='source-object-archive' THEN
    SELECT count(*) INTO matches FROM jsonb_array_elements(proof->'objects') o WHERE o->>'id'=u.archived_source_object_id::text;
    IF matches<>1 THEN RAISE EXCEPTION 'Archive source object is unavailable' USING ERRCODE='23514'; END IF;
    SELECT o INTO object FROM jsonb_array_elements(proof->'objects') o WHERE o->>'id'=u.archived_source_object_id::text;
    IF object->>'kind' NOT IN('pdf','sidecar') OR object->>'bucket_id' IS DISTINCT FROM 'documents'
      OR object->>'content_sha256' IS DISTINCT FROM u.content_sha256 OR object->>'byte_length' IS DISTINCT FROM u.byte_length::text THEN
      RAISE EXCEPTION 'Archive bytes differ from the verified source object' USING ERRCODE='23514';
    END IF;
  ELSIF u.purpose IS DISTINCT FROM 'candidate-pdf' THEN
    RAISE EXCEPTION 'Invalid source-bound upload purpose' USING ERRCODE='23514';
  END IF;
END; $$;

-- The existing 094 guard protects all older identity fields and verification
-- transitions. This additional field cannot attach to or change an old upload.
CREATE OR REPLACE FUNCTION survey_private.guard_generation_archive_identity()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.archived_source_object_id IS DISTINCT FROM OLD.archived_source_object_id THEN
    RAISE EXCEPTION 'Archive source object identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS generation_archive_identity_guard ON survey_private.document_generation_uploads;
CREATE TRIGGER generation_archive_identity_guard BEFORE UPDATE ON survey_private.document_generation_uploads
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_generation_archive_identity();

DO $$ BEGIN
  IF to_regprocedure('survey_private.document_generation_upload_descriptor_v2(uuid)') IS NULL THEN
    ALTER FUNCTION survey_private.document_generation_upload_descriptor(uuid) RENAME TO document_generation_upload_descriptor_v2;
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION survey_private.document_generation_upload_descriptor(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE u survey_private.document_generation_uploads%ROWTYPE; receipt jsonb; member jsonb;
BEGIN
  receipt:=survey_private.document_generation_upload_descriptor_v2(p_operation);
  IF receipt IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation;
  IF u.archived_source_object_id IS NULL THEN RETURN receipt; END IF;
  receipt:=receipt||jsonb_build_object('version',3,'archived_source_object_id',u.archived_source_object_id,'source_object',NULL);
  IF receipt->>'state' IN('canceled','source-unavailable') THEN RETURN receipt; END IF;
  BEGIN
    -- The ready v2 receipt already checked the complete source and still holds
    -- its parent FOR UPDATE plus document/path/object locks. Every 093 proof
    -- writer and terminal disposal takes that same parent first. Project the
    -- frozen member under those locks instead of scanning the source twice.
    SELECT jsonb_build_object('kind',o->'kind','bucket_id',o->'bucket_id','path',o->'path','id',o->'id',
      'version',o->'version','byte_length',o->'byte_length','content_sha256',o->'content_sha256') INTO member
      FROM survey_private.document_generation_source_bytes b CROSS JOIN LATERAL jsonb_array_elements(b.objects) o
      WHERE b.source_id=u.source_id AND b.verified_at IS NOT NULL AND o->>'id'=u.archived_source_object_id::text;
    IF member IS NULL OR member->>'content_sha256' IS DISTINCT FROM u.content_sha256
      OR member->>'byte_length' IS DISTINCT FROM u.byte_length::text OR u.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION 'Archive source is unavailable' USING ERRCODE='23514'; END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN receipt||jsonb_build_object('state','source-unavailable','object',NULL,'verified_at',NULL,'rejection',NULL);
  END;
  RETURN receipt||jsonb_build_object('source_object',member);
END; $$;

CREATE OR REPLACE FUNCTION public.begin_document_generation_source_archive(
  p_source_id uuid,p_operation_id uuid,p_source_object_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' SET TimeZone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); u survey_private.document_generation_uploads%ROWTYPE; proof jsonb; member jsonb; matches integer;
  owner_id uuid; generation uuid; destination text; source_expiry timestamptz; byte_limit bigint; bytes bigint; digest text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Generation archive is not permitted' USING ERRCODE='42501'; END IF;
  IF p_source_id IS NULL OR p_operation_id IS NULL OR p_source_object_id IS NULL THEN
    RAISE EXCEPTION 'Invalid source archive identity' USING ERRCODE='22023'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Generation archive requires READ COMMITTED' USING ERRCODE='25001'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_operation_id::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF FOUND THEN
    IF u.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Generation archive is not permitted' USING ERRCODE='42501'; END IF;
    IF u.source_id IS DISTINCT FROM p_source_id OR u.purpose IS DISTINCT FROM 'source-object-archive'
      OR u.archived_source_object_id IS DISTINCT FROM p_source_object_id THEN
      RAISE EXCEPTION 'Generation archive identity differs' USING ERRCODE='22023'; END IF;
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload-actor:'||actor::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03'; END IF;
  proof:=survey_private.assert_document_generation_source_bytes(actor,p_source_id);
  IF proof->>'state' IS DISTINCT FROM 'verified' OR proof->>'source_id' IS DISTINCT FROM p_source_id::text
    OR proof->>'actor_user_id' IS DISTINCT FROM actor::text THEN
    RAISE EXCEPTION 'Verified generation source required' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO matches FROM jsonb_array_elements(proof->'objects') o WHERE o->>'id'=p_source_object_id::text;
  IF matches<>1 THEN RAISE EXCEPTION 'Archive object must belong to the verified source' USING ERRCODE='23514'; END IF;
  SELECT o INTO member FROM jsonb_array_elements(proof->'objects') o WHERE o->>'id'=p_source_object_id::text;
  IF member->>'kind' NOT IN('pdf','sidecar') OR member->>'bucket_id' IS DISTINCT FROM 'documents' THEN
    RAISE EXCEPTION 'Unsupported archive source object' USING ERRCODE='23514'; END IF;
  digest:=member->>'content_sha256';bytes:=(member->>'byte_length')::bigint;
  IF digest IS NULL OR digest !~ '^[0-9a-f]{64}$' OR bytes IS NULL OR bytes<=0 THEN
    RAISE EXCEPTION 'Verified archive bytes required' USING ERRCODE='23514'; END IF;
  SELECT user_id INTO owner_id FROM public.documents WHERE id=(proof->>'document_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation document is unavailable' USING ERRCODE='42501'; END IF;
  byte_limit:=public.get_storage_limit(owner_id);
  IF byte_limit IS NOT NULL AND byte_limit>=0 AND bytes>byte_limit THEN
    RAISE EXCEPTION 'Generation upload exceeds the owner storage limit' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM survey_private.document_generation_uploads WHERE actor_user_id=actor AND state<>'canceled')>=16
    OR (SELECT count(*) FROM survey_private.document_generation_uploads WHERE document_id=(proof->>'document_id')::uuid AND state<>'canceled')>=4 THEN
    RAISE EXCEPTION 'Too many pending generation uploads' USING ERRCODE='54000'; END IF;
  source_expiry:=(proof->>'expires_at')::timestamptz;
  generation:=gen_random_uuid();
  destination:=owner_id::text||'/_generations/'||(proof->>'document_id')||'/'||generation::text||'/'||p_operation_id::text||'.bin';
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents' AND name=destination) THEN
    RAISE EXCEPTION 'Generation upload destination already exists' USING ERRCODE='23514'; END IF;
  INSERT INTO survey_private.document_generation_uploads(operation_id,actor_user_id,document_id,owner_user_id,generation_id,path,
    content_sha256,byte_length,source_sql_sha256,expires_at,source_id,purpose,expected_source_generation_id,archived_source_object_id)
    VALUES(p_operation_id,actor,(proof->>'document_id')::uuid,owner_id,generation,destination,digest,bytes,
      proof->>'source_sql_sha256',least(source_expiry,clock_timestamp()+interval '2 hours'),p_source_id,'source-object-archive',
      (proof->>'generation_id')::uuid,p_source_object_id);
  INSERT INTO survey_private.document_generation_storage_references(document_id,generation_id,path)
    VALUES((proof->>'document_id')::uuid,generation,destination);
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END; $$;

ALTER FUNCTION survey_private.assert_generation_upload_source(survey_private.document_generation_uploads) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_generation_archive_identity() OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_upload_descriptor_v2(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_upload_descriptor(uuid) OWNER TO postgres;
ALTER FUNCTION public.begin_document_generation_source_archive(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.assert_generation_upload_source(survey_private.document_generation_uploads),
  survey_private.guard_generation_archive_identity(),survey_private.document_generation_upload_descriptor_v2(uuid),
  survey_private.document_generation_upload_descriptor(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_document_generation_source_archive(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_document_generation_source_archive(uuid,uuid,uuid) TO authenticated;
COMMIT;
