-- Bound new model-2 annotation rows to the checked-read transport limits.
-- Exact old receipts stay readable even when they predate these admission caps.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.append_annotation_update_v3(p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,
 p_client_id text,p_client_seq bigint,p_data bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid(); receipt record; n bigint; current_generation uuid; found_receipt boolean;
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE='42501';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Annotation transport requires READ COMMITTED' USING ERRCODE='25001';END IF;
 IF p_document_id IS NULL OR p_content_model_version IS NULL OR p_content_model_version NOT IN(1,2)
  OR p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512 OR p_client_seq IS NULL OR p_client_seq<=0 OR p_data IS NULL THEN
  RAISE EXCEPTION 'invalid annotation update' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN RAISE EXCEPTION 'annotation write contention' USING ERRCODE='40001';END IF;
 SELECT h.generation_id INTO current_generation FROM survey_private.annotation_generation_heads h WHERE h.document_id=p_document_id;
 IF p_generation_id IS NULL THEN SELECT u.seq,u.data,u.actor_user_id INTO receipt FROM public.annotation_updates u
  WHERE u.document_id=p_document_id AND u.client_id=p_client_id AND u.client_seq=p_client_seq;
 ELSE SELECT u.seq,u.data,u.actor_user_id INTO receipt FROM survey_private.annotation_generation_updates u
  WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq=p_client_seq;END IF;
 found_receipt:=FOUND;
 IF found_receipt THEN
  PERFORM survey_private.annotation_content_model_receipt(p_document_id,p_generation_id,p_content_model_version);
  IF receipt.actor_user_id IS NOT NULL AND receipt.actor_user_id IS DISTINCT FROM caller THEN RAISE EXCEPTION 'annotation receipt is not yours' USING ERRCODE='42501';END IF;
  IF receipt.data IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'annotation receipt collision' USING ERRCODE='23505';END IF;
  IF receipt.actor_user_id IS NULL THEN PERFORM survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,true);END IF;
  n:=receipt.seq;
 ELSE
  n:=survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,true);
  IF p_generation_id IS NULL THEN SELECT a.seq INTO n FROM public.append_annotation_update(p_document_id,p_client_id,p_client_seq,p_data) a;
  ELSE
   IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_updates u WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id
    AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq>=p_client_seq) THEN
    RAISE EXCEPTION 'annotation writer sequence did not advance' USING ERRCODE='23505';END IF;
   IF p_content_model_version=2 AND octet_length(p_data)>16777216 THEN
    RAISE EXCEPTION 'annotation model 2 update exceeds its row limit' USING ERRCODE='SG004';END IF;
   n:=n+1;INSERT INTO survey_private.annotation_generation_updates(document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
    VALUES(p_document_id,p_generation_id,n,caller,p_client_id,p_client_seq,p_data);
   UPDATE survey_private.annotation_generation_heads SET last_seq=n WHERE document_id=p_document_id;
  END IF;
 END IF;
 RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id',p_document_id,
  'generation_id',p_generation_id,'actor_user_id',CASE WHEN found_receipt THEN receipt.actor_user_id ELSE caller END,
  'client_id',p_client_id,'client_seq',p_client_seq::text,'seq',n::text,'accepted',true,'data_sha256',encode(sha256(p_data),'hex'),
  'current_generation_id',current_generation,'is_current',current_generation IS NOT DISTINCT FROM p_generation_id);
END $$;

CREATE OR REPLACE FUNCTION public.store_annotation_snapshot_v3(p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,
 p_at_seq bigint,p_snapshot bytea,p_encoding_version integer,p_writer_id text,p_writer_epoch bigint,p_expected_at_seq bigint,
 p_expected_writer_id text,p_expected_writer_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; old_snapshot record; stored boolean:=false;
BEGIN
 IF p_at_seq IS NULL OR p_at_seq<0 OR p_snapshot IS NULL OR p_encoding_version IS NULL OR p_encoding_version NOT IN(1,2)
  OR p_writer_epoch IS NULL OR p_writer_epoch<=0 OR p_expected_writer_epoch IS NULL OR p_expected_writer_epoch<0
  OR length(p_writer_id)>512 OR p_expected_at_seq<0 OR length(p_expected_writer_id)>512
  OR (p_generation_id IS NOT NULL AND (p_writer_id IS NULL OR length(p_writer_id) NOT BETWEEN 1 AND 512)) THEN
  RAISE EXCEPTION 'invalid annotation checkpoint' USING ERRCODE='22023';END IF;
 frontier:=survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,true);
 IF p_generation_id IS NULL THEN stored:=public.store_annotation_snapshot(p_document_id,p_at_seq,p_snapshot,p_encoding_version,p_writer_id,p_writer_epoch,
   p_expected_at_seq,p_expected_writer_id,p_expected_writer_epoch);
 ELSE
  SELECT s.at_seq,s.snapshot,s.encoding_version,s.writer_id,s.writer_epoch INTO old_snapshot FROM survey_private.annotation_generation_snapshots s
   WHERE s.document_id=p_document_id AND s.generation_id=p_generation_id;
  IF NOT FOUND THEN SELECT g.base_seq AS at_seq,g.baseline_snapshot AS snapshot,g.baseline_encoding_version AS encoding_version,
   NULL::text AS writer_id,0::bigint AS writer_epoch INTO old_snapshot
   FROM survey_private.annotation_generations g WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id;END IF;
  IF old_snapshot.at_seq=p_at_seq AND old_snapshot.snapshot=p_snapshot AND old_snapshot.encoding_version=p_encoding_version
   AND old_snapshot.writer_id IS NOT DISTINCT FROM p_writer_id AND old_snapshot.writer_epoch=p_writer_epoch THEN stored:=true;
  ELSIF frontier=p_at_seq AND old_snapshot.at_seq IS NOT DISTINCT FROM p_expected_at_seq
   AND old_snapshot.writer_id IS NOT DISTINCT FROM p_expected_writer_id AND old_snapshot.writer_epoch=p_expected_writer_epoch
   AND p_writer_epoch>old_snapshot.writer_epoch THEN
   IF p_content_model_version=2 AND octet_length(p_snapshot)>67108864 THEN
    RAISE EXCEPTION 'annotation model 2 checkpoint exceeds its stored row limit' USING ERRCODE='SG004';END IF;
   INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
    VALUES(p_document_id,p_generation_id,p_at_seq,p_snapshot,p_encoding_version,p_writer_id,p_writer_epoch)
    ON CONFLICT(document_id,generation_id) DO UPDATE SET at_seq=EXCLUDED.at_seq,snapshot=EXCLUDED.snapshot,
     encoding_version=EXCLUDED.encoding_version,writer_id=EXCLUDED.writer_id,writer_epoch=EXCLUDED.writer_epoch,updated_at=now();stored:=true;
  END IF;
 END IF;
 RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id',p_document_id,
  'generation_id',p_generation_id,'stored',stored,'at_seq',p_at_seq::text,'writer_id',p_writer_id,
  'writer_epoch',p_writer_epoch::text,'encoding_version',p_encoding_version)
  ||CASE WHEN stored THEN jsonb_build_object('snapshot_sha256',encode(sha256(p_snapshot),'hex')) ELSE '{}'::jsonb END;
END $$;

ALTER FUNCTION public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea) OWNER TO postgres;
ALTER FUNCTION public.store_annotation_snapshot_v3(uuid,uuid,smallint,bigint,bytea,integer,text,bigint,bigint,text,bigint) OWNER TO postgres;

COMMIT;
