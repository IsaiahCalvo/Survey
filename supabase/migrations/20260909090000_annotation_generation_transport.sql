-- Generation-scoped annotation transport. No generation publication API.
-- Future publication must hold the same document advisory lock, preserve the
-- global sequence floor, and insert an accepted clean baseline before head switch.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS survey_private.annotation_generations (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  base_seq bigint NOT NULL CHECK(base_seq>=0),
  baseline_snapshot bytea NOT NULL,
  baseline_encoding_version integer NOT NULL CHECK(baseline_encoding_version IN(1,2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,generation_id)
);
CREATE TABLE IF NOT EXISTS survey_private.annotation_generation_heads (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  last_seq bigint NOT NULL CHECK(last_seq>=0),
  FOREIGN KEY(document_id,generation_id) REFERENCES survey_private.annotation_generations(document_id,generation_id)
);
CREATE TABLE IF NOT EXISTS survey_private.annotation_generation_updates (
  document_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  seq bigint NOT NULL CHECK(seq>0),
  actor_user_id uuid NOT NULL,
  client_id text NOT NULL CHECK(length(client_id) BETWEEN 1 AND 512),
  client_seq bigint NOT NULL CHECK(client_seq>0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,generation_id,seq),
  UNIQUE(document_id,generation_id,actor_user_id,client_id,client_seq),
  FOREIGN KEY(document_id,generation_id) REFERENCES survey_private.annotation_generations(document_id,generation_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS survey_private.annotation_generation_snapshots (
  document_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  at_seq bigint NOT NULL CHECK(at_seq>=0),
  snapshot bytea NOT NULL,
  encoding_version integer NOT NULL CHECK(encoding_version IN(1,2)),
  writer_id text,
  writer_epoch bigint NOT NULL CHECK(writer_epoch>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,generation_id),
  FOREIGN KEY(document_id,generation_id) REFERENCES survey_private.annotation_generations(document_id,generation_id) ON DELETE CASCADE
);
REVOKE ALL ON survey_private.annotation_generations,survey_private.annotation_generation_heads,
  survey_private.annotation_generation_updates,survey_private.annotation_generation_snapshots FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION survey_private.guard_annotation_generation_history()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=OLD.document_id) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'generation history is immutable' USING ERRCODE='42501';
END;
$$;
CREATE OR REPLACE FUNCTION survey_private.guard_annotation_generation_head()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE base bigint; floor_seq bigint;
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=OLD.document_id) THEN RETURN OLD;END IF;
    RAISE EXCEPTION 'an adopted document cannot return to legacy mode' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'generation head requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF TG_OP='UPDATE' AND NEW.document_id IS DISTINCT FROM OLD.document_id THEN RAISE EXCEPTION 'generation document is immutable' USING ERRCODE='42501';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW.document_id::text,0)) THEN RAISE EXCEPTION 'generation contention' USING ERRCODE='40001';END IF;
  PERFORM d.id FROM public.documents d WHERE d.id=NEW.document_id FOR SHARE NOWAIT;
  SELECT g.base_seq INTO base FROM survey_private.annotation_generations g WHERE g.document_id=NEW.document_id AND g.generation_id=NEW.generation_id;
  IF TG_OP='INSERT' THEN
    SELECT greatest(coalesce((SELECT max(u.seq) FROM public.annotation_updates u WHERE u.document_id=NEW.document_id),0),
      coalesce((SELECT s.at_seq FROM public.annotation_snapshots s WHERE s.document_id=NEW.document_id),0)) INTO floor_seq;
    IF base IS DISTINCT FROM floor_seq OR NEW.last_seq IS DISTINCT FROM base THEN RAISE EXCEPTION 'invalid generation sequence floor' USING ERRCODE='23514';END IF;
  ELSE
    IF NEW.last_seq<OLD.last_seq OR (NEW.generation_id IS DISTINCT FROM OLD.generation_id AND (base IS DISTINCT FROM OLD.last_seq OR NEW.last_seq IS DISTINCT FROM base)) THEN
      RAISE EXCEPTION 'generation sequence cannot move backward' USING ERRCODE='23514';END IF;
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['annotation_generations','annotation_generation_updates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS generation_history_immutable ON survey_private.%I',t);
    EXECUTE format('CREATE TRIGGER generation_history_immutable BEFORE UPDATE OR DELETE ON survey_private.%I FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_generation_history()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['annotation_generations','annotation_generation_heads','annotation_generation_updates','annotation_generation_snapshots'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS generation_history_no_truncate ON survey_private.%I',t);
    EXECUTE format('CREATE TRIGGER generation_history_no_truncate BEFORE TRUNCATE ON survey_private.%I FOR EACH STATEMENT EXECUTE FUNCTION survey_private.reject_annotation_source_truncate()',t);
  END LOOP;
END;
$$;
DROP TRIGGER IF EXISTS generation_head_guard ON survey_private.annotation_generation_heads;
CREATE TRIGGER generation_head_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_private.annotation_generation_heads
FOR EACH ROW EXECUTE FUNCTION survey_private.guard_annotation_generation_head();
REVOKE ALL ON FUNCTION survey_private.guard_annotation_generation_head(),survey_private.guard_annotation_generation_history() FROM PUBLIC,anon,authenticated,service_role;

-- Wake hints contain no annotation or file data. Clients must fetch through
-- generation-checked RPCs; a hint alone is neither acceptance nor authority.
CREATE TABLE IF NOT EXISTS public.annotation_generation_signals (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL,
  last_seq bigint NOT NULL CHECK(last_seq>=0),
  snapshot_writer_epoch bigint NOT NULL DEFAULT 0 CHECK(snapshot_writer_epoch>=0),
  wake_revision bigint NOT NULL DEFAULT 1 CHECK(wake_revision>0)
);
ALTER TABLE public.annotation_generation_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.annotation_generation_signals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.annotation_generation_signals TO authenticated;
DROP POLICY IF EXISTS annotation_generation_signal_read ON public.annotation_generation_signals;
CREATE POLICY annotation_generation_signal_read ON public.annotation_generation_signals FOR SELECT TO authenticated
USING(public.user_can_access_document(document_id,'viewer'));
CREATE OR REPLACE FUNCTION survey_private.signal_annotation_generation_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.annotation_generation_signals(document_id,generation_id,last_seq,snapshot_writer_epoch)
    SELECT h.document_id,h.generation_id,h.last_seq,coalesce(s.writer_epoch,0)
      FROM survey_private.annotation_generation_heads h LEFT JOIN survey_private.annotation_generation_snapshots s
        ON s.document_id=h.document_id AND s.generation_id=h.generation_id
      WHERE h.document_id=NEW.document_id
    ON CONFLICT(document_id) DO UPDATE SET generation_id=EXCLUDED.generation_id,last_seq=EXCLUDED.last_seq,
      snapshot_writer_epoch=EXCLUDED.snapshot_writer_epoch,
      wake_revision=public.annotation_generation_signals.wake_revision+1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION survey_private.signal_annotation_generation_change() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS signal_annotation_generation_head ON survey_private.annotation_generation_heads;
CREATE TRIGGER signal_annotation_generation_head AFTER INSERT OR UPDATE ON survey_private.annotation_generation_heads
FOR EACH ROW EXECUTE FUNCTION survey_private.signal_annotation_generation_change();
DROP TRIGGER IF EXISTS signal_annotation_generation_snapshot ON survey_private.annotation_generation_snapshots;
CREATE TRIGGER signal_annotation_generation_snapshot AFTER INSERT OR UPDATE ON survey_private.annotation_generation_snapshots
FOR EACH ROW EXECUTE FUNCTION survey_private.signal_annotation_generation_change();
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='annotation_generation_signals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.annotation_generation_signals;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION survey_private.annotation_generation_scope(p_document_id uuid,p_generation_id uuid,p_write boolean)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid(); owner_id uuid; project_id uuid; direct_role text; current_generation uuid; frontier bigint;
BEGIN
  IF caller IS NULL OR public.user_can_access_document(p_document_id,CASE WHEN p_write THEN 'editor' ELSE 'viewer' END) IS NOT TRUE
    OR (p_write AND public.kal49_document_is_locked(p_document_id)) THEN
    RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Annotation transport requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF NOT (CASE WHEN p_write THEN pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0))
    ELSE pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) END) THEN
    RAISE EXCEPTION 'annotation transport contention' USING ERRCODE='40001';
  END IF;
  SELECT d.user_id,d.project_id INTO owner_id,project_id FROM public.documents d WHERE d.id=p_document_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501'; END IF;
  IF owner_id IS DISTINCT FROM caller AND project_id IS NOT NULL THEN
    SELECT c.role INTO direct_role FROM public.document_collaborators c WHERE c.document_id=p_document_id AND c.user_id=caller AND c.status='active';
    IF direct_role IS NULL THEN PERFORM p.id FROM public.projects p WHERE p.id=project_id FOR SHARE NOWAIT; END IF;
  END IF;
  IF public.user_can_access_document(p_document_id,CASE WHEN p_write THEN 'editor' ELSE 'viewer' END) IS NOT TRUE
    OR (p_write AND public.kal49_document_is_locked(p_document_id)) THEN
    RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';
  END IF;
  SELECT h.generation_id,h.last_seq INTO current_generation,frontier FROM survey_private.annotation_generation_heads h WHERE h.document_id=p_document_id;
  IF current_generation IS DISTINCT FROM p_generation_id THEN
    RAISE EXCEPTION 'annotation generation changed' USING ERRCODE=CASE WHEN p_generation_id IS NULL THEN 'SG001' ELSE 'SG002' END,
      DETAIL=jsonb_build_object('document_id',p_document_id,'expected_generation_id',p_generation_id,'current_generation_id',current_generation)::text;
  END IF;
  IF current_generation IS NULL THEN
    SELECT greatest(coalesce((SELECT max(u.seq) FROM public.annotation_updates u WHERE u.document_id=p_document_id),0),
      coalesce((SELECT s.at_seq FROM public.annotation_snapshots s WHERE s.document_id=p_document_id),0)) INTO frontier;
  END IF;
  RETURN frontier;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_annotation_snapshot_v2(p_document_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; checkpoint jsonb;
BEGIN
  frontier:=survey_private.annotation_generation_scope(p_document_id,p_generation_id,false);
  IF p_generation_id IS NULL THEN
    SELECT jsonb_build_object('at_seq',s.at_seq::text,'snapshot','\x'||encode(s.snapshot,'hex'),'encoding_version',s.encoding_version,
      'writer_id',s.writer_id,'writer_epoch',s.writer_epoch::text) INTO checkpoint FROM public.annotation_snapshots s WHERE s.document_id=p_document_id;
  ELSE
    SELECT jsonb_build_object('at_seq',s.at_seq::text,'snapshot','\x'||encode(s.snapshot,'hex'),'encoding_version',s.encoding_version,
      'writer_id',s.writer_id,'writer_epoch',s.writer_epoch::text) INTO checkpoint FROM survey_private.annotation_generation_snapshots s
      WHERE s.document_id=p_document_id AND s.generation_id=p_generation_id;
    IF NOT FOUND THEN
      SELECT jsonb_build_object('at_seq',g.base_seq::text,'snapshot','\x'||encode(g.baseline_snapshot,'hex'),
        'encoding_version',g.baseline_encoding_version,'writer_id',NULL,'writer_epoch','0') INTO checkpoint
        FROM survey_private.annotation_generations g WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',p_generation_id,'wal_head',frontier::text,'snapshot',checkpoint);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_annotation_updates_v2(p_document_id uuid,p_generation_id uuid,p_after_seq bigint,
  p_through_seq bigint DEFAULT NULL,p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; through_seq bigint; rows jsonb; more boolean;
BEGIN
  IF p_after_seq IS NULL OR p_after_seq<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 OR p_through_seq<0 THEN
    RAISE EXCEPTION 'invalid annotation page bounds' USING ERRCODE='22023'; END IF;
  frontier:=survey_private.annotation_generation_scope(p_document_id,p_generation_id,false);
  through_seq:=coalesce(p_through_seq,frontier);
  IF through_seq>frontier OR p_after_seq>through_seq THEN RAISE EXCEPTION 'invalid annotation frontier' USING ERRCODE='22023'; END IF;
  -- One indivisible row may exceed the soft 16 MiB budget. Never truncate bytes
  -- or make an already accepted large update impossible to read.
  WITH bounded AS MATERIALIZED (SELECT * FROM (
    SELECT u.seq,u.client_id,u.client_seq,u.actor_user_id,u.data FROM public.annotation_updates u
      WHERE p_generation_id IS NULL AND u.document_id=p_document_id AND u.seq>p_after_seq AND u.seq<=through_seq
    UNION ALL
    SELECT u.seq,u.client_id,u.client_seq,u.actor_user_id,u.data FROM survey_private.annotation_generation_updates u
      WHERE p_generation_id IS NOT NULL AND u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.seq>p_after_seq AND u.seq<=through_seq
    ) q ORDER BY seq LIMIT p_limit+1), ranked AS MATERIALIZED (
      SELECT b.*,row_number() OVER(ORDER BY seq) ordinal,sum(octet_length(data)::bigint) OVER(ORDER BY seq) running_bytes FROM bounded b
    ), selected AS MATERIALIZED (
      SELECT r.*,ordinal<=p_limit AND (ordinal=1 OR running_bytes<=16777216) included FROM ranked r
    ) SELECT coalesce(jsonb_agg(jsonb_build_object('seq',s.seq::text,'client_id',s.client_id,'client_seq',s.client_seq::text,
      'actor_user_id',s.actor_user_id,'data','\x'||encode(s.data,'hex')) ORDER BY s.seq) FILTER(WHERE included),'[]'::jsonb),
      coalesce(bool_or(NOT included),false) INTO rows,more FROM selected s;
  RETURN jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',p_generation_id,'through_seq',through_seq::text,'rows',rows,'has_more',more);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_annotation_writer_sequence_v2(p_document_id uuid,p_generation_id uuid,p_client_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE n bigint;
BEGIN
  IF p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'invalid annotation writer' USING ERRCODE='22023';END IF;
  PERFORM survey_private.annotation_generation_scope(p_document_id,p_generation_id,false);
  IF p_generation_id IS NULL THEN
    SELECT coalesce(max(u.client_seq),0) INTO n FROM public.annotation_updates u WHERE u.document_id=p_document_id AND u.client_id=p_client_id AND u.actor_user_id=auth.uid();
  ELSE
    SELECT coalesce(max(u.client_seq),0) INTO n FROM survey_private.annotation_generation_updates u
      WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.client_id=p_client_id AND u.actor_user_id=auth.uid();
  END IF;
  RETURN jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',p_generation_id,'client_id',p_client_id,'client_seq',n::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.append_annotation_update_v2(p_document_id uuid,p_generation_id uuid,p_client_id text,p_client_seq bigint,p_data bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid(); receipt record; n bigint; current_generation uuid; found_receipt boolean;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'annotation write is not permitted' USING ERRCODE='42501';END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Annotation transport requires READ COMMITTED' USING ERRCODE='25001';END IF;
  IF p_document_id IS NULL OR p_client_id IS NULL OR length(p_client_id) NOT BETWEEN 1 AND 512 OR p_client_seq IS NULL OR p_client_seq<=0 OR p_data IS NULL THEN
    RAISE EXCEPTION 'invalid annotation update' USING ERRCODE='22023';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN RAISE EXCEPTION 'annotation write contention' USING ERRCODE='40001';END IF;
  SELECT h.generation_id INTO current_generation FROM survey_private.annotation_generation_heads h WHERE h.document_id=p_document_id;
  IF p_generation_id IS NULL THEN
    SELECT u.seq,u.data,u.actor_user_id INTO receipt FROM public.annotation_updates u WHERE u.document_id=p_document_id AND u.client_id=p_client_id AND u.client_seq=p_client_seq;
  ELSE
    SELECT u.seq,u.data,u.actor_user_id INTO receipt FROM survey_private.annotation_generation_updates u
      WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq=p_client_seq;
  END IF;
  found_receipt:=FOUND;
  IF found_receipt THEN
    IF receipt.actor_user_id IS NOT NULL AND receipt.actor_user_id IS DISTINCT FROM caller THEN RAISE EXCEPTION 'annotation receipt is not yours' USING ERRCODE='42501';END IF;
    IF receipt.data IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'annotation receipt collision' USING ERRCODE='23505';END IF;
    IF receipt.actor_user_id IS NULL THEN
      -- Historical actorless legacy receipts are not claimed as this actor.
      PERFORM survey_private.annotation_generation_scope(p_document_id,p_generation_id,true);
    END IF;
    n:=receipt.seq;
  ELSE
    n:=survey_private.annotation_generation_scope(p_document_id,p_generation_id,true);
    IF p_generation_id IS NULL THEN
      SELECT a.seq INTO n FROM public.append_annotation_update(p_document_id,p_client_id,p_client_seq,p_data) a;
    ELSE
      IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_updates u WHERE u.document_id=p_document_id AND u.generation_id=p_generation_id
        AND u.actor_user_id=caller AND u.client_id=p_client_id AND u.client_seq>=p_client_seq) THEN
        RAISE EXCEPTION 'annotation writer sequence did not advance' USING ERRCODE='23505';END IF;
      n:=n+1;
      INSERT INTO survey_private.annotation_generation_updates(document_id,generation_id,seq,actor_user_id,client_id,client_seq,data)
        VALUES(p_document_id,p_generation_id,n,caller,p_client_id,p_client_seq,p_data);
      UPDATE survey_private.annotation_generation_heads SET last_seq=n WHERE document_id=p_document_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',p_generation_id,'actor_user_id',
    CASE WHEN found_receipt THEN receipt.actor_user_id ELSE caller END,'client_id',p_client_id,'client_seq',p_client_seq::text,
    'seq',n::text,'accepted',true,'data_sha256',encode(sha256(p_data),'hex'),
    'current_generation_id',current_generation,'is_current',current_generation IS NOT DISTINCT FROM p_generation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.store_annotation_snapshot_v2(p_document_id uuid,p_generation_id uuid,p_at_seq bigint,p_snapshot bytea,
 p_encoding_version integer,p_writer_id text,p_writer_epoch bigint,p_expected_at_seq bigint,p_expected_writer_id text,p_expected_writer_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE frontier bigint; old_snapshot record; stored boolean:=false;
BEGIN
  IF p_at_seq IS NULL OR p_at_seq<0 OR p_snapshot IS NULL OR p_encoding_version IS NULL OR p_encoding_version NOT IN(1,2)
    OR p_writer_epoch IS NULL OR p_writer_epoch<=0 OR p_expected_writer_epoch IS NULL OR p_expected_writer_epoch<0
    OR length(p_writer_id)>512 OR p_expected_at_seq<0 OR length(p_expected_writer_id)>512
    OR (p_generation_id IS NOT NULL AND (p_writer_id IS NULL OR length(p_writer_id) NOT BETWEEN 1 AND 512)) THEN
    RAISE EXCEPTION 'invalid annotation checkpoint' USING ERRCODE='22023';END IF;
  frontier:=survey_private.annotation_generation_scope(p_document_id,p_generation_id,true);
  IF p_generation_id IS NULL THEN
    stored:=public.store_annotation_snapshot(p_document_id,p_at_seq,p_snapshot,p_encoding_version,p_writer_id,p_writer_epoch,
      p_expected_at_seq,p_expected_writer_id,p_expected_writer_epoch);
  ELSE
    SELECT s.at_seq,s.snapshot,s.encoding_version,s.writer_id,s.writer_epoch INTO old_snapshot
      FROM survey_private.annotation_generation_snapshots s WHERE s.document_id=p_document_id AND s.generation_id=p_generation_id;
    IF NOT FOUND THEN
      SELECT g.base_seq at_seq,g.baseline_snapshot snapshot,g.baseline_encoding_version encoding_version,NULL::text writer_id,0::bigint writer_epoch
        INTO old_snapshot FROM survey_private.annotation_generations g WHERE g.document_id=p_document_id AND g.generation_id=p_generation_id;
    END IF;
    IF old_snapshot.at_seq=p_at_seq AND old_snapshot.snapshot=p_snapshot AND old_snapshot.encoding_version=p_encoding_version
      AND old_snapshot.writer_id IS NOT DISTINCT FROM p_writer_id AND old_snapshot.writer_epoch=p_writer_epoch THEN stored:=true;
    ELSIF frontier=p_at_seq AND old_snapshot.at_seq IS NOT DISTINCT FROM p_expected_at_seq
      AND old_snapshot.writer_id IS NOT DISTINCT FROM p_expected_writer_id AND old_snapshot.writer_epoch=p_expected_writer_epoch
      AND p_writer_epoch>old_snapshot.writer_epoch THEN
      INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
        VALUES(p_document_id,p_generation_id,p_at_seq,p_snapshot,p_encoding_version,p_writer_id,p_writer_epoch)
        ON CONFLICT(document_id,generation_id) DO UPDATE SET at_seq=EXCLUDED.at_seq,snapshot=EXCLUDED.snapshot,
          encoding_version=EXCLUDED.encoding_version,writer_id=EXCLUDED.writer_id,writer_epoch=EXCLUDED.writer_epoch,updated_at=now();
      stored:=true;
    END IF;
  END IF;
  RETURN jsonb_build_object('version',2,'document_id',p_document_id,'generation_id',p_generation_id,'stored',stored,'at_seq',p_at_seq::text,
    'writer_id',p_writer_id,'writer_epoch',p_writer_epoch::text,'encoding_version',p_encoding_version)
    ||CASE WHEN stored THEN jsonb_build_object('snapshot_sha256',encode(sha256(p_snapshot),'hex')) ELSE '{}'::jsonb END;
END;
$$;

-- Fence old RPC fast paths too: a retry must use v2 to label historical proof.
CREATE OR REPLACE FUNCTION survey_private.assert_legacy_annotation_document(p_document_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN RAISE EXCEPTION 'annotation contention' USING ERRCODE='40001';END IF;
  IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=p_document_id) THEN
    IF auth.uid() IS NULL OR public.user_can_access_document(p_document_id,'viewer') IS NOT TRUE THEN
      RAISE EXCEPTION 'annotation access is not permitted' USING ERRCODE='42501';END IF;
    RAISE EXCEPTION 'generation-aware annotation access required' USING ERRCODE='SG001';END IF;
END;
$$;
DO $$
DECLARE signature text; definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['public.append_annotation_update(uuid,text,bigint,bytea)',
    'public.store_annotation_snapshot(uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    IF position('PERFORM survey_private.assert_legacy_annotation_document(p_document_id);' IN definition)=0 THEN
      IF position(E'BEGIN\n' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected legacy annotation function shape';END IF;
      definition:=overlay(definition PLACING E'BEGIN\n  PERFORM survey_private.assert_legacy_annotation_document(p_document_id);\n'
        FROM position(E'BEGIN\n' IN definition) FOR length(E'BEGIN\n'));
      EXECUTE definition;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.guard_legacy_annotation_generation()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE old_doc uuid; new_doc uuid; doc uuid; old_row jsonb; new_row jsonb; sid uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD);END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW);END IF;
  -- Exact FK ancestor absence is a cascade proof, not trigger depth or a
  -- caller-controlled NULL. These FKs are nondeferrable in the tracked schema.
  IF TG_OP='DELETE' THEN
    IF (old_row->>'document_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=(old_row->>'document_id')::uuid) THEN RETURN OLD;END IF;
    IF TG_TABLE_NAME IN('survey_sessions','document_annotations') AND (old_row->>'user_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=(old_row->>'user_id')::uuid) THEN RETURN OLD;END IF;
    IF TG_TABLE_NAME='survey_sessions' AND (old_row->>'template_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.templates t WHERE t.id=(old_row->>'template_id')::uuid) THEN RETURN OLD;END IF;
    IF TG_TABLE_NAME='survey_items' AND NOT EXISTS(SELECT 1 FROM public.survey_sessions s WHERE s.id=(old_row->>'session_id')::uuid) THEN RETURN OLD;END IF;
  END IF;
  IF TG_TABLE_NAME='survey_sessions' AND TG_OP='UPDATE' AND old_row->>'document_id' IS NOT NULL AND new_row->>'document_id' IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=(old_row->>'document_id')::uuid)
    AND (old_row-'document_id'-'updated_at') IS NOT DISTINCT FROM (new_row-'document_id'-'updated_at') THEN RETURN NEW;END IF;
  IF TG_TABLE_NAME='documents' THEN
    IF NEW.annotations IS NOT DISTINCT FROM OLD.annotations THEN RETURN NEW;END IF;
    old_doc:=OLD.id;new_doc:=NEW.id;
  ELSIF TG_TABLE_NAME='survey_items' THEN
    FOR sid IN SELECT DISTINCT x FROM unnest(ARRAY[(old_row->>'session_id')::uuid,(new_row->>'session_id')::uuid]) x WHERE x IS NOT NULL ORDER BY x LOOP
      PERFORM s.id FROM public.survey_sessions s WHERE s.id=sid FOR SHARE NOWAIT;
    END LOOP;
    SELECT s.document_id INTO old_doc FROM public.survey_sessions s WHERE s.id=(old_row->>'session_id')::uuid;
    SELECT s.document_id INTO new_doc FROM public.survey_sessions s WHERE s.id=(new_row->>'session_id')::uuid;
  ELSE old_doc:=(old_row->>'document_id')::uuid;new_doc:=(new_row->>'document_id')::uuid;
  END IF;
  FOR doc IN SELECT DISTINCT x FROM unnest(ARRAY[old_doc,new_doc]) x WHERE x IS NOT NULL ORDER BY x LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(doc::text,0)) THEN RAISE EXCEPTION 'annotation contention' USING ERRCODE='40001';END IF;
    IF EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads h WHERE h.document_id=doc) THEN
      RAISE EXCEPTION 'legacy annotation state is frozen' USING ERRCODE='SG001';END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['annotation_updates','annotation_snapshots','document_annotations','doc_yjs_state','doc_yjs_updates','survey_sessions','survey_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_generation_legacy_fence ON public.%I',t);
    EXECUTE format('CREATE TRIGGER a_generation_legacy_fence BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION survey_private.guard_legacy_annotation_generation()',t);
  END LOOP;
END;
$$;
DROP TRIGGER IF EXISTS a_generation_legacy_document_json_fence ON public.documents;
CREATE TRIGGER a_generation_legacy_document_json_fence BEFORE UPDATE OF annotations ON public.documents
FOR EACH ROW EXECUTE FUNCTION survey_private.guard_legacy_annotation_generation();

REVOKE ALL ON FUNCTION survey_private.annotation_generation_scope(uuid,uuid,boolean),survey_private.assert_legacy_annotation_document(uuid),
  survey_private.guard_legacy_annotation_generation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_annotation_snapshot_v2(uuid,uuid),public.read_annotation_updates_v2(uuid,uuid,bigint,bigint,integer),
 public.read_annotation_writer_sequence_v2(uuid,uuid,text),public.append_annotation_update_v2(uuid,uuid,text,bigint,bytea),
 public.store_annotation_snapshot_v2(uuid,uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_annotation_snapshot_v2(uuid,uuid),public.read_annotation_updates_v2(uuid,uuid,bigint,bigint,integer),
 public.read_annotation_writer_sequence_v2(uuid,uuid,text),public.append_annotation_update_v2(uuid,uuid,text,bigint,bytea),
 public.store_annotation_snapshot_v2(uuid,uuid,bigint,bytea,integer,text,bigint,bigint,text,bigint) TO authenticated;
COMMIT;
