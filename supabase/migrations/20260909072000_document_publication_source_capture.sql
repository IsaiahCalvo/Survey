-- Bounded, coherent SQL input for a future PDF-generation publication.
-- This is private: no client capture endpoint, Storage proof, or activation.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE INDEX IF NOT EXISTS survey_sessions_document_capture_idx
  ON public.survey_sessions(document_id,id);
CREATE INDEX IF NOT EXISTS survey_items_session_capture_idx
  ON public.survey_items(session_id,id);

CREATE FUNCTION survey_private.capture_document_publication_sources(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $fn$
DECLARE
  actor uuid := auth.uid();
  doc public.documents%ROWTYPE;
  direct_role text;
  document_json jsonb;
  wal_head bigint;
  snapshot_at_seq bigint;
  legacy_revision bigint;
  survey_revision bigint;
  source_name text;
  source_query text;
  row_json jsonb;
  rows_json jsonb[];
  sources jsonb := '{}'::jsonb;
  compare jsonb;
  body jsonb;
  total_rows integer := 0;
  total_bytes bigint := 0;
  max_rows constant integer := 10000;
  max_bytes constant bigint := 16777216;
BEGIN
  IF actor IS NULL OR p_document_id IS NULL
     OR public.user_can_access_document(p_document_id,'editor') IS NOT TRUE
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document source capture is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Document source capture requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0)) THEN
    RAISE EXCEPTION 'Document source capture contention' USING ERRCODE='40001';
  END IF;
  SELECT d.* INTO doc FROM public.documents d WHERE d.id=p_document_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document source capture is not permitted' USING ERRCODE='42501';
  END IF;
  -- Match guard_annotation_write_authority's existing role ladder. A direct
  -- viewer overrides an inherited editor; only the inherited branch needs the
  -- project parent lock. Parent locks fence absent-membership insertions too.
  IF doc.user_id IS DISTINCT FROM actor AND doc.project_id IS NOT NULL THEN
    SELECT c.role INTO direct_role FROM public.document_collaborators c
      WHERE c.document_id=p_document_id AND c.user_id=actor AND c.status='active';
    IF direct_role IS NULL THEN
      PERFORM p.id FROM public.projects p WHERE p.id=doc.project_id FOR SHARE NOWAIT;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Document source capture is not permitted' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  IF public.user_can_access_document(p_document_id,'editor') IS NOT TRUE
     OR public.kal49_document_is_locked(p_document_id) THEN
    RAISE EXCEPTION 'Document source capture is not permitted' USING ERRCODE='42501';
  END IF;
  -- Survey sessions have owner-only SELECT, unlike document annotations. Do
  -- not widen that policy or silently omit foreign sessions from a full input.
  IF EXISTS (SELECT 1 FROM public.survey_sessions s WHERE s.document_id=p_document_id
      AND s.user_id IS DISTINCT FROM actor) THEN
    RAISE EXCEPTION 'Document source capture is not permitted' USING ERRCODE='42501';
  END IF;

  -- All source writers, including privileged row deletes, take this WAL lock
  -- after migrations 040000/050000/060000/071000. No inverse child locks here.
  SELECT coalesce(max(u.seq),0) INTO wal_head FROM public.annotation_updates u
    WHERE u.document_id=p_document_id;
  SELECT s.at_seq INTO snapshot_at_seq FROM public.annotation_snapshots s
    WHERE s.document_id=p_document_id;
  SELECT coalesce((SELECT r.revision FROM survey_private.document_legacy_revisions r
    WHERE r.document_id=p_document_id),0) INTO legacy_revision;
  SELECT coalesce((SELECT r.revision FROM survey_private.document_survey_revisions r
    WHERE r.document_id=p_document_id),0) INTO survey_revision;

  document_json := to_jsonb(doc);
  IF document_json ? 'file_size' THEN
    document_json := document_json || jsonb_build_object('file_size',document_json->>'file_size');
  END IF;
  total_bytes := octet_length(document_json::text);
  IF total_bytes>max_bytes THEN
    RAISE EXCEPTION 'Document SQL capture exceeds its byte limit' USING ERRCODE='54000';
  END IF;

  -- Queries are fixed here, never caller-provided SQL. Each cursor is bounded
  -- by one more than the total row limit; fail the whole capture, never return
  -- partial arrays or page through independently changing live source reads.
  -- Keep complete rows, explicitly replacing every known bigint/bytea field.
  FOR source_name,source_query IN SELECT * FROM (VALUES
    ('annotation_snapshot',$query$
      SELECT (to_jsonb(s)-'snapshot') || jsonb_build_object(
        'snapshot_base64',encode(s.snapshot,'base64'),'at_seq',s.at_seq::text,
        'writer_epoch',s.writer_epoch::text,'base_at_seq',s.base_at_seq::text,
        'base_writer_epoch',s.base_writer_epoch::text)
      FROM public.annotation_snapshots s WHERE s.document_id=$1 LIMIT 10001$query$),
    ('annotation_updates',$query$
      SELECT (to_jsonb(u)-'data') || jsonb_build_object('data_base64',encode(u.data,'base64'),
        'seq',u.seq::text,'client_seq',u.client_seq::text)
      FROM public.annotation_updates u WHERE u.document_id=$1
        AND u.seq>coalesce($2,0) AND u.seq<=$3 ORDER BY u.seq LIMIT 10001$query$),
    ('document_annotations',$query$
      SELECT to_jsonb(a) FROM public.document_annotations a
      WHERE a.document_id=$1 ORDER BY a.id LIMIT 10001$query$),
    ('doc_yjs_state',$query$
      SELECT (to_jsonb(s)-'state'-'state_vector') || jsonb_build_object(
        'state_base64',encode(s.state,'base64'),'state_vector_base64',encode(s.state_vector,'base64'),
        'through_seq',s.through_seq::text)
      FROM public.doc_yjs_state s WHERE s.document_id=$1 LIMIT 10001$query$),
    ('doc_yjs_updates',$query$
      SELECT (to_jsonb(u)-'update') || jsonb_build_object('update_base64',encode(u.update,'base64'),
        'id',u.id::text,'seq',u.seq::text)
      FROM public.doc_yjs_updates u WHERE u.document_id=$1 ORDER BY u.seq,u.id LIMIT 10001$query$),
    ('survey_sessions',$query$
      SELECT to_jsonb(s) FROM public.survey_sessions s
      WHERE s.document_id=$1 ORDER BY s.id LIMIT 10001$query$),
    ('survey_items',$query$
      SELECT to_jsonb(i) FROM public.survey_items i JOIN public.survey_sessions s ON s.id=i.session_id
      WHERE s.document_id=$1 ORDER BY i.session_id,i.id LIMIT 10001$query$)
  ) definitions(name,query)
  LOOP
    rows_json := ARRAY[]::jsonb[];
    FOR row_json IN EXECUTE source_query USING p_document_id,snapshot_at_seq,wal_head LOOP
      total_rows := total_rows+1;
      -- Count serialized bytes before accumulating an aggregate. A single row
      -- still must be serialized; this is a result-size cap, not a RAM quota.
      total_bytes := total_bytes+octet_length(row_json::text)+2;
      IF total_rows>max_rows OR total_bytes>max_bytes THEN
        RAISE EXCEPTION 'Document SQL capture exceeds its row or byte limit' USING ERRCODE='54000';
      END IF;
      rows_json := array_append(rows_json,row_json);
    END LOOP;
    sources := sources || jsonb_build_object(source_name,
      CASE WHEN source_name IN ('annotation_snapshot','doc_yjs_state')
        THEN coalesce(rows_json[1],'null'::jsonb) ELSE to_jsonb(rows_json) END);
  END LOOP;
  compare := jsonb_build_object('wal_head',wal_head::text,
    'covered_head',greatest(wal_head,coalesce(snapshot_at_seq,0))::text,
    'legacy_revision',legacy_revision::text,'survey_revision',survey_revision::text);
  body := jsonb_build_object('version',1,'scope','sql-only','actor_user_id',actor,
    'document',document_json,'sources',sources,'compare',compare);
  -- Include presence, every row field, bytes, exact PDF metadata and counters.
  -- No capture timestamp: equal SQL state produces an equal compare token.
  compare := compare || jsonb_build_object('sql_sha256',encode(sha256(convert_to(body::text,'UTF8')),'hex'));
  body := body || jsonb_build_object('compare',compare);
  IF octet_length(body::text)>max_bytes THEN
    RAISE EXCEPTION 'Document SQL capture exceeds its byte limit' USING ERRCODE='54000';
  END IF;
  RETURN body;
END;
$fn$;
ALTER FUNCTION survey_private.capture_document_publication_sources(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.capture_document_publication_sources(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION survey_private.capture_document_publication_sources(uuid) IS
  'Private coherent bounded SQL capture; no Storage/sidecar/PDF-byte proof, public endpoint or generation publication. Reauthorize and recapture inside the future commit transaction.';
COMMIT;
