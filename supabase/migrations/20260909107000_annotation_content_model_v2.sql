-- Checked annotation content-model contract. The transport/byte encoding
-- version is separate: this value names the Yjs data model inside the bytes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

ALTER TABLE survey_private.annotation_generations
  ADD COLUMN IF NOT EXISTS content_model_version smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='survey_private.annotation_generations'::regclass
    AND conname='annotation_generations_content_model_version_check') THEN
    ALTER TABLE survey_private.annotation_generations ADD CONSTRAINT annotation_generations_content_model_version_check
      CHECK(content_model_version IN(1,2));
  END IF;
END $$;
DO $$ DECLARE column_row record; check_def text; check_valid boolean;
BEGIN
 SELECT data_type,is_nullable,column_default INTO column_row FROM information_schema.columns
  WHERE table_schema='survey_private' AND table_name='annotation_generations' AND column_name='content_model_version';
 SELECT pg_get_constraintdef(oid),convalidated INTO check_def,check_valid FROM pg_constraint
  WHERE conrelid='survey_private.annotation_generations'::regclass AND conname='annotation_generations_content_model_version_check';
 IF column_row.data_type IS DISTINCT FROM 'smallint' OR column_row.is_nullable IS DISTINCT FROM 'NO'
  OR column_row.column_default IS DISTINCT FROM '1' OR check_valid IS NOT TRUE
  OR regexp_replace(check_def,'\s','','g') IS DISTINCT FROM 'CHECK((content_model_version=ANY(ARRAY[1,2])))' THEN
  RAISE EXCEPTION 'annotation content model schema differs' USING ERRCODE='55000';END IF;
END $$;

-- Keep the model after a source body is dropped on expiry/cancel. This is part
-- of the immutable receipt identity; old receipts and old callers default to 1.
ALTER TABLE survey_private.document_generation_sources
  ADD COLUMN IF NOT EXISTS content_model_version smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='survey_private.document_generation_sources'::regclass
    AND conname='document_generation_sources_content_model_version_check') THEN
    ALTER TABLE survey_private.document_generation_sources ADD CONSTRAINT document_generation_sources_content_model_version_check
      CHECK(content_model_version IN(1,2));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.guard_generation_source_content_model()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.content_model_version IS DISTINCT FROM OLD.content_model_version THEN
  RAISE EXCEPTION 'generation source content model is immutable' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS generation_source_content_model_immutable ON survey_private.document_generation_sources;
CREATE TRIGGER generation_source_content_model_immutable BEFORE UPDATE OF content_model_version
 ON survey_private.document_generation_sources FOR EACH ROW EXECUTE FUNCTION survey_private.guard_generation_source_content_model();
DO $$ DECLARE column_row record; check_def text; check_valid boolean;
BEGIN
 SELECT data_type,is_nullable,column_default INTO column_row FROM information_schema.columns
  WHERE table_schema='survey_private' AND table_name='document_generation_sources' AND column_name='content_model_version';
 SELECT pg_get_constraintdef(oid),convalidated INTO check_def,check_valid FROM pg_constraint
  WHERE conrelid='survey_private.document_generation_sources'::regclass AND conname='document_generation_sources_content_model_version_check';
 IF column_row.data_type IS DISTINCT FROM 'smallint' OR column_row.is_nullable IS DISTINCT FROM 'NO'
  OR column_row.column_default IS DISTINCT FROM '1' OR check_valid IS NOT TRUE
  OR regexp_replace(check_def,'\s','','g') IS DISTINCT FROM 'CHECK((content_model_version=ANY(ARRAY[1,2])))' THEN
  RAISE EXCEPTION 'generation source content model schema differs' USING ERRCODE='55000';END IF;
END $$;

ALTER TABLE public.annotation_generation_signals
  ADD COLUMN IF NOT EXISTS content_model_version smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.annotation_generation_signals'::regclass
    AND conname='annotation_generation_signals_content_model_version_check') THEN
    ALTER TABLE public.annotation_generation_signals ADD CONSTRAINT annotation_generation_signals_content_model_version_check
      CHECK(content_model_version IN(1,2));
  END IF;
END $$;
DO $$ DECLARE column_row record; check_def text; check_valid boolean;
BEGIN
 SELECT data_type,is_nullable,column_default INTO column_row FROM information_schema.columns
  WHERE table_schema='public' AND table_name='annotation_generation_signals' AND column_name='content_model_version';
 SELECT pg_get_constraintdef(oid),convalidated INTO check_def,check_valid FROM pg_constraint
  WHERE conrelid='public.annotation_generation_signals'::regclass AND conname='annotation_generation_signals_content_model_version_check';
 IF column_row.data_type IS DISTINCT FROM 'smallint' OR column_row.is_nullable IS DISTINCT FROM 'NO'
  OR column_row.column_default IS DISTINCT FROM '1' OR check_valid IS NOT TRUE
  OR regexp_replace(check_def,'\s','','g') IS DISTINCT FROM 'CHECK((content_model_version=ANY(ARRAY[1,2])))' THEN
  RAISE EXCEPTION 'annotation signal content model schema differs' USING ERRCODE='55000';END IF;
END $$;

CREATE OR REPLACE FUNCTION survey_private.annotation_generation_scope_v3(
  p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,p_write boolean)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid(); owner_id uuid; project_id uuid; direct_role text;
 current_generation uuid; frontier bigint; actual_model smallint;
BEGIN
  IF p_content_model_version IS NULL OR p_content_model_version NOT IN(1,2) THEN
    RAISE EXCEPTION 'invalid annotation content model' USING ERRCODE='22023';END IF;
  IF caller IS NULL OR public.user_can_access_document(p_document_id,CASE WHEN p_write THEN 'editor' ELSE 'viewer' END) IS NOT TRUE
    OR (p_write AND public.kal49_document_is_locked(p_document_id)) THEN
    RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Annotation transport requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF NOT (CASE WHEN p_write THEN pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0))
    ELSE pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) END) THEN
    RAISE EXCEPTION 'annotation transport contention' USING ERRCODE='40001';END IF;
  SELECT d.user_id,d.project_id INTO owner_id,project_id FROM public.documents d WHERE d.id=p_document_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';END IF;
  IF owner_id IS DISTINCT FROM caller AND project_id IS NOT NULL THEN
    SELECT c.role INTO direct_role FROM public.document_collaborators c WHERE c.document_id=p_document_id AND c.user_id=caller AND c.status='active';
    IF direct_role IS NULL THEN PERFORM p.id FROM public.projects p WHERE p.id=project_id FOR SHARE NOWAIT;END IF;
  END IF;
  IF public.user_can_access_document(p_document_id,CASE WHEN p_write THEN 'editor' ELSE 'viewer' END) IS NOT TRUE
    OR (p_write AND public.kal49_document_is_locked(p_document_id)) THEN
    RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';END IF;
  SELECT h.generation_id,h.last_seq,g.content_model_version INTO current_generation,frontier,actual_model
    FROM survey_private.annotation_generation_heads h JOIN survey_private.annotation_generations g
      ON g.document_id=h.document_id AND g.generation_id=h.generation_id WHERE h.document_id=p_document_id;
  IF current_generation IS DISTINCT FROM p_generation_id THEN
    RAISE EXCEPTION 'annotation generation changed' USING ERRCODE=CASE WHEN p_generation_id IS NULL THEN 'SG001' ELSE 'SG002' END,
      DETAIL=jsonb_build_object('document_id',p_document_id,'expected_generation_id',p_generation_id,'current_generation_id',current_generation)::text;
  END IF;
  actual_model:=coalesce(actual_model,1);
  IF actual_model IS DISTINCT FROM p_content_model_version THEN
    RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003',
      DETAIL=jsonb_build_object('document_id',p_document_id,'generation_id',current_generation,
        'expected_content_model_version',p_content_model_version,'current_content_model_version',actual_model)::text;
  END IF;
  IF current_generation IS NULL THEN
    SELECT greatest(coalesce((SELECT max(u.seq) FROM public.annotation_updates u WHERE u.document_id=p_document_id),0),
      coalesce((SELECT s.at_seq FROM public.annotation_snapshots s WHERE s.document_id=p_document_id),0)) INTO frontier;
  END IF;
  RETURN frontier;
END $$;

-- Preserve every old caller as model 1. This also fences old source capture,
-- checked open and publication paths before they can read or write model 2.
CREATE OR REPLACE FUNCTION survey_private.annotation_generation_scope(p_document_id uuid,p_generation_id uuid,p_write boolean)
RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,1::smallint,p_write)
$$;

CREATE OR REPLACE FUNCTION survey_private.annotation_content_model_receipt(
 p_document_id uuid,p_generation_id uuid,p_expected smallint)
RETURNS smallint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actual smallint;
BEGIN
 IF p_expected IS NULL OR p_expected NOT IN(1,2) THEN RAISE EXCEPTION 'invalid annotation content model' USING ERRCODE='22023';END IF;
 IF p_generation_id IS NULL THEN actual:=1;
 ELSE SELECT content_model_version INTO actual FROM survey_private.annotation_generations
  WHERE document_id=p_document_id AND generation_id=p_generation_id;
 END IF;
 IF actual IS NULL THEN RAISE EXCEPTION 'annotation generation changed' USING ERRCODE='SG002';END IF;
 IF actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003';END IF;
 RETURN actual;
END $$;

-- The old append has an intentional lost-success fast path which can return a
-- retired receipt without current access. Keep that property for model 1, but
-- do not let an old contract replay a model-2 receipt.
DO $patch_old_append$ DECLARE definition text; anchor text;
BEGIN
 definition:=pg_get_functiondef('public.append_annotation_update_v2(uuid,uuid,text,bigint,bytea)'::regprocedure);
 anchor:='found_receipt:=FOUND;';
 IF position('annotation_content_model_receipt(p_document_id,p_generation_id,1::smallint)' IN definition)=0 THEN
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Unexpected old append function shape' USING ERRCODE='55000';END IF;
  definition:=replace(definition,anchor,anchor||E'\n  IF found_receipt THEN PERFORM survey_private.annotation_content_model_receipt(p_document_id,p_generation_id,1::smallint);END IF;');
  EXECUTE definition;
 END IF;
END $patch_old_append$;

CREATE OR REPLACE FUNCTION public.read_annotation_snapshot_v3(
 p_document_id uuid,p_generation_id uuid,p_content_model_version smallint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; checkpoint jsonb;
BEGIN
 frontier:=survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,false);
 IF p_generation_id IS NULL THEN
  SELECT jsonb_build_object('at_seq',s.at_seq::text,'snapshot','\x'||encode(s.snapshot,'hex'),'encoding_version',s.encoding_version,
    'writer_id',s.writer_id,'writer_epoch',s.writer_epoch::text) INTO checkpoint FROM public.annotation_snapshots s WHERE s.document_id=p_document_id;
 ELSE
  SELECT jsonb_build_object('at_seq',s.at_seq::text,'snapshot','\x'||encode(s.snapshot,'hex'),'encoding_version',s.encoding_version,
    'writer_id',s.writer_id,'writer_epoch',s.writer_epoch::text) INTO checkpoint FROM survey_private.annotation_generation_snapshots s
    WHERE s.document_id=p_document_id AND s.generation_id=p_generation_id;
  IF NOT FOUND THEN SELECT jsonb_build_object('at_seq',g.base_seq::text,'snapshot','\x'||encode(g.baseline_snapshot,'hex'),
    'encoding_version',g.baseline_encoding_version,'writer_id',NULL,'writer_epoch','0') INTO checkpoint
    FROM survey_private.annotation_generations g WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id;END IF;
 END IF;
 RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id',p_document_id,
  'generation_id',p_generation_id,'wal_head',frontier::text,'snapshot',checkpoint);
END $$;

CREATE OR REPLACE FUNCTION public.read_annotation_updates_v3(p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,
 p_after_seq bigint,p_through_seq bigint DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; through_seq bigint; rows jsonb; more boolean;
BEGIN
 IF p_after_seq IS NULL OR p_after_seq<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 OR p_through_seq<0 THEN
  RAISE EXCEPTION 'invalid annotation page bounds' USING ERRCODE='22023';END IF;
 frontier:=survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,false);
 through_seq:=coalesce(p_through_seq,frontier);
 IF through_seq>frontier OR p_after_seq>through_seq THEN RAISE EXCEPTION 'invalid annotation frontier' USING ERRCODE='22023';END IF;
 WITH bounded AS MATERIALIZED (SELECT * FROM (
  SELECT u.seq,u.client_id,u.client_seq,u.actor_user_id,u.data FROM public.annotation_updates u
   WHERE p_generation_id IS NULL AND u.document_id=p_document_id AND u.seq>p_after_seq AND u.seq<=through_seq
  UNION ALL SELECT u.seq,u.client_id,u.client_seq,u.actor_user_id,u.data FROM survey_private.annotation_generation_updates u
   WHERE p_generation_id IS NOT NULL AND u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.seq>p_after_seq AND u.seq<=through_seq
  ) q ORDER BY seq LIMIT p_limit+1), ranked AS MATERIALIZED (
   SELECT b.*,row_number() OVER(ORDER BY seq) ordinal,sum(octet_length(data)::bigint) OVER(ORDER BY seq) running_bytes FROM bounded b),
 selected AS MATERIALIZED (SELECT r.*,ordinal<=p_limit AND (ordinal=1 OR running_bytes<=16777216) included FROM ranked r)
 SELECT coalesce(jsonb_agg(jsonb_build_object('seq',s.seq::text,'client_id',s.client_id,'client_seq',s.client_seq::text,
  'actor_user_id',s.actor_user_id,'data','\x'||encode(s.data,'hex')) ORDER BY s.seq) FILTER(WHERE included),'[]'::jsonb),
  coalesce(bool_or(NOT included),false) INTO rows,more FROM selected s;
 RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id',p_document_id,
  'generation_id',p_generation_id,'through_seq',through_seq::text,'rows',rows,'has_more',more);
END $$;

CREATE OR REPLACE FUNCTION public.read_annotation_writer_sequence_v3(
 p_document_id uuid,p_generation_id uuid,p_content_model_version smallint,p_client_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE n bigint;
BEGIN
 IF p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'invalid annotation writer' USING ERRCODE='22023';END IF;
 PERFORM survey_private.annotation_generation_scope_v3(p_document_id,p_generation_id,p_content_model_version,false);
 IF p_generation_id IS NULL THEN SELECT coalesce(max(u.client_seq),0) INTO n FROM public.annotation_updates u
  WHERE u.document_id=p_document_id AND u.client_id=p_client_id AND u.actor_user_id=auth.uid();
 ELSE SELECT coalesce(max(u.client_seq),0) INTO n FROM survey_private.annotation_generation_updates u
  WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.client_id=p_client_id AND u.actor_user_id=auth.uid();END IF;
 RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id',p_document_id,
  'generation_id',p_generation_id,'client_id',p_client_id,'client_seq',n::text);
END $$;

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

CREATE OR REPLACE FUNCTION survey_private.signal_annotation_generation_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.annotation_generation_signals(document_id,generation_id,last_seq,snapshot_writer_epoch,content_model_version)
  SELECT h.document_id,h.generation_id,h.last_seq,coalesce(s.writer_epoch,0),g.content_model_version
  FROM survey_private.annotation_generation_heads h JOIN survey_private.annotation_generations g
   ON g.document_id=h.document_id AND g.generation_id=h.generation_id
  LEFT JOIN survey_private.annotation_generation_snapshots s ON s.document_id=h.document_id AND s.generation_id=h.generation_id
  WHERE h.document_id=NEW.document_id ON CONFLICT(document_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,
   last_seq=EXCLUDED.last_seq,snapshot_writer_epoch=EXCLUDED.snapshot_writer_epoch,
   content_model_version=EXCLUDED.content_model_version,wake_revision=public.annotation_generation_signals.wake_revision+1;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.read_document_open_mode_v2(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid; generation uuid; model smallint:=1; account_id uuid; closing boolean;
BEGIN
 IF actor IS NULL OR p_document_id IS NULL OR public.user_can_access_document(p_document_id,'viewer') IS NOT TRUE THEN
  RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Document mode requires READ COMMITTED' USING ERRCODE='25001';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) THEN RAISE EXCEPTION 'Document mode contention' USING ERRCODE='40001';END IF;
 SELECT d.user_id INTO owner_id FROM public.documents d WHERE d.id=p_document_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 SELECT h.generation_id,g.content_model_version INTO generation,model FROM survey_private.annotation_generation_heads h
  JOIN survey_private.annotation_generations g ON g.document_id=h.document_id AND g.generation_id=h.generation_id WHERE h.document_id=p_document_id;
 model:=coalesce(model,1);PERFORM survey_private.annotation_generation_scope_v3(p_document_id,generation,model,false);
 FOR account_id IN SELECT DISTINCT x FROM unnest(ARRAY[actor,owner_id]) x ORDER BY x LOOP
  SELECT g.closing INTO closing FROM survey_private.account_write_guards g WHERE g.user_id=account_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN PERFORM survey_private.assert_account_open(account_id);ELSIF closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN jsonb_build_object('version',2,'actor_user_id',actor,'document_id',p_document_id,
  'mode',CASE WHEN generation IS NULL THEN 'legacy' ELSE 'checked' END,'generation_id',generation,'content_model_version',model);
END $$;

-- Old mode discovery stays exact for model 1 and fails before it can direct an
-- old client into a model-2 open.
CREATE OR REPLACE FUNCTION public.read_document_open_mode(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE discovered jsonb;
BEGIN
 discovered:=public.read_document_open_mode_v2(p_document_id);
 IF (discovered->>'content_model_version')::smallint<>1 THEN
  RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003';END IF;
 RETURN (discovered-'content_model_version')||jsonb_build_object('version',1);
END $$;

-- The checked open keeps one canonical model value at the top level. Its
-- nested transport copy must match because both come from the same locked row.
-- Clone the full checked-open implementation, changing only its explicit model
-- seam and response version. This keeps every publication, PDF, account and
-- snapshot check in one implementation instead of a shallow partial wrapper.
DO $clone_open$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.read_document_generation_open(uuid,uuid,boolean)'::regprocedure);
 definition:=replace(definition,'public.read_document_generation_open(p_document_id uuid, p_generation_id uuid DEFAULT NULL::uuid, p_include_snapshot boolean DEFAULT true)',
  'public.read_document_generation_open_v3(p_document_id uuid, p_generation_id uuid, p_content_model_version smallint, p_include_snapshot boolean DEFAULT true)');
 definition:=replace(definition,'frontier:=survey_private.annotation_generation_scope(p_document_id,coalesce(p_generation_id,generation),false);',
  'frontier:=survey_private.annotation_generation_scope_v3(p_document_id,coalesce(p_generation_id,generation),p_content_model_version,false);');
 definition:=replace(definition,'annotations:=public.read_annotation_snapshot_v2(p_document_id,generation);',
  'annotations:=public.read_annotation_snapshot_v3(p_document_id,generation,p_content_model_version);');
 definition:=replace(definition,$old$annotations:=jsonb_build_object('version',2,'document_id'$old$,
  $new$annotations:=jsonb_build_object('version',3,'content_model_version',p_content_model_version,'document_id'$new$);
 definition:=replace(definition,$old$RETURN jsonb_build_object('version',1,'actor_user_id'$old$,
  $new$RETURN jsonb_build_object('version',3,'content_model_version',p_content_model_version,'actor_user_id'$new$);
 IF position('read_document_generation_open_v3' IN definition)=0 OR position('annotation_generation_scope_v3' IN definition)=0
  OR position('read_annotation_snapshot_v3' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected checked open function shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $clone_open$;

-- Versioned source capture. The exact model is inside the hashed semantic body;
-- archived byte receipts already bind that source_sql_sha256.
DO $clone_capture$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('survey_private.capture_document_generation_source(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'survey_private.capture_document_generation_source(p_actor uuid, p_document uuid, p_generation uuid)',
  'survey_private.capture_document_generation_source_v3(p_actor uuid, p_document uuid, p_generation uuid, p_content_model_version smallint)');
 definition:=replace(definition,'frontier:=survey_private.annotation_generation_scope(p_document,p_generation,false);',
  'frontier:=survey_private.annotation_generation_scope_v3(p_document,p_generation,p_content_model_version,false);');
 definition:=replace(definition,$old$semantic:=jsonb_build_object('version',1,'document_id',p_document,'generation_id',p_generation,'document'$old$,
  $new$semantic:=jsonb_build_object('version',2,'document_id',p_document,'generation_id',p_generation,'content_model_version',p_content_model_version,'document'$new$);
 IF position('capture_document_generation_source_v3' IN definition)=0 OR position('annotation_generation_scope_v3' IN definition)=0
  OR position($needle$'content_model_version',p_content_model_version$needle$ IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected generation source capture shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $clone_capture$;

CREATE OR REPLACE FUNCTION survey_private.document_generation_source_descriptor_v2(p_source uuid,p_content_model_version smallint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET "TimeZone"='UTC' AS $$
DECLARE result jsonb; actual smallint;
BEGIN
 IF p_content_model_version IS NULL OR p_content_model_version NOT IN(1,2) THEN
  RAISE EXCEPTION 'invalid annotation content model' USING ERRCODE='22023';END IF;
 result:=survey_private.document_generation_source_descriptor(p_source);
 IF result IS NULL THEN RETURN NULL;END IF;
 SELECT s.content_model_version INTO actual
  FROM survey_private.document_generation_sources s
  WHERE s.source_id=p_source;
 IF actual IS DISTINCT FROM p_content_model_version THEN RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003';END IF;
 RETURN result||jsonb_build_object('version',2,'content_model_version',actual);
END $$;

DO $clone_source_receipts$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.begin_document_generation_source(uuid,uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'public.begin_document_generation_source(p_actor_user_id uuid, p_document_id uuid, p_source_id uuid, p_generation_id uuid)',
  'public.begin_document_generation_source_v2(p_actor_user_id uuid, p_document_id uuid, p_source_id uuid, p_generation_id uuid, p_content_model_version smallint)');
 definition:=replace(definition,'captured:=survey_private.capture_document_generation_source(p_actor_user_id,p_document_id,p_generation_id);',
  'captured:=survey_private.capture_document_generation_source_v3(p_actor_user_id,p_document_id,p_generation_id,p_content_model_version);');
 definition:=replace(definition,$old$IF r.document_id<>p_document_id OR r.generation_id IS DISTINCT FROM p_generation_id THEN RAISE EXCEPTION 'Source identity differs' USING ERRCODE='23505';END IF;$old$,
  $new$IF r.document_id<>p_document_id OR r.generation_id IS DISTINCT FROM p_generation_id THEN RAISE EXCEPTION 'Source identity differs' USING ERRCODE='23505';END IF;
    IF r.content_model_version IS DISTINCT FROM p_content_model_version THEN RAISE EXCEPTION 'annotation content model changed' USING ERRCODE='SG003';END IF;$new$);
 definition:=replace(definition,$old$INSERT INTO survey_private.document_generation_sources(source_id,actor_user_id,document_id,generation_id,source_sql_sha256,wal_head,body_id,expires_at)
    VALUES(p_source_id,p_actor_user_id,p_document_id,p_generation_id,captured->>'source_sql_sha256',(captured->'payload'->'semantic'->>'wal_head')::bigint,body,clock_timestamp()+interval '2 hours');$old$,
  $new$INSERT INTO survey_private.document_generation_sources(source_id,actor_user_id,document_id,generation_id,source_sql_sha256,wal_head,body_id,expires_at,content_model_version)
    VALUES(p_source_id,p_actor_user_id,p_document_id,p_generation_id,captured->>'source_sql_sha256',(captured->'payload'->'semantic'->>'wal_head')::bigint,body,clock_timestamp()+interval '2 hours',p_content_model_version);$new$);
 definition:=replace(definition,'survey_private.document_generation_source_descriptor(p_source_id)',
  'survey_private.document_generation_source_descriptor_v2(p_source_id,p_content_model_version)');
 IF position('begin_document_generation_source_v2' IN definition)=0 OR position('capture_document_generation_source_v3' IN definition)=0
  OR position('document_generation_source_descriptor_v2' IN definition)=0
  OR position($needle$clock_timestamp()+interval '2 hours',p_content_model_version$needle$ IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected generation source begin shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;

 definition:=pg_get_functiondef('public.get_document_generation_source(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'public.get_document_generation_source(p_actor_user_id uuid, p_source_id uuid)',
  'public.get_document_generation_source_v2(p_actor_user_id uuid, p_source_id uuid, p_content_model_version smallint)');
 definition:=replace(definition,'survey_private.document_generation_source_descriptor(p_source_id)',
  'survey_private.document_generation_source_descriptor_v2(p_source_id,p_content_model_version)');
 IF position('get_document_generation_source_v2' IN definition)=0 OR position('document_generation_source_descriptor_v2' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected generation source get shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $clone_source_receipts$;

-- A model-2 replacement plan is the signed switch. The plan hash already lives
-- in the durable request and publication rows, so the model is not a loose
-- publisher argument. The immutable generation row is the lasting truth.
DO $clone_replacement$ DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('survey_private.prepare_document_generation_replacement(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)'::regprocedure);
 definition:=replace(definition,'survey_private.prepare_document_generation_replacement(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb, p_plan jsonb)',
  'survey_private.prepare_document_generation_replacement_v2(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_expected_generation uuid, p_expected_wal_head bigint, p_operation jsonb, p_plan jsonb)');
 definition:=replace(definition,$old$ARRAY['baseline_base64','legacy','operation','operationId','projection','source','version']::text[]
    OR p_plan->'version' IS DISTINCT FROM '1'::jsonb$old$,
  $new$ARRAY['baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
    OR p_plan->'version' IS DISTINCT FROM '2'::jsonb OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb$new$);
 definition:=replace(definition,$old$jsonb_build_object('documentId',source_row.document_id,
      'generationId',p_expected_generation,'walHead',p_expected_wal_head::text,'sourceObject',source_object)$old$,
  $new$jsonb_build_object('documentId',source_row.document_id,
      'generationId',p_expected_generation,'contentModelVersion',coalesce((semantic->>'content_model_version')::smallint,1),
      'walHead',p_expected_wal_head::text,'sourceObject',source_object)$new$);
 definition:=replace(definition,$old$current_frontier:=survey_private.annotation_generation_scope(
      source_row.document_id,p_expected_generation,false);$old$,
  $new$current_frontier:=survey_private.annotation_generation_scope_v3(
      source_row.document_id,p_expected_generation,coalesce((semantic->>'content_model_version')::smallint,1),false);$new$);
 IF position('prepare_document_generation_replacement_v2' IN definition)=0
  OR position($needle$p_plan->'contentModelVersion' IS DISTINCT FROM '2'$needle$ IN definition)=0
  OR position('annotation_generation_scope_v3' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected replacement preparation shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;

 definition:=pg_get_functiondef('survey_private.publish_document_generation(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure);
 definition:=replace(definition,'survey_private.publish_document_generation(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_plan jsonb)',
  'survey_private.publish_document_generation_v2(p_actor uuid, p_source uuid, p_candidate uuid, p_archives uuid[], p_plan jsonb)');
 definition:=replace(definition,$old$ARRAY['baseline_base64','legacy','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version' IS DISTINCT FROM '1'::jsonb$old$,
  $new$ARRAY['baseline_base64','contentModelVersion','legacy','operation','operationId','projection','source','version']::text[]
  OR p_plan->'version' IS DISTINCT FROM '2'::jsonb OR p_plan->'contentModelVersion' IS DISTINCT FROM '2'::jsonb$new$);
 definition:=replace(definition,$old$jsonb_build_object('documentId',doc,'generationId',expected_generation,'walHead',frontier::text,'sourceObject',semantic->'source_object')$old$,
  $new$jsonb_build_object('documentId',doc,'generationId',expected_generation,
   'contentModelVersion',coalesce((semantic->>'content_model_version')::smallint,1),
   'walHead',frontier::text,'sourceObject',semantic->'source_object')$new$);
 definition:=replace(definition,'fresh:=survey_private.capture_document_generation_source(p_actor,doc,expected_generation);',
  'fresh:=survey_private.capture_document_generation_source_v3(p_actor,doc,expected_generation,coalesce((semantic->>''content_model_version'')::smallint,1));');
 definition:=replace(definition,$old$INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
  VALUES(doc,target_generation,frontier,baseline,1);$old$,
  $new$INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version,content_model_version)
  VALUES(doc,target_generation,frontier,baseline,1,2);$new$);
 definition:=replace(definition,$old$AND base_seq=frontier AND baseline_snapshot=baseline AND baseline_encoding_version=1)$old$,
  $new$AND base_seq=frontier AND baseline_snapshot=baseline AND baseline_encoding_version=1 AND content_model_version=2)$new$);
 definition:=replace(definition,'PERFORM survey_private.capture_document_generation_source(p_actor,doc,target_generation);',
  'PERFORM survey_private.capture_document_generation_source_v3(p_actor,doc,target_generation,2::smallint);');
 definition:=replace(definition,$old$||jsonb_build_object('version',1,'wal_head',r.wal_head::text)$old$,
  $new$||jsonb_build_object('version',2,'content_model_version',2,'wal_head',r.wal_head::text)$new$);
 IF position('publish_document_generation_v2' IN definition)=0 OR position('VALUES(doc,target_generation,frontier,baseline,1,2)' IN definition)=0
  OR position('capture_document_generation_source_v3' IN definition)=0 THEN
  RAISE EXCEPTION 'Unexpected generation publication shape' USING ERRCODE='55000';END IF;
 EXECUTE definition;
END $clone_replacement$;

DO $$ DECLARE signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'survey_private.annotation_generation_scope_v3(uuid,uuid,smallint,boolean)',
  'survey_private.annotation_content_model_receipt(uuid,uuid,smallint)',
  'survey_private.guard_generation_source_content_model()',
  'survey_private.capture_document_generation_source_v3(uuid,uuid,uuid,smallint)',
  'survey_private.document_generation_source_descriptor_v2(uuid,smallint)',
  'survey_private.prepare_document_generation_replacement_v2(uuid,uuid,uuid,uuid[],uuid,bigint,jsonb,jsonb)',
  'survey_private.publish_document_generation_v2(uuid,uuid,uuid,uuid[],jsonb)',
  'public.begin_document_generation_source_v2(uuid,uuid,uuid,uuid,smallint)',
  'public.get_document_generation_source_v2(uuid,uuid,smallint)',
  'public.read_annotation_snapshot_v3(uuid,uuid,smallint)',
  'public.read_annotation_updates_v3(uuid,uuid,smallint,bigint,bigint,integer)',
  'public.read_annotation_writer_sequence_v3(uuid,uuid,smallint,text)',
  'public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea)',
  'public.store_annotation_snapshot_v3(uuid,uuid,smallint,bigint,bytea,integer,text,bigint,bigint,text,bigint)',
  'public.read_document_open_mode_v2(uuid)','public.read_document_generation_open_v3(uuid,uuid,smallint,boolean)'] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,anon,authenticated,service_role';
 END LOOP;
END $$;
-- Source capture, byte proof, archives and publication must be enabled as one
-- versioned unit. Keep the drafted model-2 source/publisher path private until
-- that whole path has a disposable-Postgres proof.
GRANT EXECUTE ON FUNCTION public.read_annotation_snapshot_v3(uuid,uuid,smallint),
 public.read_annotation_updates_v3(uuid,uuid,smallint,bigint,bigint,integer),
 public.read_annotation_writer_sequence_v3(uuid,uuid,smallint,text),
 public.append_annotation_update_v3(uuid,uuid,smallint,text,bigint,bytea),
 public.store_annotation_snapshot_v3(uuid,uuid,smallint,bigint,bytea,integer,text,bigint,bigint,text,bigint),
 public.read_document_open_mode_v2(uuid),public.read_document_generation_open_v3(uuid,uuid,smallint,boolean) TO authenticated;
COMMIT;
