-- Staging only. No active generation, document pointer change, or byte proof
-- from Storage metadata. Reserved, verified and rejected stages expire after two
-- hours; a future publication protocol must explicitly separate published refs.
-- Deployment requires the pinned provider compatibility
-- gate: standard uploads use fresh physical versions before final SQL admission.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_generation_uploads (
  operation_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  generation_id uuid NOT NULL UNIQUE,
  path text NOT NULL UNIQUE,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK(byte_length>0),
  source_sql_sha256 text NOT NULL CHECK(source_sql_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','verified','rejected','canceled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  verified_object_id uuid,
  verified_object_version text,
  observed_sha256 text,
  rejected_at timestamptz,
  rejected_object_id uuid,
  rejected_object_version text,
  rejection_reason text,
  verification_claim_id uuid,
  verification_claim_expires_at timestamptz,
  verification_object_id uuid,
  verification_object_version text,
  CHECK((verified_at IS NULL AND verified_object_id IS NULL AND verified_object_version IS NULL)
    OR (verified_at IS NOT NULL AND verified_object_id IS NOT NULL AND length(verified_object_version)>0)),
  CHECK((observed_sha256 IS NULL AND rejected_at IS NULL AND rejected_object_id IS NULL
      AND rejected_object_version IS NULL AND rejection_reason IS NULL)
    OR (observed_sha256 IS NOT NULL AND observed_sha256 ~ '^[0-9a-f]{64}$' AND observed_sha256<>content_sha256
      AND rejected_at IS NOT NULL AND rejected_object_id IS NOT NULL AND rejected_object_version IS NOT NULL
      AND length(rejected_object_version)>0 AND rejection_reason IS NOT NULL AND rejection_reason='sha256_mismatch'))
);
-- No auth/document FK: terminal identity survives account/document deletion.
CREATE INDEX IF NOT EXISTS document_generation_upload_actor_pending_idx
  ON survey_private.document_generation_uploads(actor_user_id,expires_at) WHERE state<>'canceled';
CREATE INDEX IF NOT EXISTS document_generation_upload_document_idx
  ON survey_private.document_generation_uploads(document_id,operation_id) WHERE state<>'canceled';
CREATE INDEX IF NOT EXISTS document_generation_upload_expiry_idx
  ON survey_private.document_generation_uploads(expires_at,operation_id) WHERE state<>'canceled';
ALTER TABLE survey_private.document_generation_uploads OWNER TO postgres;
ALTER TABLE survey_private.document_generation_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_uploads FROM PUBLIC,anon,authenticated,service_role;

-- Claim UUIDs are never reused, even after another worker took over. Keeping
-- their identity prevents an old A worker from completing an A -> B -> A lease.
CREATE TABLE IF NOT EXISTS survey_private.document_generation_upload_claims (
  claim_id uuid PRIMARY KEY, operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE survey_private.document_generation_upload_claims OWNER TO postgres;
ALTER TABLE survey_private.document_generation_upload_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_upload_claims FROM PUBLIC,anon,authenticated,service_role;

-- Never silently adopt a user's preexisting unrelated folder. Hold the same
-- write-conflicting table lock through trigger installation so no old route can
-- create a namespace collision between this inventory and final guard install.
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='documents'
    AND split_part(o.name,'/',2)='_generations'
    AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u WHERE u.path=o.name)) THEN
    RAISE EXCEPTION 'Unregistered generation Storage namespace collision; staging migration aborted' USING ERRCODE='23514';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.assert_document_generation_upload_authority(p_actor uuid,p_document uuid,p_owner uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE previous_sub text := current_setting('request.jwt.claim.sub',true); d public.documents%ROWTYPE; direct_role text;
BEGIN
  IF p_actor IS NULL OR p_document IS NULL THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Generation upload requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
  IF public.user_can_access_document(p_document,'editor') IS NOT TRUE OR public.kal49_document_is_locked(p_document) THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='40001';
  END IF;
  SELECT * INTO d FROM public.documents WHERE id=p_document FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
  IF p_owner IS NOT NULL AND d.user_id IS DISTINCT FROM p_owner THEN
    RAISE EXCEPTION 'Generation document ownership changed' USING ERRCODE='42501';
  END IF;
  IF d.user_id IS DISTINCT FROM p_actor AND d.project_id IS NOT NULL THEN
    SELECT role INTO direct_role FROM public.document_collaborators
      WHERE document_id=p_document AND user_id=p_actor AND status='active';
    IF direct_role IS NULL THEN
      PERFORM id FROM public.projects WHERE id=d.project_id FOR SHARE NOWAIT;
      IF NOT FOUND THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
    END IF;
  END IF;
  IF public.user_can_access_document(p_document,'editor') IS NOT TRUE OR public.kal49_document_is_locked(p_document) THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  -- Fence both the writer and permanent owner; a shared document is still billed
  -- to its owner's namespace. Sorted account locks avoid cross-owner cycles.
  PERFORM survey_private.assert_account_open(a) FROM
    (SELECT DISTINCT unnest(ARRAY[p_actor,d.user_id]) a ORDER BY a) actors;
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_upload_descriptor(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u LEFT JOIN storage.objects o
    ON o.bucket_id='documents' AND o.name=u.path WHERE u.operation_id=p_operation AND u.state='verified'
      AND (o.id IS DISTINCT FROM u.verified_object_id OR o.version IS DISTINCT FROM u.verified_object_version
        OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text)) THEN
    RAISE EXCEPTION 'Verified generation object no longer matches its receipt' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u LEFT JOIN storage.objects o
    ON o.bucket_id='documents' AND o.name=u.path WHERE u.operation_id=p_operation AND u.state='rejected'
      AND (o.id IS DISTINCT FROM u.rejected_object_id OR o.version IS DISTINCT FROM u.rejected_object_version
        OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text)) THEN
    RAISE EXCEPTION 'Rejected generation object no longer matches its receipt' USING ERRCODE='23514';
  END IF;
  RETURN (SELECT jsonb_build_object('version',1,'operation_id',u.operation_id,'actor_user_id',u.actor_user_id,
    'document_id',u.document_id,'generation_id',u.generation_id,'owner_user_id',u.owner_user_id,
    'path',u.path,'content_sha256',u.content_sha256,'byte_length',u.byte_length::text,
    'source_sql_sha256',u.source_sql_sha256,'state',u.state,'expires_at',u.expires_at,
    'verified_at',u.verified_at,'rejection',CASE WHEN u.rejected_at IS NULL THEN NULL ELSE jsonb_build_object(
      'reason',u.rejection_reason,'observed_sha256',u.observed_sha256,'byte_length',u.byte_length::text,
      'object',jsonb_build_object('id',u.rejected_object_id,'version',u.rejected_object_version),
      'rejected_at',u.rejected_at) END,'object',CASE WHEN o.id IS NULL THEN NULL ELSE
      jsonb_build_object('id',o.id,'version',o.version,'byte_length',o.metadata->>'size') END)
  FROM survey_private.document_generation_uploads u LEFT JOIN storage.objects o
    ON o.bucket_id='documents' AND o.name=u.path WHERE u.operation_id=p_operation);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_document_generation_upload(
  p_document_id uuid,p_operation_id uuid,p_content_sha256 text,p_byte_length bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' SET TimeZone='UTC' AS $$
DECLARE actor uuid := auth.uid(); u survey_private.document_generation_uploads%ROWTYPE;
  capture jsonb; owner_id uuid; generation uuid; destination text; byte_limit bigint;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
  IF p_document_id IS NULL OR p_operation_id IS NULL OR p_content_sha256 IS NULL
    OR p_content_sha256 !~ '^[0-9a-f]{64}$' OR p_byte_length IS NULL OR p_byte_length<=0 THEN
    RAISE EXCEPTION 'Invalid generation upload input' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Generation upload requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_operation_id::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03';
  END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF FOUND THEN
    IF u.actor_user_id<>actor THEN RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501'; END IF;
    IF u.document_id<>p_document_id OR u.content_sha256<>p_content_sha256 OR u.byte_length<>p_byte_length THEN
      RAISE EXCEPTION 'Generation operation identity differs' USING ERRCODE='22023';
    END IF;
    IF u.state='reserved' THEN
      IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
      PERFORM survey_private.assert_document_generation_upload_authority(actor,u.document_id,u.owner_user_id);
      IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
    END IF;
    -- Exact retry is a receipt, never new upload admission or a fresh source.
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload-actor:'||actor::text,0)) THEN
    RAISE EXCEPTION 'Generation upload contention' USING ERRCODE='55P03';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(actor,p_document_id);
  SELECT user_id INTO owner_id FROM public.documents WHERE id=p_document_id;
  byte_limit := public.get_storage_limit(owner_id);
  IF byte_limit IS NOT NULL AND byte_limit>=0 AND p_byte_length>byte_limit THEN
    RAISE EXCEPTION 'Generation upload exceeds the owner storage limit' USING ERRCODE='42501';
  END IF;
  -- The coherent capture holds the document lock, so per-document admission is
  -- serialized by its advisory lock even when several editors reserve uploads.
  IF (SELECT count(*) FROM survey_private.document_generation_uploads WHERE actor_user_id=actor AND state<>'canceled')>=16
    OR (SELECT count(*) FROM survey_private.document_generation_uploads WHERE document_id=p_document_id AND state<>'canceled')>=4 THEN
    RAISE EXCEPTION 'Too many pending generation uploads' USING ERRCODE='54000';
  END IF;
  capture := survey_private.capture_document_publication_sources(p_document_id);
  generation := gen_random_uuid();
  destination := owner_id::text||'/_generations/'||p_document_id::text||'/'||generation::text||'/'||p_operation_id::text||'.pdf';
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='documents' AND name=destination) THEN
    RAISE EXCEPTION 'Generation upload destination already exists' USING ERRCODE='23514';
  END IF;
  INSERT INTO survey_private.document_generation_uploads(operation_id,actor_user_id,document_id,owner_user_id,
    generation_id,path,content_sha256,byte_length,source_sql_sha256,expires_at)
    VALUES(p_operation_id,actor,p_document_id,owner_id,generation,destination,p_content_sha256,p_byte_length,
      capture->'compare'->>'sql_sha256',clock_timestamp()+interval '2 hours');
  INSERT INTO survey_private.document_generation_storage_references(document_id,generation_id,path)
    VALUES(p_document_id,generation,destination);
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_document_generation_upload(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE u survey_private.document_generation_uploads%ROWTYPE;
BEGIN
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id;
  IF auth.uid() IS NULL OR NOT FOUND OR u.actor_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF u.state='reserved' THEN
    IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
    PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
    IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.cancel_document_generation_upload(p_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE u survey_private.document_generation_uploads%ROWTYPE;
BEGIN
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation FOR UPDATE NOWAIT;
  IF NOT FOUND OR u.state='canceled' THEN RETURN; END IF;
  UPDATE survey_private.document_generation_uploads SET state='canceled' WHERE operation_id=p_operation;
  DELETE FROM survey_private.document_generation_storage_references
    WHERE document_id=u.document_id AND generation_id=u.generation_id AND path=u.path;
  PERFORM survey_private.touch_document_storage_path(u.path);
  IF NOT survey_private.document_storage_path_is_referenced(u.path) THEN
    UPDATE survey_private.document_storage_path_guards SET retired=true,retirement_xid=pg_current_xact_id()
      WHERE path_hash=survey_private.document_storage_path_hash(u.path);
  END IF;
  PERFORM survey_private.queue_document_storage_cleanup(u.path);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_document_generation_upload(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads
    WHERE operation_id=p_operation_id AND actor_user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Generation upload requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  PERFORM survey_private.cancel_document_generation_upload(p_operation_id);
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_document_generation_upload_verification(
  p_actor_user_id uuid,p_operation_id uuid,p_object_id uuid,p_object_version text,p_content_sha256 text,p_byte_length bigint,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE caller text := current_setting('role',true); trusted boolean;
  u survey_private.document_generation_uploads%ROWTYPE; o storage.objects%ROWTYPE;
BEGIN
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS DISTINCT FROM u.actor_user_id THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF p_object_id IS NULL OR p_object_version IS NULL OR p_object_version !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_content_sha256 IS DISTINCT FROM u.content_sha256 OR p_byte_length IS DISTINCT FROM u.byte_length THEN
    RAISE EXCEPTION 'Generation byte verification differs' USING ERRCODE='23514';
  END IF;
  IF u.state='verified' THEN
    IF p_object_id IS DISTINCT FROM u.verified_object_id OR p_object_version IS DISTINCT FROM u.verified_object_version THEN
      RAISE EXCEPTION 'Generation verification receipt differs' USING ERRCODE='23514';
    END IF;
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
  END IF;
  IF u.state<>'reserved' OR u.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation upload is canceled or expired' USING ERRCODE='23514';
  END IF;
  IF p_claim_id IS NULL OR u.verification_claim_id IS DISTINCT FROM p_claim_id
    OR u.verification_claim_expires_at<=clock_timestamp() OR u.verification_claim_expires_at IS NULL
    OR u.verification_object_id IS DISTINCT FROM p_object_id OR u.verification_object_version IS DISTINCT FROM p_object_version THEN
    RAISE EXCEPTION 'Generation verification claim is stale' USING ERRCODE='40001';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
  PERFORM survey_private.touch_document_storage_path(u.path);
  IF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references
    WHERE document_id=u.document_id AND generation_id=u.generation_id AND path=u.path) THEN
    RAISE EXCEPTION 'Generation storage reference is missing' USING ERRCODE='23514';
  END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='documents' AND name=u.path FOR SHARE NOWAIT;
  IF NOT FOUND OR o.id IS DISTINCT FROM p_object_id OR o.version IS DISTINCT FROM p_object_version
    OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text THEN
    RAISE EXCEPTION 'Generation object differs from verified bytes' USING ERRCODE='23514';
  END IF;
  IF u.expires_at<=clock_timestamp() OR u.verification_claim_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation verification deadline passed' USING ERRCODE='40001';
  END IF;
  UPDATE survey_private.document_generation_uploads SET state='verified',verified_at=clock_timestamp(),
    verified_object_id=p_object_id,verified_object_version=p_object_version WHERE operation_id=p_operation_id;
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

-- Only a trusted verifier that consumed the full exact-size stream may attest
-- a digest mismatch. Short/extra/failed reads remain pending, never rejected.
CREATE OR REPLACE FUNCTION public.reject_document_generation_upload_verification(
  p_actor_user_id uuid,p_operation_id uuid,p_claim_id uuid,p_object_id uuid,p_object_version text,p_content_sha256 text,p_byte_length bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE caller text:=current_setting('role',true); trusted boolean;
  u survey_private.document_generation_uploads%ROWTYPE; o storage.objects%ROWTYPE;
BEGIN
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS DISTINCT FROM u.actor_user_id THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF p_object_id IS NULL OR p_object_version IS NULL OR p_object_version !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$' OR p_content_sha256=u.content_sha256
    OR p_byte_length IS DISTINCT FROM u.byte_length THEN
    RAISE EXCEPTION 'Generation rejection requires a complete exact-size digest mismatch' USING ERRCODE='23514';
  END IF;
  IF u.state='rejected' THEN
    IF p_claim_id IS NULL OR p_claim_id IS DISTINCT FROM u.verification_claim_id
      OR p_content_sha256 IS DISTINCT FROM u.observed_sha256 OR p_object_id IS DISTINCT FROM u.rejected_object_id
      OR p_object_version IS DISTINCT FROM u.rejected_object_version THEN
      RAISE EXCEPTION 'Generation rejection receipt differs' USING ERRCODE='23514';
    END IF;
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
  END IF;
  IF u.state<>'reserved' OR u.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation upload is terminal or expired' USING ERRCODE='23514';
  END IF;
  IF p_claim_id IS NULL OR u.verification_claim_id IS DISTINCT FROM p_claim_id
    OR u.verification_claim_expires_at<=clock_timestamp() OR u.verification_claim_expires_at IS NULL
    OR u.verification_object_id IS DISTINCT FROM p_object_id OR u.verification_object_version IS DISTINCT FROM p_object_version THEN
    RAISE EXCEPTION 'Generation verification claim is stale' USING ERRCODE='40001';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
  PERFORM survey_private.touch_document_storage_path(u.path);
  IF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references
    WHERE document_id=u.document_id AND generation_id=u.generation_id AND path=u.path) THEN
    RAISE EXCEPTION 'Generation storage reference is missing' USING ERRCODE='23514';
  END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='documents' AND name=u.path FOR SHARE NOWAIT;
  IF NOT FOUND OR o.id IS DISTINCT FROM p_object_id OR o.version IS DISTINCT FROM p_object_version
    OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text THEN
    RAISE EXCEPTION 'Generation object differs from rejected bytes' USING ERRCODE='23514';
  END IF;
  IF u.expires_at<=clock_timestamp() OR u.verification_claim_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation verification deadline passed' USING ERRCODE='40001';
  END IF;
  UPDATE survey_private.document_generation_uploads SET state='rejected',rejected_at=clock_timestamp(),
    observed_sha256=p_content_sha256,rejected_object_id=p_object_id,rejected_object_version=p_object_version,
    rejection_reason='sha256_mismatch' WHERE operation_id=p_operation_id;
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_document_generation_upload_verification(
  p_actor_user_id uuid,p_operation_id uuid,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' SET TimeZone='UTC' AS $$
DECLARE caller text:=current_setting('role',true); trusted boolean;
  u survey_private.document_generation_uploads%ROWTYPE; o storage.objects%ROWTYPE;
BEGIN
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS DISTINCT FROM u.actor_user_id THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF u.state IN ('verified','rejected') THEN RETURN survey_private.document_generation_upload_descriptor(p_operation_id); END IF;
  IF p_claim_id IS NULL THEN RAISE EXCEPTION 'Verification claim ID required' USING ERRCODE='22023'; END IF;
  IF u.state<>'reserved' OR u.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation upload is canceled or expired' USING ERRCODE='23514';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
  IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
  IF u.verification_claim_expires_at>clock_timestamp() THEN
    IF u.verification_claim_id IS DISTINCT FROM p_claim_id THEN
      RAISE EXCEPTION 'Generation verification is busy' USING ERRCODE='40001';
    END IF;
    RETURN survey_private.document_generation_upload_descriptor(p_operation_id) || jsonb_build_object(
      'verification_claim_id',u.verification_claim_id,'verification_claim_expires_at',u.verification_claim_expires_at);
  END IF;
  PERFORM survey_private.touch_document_storage_path(u.path);
  IF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references
    WHERE document_id=u.document_id AND generation_id=u.generation_id AND path=u.path) THEN
    RAISE EXCEPTION 'Generation storage reference is missing' USING ERRCODE='23514';
  END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='documents' AND name=u.path FOR SHARE NOWAIT;
  IF NOT FOUND OR o.version IS NULL OR o.version !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR o.metadata->>'size' IS DISTINCT FROM u.byte_length::text THEN
    RAISE EXCEPTION 'Generation object is not ready for byte verification' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_upload_claims WHERE claim_id=p_claim_id) THEN
    RAISE EXCEPTION 'Generation verification claim ID was already used' USING ERRCODE='40001';
  END IF;
  INSERT INTO survey_private.document_generation_upload_claims(claim_id,operation_id) VALUES(p_claim_id,p_operation_id);
  UPDATE survey_private.document_generation_uploads SET verification_claim_id=p_claim_id,
    verification_claim_expires_at=least(clock_timestamp()+interval '120 seconds',expires_at),
    verification_object_id=o.id,verification_object_version=o.version WHERE operation_id=p_operation_id RETURNING * INTO u;
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id) || jsonb_build_object(
    'verification_claim_id',u.verification_claim_id,'verification_claim_expires_at',u.verification_claim_expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_document_generation_upload_verification(
  p_actor_user_id uuid,p_operation_id uuid,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE caller text:=current_setting('role',true); trusted boolean; u survey_private.document_generation_uploads%ROWTYPE;
BEGIN
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE operation_id=p_operation_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS DISTINCT FROM u.actor_user_id THEN
    RAISE EXCEPTION 'Generation upload is not permitted' USING ERRCODE='42501';
  END IF;
  IF u.state='reserved' AND p_claim_id IS NOT NULL AND u.verification_claim_id=p_claim_id THEN
    UPDATE survey_private.document_generation_uploads SET verification_claim_expires_at=clock_timestamp()
      WHERE operation_id=p_operation_id;
  END IF;
  RETURN survey_private.document_generation_upload_descriptor(p_operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_document_generation_uploads(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE caller text:=current_setting('role',true); trusted boolean; operation uuid;
  canceled uuid[]:='{}'; skipped uuid[]:='{}'; cutoff timestamptz:=clock_timestamp();
BEGIN
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Expiry batch must contain 1 to 100 operations' USING ERRCODE='22023';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Generation upload expiry requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  FOR operation IN SELECT operation_id FROM survey_private.document_generation_uploads
    WHERE state<>'canceled' AND expires_at<=cutoff ORDER BY expires_at,operation_id
    LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    BEGIN
      PERFORM survey_private.cancel_document_generation_upload(operation);
      canceled:=array_append(canceled,operation);
    EXCEPTION WHEN lock_not_available OR serialization_failure OR deadlock_detected THEN
      skipped:=array_append(skipped,operation);
    END;
  END LOOP;
  RETURN jsonb_build_object('canceled_operation_ids',canceled,'skipped_operation_ids',skipped);
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_upload_object()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE u survey_private.document_generation_uploads%ROWTYPE; caller text:=current_setting('role',true); trusted boolean;
BEGIN
  -- Final write-once admission is role-independent, including service uploads.
  IF TG_OP='UPDATE' AND OLD.bucket_id='documents' AND split_part(OLD.name,'/',2)='_generations' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
      OR NEW.name IS DISTINCT FROM OLD.name OR NEW.version IS DISTINCT FROM OLD.version
      OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      RAISE EXCEPTION 'Generation storage objects are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.bucket_id<>'documents' OR split_part(NEW.name,'/',2)<>'_generations' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Generation storage objects cannot be moved into place' USING ERRCODE='23514'; END IF;
  IF caller IS NULL OR caller IN ('','none') THEN caller:=session_user; END IF;
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Generation uploads require the checked upload route' USING ERRCODE='42501'; END IF;
  SELECT * INTO u FROM survey_private.document_generation_uploads WHERE path=NEW.name FOR SHARE NOWAIT;
  IF NOT FOUND OR u.state<>'reserved' OR u.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation upload is missing, canceled or expired' USING ERRCODE='23514';
  END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(u.actor_user_id,u.document_id,u.owner_user_id);
  IF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references
    WHERE document_id=u.document_id AND generation_id=u.generation_id AND path=u.path) THEN
    RAISE EXCEPTION 'Generation storage reference is missing' USING ERRCODE='23514';
  END IF;
  -- Provider permission probes may have no version/actual size and roll back.
  -- They confer no verified receipt. Actual size, if supplied, must match.
  IF NEW.metadata ? 'size' AND NEW.metadata->>'size' IS DISTINCT FROM u.byte_length::text THEN
    RAISE EXCEPTION 'Generation object byte length differs' USING ERRCODE='23514';
  END IF;
  IF u.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Generation upload expired' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER a_document_generation_upload_object_guard
  BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION survey_private.guard_document_generation_upload_object();
DROP POLICY IF EXISTS generation_upload_checked_insert ON storage.objects;
CREATE POLICY generation_upload_checked_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
  WITH CHECK(bucket_id<>'documents' OR split_part(name,'/',2)<>'_generations');
DROP POLICY IF EXISTS generation_upload_checked_update ON storage.objects;
CREATE POLICY generation_upload_checked_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
  USING(bucket_id<>'documents' OR split_part(name,'/',2)<>'_generations')
  WITH CHECK(bucket_id<>'documents' OR split_part(name,'/',2)<>'_generations');

CREATE OR REPLACE FUNCTION survey_private.cancel_deleted_document_generation_uploads()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE operation uuid;
BEGIN
  FOR operation IN SELECT operation_id FROM survey_private.document_generation_uploads
    WHERE document_id=OLD.id AND state<>'canceled' ORDER BY operation_id LOOP
    PERFORM survey_private.cancel_document_generation_upload(operation);
  END LOOP;
  RETURN OLD;
END;
$$;
CREATE OR REPLACE TRIGGER document_generation_upload_delete_cleanup AFTER DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.cancel_deleted_document_generation_uploads();

ALTER FUNCTION survey_private.assert_document_generation_upload_authority(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_upload_descriptor(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.cancel_document_generation_upload(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_document_generation_upload_object() OWNER TO postgres;
ALTER FUNCTION survey_private.cancel_deleted_document_generation_uploads() OWNER TO postgres;
ALTER FUNCTION public.begin_document_generation_upload(uuid,uuid,text,bigint) OWNER TO postgres;
ALTER FUNCTION public.get_document_generation_upload(uuid) OWNER TO postgres;
ALTER FUNCTION public.cancel_document_generation_upload(uuid) OWNER TO postgres;
ALTER FUNCTION public.record_document_generation_upload_verification(uuid,uuid,uuid,text,text,bigint,uuid) OWNER TO postgres;
ALTER FUNCTION public.reject_document_generation_upload_verification(uuid,uuid,uuid,uuid,text,text,bigint) OWNER TO postgres;
ALTER FUNCTION public.claim_document_generation_upload_verification(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.release_document_generation_upload_verification(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.expire_document_generation_uploads(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.assert_document_generation_upload_authority(uuid,uuid,uuid),
  survey_private.document_generation_upload_descriptor(uuid),survey_private.cancel_document_generation_upload(uuid),
  survey_private.guard_document_generation_upload_object(),survey_private.cancel_deleted_document_generation_uploads()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_document_generation_upload(uuid,uuid,text,bigint),
  public.get_document_generation_upload(uuid),public.cancel_document_generation_upload(uuid),
  public.record_document_generation_upload_verification(uuid,uuid,uuid,text,text,bigint,uuid),
  public.reject_document_generation_upload_verification(uuid,uuid,uuid,uuid,text,text,bigint),
  public.claim_document_generation_upload_verification(uuid,uuid,uuid),
  public.release_document_generation_upload_verification(uuid,uuid,uuid),public.expire_document_generation_uploads(integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_document_generation_upload(uuid,uuid,text,bigint),
  public.get_document_generation_upload(uuid),public.cancel_document_generation_upload(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_document_generation_upload_verification(uuid,uuid,uuid,text,text,bigint,uuid),
  public.reject_document_generation_upload_verification(uuid,uuid,uuid,uuid,text,text,bigint),
  public.claim_document_generation_upload_verification(uuid,uuid,uuid),
  public.release_document_generation_upload_verification(uuid,uuid,uuid),public.expire_document_generation_uploads(integer) TO service_role;
COMMIT;
