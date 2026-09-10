-- Private conditional annotation checkpoint read. This protocol can omit the
-- large byte payload only when a caller presents the exact current identity.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_annotation_checkpoint_conditional_v3(
 p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,
 p_expected_at_seq bigint DEFAULT NULL,p_expected_writer_id text DEFAULT NULL,
 p_expected_writer_epoch bigint DEFAULT NULL,p_expected_encoding_version integer DEFAULT NULL,
 p_expected_snapshot_sha256 text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 caller uuid:=auth.uid();
 frontier bigint;
 checkpoint record;
 checkpoint_hash text;
 token_absent boolean;
 token_complete boolean;
 matched boolean;
BEGIN
 IF p_document_id IS NULL OR p_generation_id IS NULL
  OR p_content_model_version IS NULL OR p_content_model_version NOT IN(1,2) THEN
  RAISE EXCEPTION 'invalid conditional annotation checkpoint scope' USING ERRCODE='22023';END IF;

 token_absent:=p_expected_at_seq IS NULL AND p_expected_writer_id IS NULL
  AND p_expected_writer_epoch IS NULL AND p_expected_encoding_version IS NULL
  AND p_expected_snapshot_sha256 IS NULL;
 IF token_absent THEN token_complete:=false;
 ELSIF p_expected_at_seq IS NOT NULL AND p_expected_at_seq>=0
  AND p_expected_writer_epoch IS NOT NULL AND p_expected_writer_epoch>=0
  AND p_expected_encoding_version IS NOT NULL AND p_expected_encoding_version IN(1,2)
  AND p_expected_snapshot_sha256 IS NOT NULL
  AND p_expected_snapshot_sha256~'^[0-9a-f]{64}$'
  AND ((p_expected_writer_id IS NULL AND p_expected_writer_epoch=0)
    OR (p_expected_writer_id IS NOT NULL AND length(p_expected_writer_id) BETWEEN 1 AND 512
      AND p_expected_writer_epoch>0)) THEN token_complete:=true;
 ELSE RAISE EXCEPTION 'invalid conditional annotation checkpoint identity' USING ERRCODE='22023';END IF;

 frontier:=survey_private.annotation_generation_scope_v3(
  p_document_id,p_generation_id,p_content_model_version,false);
 IF token_complete AND p_expected_at_seq>frontier THEN
  RAISE EXCEPTION 'invalid conditional annotation checkpoint frontier' USING ERRCODE='22023';END IF;
 SELECT s.at_seq,s.snapshot,s.encoding_version,s.writer_id,s.writer_epoch,g.base_seq INTO checkpoint
  FROM survey_private.annotation_generation_snapshots s
  JOIN survey_private.annotation_generations g
   ON g.document_id=s.document_id AND g.generation_id=s.generation_id
  WHERE s.document_id=p_document_id AND s.generation_id=p_generation_id FOR SHARE OF s,g NOWAIT;
 IF NOT FOUND THEN
  SELECT g.base_seq AS at_seq,g.baseline_snapshot AS snapshot,
    g.baseline_encoding_version AS encoding_version,NULL::text AS writer_id,
    0::bigint AS writer_epoch,g.base_seq INTO checkpoint
   FROM survey_private.annotation_generations g
   WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id FOR SHARE NOWAIT;
 END IF;
 IF NOT FOUND OR checkpoint.at_seq IS NULL OR checkpoint.at_seq<checkpoint.base_seq
  OR checkpoint.at_seq>frontier OR checkpoint.snapshot IS NULL
  OR checkpoint.encoding_version IS NULL OR checkpoint.encoding_version NOT IN(1,2)
  OR checkpoint.writer_epoch IS NULL OR checkpoint.writer_epoch<0
  OR (checkpoint.writer_id IS NULL AND checkpoint.writer_epoch<>0)
  OR (checkpoint.writer_id IS NOT NULL AND (length(checkpoint.writer_id) NOT BETWEEN 1 AND 512
    OR checkpoint.writer_epoch<=0)) THEN
  RAISE EXCEPTION 'conditional annotation checkpoint differs' USING ERRCODE='23514';END IF;
 IF octet_length(checkpoint.snapshot) NOT BETWEEN 1 AND 67108864 THEN
  RAISE EXCEPTION 'conditional annotation checkpoint exceeds read bounds' USING ERRCODE='54000';END IF;

 -- The shared document lock and row lock bind this digest, identity and WAL
 -- frontier through response construction. Encode bytes only on a miss.
 checkpoint_hash:=encode(sha256(checkpoint.snapshot),'hex');
 matched:=token_complete
  AND checkpoint.at_seq=p_expected_at_seq
  AND checkpoint.writer_id IS NOT DISTINCT FROM p_expected_writer_id
  AND checkpoint.writer_epoch=p_expected_writer_epoch
  AND checkpoint.encoding_version=p_expected_encoding_version
  AND checkpoint_hash=p_expected_snapshot_sha256;

 RETURN jsonb_build_object(
  'version',3,
  'actor_user_id',caller,
  'document_id',p_document_id,
  'generation_id',p_generation_id,
  'content_model_version',p_content_model_version,
  'wal_head',frontier::text,
  'snapshot_matches',matched,
  'checkpoint',jsonb_build_object(
    'at_seq',checkpoint.at_seq::text,
    'writer_id',checkpoint.writer_id,
    'writer_epoch',checkpoint.writer_epoch::text,
    'encoding_version',checkpoint.encoding_version,
    'snapshot_sha256',checkpoint_hash,
    'snapshot',CASE WHEN matched THEN NULL ELSE '\x'||encode(checkpoint.snapshot,'hex') END));
END $$;

ALTER FUNCTION public.read_annotation_checkpoint_conditional_v3(
 uuid,uuid,smallint,bigint,text,bigint,integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_annotation_checkpoint_conditional_v3(
 uuid,uuid,smallint,bigint,text,bigint,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
