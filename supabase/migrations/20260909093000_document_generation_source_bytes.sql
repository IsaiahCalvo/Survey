-- A trusted complete-stream attestation, not Storage metadata hashing, PDF
-- publication, or a claim that old mutable paths are immutable between calls.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS survey_private.document_generation_source_bytes (
 source_id uuid PRIMARY KEY REFERENCES survey_private.document_generation_sources(source_id) ON DELETE CASCADE,
 claim_id uuid, claim_expires_at timestamptz, objects jsonb, verified_at timestamptz,
 CHECK ((objects IS NULL)=(verified_at IS NULL)),
 CHECK ((claim_id IS NULL)=(claim_expires_at IS NULL))
);
CREATE TABLE IF NOT EXISTS survey_private.document_generation_source_byte_claims (
 source_id uuid NOT NULL REFERENCES survey_private.document_generation_sources(source_id) ON DELETE CASCADE,
 claim_id uuid NOT NULL, PRIMARY KEY(source_id,claim_id)
);
ALTER TABLE survey_private.document_generation_source_bytes OWNER TO postgres;
ALTER TABLE survey_private.document_generation_source_byte_claims OWNER TO postgres;
ALTER TABLE survey_private.document_generation_source_bytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_source_byte_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_source_bytes,survey_private.document_generation_source_byte_claims FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.discard_terminal_generation_source_bytes()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state<>'captured' THEN
  DELETE FROM survey_private.document_generation_source_bytes WHERE source_id=NEW.source_id;
  DELETE FROM survey_private.document_generation_source_byte_claims WHERE source_id=NEW.source_id;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS generation_source_bytes_terminal ON survey_private.document_generation_sources;
CREATE TRIGGER generation_source_bytes_terminal AFTER UPDATE OF state ON survey_private.document_generation_sources
 FOR EACH ROW EXECUTE FUNCTION survey_private.discard_terminal_generation_source_bytes();

-- All callers hold the source row until commit. Short document/path/object
-- locks protect these checks, never span provider I/O. The caller must download
-- each exact version and pass all complete-stream hashes in one record call.
CREATE OR REPLACE FUNCTION survey_private.check_document_generation_source_bytes(p_actor uuid,p_source uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE; s jsonb; b survey_private.document_generation_source_bytes%ROWTYPE;
 previous_sub text:=current_setting('request.jwt.claim.sub',true); manifest jsonb; expected jsonb; actual jsonb;
 source_path text; sidecar_path text; path text; item jsonb; d public.documents%ROWTYPE; result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source verification requires READ COMMITTED' USING ERRCODE='25001';END IF;
 SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source FOR UPDATE NOWAIT;
 IF NOT FOUND OR p_actor IS NULL OR r.actor_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Source is not yours' USING ERRCODE='42501';END IF;
 IF r.state='captured' AND r.expires_at<=clock_timestamp() THEN
  PERFORM survey_private.release_document_generation_source(p_source,'expired');r.state:='expired';
 END IF;
 result:=jsonb_build_object('version',1,'source_id',r.source_id,'actor_user_id',r.actor_user_id,'document_id',r.document_id,
  'generation_id',r.generation_id,'source_sql_sha256',r.source_sql_sha256,'expires_at',r.expires_at);
 IF r.state<>'captured' THEN RETURN result||jsonb_build_object('state',r.state,'objects','[]'::jsonb,'verified_at',NULL);END IF;
 SELECT payload->'semantic' INTO s FROM survey_private.document_generation_source_bodies WHERE body_id=r.body_id;
 IF s IS NULL THEN RAISE EXCEPTION 'Source body missing' USING ERRCODE='23514';END IF;
 PERFORM survey_private.assert_document_generation_upload_authority(p_actor,r.document_id,(s->'document'->>'user_id')::uuid);
 PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
 PERFORM survey_private.annotation_generation_scope(r.document_id,r.generation_id,false);
 PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 SELECT * INTO d FROM public.documents WHERE id=r.document_id;
 source_path:=s->'source_object'->>'path';
 IF r.generation_id IS NULL THEN
  IF d.file_path IS DISTINCT FROM source_path THEN RAISE EXCEPTION 'Source PDF binding changed' USING ERRCODE='23514';END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u
   JOIN survey_private.document_generation_storage_references ref ON ref.document_id=u.document_id AND ref.generation_id=u.generation_id AND ref.path=u.path
   WHERE u.document_id=r.document_id AND u.generation_id=r.generation_id AND u.owner_user_id=d.user_id AND u.state='verified' AND u.path=source_path
    AND u.verified_object_id::text=s->'source_object'->>'id' AND u.verified_object_version=s->'source_object'->>'version') THEN
  RAISE EXCEPTION 'Active PDF binding changed' USING ERRCODE='23514';
 END IF;
 IF d.project_id::text IS DISTINCT FROM s->'document'->>'project_id' THEN RAISE EXCEPTION 'Source sidecar binding changed' USING ERRCODE='23514';END IF;
 IF d.project_id IS NOT NULL THEN sidecar_path:=d.project_id::text||'/'||d.id::text||'_data.json';END IF;
 manifest:=jsonb_build_array((s->'source_object')||jsonb_build_object('kind','pdf','content_sha256',NULL));
 FOR item IN SELECT x FROM jsonb_array_elements(s->'sidecar_objects') x ORDER BY x->>'path' LOOP
  IF item->>'path' IS DISTINCT FROM sidecar_path THEN RAISE EXCEPTION 'Unknown source sidecar' USING ERRCODE='23514';END IF;
  manifest:=manifest||jsonb_build_array(item||jsonb_build_object('kind','sidecar','content_sha256',NULL));
 END LOOP;
 FOR item IN SELECT x FROM jsonb_array_elements(manifest) x LOOP
  IF item->>'bucket_id'<>'documents' OR item->>'path' IS NULL
   OR coalesce(item->>'version','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR coalesce(item->>'byte_length','')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION 'Source object metadata is not verifiable' USING ERRCODE='23514';END IF;
  IF (item->>'byte_length')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'Source object size is unsupported' USING ERRCODE='23514';END IF;
 END LOOP;
 FOR path IN SELECT DISTINCT x FROM unnest(ARRAY[source_path,sidecar_path]) x WHERE x IS NOT NULL ORDER BY x LOOP
  IF survey_private.touch_document_storage_path(path) THEN RAISE EXCEPTION 'Source path retired' USING ERRCODE='23514';END IF;
  PERFORM o.id FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=path FOR SHARE NOWAIT;
  SELECT jsonb_build_object('bucket_id',o.bucket_id,'path',o.name,'id',o.id,'version',o.version,'byte_length',o.metadata->>'size')
    INTO actual FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=path;
  SELECT x-'kind'-'content_sha256' INTO expected FROM jsonb_array_elements(manifest) x WHERE x->>'path'=path;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Source object metadata changed' USING ERRCODE='23514';END IF;
 END LOOP;
 IF r.expires_at<=clock_timestamp() THEN
  PERFORM survey_private.release_document_generation_source(p_source,'expired');
  RETURN result||jsonb_build_object('state','expired','objects','[]'::jsonb,'verified_at',NULL);
 END IF;
 SELECT * INTO b FROM survey_private.document_generation_source_bytes WHERE source_id=p_source;
 RETURN result||jsonb_build_object('state',CASE WHEN b.verified_at IS NOT NULL THEN 'verified' WHEN b.claim_expires_at>clock_timestamp() THEN 'verifying' ELSE 'unverified' END,
  'objects',coalesce(b.objects,manifest),'verified_at',b.verified_at);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);RAISE;
END; $$;

CREATE OR REPLACE FUNCTION public.get_document_generation_source_bytes(p_actor_user_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
BEGIN PERFORM survey_private.require_generation_source_service();
 RETURN survey_private.check_document_generation_source_bytes(p_actor_user_id,p_source_id);
END; $$;
CREATE OR REPLACE FUNCTION public.claim_document_generation_source_bytes(p_actor_user_id uuid,p_source_id uuid,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE r jsonb;b survey_private.document_generation_source_bytes%ROWTYPE;deadline timestamptz;
BEGIN
 PERFORM survey_private.require_generation_source_service();
 IF p_claim_id IS NULL THEN RAISE EXCEPTION 'Claim identity required' USING ERRCODE='22023';END IF;
 r:=survey_private.check_document_generation_source_bytes(p_actor_user_id,p_source_id);
 IF r->>'state' IN('verified','expired','canceled') THEN RETURN r;END IF;
 SELECT * INTO b FROM survey_private.document_generation_source_bytes WHERE source_id=p_source_id;
 IF b.claim_expires_at>clock_timestamp() THEN
  IF b.claim_id<>p_claim_id THEN RAISE EXCEPTION 'Source verifier busy' USING ERRCODE='40001';END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM survey_private.document_generation_source_byte_claims WHERE source_id=p_source_id AND claim_id=p_claim_id) THEN
   RAISE EXCEPTION 'Source verification claim already retired' USING ERRCODE='40001';END IF;
  IF (SELECT count(*) FROM survey_private.document_generation_source_byte_claims WHERE source_id=p_source_id)>=128 THEN
   RAISE EXCEPTION 'Too many source verification attempts' USING ERRCODE='54000';END IF;
  deadline:=least((r->>'expires_at')::timestamptz,clock_timestamp()+interval '2 minutes');
  INSERT INTO survey_private.document_generation_source_byte_claims VALUES(p_source_id,p_claim_id);
  INSERT INTO survey_private.document_generation_source_bytes(source_id,claim_id,claim_expires_at) VALUES(p_source_id,p_claim_id,deadline)
   ON CONFLICT(source_id) DO UPDATE SET claim_id=excluded.claim_id,claim_expires_at=excluded.claim_expires_at;
  SELECT * INTO b FROM survey_private.document_generation_source_bytes WHERE source_id=p_source_id;
 END IF;
 RETURN r||jsonb_build_object('state','verifying','verification_claim_id',b.claim_id,'verification_claim_expires_at',b.claim_expires_at);
END; $$;
CREATE OR REPLACE FUNCTION public.record_document_generation_source_bytes(p_actor_user_id uuid,p_source_id uuid,p_claim_id uuid,p_objects jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE r jsonb;b survey_private.document_generation_source_bytes%ROWTYPE;item jsonb;metadata jsonb;
BEGIN
 PERFORM survey_private.require_generation_source_service();
 r:=survey_private.check_document_generation_source_bytes(p_actor_user_id,p_source_id);
 IF r->>'state' IN('expired','canceled') THEN RETURN r;END IF;
 IF p_objects IS NULL OR jsonb_typeof(p_objects)<>'array' THEN RAISE EXCEPTION 'Complete source manifest required' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_objects)<>jsonb_array_length(r->'objects') THEN RAISE EXCEPTION 'Source manifest differs' USING ERRCODE='23514';END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(p_objects) x LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'content_sha256') IS DISTINCT FROM 'string' OR coalesce(item->>'content_sha256','')!~'^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Complete stream hash required' USING ERRCODE='22023';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(x||jsonb_build_object('content_sha256',NULL) ORDER BY n),'[]') INTO metadata FROM jsonb_array_elements(p_objects) WITH ORDINALITY t(x,n);
 IF metadata IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x||jsonb_build_object('content_sha256',NULL) ORDER BY n),'[]') FROM jsonb_array_elements(r->'objects') WITH ORDINALITY t(x,n)) THEN
  RAISE EXCEPTION 'Source manifest differs' USING ERRCODE='23514';END IF;
 -- This is an earlier trusted stream receipt, never a Storage checksum. An
 -- exact immutable generation object cannot truthfully have two byte hashes.
 -- Still require the new full stream; this slice does not reuse the old hash.
 IF r->>'generation_id' IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM survey_private.document_generation_uploads u WHERE u.document_id=(r->>'document_id')::uuid
   AND u.generation_id=(r->>'generation_id')::uuid AND u.state='verified'
   AND u.path=p_objects->0->>'path' AND u.verified_object_id::text=p_objects->0->>'id'
   AND u.verified_object_version=p_objects->0->>'version' AND u.content_sha256=p_objects->0->>'content_sha256'
 ) THEN RAISE EXCEPTION 'Source stream contradicts verified generation bytes' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM survey_private.document_generation_source_bytes WHERE source_id=p_source_id;
 IF b.verified_at IS NOT NULL THEN
  IF b.claim_id IS DISTINCT FROM p_claim_id OR b.objects IS DISTINCT FROM p_objects THEN RAISE EXCEPTION 'Source proof differs' USING ERRCODE='23505';END IF;
  RETURN r;
 END IF;
 IF p_claim_id IS NULL OR b.claim_id IS DISTINCT FROM p_claim_id OR b.claim_expires_at IS NULL OR b.claim_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'Source claim is not live' USING ERRCODE='40001';END IF;
 IF (r->>'expires_at')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'Source expired' USING ERRCODE='40001';END IF;
 UPDATE survey_private.document_generation_source_bytes SET objects=p_objects,verified_at=clock_timestamp() WHERE source_id=p_source_id;
 RETURN r||jsonb_build_object('state','verified','objects',p_objects,'verified_at',(SELECT verified_at FROM survey_private.document_generation_source_bytes WHERE source_id=p_source_id));
END; $$;
CREATE OR REPLACE FUNCTION public.release_document_generation_source_bytes(p_actor_user_id uuid,p_source_id uuid,p_claim_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE;
BEGIN
 PERFORM survey_private.require_generation_source_service();
 SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR p_actor_user_id IS NULL OR r.actor_user_id IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'Source is not yours' USING ERRCODE='42501';END IF;
 UPDATE survey_private.document_generation_source_bytes SET claim_id=NULL,claim_expires_at=NULL
  WHERE source_id=p_source_id AND claim_id=p_claim_id AND verified_at IS NULL;
 RETURN jsonb_build_object('released',FOUND,'source_id',p_source_id);
END; $$;
CREATE OR REPLACE FUNCTION survey_private.assert_document_generation_source_bytes(p_actor_user_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;BEGIN
 r:=survey_private.check_document_generation_source_bytes(p_actor_user_id,p_source_id);
 IF r->>'state'<>'verified' THEN RAISE EXCEPTION 'Verified complete source required' USING ERRCODE='23514';END IF;
 RETURN r;
END; $$;

ALTER FUNCTION survey_private.discard_terminal_generation_source_bytes() OWNER TO postgres;
ALTER FUNCTION survey_private.check_document_generation_source_bytes(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.assert_document_generation_source_bytes(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.get_document_generation_source_bytes(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_document_generation_source_bytes(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.record_document_generation_source_bytes(uuid,uuid,uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.release_document_generation_source_bytes(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.discard_terminal_generation_source_bytes(),survey_private.check_document_generation_source_bytes(uuid,uuid),
 survey_private.assert_document_generation_source_bytes(uuid,uuid),public.get_document_generation_source_bytes(uuid,uuid),
 public.claim_document_generation_source_bytes(uuid,uuid,uuid),public.record_document_generation_source_bytes(uuid,uuid,uuid,jsonb),
 public.release_document_generation_source_bytes(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_document_generation_source_bytes(uuid,uuid),public.claim_document_generation_source_bytes(uuid,uuid,uuid),
 public.record_document_generation_source_bytes(uuid,uuid,uuid,jsonb),public.release_document_generation_source_bytes(uuid,uuid,uuid) TO service_role;
COMMIT;
