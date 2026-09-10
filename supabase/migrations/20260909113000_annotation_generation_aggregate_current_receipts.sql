-- Add point-in-time current-generation evidence to accepted aggregate writes.
-- The v1 service brokers and their exact envelopes remain unchanged. These v2
-- wrappers reuse their actor delegation and private receipt/commit checks while
-- holding the same document lock used by generation publication and WAL writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v2(
  p_actor_user_id uuid,
  p_document_id uuid,
  p_generation_id uuid,
  p_content_model_version smallint,
  p_client_id text,
  p_client_seq bigint,
  p_data bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller_role text;
  result jsonb;
  current_generation uuid;
BEGIN
  caller_role:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  IF caller_role IS NULL THEN caller_role:=session_user; END IF;
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'annotation aggregate service role required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate actor is required' USING ERRCODE='42501';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'invalid annotation aggregate receipt' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN
    RAISE EXCEPTION 'annotation aggregate receipt contention' USING ERRCODE='40001';
  END IF;

  -- The guarded v1 broker remains the sole claim-delegation seam and restores
  -- both legacy and modern claims on success and error.
  result:=public.probe_annotation_generation_aggregate_receipt_service_v1(
    p_actor_user_id,p_document_id,p_generation_id,p_content_model_version,
    p_client_id,p_client_seq,p_data);
  IF result->>'version' IS DISTINCT FROM '1'
    OR (result->>'status' IS DISTINCT FROM 'missing'
      AND result->>'status' IS DISTINCT FROM 'accepted') THEN
    RAISE EXCEPTION 'annotation aggregate receipt response differs' USING ERRCODE='55000';
  END IF;
  IF result->>'status'='missing' THEN
    -- A guessed receipt key must not disclose current generation metadata.
    RETURN result||jsonb_build_object('version',2);
  END IF;

  SELECT h.generation_id INTO current_generation
  FROM survey_private.annotation_generation_heads h
  WHERE h.document_id=p_document_id;
  RETURN result||jsonb_build_object(
    'version',2,
    'current_generation_id',current_generation,
    'is_current',current_generation IS NOT NULL
      AND current_generation IS NOT DISTINCT FROM p_generation_id);
END $$;

CREATE OR REPLACE FUNCTION public.commit_annotation_generation_aggregate_service_v2(
  p_actor_user_id uuid,
  p_document_id uuid,
  p_generation_id uuid,
  p_content_model_version smallint,
  p_client_id text,
  p_client_seq bigint,
  p_data bytea,
  p_expected_head bigint,
  p_expected_checkpoint_at_seq bigint,
  p_expected_checkpoint_writer_id text,
  p_expected_checkpoint_writer_epoch bigint,
  p_expected_checkpoint_encoding_version integer,
  p_expected_checkpoint_sha256 text,
  p_result_checkpoint bytea DEFAULT NULL,
  p_result_checkpoint_encoding_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller_role text;
  result jsonb;
  current_generation uuid;
BEGIN
  caller_role:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  IF caller_role IS NULL THEN caller_role:=session_user; END IF;
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'annotation aggregate service role required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate actor is required' USING ERRCODE='42501';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'invalid annotation aggregate write' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN
    RAISE EXCEPTION 'annotation aggregate write contention' USING ERRCODE='40001';
  END IF;

  result:=public.commit_annotation_generation_aggregate_service_v1(
    p_actor_user_id,p_document_id,p_generation_id,p_content_model_version,
    p_client_id,p_client_seq,p_data,p_expected_head,
    p_expected_checkpoint_at_seq,p_expected_checkpoint_writer_id,
    p_expected_checkpoint_writer_epoch,p_expected_checkpoint_encoding_version,
    p_expected_checkpoint_sha256,p_result_checkpoint,
    p_result_checkpoint_encoding_version);
  IF result->>'version' IS DISTINCT FROM '1'
    OR result->>'status' IS DISTINCT FROM 'accepted'
    OR result->>'accepted' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'annotation aggregate commit response differs' USING ERRCODE='55000';
  END IF;

  SELECT h.generation_id INTO current_generation
  FROM survey_private.annotation_generation_heads h
  WHERE h.document_id=p_document_id;
  RETURN result||jsonb_build_object(
    'version',2,
    'current_generation_id',current_generation,
    'is_current',current_generation IS NOT NULL
      AND current_generation IS NOT DISTINCT FROM p_generation_id);
END $$;

ALTER FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea) OWNER TO postgres;
ALTER FUNCTION public.commit_annotation_generation_aggregate_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.commit_annotation_generation_aggregate_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_annotation_generation_aggregate_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  TO service_role;

COMMENT ON FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea) IS
  'Service-only exact aggregate receipt probe. Accepted receipts include locked current-generation evidence; missing keys disclose none.';
COMMENT ON FUNCTION public.commit_annotation_generation_aggregate_service_v2(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer) IS
  'Service-only aggregate commit with locked point-in-time current-generation evidence. Evidence does not grant access.';

COMMIT;
