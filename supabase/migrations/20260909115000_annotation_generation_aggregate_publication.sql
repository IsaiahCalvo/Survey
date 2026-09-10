-- Private, explicit publication contract for a replacement generation that
-- must use trusted aggregate annotation admission. Existing model-1 and
-- model-2 publication functions remain unchanged and unfenced by default.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $$
DECLARE trigger_definition text; trigger_function oid;
BEGIN
  IF to_regprocedure('survey_private.prepare_document_generation_replacement_v2(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)') IS NULL
    OR to_regprocedure('survey_private.publish_document_generation_v2(uuid,uuid,uuid,uuid[],jsonb)') IS NULL
    OR to_regprocedure('survey_private.enable_annotation_generation_aggregate_write_fence_v1(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate publication dependencies are missing' USING ERRCODE='55000';
  END IF;
  SELECT pg_get_triggerdef(oid),tgfoid INTO trigger_definition,trigger_function FROM pg_trigger
    WHERE tgrelid='survey_private.document_generation_publications'::regclass
      AND tgname='generation_publication_clear_replacement_plan' AND NOT tgisinternal
      AND tgtype=5 AND tgenabled='O';
  IF trigger_definition IS NULL
    OR trigger_function IS DISTINCT FROM
      'survey_private.clear_published_document_generation_replacement_plan()'::regprocedure
    OR position('NEW.plan_sha256 IS DISTINCT FROM request_row.plan_sha256' IN
      pg_get_functiondef('survey_private.clear_published_document_generation_replacement_plan()'::regprocedure))=0 THEN
    RAISE EXCEPTION 'prepared publication identity guard differs' USING ERRCODE='55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_replacement_request_sha256_v3(
  p_actor uuid,p_source uuid,p_candidate uuid,p_archives uuid[],p_expected_generation uuid,
  p_expected_wal_head bigint,p_operation jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'version',3,'aggregateAdmissionVersion',1,
    'actorUserId',p_actor,'sourceId',p_source,'candidateOperationId',p_candidate,
    'archiveOperationIds',to_jsonb(p_archives),'expectedGenerationId',p_expected_generation,
    'expectedWalHead',p_expected_wal_head::text,'operation',p_operation)::text,'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_replacement_result_v3(
  p_state text,p_actor uuid,p_document uuid,p_source uuid,p_candidate uuid,p_archives uuid[],
  p_expected_generation uuid,p_expected_wal_head bigint,p_prepared_at timestamptz,p_expires_at timestamptz,
  p_plan jsonb,p_publication jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' SET TimeZone='UTC' AS $$
  SELECT (survey_private.document_generation_replacement_result(
    p_state,p_actor,p_document,p_source,p_candidate,p_archives,p_expected_generation,
    p_expected_wal_head,p_prepared_at,p_expires_at,p_plan,p_publication)-'version')
    ||jsonb_build_object('version',3,'aggregate_admission_version',1)
$$;

DO $clone_read$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef(
    'survey_private.read_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb)'::regprocedure);
  definition:=replace(definition,
    'survey_private.read_document_generation_replacement(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb)',
    'survey_private.read_document_generation_replacement_v3(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb)');
  definition:=replace(definition,
    'survey_private.document_generation_replacement_request_sha256(',
    'survey_private.document_generation_replacement_request_sha256_v3(');
  definition:=replace(definition,
    'survey_private.document_generation_replacement_result(',
    'survey_private.document_generation_replacement_result_v3(');
  definition:=replace(definition,
    $old$publication_json:=(to_jsonb(publication)-'owner_user_id'-'archive_operation_ids')
      ||jsonb_build_object('version',1,'wal_head',publication.wal_head::text);$old$,
    $new$IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_aggregate_write_fences f
      WHERE f.document_id=publication.document_id AND f.generation_id=publication.generation_id) THEN
      RAISE EXCEPTION 'aggregate publication fence is missing' USING ERRCODE='23514';END IF;
    publication_json:=(to_jsonb(publication)-'owner_user_id'-'archive_operation_ids')
      ||jsonb_build_object('version',3,'content_model_version',2,
        'aggregate_admission_version',1,'wal_head',publication.wal_head::text);$new$);
  definition:=replace(definition,
    $old$IF plan_row.expires_at IS DISTINCT FROM request_row.expires_at
      OR encode(sha256(convert_to(plan_row.plan::text,'UTF8')),'hex') IS DISTINCT FROM request_row.plan_sha256 THEN
      RAISE EXCEPTION 'Prepared replacement plan differs' USING ERRCODE='23514';END IF;$old$,
    $new$IF plan_row.expires_at IS DISTINCT FROM request_row.expires_at
      OR encode(sha256(convert_to(plan_row.plan::text,'UTF8')),'hex') IS DISTINCT FROM request_row.plan_sha256
      OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(plan_row.plan) k) IS DISTINCT FROM
        ARRAY['aggregateAdmissionVersion','baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
      OR plan_row.plan->'version' IS DISTINCT FROM '3'::jsonb
      OR plan_row.plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb
      OR plan_row.plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'::jsonb THEN
      RAISE EXCEPTION 'Prepared replacement plan differs' USING ERRCODE='23514';END IF;$new$);
  IF position('read_document_generation_replacement_v3' IN definition)=0
    OR position('document_generation_replacement_request_sha256_v3' IN definition)=0
    OR position('document_generation_replacement_result_v3' IN definition)=0
    OR position('aggregate publication fence is missing' IN definition)=0
    OR position($needle$plan_row.plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'$needle$ IN definition)=0 THEN
    RAISE EXCEPTION 'unexpected aggregate replacement read shape' USING ERRCODE='55000';
  END IF;
  EXECUTE definition;
END $clone_read$;

DO $clone_prepare$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef(
    'survey_private.prepare_document_generation_replacement_v2(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)'::regprocedure);
  definition:=replace(definition,
    'survey_private.prepare_document_generation_replacement_v2(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb, p_plan jsonb)',
    'survey_private.prepare_document_generation_replacement_v3(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb, p_plan jsonb)');
  definition:=replace(definition,
    $old$ARRAY['baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
    OR p_plan->'version' IS DISTINCT FROM '2'::jsonb OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb$old$,
    $new$ARRAY['aggregateAdmissionVersion','baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
    OR p_plan->'version' IS DISTINCT FROM '3'::jsonb
    OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb
    OR p_plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'::jsonb$new$);
  definition:=replace(definition,
    'survey_private.document_generation_replacement_request_sha256(',
    'survey_private.document_generation_replacement_request_sha256_v3(');
  definition:=replace(definition,
    'survey_private.read_document_generation_replacement(',
    'survey_private.read_document_generation_replacement_v3(');
  IF position('prepare_document_generation_replacement_v3' IN definition)=0
    OR position($needle$p_plan->'version' IS DISTINCT FROM '3'$needle$ IN definition)=0
    OR position($needle$p_plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'$needle$ IN definition)=0
    OR position('document_generation_replacement_request_sha256_v3' IN definition)=0
    OR position('read_document_generation_replacement_v3' IN definition)=0 THEN
    RAISE EXCEPTION 'unexpected aggregate replacement preparation shape' USING ERRCODE='55000';
  END IF;
  EXECUTE definition;
END $clone_prepare$;

DO $clone_publish$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef(
    'survey_private.publish_document_generation_v2(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure);
  definition:=replace(definition,
    'survey_private.publish_document_generation_v2(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_plan jsonb)',
    'survey_private.publish_document_generation_v3(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_plan jsonb)');
  definition:=replace(definition,
    'DECLARE r survey_private.document_generation_publications%ROWTYPE; frozen jsonb;',
    'DECLARE r survey_private.document_generation_publications%ROWTYPE; prepared jsonb; frozen jsonb;');
  definition:=replace(definition,
    $old$ARRAY['baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version' IS DISTINCT FROM '2'::jsonb OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb$old$,
    $new$ARRAY['aggregateAdmissionVersion','baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version' IS DISTINCT FROM '3'::jsonb
  OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb
  OR p_plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'::jsonb$new$);
  definition:=replace(definition,
    $old$PERFORM survey_private.assert_document_generation_upload_authority(p_actor,r.document_id,r.owner_user_id);
  RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object('version',2,'content_model_version',2,'wal_head',r.wal_head::text);$old$,
    $new$PERFORM survey_private.assert_document_generation_upload_authority(p_actor,r.document_id,r.owner_user_id);
  IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_aggregate_write_fences f
    WHERE f.document_id=r.document_id AND f.generation_id=r.generation_id) THEN
    RAISE EXCEPTION 'aggregate publication fence is missing' USING ERRCODE='23514';END IF;
  RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object(
    'version',3,'content_model_version',2,'aggregate_admission_version',1,'wal_head',r.wal_head::text);$new$);
  definition:=replace(definition,
    $old$ END IF;
 frozen:=public.read_document_generation_transform_source_v2(p_actor,p_source,(p_plan->'source'->>'contentModelVersion')::smallint);$old$,
    $new$ END IF;
 prepared:=survey_private.read_document_generation_replacement_v3(
  p_actor,p_source,p_candidate,archives,(p_plan->'source'->>'generationId')::uuid,
  (p_plan->'source'->>'walHead')::bigint,p_plan->'operation');
 IF prepared->>'state' IS DISTINCT FROM 'prepared' OR prepared->'plan' IS DISTINCT FROM p_plan THEN
  RAISE EXCEPTION 'aggregate publication was not prepared' USING ERRCODE='23514';END IF;
 frozen:=public.read_document_generation_transform_source_v2(p_actor,p_source,(p_plan->'source'->>'contentModelVersion')::smallint);$new$);
  definition:=replace(definition,
    $old$PERFORM survey_private.assert_document_generation_upload_authority(p_actor,doc,owner_id);
 -- Reserve the lock needed by row timestamp triggers and the final PDF pointer$old$,
    $new$PERFORM survey_private.assert_document_generation_upload_authority(p_actor,doc,owner_id);
 IF NOT pg_try_advisory_xact_lock(hashtextextended(doc::text,0)) THEN
  RAISE EXCEPTION 'aggregate publication annotation contention' USING ERRCODE='40001';END IF;
 -- Reserve the lock needed by row timestamp triggers and the final PDF pointer$new$);
  definition:=replace(definition,
    $old$ END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=doc AND generation_id=target_generation AND last_seq=frontier)$old$,
    $new$ END IF;
 PERFORM survey_private.enable_annotation_generation_aggregate_write_fence_v1(doc,target_generation);
 IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=doc AND generation_id=target_generation AND last_seq=frontier)$new$);
  definition:=replace(definition,
    $old$OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND user_id=owner_id AND file_path=candidate.path AND file_size=candidate.byte_length) THEN$old$,
    $new$OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=doc AND user_id=owner_id AND file_path=candidate.path AND file_size=candidate.byte_length)
  OR NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_aggregate_write_fences f
    WHERE f.document_id=doc AND f.generation_id=target_generation) THEN$new$);
  definition:=replace(definition,
    $old$RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object('version',2,'content_model_version',2,'wal_head',r.wal_head::text);$old$,
    $new$RETURN (to_jsonb(r)-'owner_user_id'-'archive_operation_ids')||jsonb_build_object(
    'version',3,'content_model_version',2,'aggregate_admission_version',1,'wal_head',r.wal_head::text);$new$);
  IF position('publish_document_generation_v3' IN definition)=0
    OR position($needle$p_plan->'aggregateAdmissionVersion' IS DISTINCT FROM '1'$needle$ IN definition)=0
    OR position('aggregate publication annotation contention' IN definition)=0
    OR position('enable_annotation_generation_aggregate_write_fence_v1(doc,target_generation)' IN definition)=0
    OR position('aggregate publication was not prepared' IN definition)=0
    OR position('prepared:=survey_private.read_document_generation_replacement_v3' IN definition)=0
    OR position('aggregate publication fence is missing' IN definition)=0
    OR position('f.generation_id=target_generation' IN definition)=0
    OR (length(definition)-length(replace(definition,'enable_annotation_generation_aggregate_write_fence_v1(doc,target_generation)','')))
      /length('enable_annotation_generation_aggregate_write_fence_v1(doc,target_generation)')<>1
    OR (length(definition)-length(replace(definition,'aggregate publication fence is missing','')))
      /length('aggregate publication fence is missing')<>1
    OR (length(definition)-length(replace(definition,'''aggregate_admission_version'',1','')))
      /length('''aggregate_admission_version'',1')<>2
    OR position('publish_document_generation_v2' IN definition)>0
    OR position($needle$p_plan->'version' IS DISTINCT FROM '2'$needle$ IN definition)>0 THEN
    RAISE EXCEPTION 'unexpected aggregate generation publication shape' USING ERRCODE='55000';
  END IF;
  EXECUTE definition;
END $clone_publish$;

ALTER FUNCTION survey_private.prepare_document_generation_replacement_v3(
  uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.publish_document_generation_v3(
  uuid,uuid,uuid,uuid[],jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_replacement_request_sha256_v3(
  uuid,uuid,uuid,uuid[],uuid,bigint,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_replacement_result_v3(
  text,uuid,uuid,uuid,uuid,uuid[],uuid,bigint,timestamptz,timestamptz,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.read_document_generation_replacement_v3(
  uuid,uuid,uuid,uuid[],uuid,bigint,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.prepare_document_generation_replacement_v3(
  uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb),
  survey_private.publish_document_generation_v3(uuid,uuid,uuid,uuid[],jsonb),
  survey_private.document_generation_replacement_request_sha256_v3(
    uuid,uuid,uuid,uuid[],uuid,bigint,jsonb),
  survey_private.document_generation_replacement_result_v3(
    text,uuid,uuid,uuid,uuid,uuid[],uuid,bigint,timestamptz,timestamptz,jsonb,jsonb),
  survey_private.read_document_generation_replacement_v3(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION survey_private.prepare_document_generation_replacement_v3(
  uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb) IS
  'Private exact preparation for a model-2 replacement that must publish with aggregate admission fencing.';
COMMENT ON FUNCTION survey_private.publish_document_generation_v3(
  uuid,uuid,uuid,uuid[],jsonb) IS
  'Private atomic model-2 publication and aggregate admission fence. Existing publication versions remain unfenced.';

COMMIT;
