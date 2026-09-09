-- Private durable replacement preparation only. No browser/service grant,
-- provider I/O, PDF bytes, worker work, or document publication.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE survey_private.document_generation_replacement_requests (
  candidate_operation_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_id uuid NOT NULL,
  expected_generation_id uuid,
  expected_wal_head bigint NOT NULL CHECK(expected_wal_head>=0),
  archive_operation_ids uuid[] NOT NULL CHECK(cardinality(archive_operation_ids) BETWEEN 1 AND 10000),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
  plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
  source_sql_sha256 text NOT NULL CHECK(source_sql_sha256 ~ '^[0-9a-f]{64}$'),
  source_object jsonb NOT NULL CHECK(jsonb_typeof(source_object)='object'),
  candidate_receipt jsonb NOT NULL CHECK(jsonb_typeof(candidate_receipt)='object'),
  archive_receipts jsonb NOT NULL CHECK(jsonb_typeof(archive_receipts)='array'),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(candidate_operation_id<>ALL(archive_operation_ids))
);
CREATE TABLE survey_private.document_generation_replacement_plans (
  candidate_operation_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_replacement_requests(candidate_operation_id) ON DELETE CASCADE,
  plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
  plan_byte_length bigint GENERATED ALWAYS AS (octet_length(plan::text)) STORED
    CHECK(plan_byte_length BETWEEN 1 AND 67108864),
  expires_at timestamptz NOT NULL
);
CREATE INDEX generation_replacement_requests_document_idx
  ON survey_private.document_generation_replacement_requests(document_id,candidate_operation_id);
CREATE INDEX generation_replacement_requests_actor_idx
  ON survey_private.document_generation_replacement_requests(actor_user_id,candidate_operation_id);
CREATE INDEX generation_replacement_plans_expiry_idx
  ON survey_private.document_generation_replacement_plans(expires_at,candidate_operation_id);
ALTER TABLE survey_private.document_generation_replacement_requests OWNER TO postgres;
ALTER TABLE survey_private.document_generation_replacement_plans OWNER TO postgres;
ALTER TABLE survey_private.document_generation_replacement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_replacement_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_replacement_requests,
  survey_private.document_generation_replacement_plans FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_replacement_request()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.documents WHERE id=OLD.document_id) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Prepared replacement identity is immutable' USING ERRCODE='23514';
END; $$;
CREATE OR REPLACE FUNCTION survey_private.guard_document_generation_replacement_plan()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE request_row survey_private.document_generation_replacement_requests%ROWTYPE;
  publication survey_private.document_generation_publications%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM survey_private.document_generation_replacement_requests r
      WHERE r.candidate_operation_id=OLD.candidate_operation_id)
    OR EXISTS(SELECT 1 FROM survey_private.document_generation_replacement_requests r
      WHERE r.candidate_operation_id=OLD.candidate_operation_id
        AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=r.document_id))) THEN RETURN OLD;END IF;
  IF TG_OP='DELETE' AND current_setting('survey.replacement_plan_cleanup',true)=OLD.candidate_operation_id::text THEN
    SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
      WHERE candidate_operation_id=OLD.candidate_operation_id;
    SELECT * INTO publication FROM survey_private.document_generation_publications
      WHERE operation_id=OLD.candidate_operation_id;
    IF OLD.expires_at<=clock_timestamp() OR (publication.operation_id IS NOT NULL
      AND publication.actor_user_id=request_row.actor_user_id
      AND publication.owner_user_id=request_row.owner_user_id
      AND publication.document_id=request_row.document_id
      AND publication.source_id=request_row.source_id
      AND publication.previous_generation_id IS NOT DISTINCT FROM request_row.expected_generation_id
      AND publication.archive_operation_ids=request_row.archive_operation_ids
      AND publication.plan_sha256=request_row.plan_sha256
      AND publication.wal_head=request_row.expected_wal_head
      AND publication.generation_id=(request_row.candidate_receipt->>'generation_id')::uuid) THEN RETURN OLD;END IF;
  END IF;
  RAISE EXCEPTION 'Prepared replacement plan is immutable' USING ERRCODE='23514';
END; $$;
CREATE OR REPLACE FUNCTION survey_private.reject_document_generation_replacement_truncate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Prepared replacement records cannot be truncated' USING ERRCODE='42501';END; $$;
CREATE TRIGGER generation_replacement_request_immutable BEFORE UPDATE OR DELETE
  ON survey_private.document_generation_replacement_requests FOR EACH ROW
  EXECUTE FUNCTION survey_private.guard_document_generation_replacement_request();
CREATE TRIGGER generation_replacement_plan_immutable BEFORE UPDATE OR DELETE
  ON survey_private.document_generation_replacement_plans FOR EACH ROW
  EXECUTE FUNCTION survey_private.guard_document_generation_replacement_plan();
CREATE TRIGGER generation_replacement_request_no_truncate BEFORE TRUNCATE
  ON survey_private.document_generation_replacement_requests FOR EACH STATEMENT
  EXECUTE FUNCTION survey_private.reject_document_generation_replacement_truncate();
CREATE TRIGGER generation_replacement_plan_no_truncate BEFORE TRUNCATE
  ON survey_private.document_generation_replacement_plans FOR EACH STATEMENT
  EXECUTE FUNCTION survey_private.reject_document_generation_replacement_truncate();

CREATE OR REPLACE FUNCTION survey_private.document_generation_replacement_request_sha256(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'actorUserId',p_actor,'sourceId',p_source,'candidateOperationId',p_candidate,
    'archiveOperationIds',to_jsonb(p_archives),'expectedGenerationId',p_expected_generation,
    'expectedWalHead',p_expected_wal_head::text,'operation',p_operation)::text,'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_replacement_result(
  p_state text,p_actor uuid,p_document uuid,p_source uuid,p_candidate uuid,p_archives uuid[],
  p_expected_generation uuid,p_expected_wal_head bigint,p_prepared_at timestamptz,p_expires_at timestamptz,
  p_plan jsonb,p_publication jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' SET TimeZone='UTC' AS $$
  SELECT jsonb_build_object('version',1,'state',p_state,'actor_user_id',p_actor,
    'document_id',p_document,'source_id',p_source,'candidate_operation_id',p_candidate,
    'archive_operation_ids',to_jsonb(p_archives),'expected_generation_id',p_expected_generation,
    'expected_wal_head',CASE WHEN p_expected_wal_head IS NULL THEN NULL ELSE to_jsonb(p_expected_wal_head::text) END,
    'prepared_at',p_prepared_at,'expires_at',p_expires_at,'plan',p_plan,'publication',p_publication)
$$;

CREATE OR REPLACE FUNCTION survey_private.read_document_generation_replacement(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE request_row survey_private.document_generation_replacement_requests%ROWTYPE;
  plan_row survey_private.document_generation_replacement_plans%ROWTYPE;
  publication survey_private.document_generation_publications%ROWTYPE;
  upload survey_private.document_generation_uploads%ROWTYPE;
  archives uuid[]; request_digest text; publication_json jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Replacement lookup requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF p_actor IS NULL OR p_source IS NULL OR p_candidate IS NULL OR p_archives IS NULL
    OR array_ndims(p_archives) IS DISTINCT FROM 1 OR cardinality(p_archives) NOT BETWEEN 1 AND 10000
    OR array_position(p_archives,NULL) IS NOT NULL OR p_candidate=ANY(p_archives)
    OR (SELECT count(DISTINCT x) FROM unnest(p_archives) x)<>cardinality(p_archives)
    OR p_expected_wal_head IS NULL OR p_expected_wal_head<0 OR jsonb_typeof(p_operation) IS DISTINCT FROM 'object'
    OR octet_length(p_operation::text) NOT BETWEEN 1 AND 8192 THEN
    RAISE EXCEPTION 'Invalid replacement lookup' USING ERRCODE='22023';END IF;
  SELECT array_agg(x ORDER BY x) INTO archives FROM unnest(p_archives) x;
  request_digest:=survey_private.document_generation_replacement_request_sha256(
    p_actor,p_source,p_candidate,archives,p_expected_generation,p_expected_wal_head,p_operation);
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate::text,0)) THEN
    RAISE EXCEPTION 'Replacement operation contention' USING ERRCODE='55P03';END IF;
  SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    SELECT * INTO publication FROM survey_private.document_generation_publications WHERE operation_id=p_candidate FOR SHARE NOWAIT;
    IF FOUND THEN
      IF publication.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Replacement is not yours' USING ERRCODE='42501';END IF;
      IF publication.source_id IS DISTINCT FROM p_source
        OR publication.archive_operation_ids IS DISTINCT FROM archives
        OR publication.previous_generation_id IS DISTINCT FROM p_expected_generation
        OR publication.wal_head IS DISTINCT FROM p_expected_wal_head THEN
        RAISE EXCEPTION 'Untracked publication identity differs' USING ERRCODE='23505';END IF;
      PERFORM survey_private.assert_document_generation_upload_authority(p_actor,publication.document_id,publication.owner_user_id);
      RETURN survey_private.document_generation_replacement_result('untracked',p_actor,publication.document_id,p_source,
        p_candidate,archives,p_expected_generation,p_expected_wal_head,NULL,NULL,NULL,NULL);
    END IF;
    SELECT * INTO upload FROM survey_private.document_generation_uploads WHERE operation_id=p_candidate FOR SHARE NOWAIT;
    IF FOUND THEN
      IF upload.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Replacement is not yours' USING ERRCODE='42501';END IF;
      IF upload.source_id IS DISTINCT FROM p_source OR upload.purpose IS DISTINCT FROM 'candidate-pdf'
        OR upload.expected_source_generation_id IS DISTINCT FROM p_expected_generation THEN
        RAISE EXCEPTION 'Replacement retry identity differs' USING ERRCODE='23505';END IF;
      PERFORM survey_private.assert_document_generation_upload_authority(p_actor,upload.document_id,upload.owner_user_id);
      RETURN survey_private.document_generation_replacement_result('untracked',p_actor,upload.document_id,p_source,
        p_candidate,archives,p_expected_generation,p_expected_wal_head,NULL,NULL,NULL,NULL);
    END IF;
    RETURN survey_private.document_generation_replacement_result('missing',p_actor,NULL,p_source,p_candidate,archives,
      p_expected_generation,p_expected_wal_head,NULL,NULL,NULL,NULL);
  END IF;
  IF request_row.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Replacement is not yours' USING ERRCODE='42501';END IF;
  IF request_row.request_sha256 IS DISTINCT FROM request_digest OR request_row.source_id IS DISTINCT FROM p_source
    OR request_row.archive_operation_ids IS DISTINCT FROM archives
    OR request_row.expected_generation_id IS DISTINCT FROM p_expected_generation
    OR request_row.expected_wal_head IS DISTINCT FROM p_expected_wal_head THEN
    RAISE EXCEPTION 'Replacement retry identity differs' USING ERRCODE='23505';END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(
    p_actor,request_row.document_id,request_row.owner_user_id);
  SELECT * INTO publication FROM survey_private.document_generation_publications
    WHERE operation_id=p_candidate FOR SHARE NOWAIT;
  IF FOUND THEN
    IF publication.actor_user_id IS DISTINCT FROM request_row.actor_user_id
      OR publication.document_id IS DISTINCT FROM request_row.document_id
      OR publication.source_id IS DISTINCT FROM request_row.source_id
      OR publication.previous_generation_id IS DISTINCT FROM request_row.expected_generation_id
      OR publication.archive_operation_ids IS DISTINCT FROM request_row.archive_operation_ids
      OR publication.plan_sha256 IS DISTINCT FROM request_row.plan_sha256
      OR publication.wal_head IS DISTINCT FROM request_row.expected_wal_head
      OR publication.generation_id IS DISTINCT FROM (request_row.candidate_receipt->>'generation_id')::uuid THEN
      RAISE EXCEPTION 'Published replacement binding differs' USING ERRCODE='23514';END IF;
    publication_json:=(to_jsonb(publication)-'owner_user_id'-'archive_operation_ids')
      ||jsonb_build_object('version',1,'wal_head',publication.wal_head::text);
    RETURN survey_private.document_generation_replacement_result('published',request_row.actor_user_id,
      request_row.document_id,request_row.source_id,p_candidate,request_row.archive_operation_ids,
      request_row.expected_generation_id,request_row.expected_wal_head,request_row.prepared_at,
      request_row.expires_at,NULL,publication_json);
  END IF;
  SELECT * INTO plan_row FROM survey_private.document_generation_replacement_plans
    WHERE candidate_operation_id=p_candidate FOR UPDATE NOWAIT;
  IF FOUND AND plan_row.expires_at>clock_timestamp() THEN
    IF plan_row.expires_at IS DISTINCT FROM request_row.expires_at
      OR encode(sha256(convert_to(plan_row.plan::text,'UTF8')),'hex') IS DISTINCT FROM request_row.plan_sha256 THEN
      RAISE EXCEPTION 'Prepared replacement plan differs' USING ERRCODE='23514';END IF;
    RETURN survey_private.document_generation_replacement_result('prepared',request_row.actor_user_id,
      request_row.document_id,request_row.source_id,p_candidate,request_row.archive_operation_ids,
      request_row.expected_generation_id,request_row.expected_wal_head,request_row.prepared_at,
      request_row.expires_at,plan_row.plan,NULL);
  END IF;
  IF FOUND THEN
    PERFORM set_config('survey.replacement_plan_cleanup',p_candidate::text,true);
    DELETE FROM survey_private.document_generation_replacement_plans WHERE candidate_operation_id=p_candidate;
  END IF;
  RETURN survey_private.document_generation_replacement_result('expired',request_row.actor_user_id,
    request_row.document_id,request_row.source_id,p_candidate,request_row.archive_operation_ids,
    request_row.expected_generation_id,request_row.expected_wal_head,request_row.prepared_at,
    request_row.expires_at,NULL,NULL);
END; $$;

CREATE OR REPLACE FUNCTION survey_private.prepare_document_generation_replacement(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE request_row survey_private.document_generation_replacement_requests%ROWTYPE;
  source_row survey_private.document_generation_sources%ROWTYPE; source_proof jsonb; semantic jsonb;
  candidate survey_private.document_generation_uploads%ROWTYPE; upload survey_private.document_generation_uploads%ROWTYPE;
  physical storage.objects%ROWTYPE; archives uuid[]; operations uuid[]; request_digest text; plan_digest text;
  source_object jsonb; candidate_receipt jsonb; archive_receipts jsonb:='[]'; member jsonb;
  owner_id uuid; expiry timestamptz; matches integer; seen uuid[]:='{}';
  current_frontier bigint; current_snapshot jsonb;
  previous_sub text:=current_setting('request.jwt.claim.sub',true);
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Replacement preparation requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF p_actor IS NULL OR p_source IS NULL OR p_candidate IS NULL OR p_archives IS NULL
    OR array_ndims(p_archives) IS DISTINCT FROM 1 OR cardinality(p_archives) NOT BETWEEN 1 AND 10000
    OR array_position(p_archives,NULL) IS NOT NULL OR p_candidate=ANY(p_archives)
    OR (SELECT count(DISTINCT x) FROM unnest(p_archives) x)<>cardinality(p_archives)
    OR p_expected_wal_head IS NULL OR p_expected_wal_head<0
    OR jsonb_typeof(p_operation) IS DISTINCT FROM 'object' OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
    OR octet_length(p_operation::text) NOT BETWEEN 1 AND 8192
    OR octet_length(p_plan::text) NOT BETWEEN 1 AND 67108864
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_plan) k) IS DISTINCT FROM
      ARRAY['baseline_base64','legacy','operation','operationId','projection','source','version']::text[]
    OR p_plan->'version' IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'Invalid replacement preparation' USING ERRCODE='22023';END IF;
  SELECT array_agg(x ORDER BY x) INTO archives FROM unnest(p_archives) x;
  request_digest:=survey_private.document_generation_replacement_request_sha256(
    p_actor,p_source,p_candidate,archives,p_expected_generation,p_expected_wal_head,p_operation);
  plan_digest:=encode(sha256(convert_to(p_plan::text,'UTF8')),'hex');
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||p_candidate::text,0)) THEN
    RAISE EXCEPTION 'Replacement operation contention' USING ERRCODE='55P03';END IF;
  SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
    WHERE candidate_operation_id=p_candidate FOR SHARE NOWAIT;
  IF FOUND THEN
    IF request_row.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Replacement is not yours' USING ERRCODE='42501';END IF;
    IF request_row.request_sha256 IS DISTINCT FROM request_digest OR request_row.plan_sha256 IS DISTINCT FROM plan_digest THEN
      RAISE EXCEPTION 'Replacement retry identity differs' USING ERRCODE='23505';END IF;
    RETURN survey_private.read_document_generation_replacement(p_actor,p_source,p_candidate,archives,
      p_expected_generation,p_expected_wal_head,p_operation);
  END IF;
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_publications WHERE operation_id=p_candidate) THEN
    RAISE EXCEPTION 'Published operation has no prepared replacement identity' USING ERRCODE='23505';END IF;
  source_proof:=survey_private.assert_document_generation_source_bytes(p_actor,p_source);
  SELECT * INTO source_row FROM survey_private.document_generation_sources WHERE source_id=p_source FOR SHARE NOWAIT;
  IF NOT FOUND OR source_row.actor_user_id IS DISTINCT FROM p_actor OR source_row.state<>'captured'
    OR source_row.generation_id IS DISTINCT FROM p_expected_generation OR source_row.wal_head IS DISTINCT FROM p_expected_wal_head
    OR source_row.expires_at<=clock_timestamp() OR source_proof->>'state' IS DISTINCT FROM 'verified'
    OR source_proof->>'source_sql_sha256' IS DISTINCT FROM source_row.source_sql_sha256 THEN
    RAISE EXCEPTION 'Replacement source differs' USING ERRCODE='23514';END IF;
  SELECT payload->'semantic' INTO semantic FROM survey_private.document_generation_source_bodies WHERE body_id=source_row.body_id;
  source_object:=semantic->'source_object'; owner_id:=(semantic->'document'->>'user_id')::uuid;
  IF semantic IS NULL OR semantic->>'document_id' IS DISTINCT FROM source_row.document_id::text
    OR semantic->>'generation_id' IS DISTINCT FROM p_expected_generation::text
    OR semantic->>'wal_head' IS DISTINCT FROM p_expected_wal_head::text
    OR jsonb_array_length(source_proof->'objects')<>cardinality(archives)
    OR p_plan->>'operationId' IS DISTINCT FROM p_candidate::text OR p_plan->'operation' IS DISTINCT FROM p_operation
    OR p_plan->'source' IS DISTINCT FROM jsonb_build_object('documentId',source_row.document_id,
      'generationId',p_expected_generation,'walHead',p_expected_wal_head::text,'sourceObject',source_object) THEN
    RAISE EXCEPTION 'Replacement plan source differs' USING ERRCODE='23514';END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor,source_row.document_id,owner_id);
  -- Upload admission allows at most sixteen pending operations per actor and
  -- four per document. A replacement consumes at least candidate+archive, so
  -- these stricter plan counts and fixed 64 MiB actor/document byte sums stay
  -- bounded even when expiry cleanup is late. This is not tiered quota
  -- accounting. Expired payloads still count until the bounded sweep.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('survey:generation-replacement-actor:'||p_actor::text,0)) THEN
    RAISE EXCEPTION 'Replacement plan admission contention' USING ERRCODE='55P03';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'survey:generation-replacement-document:'||source_row.document_id::text,0)) THEN
    RAISE EXCEPTION 'Replacement plan admission contention' USING ERRCODE='55P03';END IF;
  IF (SELECT count(*) FROM survey_private.document_generation_replacement_plans p
      JOIN survey_private.document_generation_replacement_requests r USING(candidate_operation_id)
      WHERE r.actor_user_id=p_actor)>=8
    OR (SELECT coalesce(sum(p.plan_byte_length),0) FROM survey_private.document_generation_replacement_plans p
      JOIN survey_private.document_generation_replacement_requests r USING(candidate_operation_id)
      WHERE r.actor_user_id=p_actor)>67108864-octet_length(p_plan::text)
    OR (SELECT count(*) FROM survey_private.document_generation_replacement_plans p
      JOIN survey_private.document_generation_replacement_requests r USING(candidate_operation_id)
      WHERE r.document_id=source_row.document_id)>=2
    OR (SELECT coalesce(sum(p.plan_byte_length),0) FROM survey_private.document_generation_replacement_plans p
      JOIN survey_private.document_generation_replacement_requests r USING(candidate_operation_id)
      WHERE r.document_id=source_row.document_id)>67108864-octet_length(p_plan::text) THEN
    RAISE EXCEPTION 'Prepared replacement plan limit reached' USING ERRCODE='54000';END IF;
  SELECT array_agg(x ORDER BY x) INTO operations FROM unnest(archives||p_candidate) x;
  PERFORM operation_id FROM survey_private.document_generation_uploads
    WHERE operation_id=ANY(operations) ORDER BY operation_id FOR SHARE NOWAIT;
  IF (SELECT count(*) FROM survey_private.document_generation_uploads WHERE operation_id=ANY(operations))<>cardinality(operations) THEN
    RAISE EXCEPTION 'Replacement upload set is incomplete' USING ERRCODE='23514';END IF;
  SELECT * INTO candidate FROM survey_private.document_generation_uploads WHERE operation_id=p_candidate;
  expiry:=source_row.expires_at;
  FOR upload IN SELECT * FROM survey_private.document_generation_uploads
    WHERE operation_id=ANY(operations) ORDER BY operation_id LOOP
    IF upload.actor_user_id IS DISTINCT FROM p_actor OR upload.source_id IS DISTINCT FROM p_source
      OR upload.document_id IS DISTINCT FROM source_row.document_id OR upload.owner_user_id IS DISTINCT FROM owner_id
      OR upload.expected_source_generation_id IS DISTINCT FROM p_expected_generation
      OR upload.source_sql_sha256 IS DISTINCT FROM source_row.source_sql_sha256 OR upload.state<>'verified'
      OR upload.expires_at<=clock_timestamp() OR upload.verified_at IS NULL
      OR upload.verified_object_id IS NULL OR upload.verified_object_version IS NULL THEN
      RAISE EXCEPTION 'Verified replacement upload differs' USING ERRCODE='23514';END IF;
    expiry:=least(expiry,upload.expires_at);
    IF survey_private.touch_document_storage_path(upload.path) THEN
      RAISE EXCEPTION 'Replacement upload path is retired' USING ERRCODE='23514';END IF;
    PERFORM 1 FROM survey_private.document_generation_storage_references r
      WHERE r.document_id=upload.document_id AND r.generation_id=upload.generation_id AND r.path=upload.path FOR SHARE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'Replacement upload reference is missing' USING ERRCODE='23514';END IF;
    SELECT * INTO physical FROM storage.objects WHERE bucket_id='documents' AND name=upload.path FOR SHARE NOWAIT;
    IF NOT FOUND OR physical.id IS DISTINCT FROM upload.verified_object_id
      OR physical.version IS DISTINCT FROM upload.verified_object_version
      OR physical.metadata->>'size' IS DISTINCT FROM upload.byte_length::text THEN
      RAISE EXCEPTION 'Replacement upload object differs' USING ERRCODE='23514';END IF;
    IF upload.operation_id=p_candidate THEN
      IF upload.purpose IS DISTINCT FROM 'candidate-pdf' OR upload.archived_source_object_id IS NOT NULL THEN
        RAISE EXCEPTION 'Replacement candidate differs' USING ERRCODE='23514';END IF;
      candidate_receipt:=jsonb_build_object('operation_id',upload.operation_id,'generation_id',upload.generation_id,
        'path',upload.path,'object_id',upload.verified_object_id,'object_version',upload.verified_object_version,
        'content_sha256',upload.content_sha256,'byte_length',upload.byte_length::text);
    ELSE
      IF upload.purpose IS DISTINCT FROM 'source-object-archive' OR upload.archived_source_object_id IS NULL THEN
        RAISE EXCEPTION 'Replacement archive differs' USING ERRCODE='23514';END IF;
      SELECT count(*) INTO matches FROM jsonb_array_elements(source_proof->'objects') o
        WHERE o->>'id'=upload.archived_source_object_id::text;
      SELECT o INTO member FROM jsonb_array_elements(source_proof->'objects') o
        WHERE o->>'id'=upload.archived_source_object_id::text;
      IF matches<>1 OR upload.archived_source_object_id=ANY(seen)
        OR member->>'content_sha256' IS DISTINCT FROM upload.content_sha256
        OR member->>'byte_length' IS DISTINCT FROM upload.byte_length::text THEN
        RAISE EXCEPTION 'Replacement archive source differs' USING ERRCODE='23514';END IF;
      seen:=array_append(seen,upload.archived_source_object_id);
      archive_receipts:=archive_receipts||jsonb_build_array(jsonb_build_object('operation_id',upload.operation_id,
        'generation_id',upload.generation_id,'source_object_id',upload.archived_source_object_id,
        'path',upload.path,'object_id',upload.verified_object_id,'object_version',upload.verified_object_version,
        'content_sha256',upload.content_sha256,'byte_length',upload.byte_length::text));
    END IF;
  END LOOP;
  IF candidate_receipt IS NULL OR jsonb_array_length(archive_receipts)<>cardinality(archives)
    OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'Replacement receipt set differs' USING ERRCODE='23514';END IF;
  -- The document advisory lock taken by the authority check is still held.
  -- Reuse the authoritative generation/WAL helper to reject an already-stale
  -- worker result without rebuilding the full source body in this transaction.
  BEGIN
    PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
    current_frontier:=survey_private.annotation_generation_scope(
      source_row.document_id,p_expected_generation,false);
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    RAISE;
  END;
  IF current_frontier IS DISTINCT FROM p_expected_wal_head THEN
    RAISE EXCEPTION 'Replacement annotation frontier changed before preparation' USING ERRCODE='23514';END IF;
  -- Snapshot compaction can replace bytes and writer epochs without moving the
  -- WAL frontier. Compare the same bounded snapshot projection captured in the
  -- source receipt while the document advisory lock is still held.
  IF p_expected_generation IS NULL THEN
    SELECT (to_jsonb(s)-'snapshot')||jsonb_build_object(
      'snapshot_base64',encode(s.snapshot,'base64'),'at_seq',s.at_seq::text,
      'writer_epoch',s.writer_epoch::text,'base_at_seq',s.base_at_seq::text,
      'base_writer_epoch',s.base_writer_epoch::text)
      INTO current_snapshot FROM public.annotation_snapshots s
      WHERE s.document_id=source_row.document_id;
    IF coalesce(current_snapshot,'null'::jsonb) IS DISTINCT FROM
      semantic->'sources'->'annotation_snapshot' THEN
      RAISE EXCEPTION 'Replacement annotation snapshot changed before preparation' USING ERRCODE='23514';END IF;
  ELSE
    SELECT (to_jsonb(s)-'snapshot')||jsonb_build_object(
      'snapshot_base64',encode(s.snapshot,'base64'),'at_seq',s.at_seq::text,
      'writer_epoch',s.writer_epoch::text)
      INTO current_snapshot FROM survey_private.annotation_generation_snapshots s
      WHERE s.document_id=source_row.document_id AND s.generation_id=p_expected_generation;
    IF coalesce(current_snapshot,'null'::jsonb) IS DISTINCT FROM
      semantic->'sources'->'generation_snapshot' THEN
      RAISE EXCEPTION 'Replacement generation snapshot changed before preparation' USING ERRCODE='23514';END IF;
  END IF;
  IF expiry<=clock_timestamp() THEN
    RAISE EXCEPTION 'Replacement preparation lease expired' USING ERRCODE='23514';END IF;
  INSERT INTO survey_private.document_generation_replacement_requests(candidate_operation_id,actor_user_id,owner_user_id,
    document_id,source_id,expected_generation_id,expected_wal_head,archive_operation_ids,request_sha256,plan_sha256,
    source_sql_sha256,source_object,candidate_receipt,archive_receipts,expires_at)
    VALUES(p_candidate,p_actor,owner_id,source_row.document_id,p_source,p_expected_generation,p_expected_wal_head,archives,
      request_digest,plan_digest,source_row.source_sql_sha256,source_object,candidate_receipt,archive_receipts,expiry);
  INSERT INTO survey_private.document_generation_replacement_plans(candidate_operation_id,plan,expires_at)
    VALUES(p_candidate,p_plan,expiry);
  RETURN survey_private.read_document_generation_replacement(p_actor,p_source,p_candidate,archives,
    p_expected_generation,p_expected_wal_head,p_operation);
END; $$;

CREATE OR REPLACE FUNCTION survey_private.clear_published_document_generation_replacement_plan()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE request_row survey_private.document_generation_replacement_requests%ROWTYPE;
BEGIN
  SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
    WHERE candidate_operation_id=NEW.operation_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW;END IF;
  IF NEW.actor_user_id IS DISTINCT FROM request_row.actor_user_id
    OR NEW.owner_user_id IS DISTINCT FROM request_row.owner_user_id
    OR NEW.document_id IS DISTINCT FROM request_row.document_id
    OR NEW.source_id IS DISTINCT FROM request_row.source_id
    OR NEW.previous_generation_id IS DISTINCT FROM request_row.expected_generation_id
    OR NEW.archive_operation_ids IS DISTINCT FROM request_row.archive_operation_ids
    OR NEW.plan_sha256 IS DISTINCT FROM request_row.plan_sha256
    OR NEW.wal_head IS DISTINCT FROM request_row.expected_wal_head
    OR NEW.generation_id IS DISTINCT FROM (request_row.candidate_receipt->>'generation_id')::uuid THEN
    RAISE EXCEPTION 'Published replacement differs from prepared identity' USING ERRCODE='23514';END IF;
  PERFORM set_config('survey.replacement_plan_cleanup',NEW.operation_id::text,true);
  DELETE FROM survey_private.document_generation_replacement_plans WHERE candidate_operation_id=NEW.operation_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER generation_publication_clear_replacement_plan AFTER INSERT
  ON survey_private.document_generation_publications FOR EACH ROW
  EXECUTE FUNCTION survey_private.clear_published_document_generation_replacement_plan();

CREATE OR REPLACE FUNCTION survey_private.expire_document_generation_replacement_plans(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE candidate uuid; plan_row survey_private.document_generation_replacement_plans%ROWTYPE; removed integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid replacement expiry limit' USING ERRCODE='22023';END IF;
  FOR candidate IN SELECT candidate_operation_id FROM survey_private.document_generation_replacement_plans
    WHERE expires_at<=clock_timestamp() ORDER BY expires_at,candidate_operation_id LIMIT p_limit LOOP
    IF pg_try_advisory_xact_lock(hashtextextended('survey:generation-upload:'||candidate::text,0)) THEN
      SELECT * INTO plan_row FROM survey_private.document_generation_replacement_plans
        WHERE candidate_operation_id=candidate AND expires_at<=clock_timestamp() FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        PERFORM set_config('survey.replacement_plan_cleanup',candidate::text,true);
        DELETE FROM survey_private.document_generation_replacement_plans WHERE candidate_operation_id=candidate;
        removed:=removed+1;
      END IF;
    END IF;
  END LOOP;
  RETURN removed;
END; $$;

DO $$ DECLARE signature text;BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'survey_private.guard_document_generation_replacement_request()',
    'survey_private.guard_document_generation_replacement_plan()',
    'survey_private.reject_document_generation_replacement_truncate()',
    'survey_private.document_generation_replacement_request_sha256(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb)',
    'survey_private.document_generation_replacement_result(text,uuid,uuid,uuid,uuid,uuid[],uuid,bigint,timestamptz,timestamptz,jsonb,jsonb)',
    'survey_private.read_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb)',
    'survey_private.prepare_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)',
    'survey_private.clear_published_document_generation_replacement_plan()',
    'survey_private.expire_document_generation_replacement_plans(integer)'] LOOP
    EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
    EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
  END LOOP;
END; $$;
COMMENT ON FUNCTION survey_private.prepare_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb) IS
  'Private durable plan journal after exact source and upload verification. Stores no PDF bytes and grants no publication authority.';
COMMENT ON FUNCTION survey_private.read_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb) IS
  'Private authority-checked retry lookup. Published receipts win over source expiry or a newer active generation.';
COMMIT;
