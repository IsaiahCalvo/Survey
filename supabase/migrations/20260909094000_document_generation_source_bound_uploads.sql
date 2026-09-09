-- Source-bound staging only. No publication, active head or PDF path switch.
-- The frozen pre-transform source hash is never replaced by a fresh capture.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

ALTER TABLE survey_private.document_generation_uploads
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS expected_source_generation_id uuid;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='survey_private.document_generation_uploads'::regclass AND conname='generation_upload_source_binding') THEN
    ALTER TABLE survey_private.document_generation_uploads ADD CONSTRAINT generation_upload_source_binding CHECK(
      (source_id IS NULL AND purpose IS NULL AND expected_source_generation_id IS NULL)
      OR (source_id IS NOT NULL AND purpose IS NOT NULL AND purpose IN('prior-pdf','candidate-pdf')));
  END IF;
END; $$;
-- No source FK: canceled/expired receipts must retain their immutable identity.
CREATE INDEX IF NOT EXISTS generation_upload_source_idx ON survey_private.document_generation_uploads(source_id,operation_id) WHERE source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION survey_private.assert_generation_upload_source(u survey_private.document_generation_uploads)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE proof jsonb; pdf jsonb;
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
    pdf:=proof->'objects'->0;
    IF pdf->>'kind' IS DISTINCT FROM 'pdf' OR pdf->>'content_sha256' IS DISTINCT FROM u.content_sha256
      OR pdf->>'byte_length' IS DISTINCT FROM u.byte_length::text THEN
      RAISE EXCEPTION 'Prior PDF differs from the verified source' USING ERRCODE='23514';
    END IF;
  ELSIF u.purpose IS DISTINCT FROM 'candidate-pdf' THEN
    RAISE EXCEPTION 'Invalid source-bound upload purpose' USING ERRCODE='23514';
  END IF;
END; $$;

-- Role-independent identity guard: old RPCs or a future privileged writer cannot
-- strip the source binding, mutate old immutable fields, or extend the lease.
-- Cancellation/release still work after source expiry, revocation or deletion.
CREATE OR REPLACE FUNCTION survey_private.guard_generation_upload_source_binding()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.source_id,NEW.purpose,NEW.expected_source_generation_id) IS DISTINCT FROM ROW(OLD.source_id,OLD.purpose,OLD.expected_source_generation_id) THEN
      RAISE EXCEPTION 'Generation upload source binding is immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.source_id IS NULL THEN RETURN NEW; END IF;
    IF ROW(NEW.operation_id,NEW.actor_user_id,NEW.document_id,NEW.owner_user_id,NEW.generation_id,NEW.path,
      NEW.content_sha256,NEW.byte_length,NEW.source_sql_sha256,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.operation_id,OLD.actor_user_id,OLD.document_id,OLD.owner_user_id,OLD.generation_id,OLD.path,
      OLD.content_sha256,OLD.byte_length,OLD.source_sql_sha256,OLD.created_at,OLD.expires_at) THEN
      RAISE EXCEPTION 'Source-bound upload identity is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.state='canceled' THEN RETURN NEW; END IF;
    IF OLD.state IN('verified','rejected','canceled') AND NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION 'Terminal source-bound upload cannot resume' USING ERRCODE='23514';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.verified_object_id IS DISTINCT FROM OLD.verified_object_id OR NEW.verified_object_version IS DISTINCT FROM OLD.verified_object_version
      OR ROW(NEW.observed_sha256,NEW.rejected_at,NEW.rejected_object_id,NEW.rejected_object_version,NEW.rejection_reason)
        IS DISTINCT FROM ROW(OLD.observed_sha256,OLD.rejected_at,OLD.rejected_object_id,OLD.rejected_object_version,OLD.rejection_reason)
      OR ROW(NEW.verification_object_id,NEW.verification_object_version)
        IS DISTINCT FROM ROW(OLD.verification_object_id,OLD.verification_object_version)
      OR NEW.verification_claim_id IS DISTINCT FROM OLD.verification_claim_id
      -- Releasing an already expired lease moves its deadline forward to now,
      -- but grants no authority. Repeated release must stay available after
      -- source loss; only a future extension needs a fresh source proof.
      OR (NEW.verification_claim_expires_at>coalesce(OLD.verification_claim_expires_at,'-infinity'::timestamptz)
        AND NEW.verification_claim_expires_at>clock_timestamp()) THEN
      PERFORM survey_private.assert_generation_upload_source(NEW);
    END IF;
  ELSIF NEW.source_id IS NOT NULL THEN
    IF NEW.state<>'reserved' THEN RAISE EXCEPTION 'Source-bound upload must start reserved' USING ERRCODE='23514'; END IF;
    PERFORM survey_private.assert_generation_upload_source(NEW);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS generation_upload_source_binding_guard ON survey_private.document_generation_uploads;
CREATE TRIGGER generation_upload_source_binding_guard BEFORE INSERT OR UPDATE ON survey_private.document_generation_uploads
  FOR EACH ROW EXECUTE FUNCTION survey_private.guard_generation_upload_source_binding();

-- Keep the exact legacy descriptor implementation/behavior behind a private
-- wrapper. This is repeatable without renaming or wrapping the wrapper itself.
DO $$ BEGIN
  IF to_regprocedure('survey_private.document_generation_upload_descriptor_legacy(uuid)') IS NULL THEN
    ALTER FUNCTION survey_private.document_generation_upload_descriptor(uuid) RENAME TO document_generation_upload_descriptor_legacy;
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION survey_private.document_generation_upload_descriptor(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE u survey_private.document_generation_uploads%ROWTYPE; identity jsonb; full_receipt jsonb;
BEGIN
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF u.source_id IS NULL THEN RETURN survey_private.document_generation_upload_descriptor_legacy(p_operation); END IF;
  -- A read receipt must agree with the row whose source was checked, even when
  -- cancel/verification races this request. Never wait behind another worker.
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation FOR SHARE NOWAIT;
  identity:=jsonb_build_object('version',2,'operation_id',u.operation_id,'actor_user_id',u.actor_user_id,
    'document_id',u.document_id,'generation_id',u.generation_id,'owner_user_id',u.owner_user_id,
    'source_id',u.source_id,'purpose',u.purpose,'expected_source_generation_id',u.expected_source_generation_id,
    'path',u.path,'content_sha256',u.content_sha256,'byte_length',u.byte_length::text,
    'source_sql_sha256',u.source_sql_sha256,'expires_at',u.expires_at,'upload_state',u.state,
    'object',NULL,'verified_at',NULL,'rejection',NULL);
  IF u.state='canceled' THEN RETURN identity||jsonb_build_object('state','canceled'); END IF;
  BEGIN
    PERFORM survey_private.assert_generation_upload_source(u);
    full_receipt:=survey_private.document_generation_upload_descriptor_legacy(p_operation);
  EXCEPTION WHEN OTHERS THEN
    -- Recovery reveals only this upload's immutable identity, never a stale
    -- byte proof, source body, claim, signed URL or private failure detail.
    RETURN identity||jsonb_build_object('state','source-unavailable');
  END;
  RETURN full_receipt||identity||jsonb_build_object('state',u.state,
    'object',full_receipt->'object','verified_at',full_receipt->'verified_at','rejection',full_receipt->'rejection');
END; $$;

CREATE OR REPLACE FUNCTION public.begin_document_generation_upload_v2(
  p_source_id uuid,p_operation_id uuid,p_purpose text,p_content_sha256 text,p_byte_length bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' SET TimeZone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); u survey_private.document_generation_uploads%ROWTYPE; proof jsonb;
  owner_id uuid; generation uuid; destination text; source_expiry timestamptz; byte_limit bigint;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
  IF p_source_id IS NULL OR p_operation_id IS NULL OR p_purpose IS NULL OR p_purpose NOT IN('prior-pdf','candidate-pdf')
    OR p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$' OR p_byte_length IS NULL OR p_byte_length<=0 THEN
    RAISE EXCEPTION 'Invalid source-bound upload input' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Generation upload requires READ COMMITTED' USING ERRCODE='25001'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_operation_id::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF FOUND THEN
    IF u.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
    IF u.source_id IS DISTINCT FROM p_source_id OR u.purpose IS DISTINCT FROM p_purpose
      OR u.content_sha256 IS DISTINCT FROM p_content_sha256 OR u.byte_length IS DISTINCT FROM p_byte_length THEN
      RAISE EXCEPTION 'Generation operation identity differs' USING ERRCODE='22023'; END IF;
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload-actor:'||actor::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03'; END IF;
  proof:=survey_private.assert_document_generation_source_bytes(actor,p_source_id);
  IF proof->>'state' IS DISTINCT FROM 'verified' OR proof->>'actor_user_id' IS DISTINCT FROM actor::text
    OR proof->>'source_id' IS DISTINCT FROM p_source_id::text THEN
    RAISE EXCEPTION 'Verified generation source required' USING ERRCODE='23514'; END IF;
  SELECT user_id INTO owner_id FROM public.documents WHERE id=(proof->>'document_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation document is unavailable' USING ERRCODE='42501'; END IF;
  source_expiry:=(proof->>'expires_at')::timestamptz;
  byte_limit:=public.get_storage_limit(owner_id);
  IF byte_limit IS NOT NULL AND byte_limit>=0 AND p_byte_length>byte_limit THEN
    RAISE EXCEPTION 'Generation upload exceeds the owner storage limit' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM survey_private.document_generation_uploads WHERE actor_user_id=actor AND state<>'canceled')>=16
    OR (SELECT count(*) FROM survey_private.document_generation_uploads WHERE document_id=(proof->>'document_id')::uuid AND state<>'canceled')>=4 THEN
    RAISE EXCEPTION 'Too many pending generation uploads' USING ERRCODE='54000'; END IF;
  generation:=gen_random_uuid();
  destination:=owner_id::text||'/_generations/'||(proof->>'document_id')||'/'||generation::text||'/'||p_operation_id::text||'.pdf';
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents' AND name=destination) THEN
    RAISE EXCEPTION 'Generation upload destination already exists' USING ERRCODE='23514'; END IF;
  INSERT INTO survey_private.document_generation_uploads(operation_id,actor_user_id,document_id,owner_user_id,generation_id,path,
    content_sha256,byte_length,source_sql_sha256,expires_at,source_id,purpose,expected_source_generation_id)
    VALUES(p_operation_id,actor,(proof->>'document_id')::uuid,owner_id,generation,destination,p_content_sha256,p_byte_length,
      proof->>'source_sql_sha256',least(source_expiry,clock_timestamp()+interval '2 hours'),p_source_id,p_purpose,(proof->>'generation_id')::uuid);
  INSERT INTO survey_private.document_generation_storage_references(document_id,generation_id,path)
    VALUES((proof->>'document_id')::uuid,generation,destination);
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END; $$;

-- Keep existing public ACLs and exact legacy behavior. Add checks before every
-- old RPC's bound-row short circuit, including successful receipt replay.
DO $wire$
DECLARE signature text; anchor text; addition text; definition text; marker text:='-- source-bound generation upload fence';
BEGIN
  FOR signature,anchor,addition IN SELECT * FROM (VALUES
    ('public.begin_document_generation_upload(uuid,uuid,text,bigint)','    IF u.document_id<>p_document_id',
      'IF u.source_id IS NOT NULL THEN RAISE EXCEPTION ''Use the source-bound upload route'' USING ERRCODE=''22023''; END IF;'),
    ('public.get_document_generation_upload(uuid)','  IF u.state=''reserved'' THEN',
      'IF u.source_id IS NOT NULL THEN RETURN survey_private.document_generation_upload_descriptor(p_operation_id); END IF;'),
    ('public.claim_document_generation_upload_verification(uuid,uuid,uuid)','  IF u.state IN (''verified'',''rejected'')',
      'PERFORM survey_private.assert_generation_upload_source(u);'),
    ('public.record_document_generation_upload_verification(uuid,uuid,uuid,text,text,bigint,uuid)','  IF p_object_id IS NULL',
      'PERFORM survey_private.assert_generation_upload_source(u);'),
    ('public.reject_document_generation_upload_verification(uuid,uuid,uuid,uuid,text,text,bigint)','  IF p_object_id IS NULL',
      'PERFORM survey_private.assert_generation_upload_source(u);'),
    ('survey_private.guard_document_generation_upload_object()','  PERFORM survey_private.assert_document_generation_upload_authority',
      'PERFORM survey_private.assert_generation_upload_source(u);')
  ) entries(s,a,v) LOOP
    IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Missing upload prerequisite' USING ERRCODE='55000'; END IF;
    definition:=pg_get_functiondef(to_regprocedure(signature));
    IF position(marker IN definition)>0 THEN CONTINUE; END IF;
    IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Unrecognized upload prerequisite' USING ERRCODE='55000'; END IF;
    EXECUTE replace(definition,anchor,'  '||marker||E'\n  '||addition||E'\n'||anchor);
  END LOOP;
END; $wire$;

ALTER FUNCTION survey_private.assert_generation_upload_source(survey_private.document_generation_uploads) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_generation_upload_source_binding() OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_upload_descriptor_legacy(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_upload_descriptor(uuid) OWNER TO postgres;
ALTER FUNCTION public.begin_document_generation_upload_v2(uuid,uuid,text,text,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.assert_generation_upload_source(survey_private.document_generation_uploads),
  survey_private.guard_generation_upload_source_binding(),survey_private.document_generation_upload_descriptor_legacy(uuid),
  survey_private.document_generation_upload_descriptor(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_document_generation_upload_v2(uuid,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_document_generation_upload_v2(uuid,uuid,text,text,bigint) TO authenticated;
COMMIT;
