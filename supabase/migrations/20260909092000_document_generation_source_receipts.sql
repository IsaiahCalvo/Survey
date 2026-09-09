-- Durable PRE-TRANSFORM SQL/Storage-metadata source, not PDF-byte proof or
-- publication. Full owner-private connector/survey history stays private.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.document_generation_source_bodies (
  body_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL,
  body_sha256 text NOT NULL, source_sql_sha256 text NOT NULL,
  payload jsonb NOT NULL, byte_length bigint NOT NULL CHECK(byte_length BETWEEN 1 AND 16777216),
  UNIQUE(document_id,body_sha256)
);
CREATE TABLE IF NOT EXISTS survey_private.document_generation_sources (
  source_id uuid PRIMARY KEY, actor_user_id uuid NOT NULL, document_id uuid NOT NULL,
  generation_id uuid, state text NOT NULL DEFAULT 'captured' CHECK(state IN('captured','expired','canceled')),
  source_sql_sha256 text NOT NULL, wal_head bigint NOT NULL CHECK(wal_head>=0),
  body_id uuid REFERENCES survey_private.document_generation_source_bodies(body_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  CHECK((state='captured')=(body_id IS NOT NULL))
);
-- Private scheduling only: a busy document must not occupy every bounded
-- sweep. Public expiry and immutable capture evidence never change on retry.
ALTER TABLE survey_private.document_generation_sources ADD COLUMN IF NOT EXISTS
  next_expiry_attempt_at timestamptz NOT NULL DEFAULT '-infinity';
CREATE INDEX IF NOT EXISTS generation_sources_actor_idx ON survey_private.document_generation_sources(actor_user_id,source_id) WHERE state='captured';
CREATE INDEX IF NOT EXISTS generation_sources_document_idx ON survey_private.document_generation_sources(document_id,source_id) WHERE state='captured';
DROP INDEX IF EXISTS survey_private.generation_sources_expiry_idx;
CREATE INDEX generation_sources_expiry_idx ON survey_private.document_generation_sources
  (greatest(expires_at,next_expiry_attempt_at),expires_at,source_id) WHERE state='captured';
CREATE INDEX IF NOT EXISTS generation_sources_body_idx ON survey_private.document_generation_sources(body_id) WHERE body_id IS NOT NULL;
ALTER TABLE survey_private.document_generation_source_bodies ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_private.document_generation_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_generation_source_bodies,survey_private.document_generation_sources FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.require_generation_source_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE caller text:=coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user); trusted boolean;
BEGIN
  SELECT rolsuper OR rolbypassrls INTO trusted FROM pg_roles WHERE rolname=caller;
  IF trusted IS NOT TRUE THEN RAISE EXCEPTION 'Trusted generation source service required' USING ERRCODE='42501';END IF;
END; $$;

-- Exactly the fields consumed by the current fetch-since reducer. Registration,
-- audit, writeback and state bookkeeping are preserved as opaque history, not
-- made into a global semantic compare dependency.
CREATE OR REPLACE FUNCTION survey_private.generation_source_connector_projection(p_table text,p_row jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_table WHEN 'excel_sync_head' THEN jsonb_build_object('document_id',p_row->'document_id','template_id',p_row->'template_id','excel_revision',p_row->>'excel_revision')
 ELSE jsonb_build_object('document_id',p_row->'document_id','template_id',p_row->'template_id','op_uuid',p_row->'op_uuid',
   'op_id',p_row->'op_id','excel_revision',p_row->>'excel_revision','marker_annotation_id',p_row->'marker_annotation_id',
   'op_type',p_row->'op_type','patch_payload',p_row->'patch_payload','op_status',p_row->'op_status') END;
$$;
CREATE OR REPLACE FUNCTION survey_private.guard_generation_source_connector_write()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE before_row jsonb;after_row jsonb;doc uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD);END IF;
  IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW);END IF;
  IF TG_OP='UPDATE' AND survey_private.generation_source_connector_projection(TG_TABLE_NAME,before_row)
    IS NOT DISTINCT FROM survey_private.generation_source_connector_projection(TG_TABLE_NAME,after_row) THEN RETURN NEW;END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source-changing connector writes require READ COMMITTED' USING ERRCODE='25001';END IF;
  FOR doc IN SELECT DISTINCT x FROM unnest(ARRAY[(before_row->>'document_id')::uuid,(after_row->>'document_id')::uuid]) x WHERE x IS NOT NULL ORDER BY x LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(doc::text,0)) THEN RAISE EXCEPTION 'Document source contention' USING ERRCODE='40001';END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END; $$;
DO $$ DECLARE t text;BEGIN
  FOREACH t IN ARRAY ARRAY['excel_sync_head','excel_sync_ops'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS generation_source_connector_fence ON public.%I',t);
    EXECUTE format('CREATE TRIGGER generation_source_connector_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION survey_private.guard_generation_source_connector_write()',t);
    EXECUTE format('DROP TRIGGER IF EXISTS generation_source_no_truncate ON public.%I',t);
    EXECUTE format('CREATE TRIGGER generation_source_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_annotation_source_truncate()',t);
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION survey_private.capture_document_generation_source(p_actor uuid,p_document uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET bytea_output='hex' SET lock_timeout='2s' AS $$
DECLARE previous_sub text:=current_setting('request.jwt.claim.sub',true); d public.documents%ROWTYPE; frontier bigint;
  active_generation uuid; source_path text; sidecar_path text; path text; source_object jsonb; sidecars jsonb:='[]';
  snapshot_seq bigint; sources jsonb:='{}'; context jsonb; consumed jsonb; body jsonb; semantic jsonb;
  name text; query text; row_data jsonb; rows jsonb[]; history_rows jsonb[]:='{}';row_count integer:=0; total_bytes bigint:=0;
BEGIN
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor,p_document);
  PERFORM set_config('request.jwt.claim.sub',p_actor::text,true);
  frontier:=survey_private.annotation_generation_scope(p_document,p_generation,false);
  SELECT * INTO d FROM public.documents WHERE id=p_document;
  SELECT generation_id INTO active_generation FROM survey_private.annotation_generation_heads WHERE document_id=p_document;
  IF active_generation IS NULL THEN source_path:=d.file_path;
  ELSE
    SELECT u.path INTO source_path FROM survey_private.document_generation_uploads u
      WHERE u.document_id=p_document AND u.generation_id=active_generation AND u.owner_user_id=d.user_id AND u.state='verified'
        AND EXISTS(SELECT 1 FROM survey_private.document_generation_storage_references r WHERE r.document_id=u.document_id AND r.generation_id=u.generation_id AND r.path=u.path);
    IF NOT FOUND THEN RAISE EXCEPTION 'Active generation PDF binding is unavailable' USING ERRCODE='23514';END IF;
  END IF;
  IF source_path IS NULL THEN RAISE EXCEPTION 'Source PDF path is unavailable' USING ERRCODE='23514';END IF;
  IF d.project_id IS NOT NULL THEN sidecar_path:=d.project_id::text||'/'||d.id::text||'_data.json';END IF;
  -- The path lock also fences insertion of a currently absent sidecar. Tuple
  -- SHARE locks freeze exact object metadata; neither lock verifies its bytes.
  FOR path IN SELECT DISTINCT x FROM unnest(ARRAY[source_path,sidecar_path]) x WHERE x IS NOT NULL ORDER BY x LOOP
    IF survey_private.touch_document_storage_path(path) THEN RAISE EXCEPTION 'Source path is retired' USING ERRCODE='23514';END IF;
    PERFORM o.id FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=path FOR SHARE NOWAIT;
  END LOOP;
  SELECT jsonb_build_object('bucket_id',o.bucket_id,'path',o.name,'id',o.id,'version',o.version,'byte_length',o.metadata->>'size')
    INTO source_object FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=source_path;
  IF source_object IS NULL THEN RAISE EXCEPTION 'Source PDF object is unavailable' USING ERRCODE='23514';END IF;
  IF active_generation IS NOT NULL AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_uploads u WHERE u.document_id=p_document AND u.generation_id=active_generation
    AND u.verified_object_id::text=source_object->>'id' AND u.verified_object_version=source_object->>'version' AND u.byte_length::text=source_object->>'byte_length') THEN
    RAISE EXCEPTION 'Active PDF metadata differs from the verified upload' USING ERRCODE='23514';END IF;
  IF sidecar_path IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_id',o.bucket_id,'path',o.name,'id',o.id,'version',o.version,'byte_length',o.metadata->>'size')),'[]')
      INTO sidecars FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=sidecar_path;
  END IF;
  SELECT at_seq INTO snapshot_seq FROM public.annotation_snapshots WHERE document_id=p_document;
  FOR name,query IN SELECT * FROM(VALUES
    ('annotation_snapshot',$q$SELECT (to_jsonb(s)-'snapshot')||jsonb_build_object('snapshot_base64',encode(s.snapshot,'base64'),'at_seq',s.at_seq::text,'writer_epoch',s.writer_epoch::text,'base_at_seq',s.base_at_seq::text,'base_writer_epoch',s.base_writer_epoch::text) FROM public.annotation_snapshots s WHERE document_id=$1$q$),
    ('annotation_updates',$q$SELECT (to_jsonb(u)-'data')||jsonb_build_object('data_base64',encode(data,'base64'),'seq',seq::text,'client_seq',client_seq::text) FROM public.annotation_updates u WHERE document_id=$1 AND seq>coalesce((SELECT at_seq FROM public.annotation_snapshots WHERE document_id=$1),0) ORDER BY seq$q$),
    ('document_annotations',$q$SELECT to_jsonb(a) FROM public.document_annotations a WHERE document_id=$1 ORDER BY id$q$),
    ('doc_yjs_state',$q$SELECT (to_jsonb(s)-'state'-'state_vector')||jsonb_build_object('state_base64',encode(state,'base64'),'state_vector_base64',encode(state_vector,'base64'),'through_seq',through_seq::text) FROM public.doc_yjs_state s WHERE document_id=$1$q$),
    ('doc_yjs_updates',$q$SELECT (to_jsonb(u)-'update')||jsonb_build_object('update_base64',encode(u.update,'base64'),'id',id::text,'seq',seq::text) FROM public.doc_yjs_updates u WHERE document_id=$1 ORDER BY seq,id$q$),
    ('survey_sessions',$q$SELECT to_jsonb(s) FROM public.survey_sessions s WHERE document_id=$1 ORDER BY id$q$),
    ('survey_items',$q$SELECT to_jsonb(i) FROM public.survey_items i JOIN public.survey_sessions s ON s.id=i.session_id WHERE s.document_id=$1 ORDER BY i.session_id,i.id$q$),
    ('generation_baseline',$q$SELECT (to_jsonb(g)-'baseline_snapshot')||jsonb_build_object('baseline_snapshot_base64',encode(baseline_snapshot,'base64'),'base_seq',base_seq::text) FROM survey_private.annotation_generations g WHERE document_id=$1 AND generation_id=$2$q$),
    ('generation_snapshot',$q$SELECT (to_jsonb(s)-'snapshot')||jsonb_build_object('snapshot_base64',encode(snapshot,'base64'),'at_seq',at_seq::text,'writer_epoch',writer_epoch::text) FROM survey_private.annotation_generation_snapshots s WHERE document_id=$1 AND generation_id=$2$q$),
    ('generation_updates',$q$SELECT (to_jsonb(u)-'data')||jsonb_build_object('data_base64',encode(data,'base64'),'seq',seq::text,'client_seq',client_seq::text) FROM survey_private.annotation_generation_updates u WHERE document_id=$1 AND generation_id=$2 AND seq>coalesce((SELECT at_seq FROM survey_private.annotation_generation_snapshots WHERE document_id=$1 AND generation_id=$2),(SELECT base_seq FROM survey_private.annotation_generations WHERE document_id=$1 AND generation_id=$2),0) ORDER BY seq$q$),
    ('legacy_wal_history',$q$SELECT (to_jsonb(u)-'data')||jsonb_build_object('data_base64',encode(data,'base64'),'seq',seq::text,'client_seq',client_seq::text) FROM public.annotation_updates u WHERE document_id=$1 ORDER BY seq$q$),
    ('generation_wal_history',$q$SELECT (to_jsonb(u)-'data')||jsonb_build_object('data_base64',encode(data,'base64'),'seq',seq::text,'client_seq',client_seq::text) FROM survey_private.annotation_generation_updates u WHERE document_id=$1 AND generation_id=$2 ORDER BY seq$q$)
  ) q(n,q) LOOP
    rows:='{}';
    FOR row_data IN EXECUTE query||' LIMIT 10001' USING p_document,p_generation LOOP
      row_count:=row_count+1;total_bytes:=total_bytes+octet_length(row_data::text);
      IF row_count>10000 OR total_bytes>16777216 THEN RAISE EXCEPTION 'Source capture exceeds its bound' USING ERRCODE='54000';END IF;
      rows:=array_append(rows,row_data);
    END LOOP;
    sources:=sources||jsonb_build_object(name,CASE WHEN name IN('annotation_snapshot','doc_yjs_state','generation_baseline','generation_snapshot') THEN coalesce(rows[1],'null'::jsonb) ELSE to_jsonb(rows) END);
  END LOOP;
  -- One SQL statement / MVCC snapshot for all opaque connector history. No
  -- tokens, registrations or foreign survey bodies are projected to clients.
  -- Stream this one statement before aggregation: even a very large audit log
  -- fails at the combined cap, rather than allocating its complete JSON first.
  FOR name,row_data IN
    SELECT 'head',to_jsonb(x) FROM (SELECT * FROM public.excel_sync_head WHERE document_id=p_document LIMIT 10001) x
    UNION ALL SELECT 'state',to_jsonb(x) FROM (SELECT * FROM public.excel_sync_state WHERE document_id=p_document LIMIT 10001) x
    UNION ALL SELECT 'ops',to_jsonb(x) FROM (SELECT * FROM public.excel_sync_ops WHERE document_id=p_document LIMIT 10001) x
    UNION ALL SELECT 'changesets',to_jsonb(x) FROM (SELECT * FROM public.excel_sync_changesets WHERE document_id=p_document LIMIT 10001) x
    UNION ALL SELECT 'audit',to_jsonb(x) FROM (SELECT * FROM public.excel_sync_audit WHERE document_id=p_document LIMIT 10001) x
    UNION ALL SELECT 'registrations',to_jsonb(x) FROM (SELECT * FROM public.excel_workbook_registrations WHERE document_id=p_document LIMIT 10001) x
  LOOP
    row_count:=row_count+1;total_bytes:=total_bytes+octet_length(row_data::text);
    IF row_count>10000 OR total_bytes>16777216 THEN RAISE EXCEPTION 'Source capture exceeds its row or byte bound' USING ERRCODE='54000';END IF;
    history_rows:=array_append(history_rows,jsonb_build_object('name',name,'row',row_data));
  END LOOP;
  SELECT jsonb_build_object('head','[]'::jsonb,'state','[]'::jsonb,'ops','[]'::jsonb,'changesets','[]'::jsonb,'audit','[]'::jsonb,'registrations','[]'::jsonb)
    ||coalesce(jsonb_object_agg(k,v),'{}') INTO context FROM (
      SELECT x->>'name' k,jsonb_agg(x->'row' ORDER BY x->'row'->>'template_id',x->'row'->>'id',x->'row'->>'excel_revision') v
      FROM unnest(history_rows) x GROUP BY x->>'name'
    ) grouped;
  consumed:=jsonb_build_object('head',(SELECT coalesce(jsonb_agg(survey_private.generation_source_connector_projection('excel_sync_head',x) ORDER BY x->>'template_id'),'[]') FROM jsonb_array_elements(context->'head') x),
    'ops',(SELECT coalesce(jsonb_agg(survey_private.generation_source_connector_projection('excel_sync_ops',x) ORDER BY x->>'template_id',(x->>'excel_revision')::bigint),'[]') FROM jsonb_array_elements(context->'ops') x));
  semantic:=jsonb_build_object('version',1,'document_id',p_document,'generation_id',p_generation,'document',to_jsonb(d)||jsonb_build_object('file_size',d.file_size::text),
    'sources',sources-'legacy_wal_history'-'generation_wal_history','wal_head',frontier::text,'source_object',source_object,'sidecar_objects',sidecars,'connector_consumed',consumed);
  body:=jsonb_build_object('semantic',semantic,'connector_history',context,
    'wal_history',jsonb_build_object('legacy',sources->'legacy_wal_history','generation',sources->'generation_wal_history'));
  IF octet_length(body::text)>16777216 THEN RAISE EXCEPTION 'Source capture exceeds its byte bound' USING ERRCODE='54000';END IF;
  PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  RETURN jsonb_build_object('payload',body,'source_sql_sha256',encode(sha256(convert_to(semantic::text,'UTF8')),'hex'),
    'body_sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex'));
EXCEPTION WHEN OTHERS THEN PERFORM set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);RAISE;
END; $$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_source_descriptor(p_source uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE; s jsonb; visible jsonb; sessions jsonb; items jsonb;
BEGIN
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source;
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF r.state='captured' THEN
    SELECT payload->'semantic' INTO s FROM survey_private.document_generation_source_bodies WHERE body_id=r.body_id;
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') INTO sessions FROM jsonb_array_elements(s->'sources'->'survey_sessions') x WHERE x->>'user_id'=r.actor_user_id::text;
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'session_id',x->>'id'),'[]') INTO items FROM jsonb_array_elements(s->'sources'->'survey_items') x
      WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(sessions) own WHERE own->>'id'=x->>'session_id');
    visible:=jsonb_build_object('scope','sql-metadata-only','document',s->'document','sources',((s->'sources')-'generation_baseline'-'generation_snapshot'-'generation_updates')
      ||jsonb_build_object('survey_sessions',sessions,'survey_items',items,'active_generation',CASE WHEN r.generation_id IS NULL THEN NULL ELSE
        jsonb_build_object('baseline',s->'sources'->'generation_baseline','snapshot',s->'sources'->'generation_snapshot','updates',s->'sources'->'generation_updates') END),
      'compare',jsonb_build_object('wal_head',r.wal_head::text,'covered_head',r.wal_head::text));
  END IF;
  RETURN jsonb_build_object('version',1,'source_id',r.source_id,'actor_user_id',r.actor_user_id,'document_id',r.document_id,'generation_id',r.generation_id,
    'state',r.state,'source_byte_state','unverified','source_sql_sha256',r.source_sql_sha256,'wal_head',r.wal_head::text,'expires_at',r.expires_at,
    'source_object',s->'source_object','sidecar_objects',coalesce(s->'sidecar_objects','[]'::jsonb),'visible_capture',visible);
END; $$;

CREATE OR REPLACE FUNCTION survey_private.release_document_generation_source(p_source uuid,p_state text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE;
BEGIN
  IF p_state NOT IN('expired','canceled') THEN RAISE EXCEPTION 'Invalid source terminal state' USING ERRCODE='22023';END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source release requires READ COMMITTED' USING ERRCODE='25001';END IF;
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source FOR UPDATE NOWAIT;
  IF NOT FOUND OR r.state<>'captured' THEN RETURN;END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(r.document_id::text,0)) THEN RAISE EXCEPTION 'Source release contention' USING ERRCODE='40001';END IF;
  UPDATE survey_private.document_generation_sources SET state=p_state,body_id=NULL WHERE source_id=p_source;
  DELETE FROM survey_private.document_generation_source_bodies b WHERE b.body_id=r.body_id
    AND NOT EXISTS(SELECT 1 FROM survey_private.document_generation_sources s WHERE s.body_id=b.body_id);
END; $$;

CREATE OR REPLACE FUNCTION public.begin_document_generation_source(p_actor_user_id uuid,p_document_id uuid,p_source_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE; captured jsonb; body uuid; bytes bigint; digest text;
BEGIN
  PERFORM survey_private.require_generation_source_service();
  IF p_actor_user_id IS NULL OR p_document_id IS NULL OR p_source_id IS NULL THEN RAISE EXCEPTION 'Invalid source identity' USING ERRCODE='22023';END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source receipt requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('generation-source:'||p_source_id::text,0)) THEN RAISE EXCEPTION 'Source identity contention' USING ERRCODE='40001';END IF;
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source_id FOR UPDATE NOWAIT;
  IF FOUND THEN
    IF r.actor_user_id<>p_actor_user_id THEN RAISE EXCEPTION 'Source receipt is not yours' USING ERRCODE='42501';END IF;
    IF r.document_id<>p_document_id OR r.generation_id IS DISTINCT FROM p_generation_id THEN RAISE EXCEPTION 'Source identity differs' USING ERRCODE='23505';END IF;
    IF r.state='captured' AND r.expires_at<=clock_timestamp() THEN PERFORM survey_private.release_document_generation_source(p_source_id,'expired');
    ELSIF r.state='captured' THEN
      PERFORM survey_private.assert_document_generation_upload_authority(p_actor_user_id,p_document_id);
      IF r.expires_at<=clock_timestamp() THEN PERFORM survey_private.release_document_generation_source(p_source_id,'expired');END IF;
    END IF;
    RETURN survey_private.document_generation_source_descriptor(p_source_id);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('generation-source-actor:'||p_actor_user_id::text,0)) THEN RAISE EXCEPTION 'Source admission contention' USING ERRCODE='40001';END IF;
  PERFORM survey_private.assert_document_generation_upload_authority(p_actor_user_id,p_document_id);
  IF (SELECT count(*) FROM survey_private.document_generation_sources WHERE actor_user_id=p_actor_user_id AND state='captured')>=16
    OR (SELECT count(*) FROM survey_private.document_generation_sources WHERE document_id=p_document_id AND state='captured')>=4 THEN RAISE EXCEPTION 'Too many source receipts' USING ERRCODE='54000';END IF;
  captured:=survey_private.capture_document_generation_source(p_actor_user_id,p_document_id,p_generation_id);
  digest:=captured->>'body_sha256';bytes:=octet_length((captured->'payload')::text);
  IF (SELECT coalesce(sum(b.byte_length),0) FROM survey_private.document_generation_source_bodies b WHERE b.body_sha256<>digest AND EXISTS(
      SELECT 1 FROM survey_private.document_generation_sources s WHERE s.body_id=b.body_id AND s.actor_user_id=p_actor_user_id))+bytes>67108864 THEN
    RAISE EXCEPTION 'Source receipt byte budget exceeded' USING ERRCODE='54000';END IF;
  INSERT INTO survey_private.document_generation_source_bodies(document_id,body_sha256,source_sql_sha256,payload,byte_length)
    VALUES(p_document_id,digest,captured->>'source_sql_sha256',captured->'payload',bytes) ON CONFLICT(document_id,body_sha256) DO NOTHING;
  SELECT body_id INTO body FROM survey_private.document_generation_source_bodies WHERE document_id=p_document_id AND body_sha256=digest AND payload=captured->'payload';
  IF body IS NULL THEN RAISE EXCEPTION 'Source hash collision' USING ERRCODE='23514';END IF;
  INSERT INTO survey_private.document_generation_sources(source_id,actor_user_id,document_id,generation_id,source_sql_sha256,wal_head,body_id,expires_at)
    VALUES(p_source_id,p_actor_user_id,p_document_id,p_generation_id,captured->>'source_sql_sha256',(captured->'payload'->'semantic'->>'wal_head')::bigint,body,clock_timestamp()+interval '2 hours');
  RETURN survey_private.document_generation_source_descriptor(p_source_id);
END; $$;

CREATE OR REPLACE FUNCTION public.get_document_generation_source(p_actor_user_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE;
BEGIN
  PERFORM survey_private.require_generation_source_service();
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS NULL OR r.actor_user_id IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'Source receipt is not yours' USING ERRCODE='42501';END IF;
  IF r.state='captured' AND r.expires_at<=clock_timestamp() THEN PERFORM survey_private.release_document_generation_source(p_source_id,'expired');
  ELSIF r.state='captured' THEN
    PERFORM survey_private.assert_document_generation_upload_authority(p_actor_user_id,r.document_id);
    IF r.expires_at<=clock_timestamp() THEN PERFORM survey_private.release_document_generation_source(p_source_id,'expired');END IF;
  END IF;
  RETURN survey_private.document_generation_source_descriptor(p_source_id);
END; $$;
CREATE OR REPLACE FUNCTION public.cancel_document_generation_source(p_actor_user_id uuid,p_source_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r survey_private.document_generation_sources%ROWTYPE;
BEGIN
  PERFORM survey_private.require_generation_source_service();
  SELECT * INTO r FROM survey_private.document_generation_sources WHERE source_id=p_source_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_actor_user_id IS NULL OR r.actor_user_id IS DISTINCT FROM p_actor_user_id THEN RAISE EXCEPTION 'Source receipt is not yours' USING ERRCODE='42501';END IF;
  PERFORM survey_private.release_document_generation_source(p_source_id,'canceled');
  RETURN survey_private.document_generation_source_descriptor(p_source_id);
END; $$;
CREATE OR REPLACE FUNCTION public.expire_document_generation_sources(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid;expired uuid[]:='{}';skipped uuid[]:='{}';cutoff timestamptz:=clock_timestamp();
BEGIN
  PERFORM survey_private.require_generation_source_service();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid source expiry bound' USING ERRCODE='22023';END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Source expiry requires READ COMMITTED' USING ERRCODE='25001';END IF;
  FOR id IN SELECT source_id FROM survey_private.document_generation_sources WHERE state='captured'
    AND greatest(expires_at,next_expiry_attempt_at)<=cutoff
    ORDER BY greatest(expires_at,next_expiry_attempt_at),expires_at,source_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    BEGIN PERFORM survey_private.release_document_generation_source(id,'expired');expired:=array_append(expired,id);
    EXCEPTION WHEN lock_not_available OR serialization_failure OR deadlock_detected THEN
      -- The outer SELECT still owns this receipt row after the failed release
      -- subtransaction. Do not take the contested document lock for scheduling.
      UPDATE survey_private.document_generation_sources SET next_expiry_attempt_at=clock_timestamp()+interval '30 seconds' WHERE source_id=id;
      skipped:=array_append(skipped,id);
    END;
  END LOOP;
  RETURN jsonb_build_object('expired_source_ids',expired,'skipped_source_ids',skipped);
END; $$;
CREATE OR REPLACE FUNCTION survey_private.release_deleted_document_sources()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid;BEGIN
  FOR id IN SELECT source_id FROM survey_private.document_generation_sources WHERE document_id=OLD.id AND state='captured' ORDER BY source_id LOOP
    PERFORM survey_private.release_document_generation_source(id,'canceled');END LOOP;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS generation_source_document_cleanup ON public.documents;
CREATE TRIGGER generation_source_document_cleanup AFTER DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION survey_private.release_deleted_document_sources();

ALTER TABLE survey_private.document_generation_source_bodies OWNER TO postgres;
ALTER TABLE survey_private.document_generation_sources OWNER TO postgres;
ALTER FUNCTION survey_private.require_generation_source_service() OWNER TO postgres;
ALTER FUNCTION survey_private.generation_source_connector_projection(text,jsonb) OWNER TO postgres;
ALTER FUNCTION survey_private.guard_generation_source_connector_write() OWNER TO postgres;
ALTER FUNCTION survey_private.capture_document_generation_source(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.document_generation_source_descriptor(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.release_document_generation_source(uuid,text) OWNER TO postgres;
ALTER FUNCTION survey_private.release_deleted_document_sources() OWNER TO postgres;
ALTER FUNCTION public.begin_document_generation_source(uuid,uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.get_document_generation_source(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.cancel_document_generation_source(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.expire_document_generation_sources(integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION survey_private.require_generation_source_service(),survey_private.generation_source_connector_projection(text,jsonb),
 survey_private.guard_generation_source_connector_write(),survey_private.capture_document_generation_source(uuid,uuid,uuid),
 survey_private.document_generation_source_descriptor(uuid),survey_private.release_document_generation_source(uuid,text),survey_private.release_deleted_document_sources() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_document_generation_source(uuid,uuid,uuid,uuid),public.get_document_generation_source(uuid,uuid),
 public.cancel_document_generation_source(uuid,uuid),public.expire_document_generation_sources(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_document_generation_source(uuid,uuid,uuid,uuid),public.get_document_generation_source(uuid,uuid),
 public.cancel_document_generation_source(uuid,uuid),public.expire_document_generation_sources(integer) TO service_role;
COMMIT;
