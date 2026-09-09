-- PRIVATE worker input, never a browser response. Includes other actors' survey
-- rows and connector history. No table grant, recapture, publication or retention.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_document_generation_transform_source(p_actor_user_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE proof jsonb; r survey_private.document_generation_sources%ROWTYPE;
  b survey_private.document_generation_source_bodies%ROWTYPE; semantic jsonb;
BEGIN
  PERFORM survey_private.require_generation_source_service();
  -- This checks current access, generation and every source object, and keeps
  -- source/document/path/object locks until this short transaction completes.
  proof:=survey_private.assert_document_generation_source_bytes(p_actor_user_id,p_source_id);
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source_id;
  SELECT * INTO b FROM survey_private.document_generation_source_bodies WHERE body_id=r.body_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation source body unavailable' USING ERRCODE='23514'; END IF;
  semantic:=b.payload->'semantic';
  IF b.document_id IS DISTINCT FROM r.document_id OR b.source_sql_sha256 IS DISTINCT FROM r.source_sql_sha256
    OR semantic->>'document_id' IS DISTINCT FROM r.document_id::text
    OR semantic->'document'->>'id' IS DISTINCT FROM r.document_id::text
    OR semantic->>'generation_id' IS DISTINCT FROM r.generation_id::text
    OR semantic->>'wal_head' IS DISTINCT FROM r.wal_head::text
    OR b.byte_length IS DISTINCT FROM octet_length(b.payload::text)::bigint
    OR b.body_sha256 IS DISTINCT FROM encode(sha256(convert_to(b.payload::text,'UTF8')),'hex')
    OR b.source_sql_sha256 IS DISTINCT FROM encode(sha256(convert_to(semantic::text,'UTF8')),'hex')
    OR r.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Generation source body differs from capture' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('version',1,'source_id',r.source_id,'actor_user_id',r.actor_user_id,
    'document_id',r.document_id,'generation_id',r.generation_id,'source_sql_sha256',r.source_sql_sha256,
    'body_sha256',b.body_sha256,'wal_head',r.wal_head::text,'expires_at',r.expires_at,
    'source_bytes',proof,'payload',b.payload);
END; $$;

ALTER FUNCTION public.read_document_generation_transform_source(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_document_generation_transform_source(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_document_generation_transform_source(uuid,uuid) TO service_role;
COMMIT;
