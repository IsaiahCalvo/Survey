-- The replacement server handler has already verified its bearer actor. Keep
-- the V5 publication surface public only for its service role: browser roles
-- cannot call these wrappers or any survey_private V5 function directly.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_document_generation_replacement_service_v5(
  p_actor_user_id uuid,p_document_id uuid,p_source_id uuid,p_candidate_operation_id uuid,
  p_archive_operation_ids uuid[],p_expected_generation_id uuid,p_expected_wal_head bigint,
  p_operation jsonb,p_expected_definition_revision bigint,p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN survey_private.read_document_generation_replacement_v5(p_actor_user_id,p_document_id,
    p_source_id,p_candidate_operation_id,p_archive_operation_ids,p_expected_generation_id,
    p_expected_wal_head,p_operation,p_expected_definition_revision,p_expected_definition_digest);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_document_generation_replacement_service_v5(
  p_actor_user_id uuid,p_source_id uuid,p_candidate_operation_id uuid,p_archive_operation_ids uuid[],
  p_expected_generation_id uuid,p_expected_wal_head bigint,p_operation jsonb,p_plan jsonb,
  p_expected_definition_revision bigint,p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN survey_private.prepare_document_generation_replacement_v5(p_actor_user_id,p_source_id,
    p_candidate_operation_id,p_archive_operation_ids,p_expected_generation_id,p_expected_wal_head,
    p_operation,p_plan,p_expected_definition_revision,p_expected_definition_digest);
END $$;

CREATE OR REPLACE FUNCTION public.publish_document_generation_service_v5(
  p_actor_user_id uuid,p_source_id uuid,p_candidate_operation_id uuid,p_archive_operation_ids uuid[],
  p_plan jsonb,p_expected_definition_revision bigint,p_expected_definition_digest text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN survey_private.publish_document_generation_v5(p_actor_user_id,p_source_id,
    p_candidate_operation_id,p_archive_operation_ids,p_plan,p_expected_definition_revision,
    p_expected_definition_digest);
END $$;

CREATE OR REPLACE FUNCTION public.read_document_generation_transform_source_service_v2(
  p_actor_user_id uuid,p_source_id uuid,p_content_model_version smallint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN public.read_document_generation_transform_source_v2(
    p_actor_user_id,p_source_id,p_content_model_version);
END $$;

CREATE OR REPLACE FUNCTION public.get_document_generation_source_bytes_service_v2(
  p_actor_user_id uuid,p_source_id uuid,p_content_model_version smallint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN survey_private.check_document_generation_source_bytes_v2(
    p_actor_user_id,p_source_id,p_content_model_version);
END $$;

CREATE OR REPLACE FUNCTION survey_private.resolve_document_generation_replacement_source_model_v1(
  p_actor uuid,p_document uuid,p_source uuid,p_candidate uuid,p_expected_generation uuid)
RETURNS smallint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE request_row survey_private.document_generation_replacement_requests%ROWTYPE;
  model smallint;
BEGIN
  IF p_actor IS NULL OR p_document IS NULL OR p_source IS NULL OR p_candidate IS NULL
     OR p_expected_generation IS NULL THEN
    RAISE EXCEPTION 'Invalid replacement source model lookup' USING ERRCODE='22023';
  END IF;
  -- This makes current editor/lock/account authority the first disclosure
  -- fence. It deliberately does not consult the current generation head:
  -- exact retries must still resolve their retained source generation later.
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor,p_document);
  SELECT * INTO request_row FROM survey_private.document_generation_replacement_requests
    WHERE candidate_operation_id=p_candidate;
  IF FOUND THEN
    IF request_row.actor_user_id IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'Replacement is not yours' USING ERRCODE='42501';
    END IF;
    IF request_row.document_id IS DISTINCT FROM p_document
       OR request_row.source_id IS DISTINCT FROM p_source
       OR request_row.expected_generation_id IS DISTINCT FROM p_expected_generation THEN
      RAISE EXCEPTION 'Replacement retry identity differs' USING ERRCODE='23505';
    END IF;
  END IF;
  SELECT g.content_model_version INTO model FROM survey_private.annotation_generations g
    WHERE g.document_id=p_document AND g.generation_id=p_expected_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'annotation generation changed' USING ERRCODE='SG002';
  END IF;
  IF model IS NULL OR model NOT IN(1,2) THEN
    RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003';
  END IF;
  RETURN model;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_document_generation_replacement_source_model_service_v1(
  p_actor_user_id uuid,p_document_id uuid,p_source_id uuid,p_candidate_operation_id uuid,
  p_expected_generation_id uuid)
RETURNS smallint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM survey_private.require_generation_source_service();
  RETURN survey_private.resolve_document_generation_replacement_source_model_v1(p_actor_user_id,
    p_document_id,p_source_id,p_candidate_operation_id,p_expected_generation_id);
END $$;

REVOKE ALL ON FUNCTION
  survey_private.read_document_generation_replacement_v5(uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text),
  survey_private.prepare_document_generation_replacement_v5(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text),
  survey_private.publish_document_generation_v5(uuid,uuid,uuid,uuid[],jsonb,bigint,text),
  survey_private.check_document_generation_source_bytes_v2(uuid,uuid,smallint),
  survey_private.resolve_document_generation_replacement_source_model_v1(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

DO $$ DECLARE signature text; BEGIN FOREACH signature IN ARRAY ARRAY[
  'public.read_document_generation_replacement_service_v5(uuid,uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,bigint,text)',
  'public.prepare_document_generation_replacement_service_v5(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb,bigint,text)',
  'public.publish_document_generation_service_v5(uuid,uuid,uuid,uuid[],jsonb,bigint,text)',
  'public.read_document_generation_transform_source_service_v2(uuid,uuid,smallint)',
  'public.get_document_generation_source_bytes_service_v2(uuid,uuid,smallint)',
  'public.resolve_document_generation_replacement_source_model_service_v1(uuid,uuid,uuid,uuid,uuid)'
] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||signature||' TO service_role';
END LOOP; END $$;
COMMIT;
