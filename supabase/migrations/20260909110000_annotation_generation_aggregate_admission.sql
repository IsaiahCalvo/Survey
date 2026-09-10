-- Private model-2 aggregate admission. This migration intentionally grants no
-- runtime role access: a later rollout must supply an actor-bound trusted call
-- path without exposing these functions as public annotation RPCs.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION survey_private.probe_annotation_generation_update_receipt_v1(
  p_document_id uuid,
  p_generation_id uuid,
  p_content_model_version smallint,
  p_client_id text,
  p_client_seq bigint,
  p_data bytea)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  caller uuid:=auth.uid();
  receipt record;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate receipt is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Annotation aggregate receipt requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF p_document_id IS NULL OR p_generation_id IS NULL OR p_content_model_version IS DISTINCT FROM 2
    OR p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512
    OR p_client_seq IS NULL OR p_client_seq<=0 OR p_data IS NULL THEN
    RAISE EXCEPTION 'invalid annotation aggregate receipt' USING ERRCODE='22023';
  END IF;

  SELECT u.seq,u.data,u.actor_user_id INTO receipt
  FROM survey_private.annotation_generation_updates u
  WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id
    AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq=p_client_seq;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'version',1,'status','missing','content_model_version',p_content_model_version,
      'document_id',p_document_id,'generation_id',p_generation_id,'actor_user_id',caller,
      'client_id',p_client_id,'client_seq',p_client_seq::text);
  END IF;

  -- The generation receipt and bytes are immutable. Preserve the public v3
  -- retry order: model evidence precedes collision detection, and neither path
  -- requires the generation to remain current or the actor to retain access.
  PERFORM survey_private.annotation_content_model_receipt(
    p_document_id,p_generation_id,p_content_model_version);
  IF receipt.actor_user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'annotation aggregate receipt is not yours' USING ERRCODE='42501';
  END IF;
  IF receipt.data IS DISTINCT FROM p_data THEN
    RAISE EXCEPTION 'annotation aggregate receipt collision' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object(
    'version',1,'status','accepted','accepted',true,
    'content_model_version',p_content_model_version,
    'document_id',p_document_id,'generation_id',p_generation_id,'actor_user_id',caller,
    'client_id',p_client_id,'client_seq',p_client_seq::text,
    'seq',receipt.seq::text,'data_sha256',encode(sha256(p_data),'hex'));
END $$;

CREATE OR REPLACE FUNCTION survey_private.commit_annotation_generation_aggregate_v1(
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
  caller uuid:=auth.uid();
  receipt record;
  frontier bigint;
  base_seq bigint;
  baseline_snapshot bytea;
  baseline_encoding integer;
  has_stored_checkpoint boolean;
  current_at_seq bigint;
  current_snapshot bytea;
  current_encoding integer;
  current_writer_id text;
  current_writer_epoch bigint;
  current_sha256 text;
  new_seq bigint;
  new_writer_epoch bigint;
  new_checkpoint jsonb:=NULL;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'annotation aggregate write is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Annotation aggregate write requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  -- Only stable receipt-key inputs are checked before the receipt lookup. A
  -- lost-success retry must not depend on stale head/checkpoint/compaction data.
  IF p_document_id IS NULL OR p_generation_id IS NULL OR p_content_model_version IS DISTINCT FROM 2
    OR p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512
    OR p_client_seq IS NULL OR p_client_seq<=0 OR p_data IS NULL THEN
    RAISE EXCEPTION 'invalid annotation aggregate write' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN
    RAISE EXCEPTION 'annotation aggregate write contention' USING ERRCODE='40001';
  END IF;

  -- Repeat the exact receipt probe under the same document lock before any
  -- current-generation, access, head, checkpoint, or size checks.
  SELECT u.seq,u.data,u.actor_user_id INTO receipt
  FROM survey_private.annotation_generation_updates u
  WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id
    AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq=p_client_seq;
  IF FOUND THEN
    PERFORM survey_private.annotation_content_model_receipt(
      p_document_id,p_generation_id,p_content_model_version);
    IF receipt.actor_user_id IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'annotation aggregate receipt is not yours' USING ERRCODE='42501';
    END IF;
    IF receipt.data IS DISTINCT FROM p_data THEN
      RAISE EXCEPTION 'annotation aggregate receipt collision' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'version',1,'status','accepted','accepted',true,
      'content_model_version',p_content_model_version,
      'document_id',p_document_id,'generation_id',p_generation_id,'actor_user_id',caller,
      'client_id',p_client_id,'client_seq',p_client_seq::text,
      'seq',receipt.seq::text,'data_sha256',encode(sha256(p_data),'hex'),
      'checkpoint_stored',false,'checkpoint',NULL);
  END IF;

  IF p_expected_head IS NULL OR p_expected_head<0
    OR p_expected_checkpoint_at_seq IS NULL OR p_expected_checkpoint_at_seq<0
    OR p_expected_checkpoint_at_seq>p_expected_head
    OR p_expected_checkpoint_writer_epoch IS NULL OR p_expected_checkpoint_writer_epoch<0
    OR p_expected_checkpoint_encoding_version IS NULL
    OR p_expected_checkpoint_encoding_version NOT IN(1,2)
    OR p_expected_checkpoint_sha256 IS NULL
    OR p_expected_checkpoint_sha256 !~ '^[0-9a-f]{64}$'
    OR (p_expected_checkpoint_writer_id IS NULL AND p_expected_checkpoint_writer_epoch<>0)
    OR (p_expected_checkpoint_writer_id IS NOT NULL AND
      (length(p_expected_checkpoint_writer_id) NOT BETWEEN 1 AND 512
       OR p_expected_checkpoint_writer_epoch<=0))
    OR ((p_result_checkpoint IS NULL)<>(p_result_checkpoint_encoding_version IS NULL))
    OR (p_result_checkpoint_encoding_version IS NOT NULL
      AND p_result_checkpoint_encoding_version NOT IN(1,2)) THEN
    RAISE EXCEPTION 'invalid annotation aggregate checkpoint' USING ERRCODE='22023';
  END IF;

  -- This reuses the checked v3 access, document-lock, current-generation, and
  -- content-model checks. The advisory transaction lock is reentrant here.
  frontier:=survey_private.annotation_generation_scope_v3(
    p_document_id,p_generation_id,p_content_model_version,true);

  -- Preserve the existing writer collision order before either CAS fence.
  IF EXISTS(
    SELECT 1 FROM survey_private.annotation_generation_updates u
    WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id
      AND u.actor_user_id=caller AND u.client_id=p_client_id
      AND u.client_seq>=p_client_seq) THEN
    RAISE EXCEPTION 'annotation writer sequence did not advance' USING ERRCODE='23505';
  END IF;
  IF octet_length(p_data)>16777216 THEN
    RAISE EXCEPTION 'annotation model 2 update exceeds its row limit' USING ERRCODE='SG004';
  END IF;
  IF p_result_checkpoint IS NOT NULL AND octet_length(p_result_checkpoint)>67108864 THEN
    RAISE EXCEPTION 'annotation model 2 checkpoint exceeds its stored row limit' USING ERRCODE='SG004';
  END IF;
  IF frontier IS DISTINCT FROM p_expected_head THEN
    RAISE EXCEPTION 'annotation aggregate head changed' USING ERRCODE='40001';
  END IF;

  SELECT g.base_seq,g.baseline_snapshot,g.baseline_encoding_version,
    s.document_id IS NOT NULL,s.at_seq,s.snapshot,s.encoding_version,s.writer_id,s.writer_epoch
  INTO base_seq,baseline_snapshot,baseline_encoding,has_stored_checkpoint,
    current_at_seq,current_snapshot,current_encoding,current_writer_id,current_writer_epoch
  FROM survey_private.annotation_generations g
  LEFT JOIN survey_private.annotation_generation_snapshots s
    ON s.document_id=g.document_id AND s.generation_id=g.generation_id
  WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'annotation generation changed' USING ERRCODE='SG002';
  END IF;

  IF has_stored_checkpoint THEN
    NULL;
  ELSE
    current_at_seq:=base_seq;
    current_snapshot:=baseline_snapshot;
    current_encoding:=baseline_encoding;
    current_writer_id:=NULL;
    current_writer_epoch:=0;
  END IF;

  IF current_at_seq IS NULL OR current_at_seq<base_seq OR current_at_seq>frontier
    OR current_snapshot IS NULL OR current_encoding NOT IN(1,2)
    OR (has_stored_checkpoint AND
      (current_writer_id IS NULL OR length(current_writer_id) NOT BETWEEN 1 AND 512
       OR current_writer_epoch IS NULL OR current_writer_epoch<=0))
    OR (NOT has_stored_checkpoint AND
      (current_writer_id IS NOT NULL OR current_writer_epoch IS DISTINCT FROM 0)) THEN
    RAISE EXCEPTION 'annotation aggregate checkpoint state is invalid' USING ERRCODE='55000';
  END IF;

  IF current_at_seq IS DISTINCT FROM p_expected_checkpoint_at_seq
    OR current_writer_id IS DISTINCT FROM p_expected_checkpoint_writer_id
    OR current_writer_epoch IS DISTINCT FROM p_expected_checkpoint_writer_epoch
    OR current_encoding IS DISTINCT FROM p_expected_checkpoint_encoding_version THEN
    RAISE EXCEPTION 'annotation aggregate checkpoint changed' USING ERRCODE='40001';
  END IF;
  current_sha256:=encode(sha256(current_snapshot),'hex');
  IF current_sha256 IS DISTINCT FROM p_expected_checkpoint_sha256 THEN
    RAISE EXCEPTION 'annotation aggregate checkpoint changed' USING ERRCODE='40001';
  END IF;

  IF frontier=9223372036854775807 THEN
    RAISE EXCEPTION 'annotation aggregate sequence is exhausted' USING ERRCODE='22003';
  END IF;
  IF p_result_checkpoint IS NOT NULL AND current_writer_epoch=9223372036854775807 THEN
    RAISE EXCEPTION 'annotation aggregate checkpoint epoch is exhausted' USING ERRCODE='22003';
  END IF;

  new_seq:=frontier+1;
  INSERT INTO survey_private.annotation_generation_updates(
    document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
  VALUES(p_document_id,p_generation_id,new_seq,caller,p_client_id,p_client_seq,p_data);
  UPDATE survey_private.annotation_generation_heads
  SET last_seq=new_seq WHERE document_id=p_document_id AND generation_id=p_generation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'annotation generation changed' USING ERRCODE='SG002';
  END IF;

  IF p_result_checkpoint IS NOT NULL THEN
    new_writer_epoch:=current_writer_epoch+1;
    INSERT INTO survey_private.annotation_generation_snapshots(
      document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
    VALUES(p_document_id,p_generation_id,new_seq,p_result_checkpoint,
      p_result_checkpoint_encoding_version,'survey-private-aggregate-v1',new_writer_epoch)
    ON CONFLICT(document_id,generation_id) DO UPDATE SET
      at_seq=EXCLUDED.at_seq,snapshot=EXCLUDED.snapshot,
      encoding_version=EXCLUDED.encoding_version,writer_id=EXCLUDED.writer_id,
      writer_epoch=EXCLUDED.writer_epoch,updated_at=now();
    new_checkpoint:=jsonb_build_object(
      'at_seq',new_seq::text,'writer_id','survey-private-aggregate-v1',
      'writer_epoch',new_writer_epoch::text,
      'encoding_version',p_result_checkpoint_encoding_version,
      'snapshot_sha256',encode(sha256(p_result_checkpoint),'hex'));
  END IF;

  RETURN jsonb_build_object(
    'version',1,'status','accepted','accepted',true,
    'content_model_version',p_content_model_version,
    'document_id',p_document_id,'generation_id',p_generation_id,'actor_user_id',caller,
    'client_id',p_client_id,'client_seq',p_client_seq::text,
    'seq',new_seq::text,'data_sha256',encode(sha256(p_data),'hex'),
    'checkpoint_stored',p_result_checkpoint IS NOT NULL,'checkpoint',new_checkpoint);
END $$;

ALTER FUNCTION survey_private.probe_annotation_generation_update_receipt_v1(
  uuid,uuid,smallint,text,bigint,bytea) OWNER TO postgres;
ALTER FUNCTION survey_private.commit_annotation_generation_aggregate_v1(
  uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION survey_private.probe_annotation_generation_update_receipt_v1(
  uuid,uuid,smallint,text,bigint,bytea) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION survey_private.commit_annotation_generation_aggregate_v1(
  uuid,uuid,smallint,text,bigint,bytea,bigint,bigint,text,bigint,integer,text,bytea,integer)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
