-- Service-only broker for trusted model-2 aggregate admission. The Edge
-- handler authenticates the bearer and supplies that verified actor. These
-- wrappers prove the SQL invoker role before replacing JWT claims, and expose
-- no direct authenticated-client path to the private admission functions.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v1(
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
  previous_sub text;
  previous_role text;
  previous_claims text;
  delegated_claims jsonb;
  result jsonb;
BEGIN
  caller_role:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  IF caller_role IS NULL THEN caller_role:=session_user; END IF;
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'annotation aggregate service role required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate actor is required' USING ERRCODE='42501';
  END IF;

  previous_sub:=current_setting('request.jwt.claim.sub',true);
  previous_role:=current_setting('request.jwt.claim.role',true);
  previous_claims:=current_setting('request.jwt.claims',true);
  BEGIN
    delegated_claims:=CASE WHEN NULLIF(previous_claims,'') IS NULL THEN '{}'::jsonb
      ELSE previous_claims::jsonb END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END;
  IF jsonb_typeof(delegated_claims)<>'object' THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END IF;
  delegated_claims:=jsonb_build_object(
    'sub',p_actor_user_id::text,'role','authenticated');

  PERFORM set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',delegated_claims::text,true);
  BEGIN
    result:=survey_private.probe_annotation_generation_update_receipt_v1(
      p_document_id,p_generation_id,p_content_model_version,p_client_id,p_client_seq,p_data);
    IF result->>'actor_user_id' IS DISTINCT FROM p_actor_user_id::text
      OR result->>'document_id' IS DISTINCT FROM p_document_id::text
      OR result->>'generation_id' IS DISTINCT FROM p_generation_id::text
      OR result->>'content_model_version' IS DISTINCT FROM p_content_model_version::text THEN
      RAISE EXCEPTION 'annotation aggregate receipt scope differs' USING ERRCODE='55000';
    END IF;
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RETURN result;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RAISE;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.read_annotation_generation_aggregate_checkpoint_service_v1(
  p_actor_user_id uuid,
  p_document_id uuid,
  p_generation_id uuid,
  p_content_model_version smallint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller_role text;
  previous_sub text;
  previous_role text;
  previous_claims text;
  delegated_claims jsonb;
  frontier bigint;
  base_seq bigint;
  checkpoint_result jsonb;
  checkpoint jsonb;
  checkpoint_at_seq bigint;
  result jsonb;
BEGIN
  caller_role:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  IF caller_role IS NULL THEN caller_role:=session_user; END IF;
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'annotation aggregate service role required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate actor is required' USING ERRCODE='42501';
  END IF;

  previous_sub:=current_setting('request.jwt.claim.sub',true);
  previous_role:=current_setting('request.jwt.claim.role',true);
  previous_claims:=current_setting('request.jwt.claims',true);
  BEGIN
    delegated_claims:=CASE WHEN NULLIF(previous_claims,'') IS NULL THEN '{}'::jsonb
      ELSE previous_claims::jsonb END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END;
  IF jsonb_typeof(delegated_claims)<>'object' THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END IF;
  delegated_claims:=jsonb_build_object(
    'sub',p_actor_user_id::text,'role','authenticated');

  PERFORM set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',delegated_claims::text,true);
  BEGIN
    -- Acquire the same shared document lock before the editor/unlocked
    -- preflight, then let the conditional reader recheck viewer scope while it
    -- hashes and encodes the fixed checkpoint.
    IF p_content_model_version IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'invalid annotation aggregate content model' USING ERRCODE='22023';
    END IF;
    frontier:=survey_private.annotation_generation_scope_v3(
      p_document_id,p_generation_id,p_content_model_version,false);
    IF public.user_can_access_document(p_document_id,'editor') IS NOT TRUE
      OR public.kal49_document_is_locked(p_document_id) THEN
      RAISE EXCEPTION 'annotation aggregate checkpoint is not permitted' USING ERRCODE='42501';
    END IF;
    checkpoint_result:=public.read_annotation_checkpoint_conditional_v3(
      p_document_id,p_generation_id,p_content_model_version,
      NULL::bigint,NULL::text,NULL::bigint,NULL::integer,NULL::text);
    checkpoint:=checkpoint_result->'checkpoint';
    IF checkpoint_result->>'version' IS DISTINCT FROM '3'
      OR checkpoint_result->>'actor_user_id' IS DISTINCT FROM p_actor_user_id::text
      OR checkpoint_result->>'document_id' IS DISTINCT FROM p_document_id::text
      OR checkpoint_result->>'generation_id' IS DISTINCT FROM p_generation_id::text
      OR checkpoint_result->>'content_model_version' IS DISTINCT FROM p_content_model_version::text
      OR checkpoint_result->>'wal_head' IS DISTINCT FROM frontier::text
      OR checkpoint_result->>'snapshot_matches' IS DISTINCT FROM 'false'
      OR jsonb_typeof(checkpoint) IS DISTINCT FROM 'object'
      OR checkpoint->>'snapshot' IS NULL THEN
      RAISE EXCEPTION 'annotation aggregate checkpoint scope differs' USING ERRCODE='55000';
    END IF;
    SELECT g.base_seq INTO base_seq
    FROM survey_private.annotation_generations g
    WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id
    FOR SHARE NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'annotation generation changed' USING ERRCODE='SG002';
    END IF;
    BEGIN checkpoint_at_seq:=(checkpoint->>'at_seq')::bigint;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'annotation aggregate checkpoint scope differs' USING ERRCODE='55000';
    END;
    IF base_seq IS NULL OR checkpoint_at_seq IS NULL
      OR checkpoint_at_seq<base_seq OR checkpoint_at_seq>frontier THEN
      RAISE EXCEPTION 'annotation aggregate checkpoint scope differs' USING ERRCODE='55000';
    END IF;
    result:=jsonb_build_object(
      'version',1,'actor_user_id',p_actor_user_id,
      'document_id',p_document_id,'generation_id',p_generation_id,
      'content_model_version',p_content_model_version,
      'head',frontier::text,'base_seq',base_seq::text,'checkpoint',checkpoint);
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RETURN result;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RAISE;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.commit_annotation_generation_aggregate_service_v1(
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
  previous_sub text;
  previous_role text;
  previous_claims text;
  delegated_claims jsonb;
  result jsonb;
BEGIN
  caller_role:=NULLIF(NULLIF(current_setting('role',true),''),'none');
  IF caller_role IS NULL THEN caller_role:=session_user; END IF;
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'annotation aggregate service role required' USING ERRCODE='42501';
  END IF;
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate actor is required' USING ERRCODE='42501';
  END IF;

  previous_sub:=current_setting('request.jwt.claim.sub',true);
  previous_role:=current_setting('request.jwt.claim.role',true);
  previous_claims:=current_setting('request.jwt.claims',true);
  BEGIN
    delegated_claims:=CASE WHEN NULLIF(previous_claims,'') IS NULL THEN '{}'::jsonb
      ELSE previous_claims::jsonb END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END;
  IF jsonb_typeof(delegated_claims)<>'object' THEN
    RAISE EXCEPTION 'annotation aggregate service claims are invalid' USING ERRCODE='42501';
  END IF;
  delegated_claims:=jsonb_build_object(
    'sub',p_actor_user_id::text,'role','authenticated');

  PERFORM set_config('request.jwt.claim.sub',p_actor_user_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',delegated_claims::text,true);
  BEGIN
    result:=survey_private.commit_annotation_generation_aggregate_v1(
      p_document_id,p_generation_id,p_content_model_version,p_client_id,p_client_seq,p_data,
      p_expected_head,p_expected_checkpoint_at_seq,p_expected_checkpoint_writer_id,
      p_expected_checkpoint_writer_epoch,p_expected_checkpoint_encoding_version,
      p_expected_checkpoint_sha256,p_result_checkpoint,p_result_checkpoint_encoding_version);
    IF result->>'actor_user_id' IS DISTINCT FROM p_actor_user_id::text
      OR result->>'document_id' IS DISTINCT FROM p_document_id::text
      OR result->>'generation_id' IS DISTINCT FROM p_generation_id::text
      OR result->>'content_model_version' IS DISTINCT FROM p_content_model_version::text THEN
      RAISE EXCEPTION 'annotation aggregate commit scope differs' USING ERRCODE='55000';
    END IF;
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RETURN result;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
    PERFORM set_config('request.jwt.claim.role',coalesce(previous_role,''),true);
    PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
    RAISE;
  END;
END $$;

ALTER FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea) OWNER TO postgres;
ALTER FUNCTION public.read_annotation_generation_aggregate_checkpoint_service_v1(
  uuid,uuid,uuid,smallint) OWNER TO postgres;
ALTER FUNCTION public.commit_annotation_generation_aggregate_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_annotation_generation_aggregate_checkpoint_service_v1(
  uuid,uuid,uuid,smallint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.commit_annotation_generation_aggregate_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.probe_annotation_generation_aggregate_receipt_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_annotation_generation_aggregate_checkpoint_service_v1(
  uuid,uuid,uuid,smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_annotation_generation_aggregate_service_v1(
  uuid,uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  TO service_role;

COMMIT;
