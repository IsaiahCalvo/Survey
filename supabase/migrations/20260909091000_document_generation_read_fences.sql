-- Read boundary only, not generation activation. Old clients must not combine
-- generation PDFs with document-only caches or annotation reads. New list/open,
-- download and broadcast adoption remains required before publication is enabled.
-- Storage RLS does not revoke issued signed links or protect a public bucket.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION survey_private.has_annotation_generation_heads()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads)
$$;

-- A callable policy helper must check authority itself: an outsider cannot use
-- an exception to probe whether a supplied document UUID has been adopted.
CREATE OR REPLACE FUNCTION survey_private.legacy_generation_read_allowed(p_document_id uuid,p_revision boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_document_id IS NULL THEN RETURN true; END IF;
  IF NOT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=p_document_id) THEN RETURN true; END IF;
  IF (CASE WHEN p_revision THEN public._kal48_can_access(p_document_id,'viewer')
    ELSE public.user_can_access_document(p_document_id,'viewer') END) IS NOT TRUE THEN RETURN true; END IF;
  RAISE EXCEPTION 'This document requires the generation-aware reader' USING ERRCODE='SG001';
END;
$$;

-- A definer may issue several SQL statements. Hold the shared publication lock
-- from this guard through its content read so activation cannot slip between
-- the check and a later SELECT with a fresh READ COMMITTED snapshot.
CREATE OR REPLACE FUNCTION survey_private.assert_legacy_generation_content_read(p_document_id uuid,p_revision boolean,p_write boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE project uuid; owner_id uuid;
BEGIN
  IF (CASE WHEN p_revision THEN public._kal48_can_access(p_document_id,'viewer')
    ELSE public.user_can_access_document(p_document_id,'viewer') END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Document content read requires READ COMMITTED' USING ERRCODE='25001';
  END IF;
  IF NOT (CASE WHEN p_write THEN pg_try_advisory_xact_lock(hashtextextended(p_document_id::text,0))
    ELSE pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) END) THEN
    RAISE EXCEPTION 'Document content read contention' USING ERRCODE='40001';
  END IF;
  SELECT project_id,user_id INTO project,owner_id FROM public.documents WHERE id=p_document_id FOR SHARE NOWAIT;
  IF project IS NOT NULL AND owner_id IS DISTINCT FROM auth.uid() THEN
    PERFORM id FROM public.projects WHERE id=project FOR SHARE NOWAIT;
  END IF;
  IF (CASE WHEN p_revision THEN public._kal48_can_access(p_document_id,'viewer')
    ELSE public.user_can_access_document(p_document_id,'viewer') END) IS NOT TRUE THEN
    RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';
  END IF;
  PERFORM survey_private.legacy_generation_read_allowed(p_document_id,p_revision);
END;
$$;

-- Survey data has an owner-only policy, not inherited document-viewer access.
-- Resolve the real binding/owner internally so arbitrary caller arguments cannot
-- manufacture visibility into another user's sessions or items.
CREATE OR REPLACE FUNCTION survey_private.legacy_survey_generation_read_allowed(p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE document uuid; session_owner uuid;
BEGIN
  SELECT document_id,user_id INTO document,session_owner FROM public.survey_sessions WHERE id=p_session_id;
  -- INSERT RETURNING can run before this STABLE helper sees the new session.
  -- Existing owner RLS and the generation write guard remain authoritative.
  IF NOT FOUND THEN RETURN true; END IF;
  IF auth.uid() IS NULL OR session_owner IS DISTINCT FROM auth.uid() THEN RETURN true; END IF;
  IF document IS NOT NULL AND EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id=document) THEN
    RAISE EXCEPTION 'This document requires the generation-aware reader' USING ERRCODE='SG001';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION survey_private.legacy_generation_storage_read_allowed(p_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  -- Match the existing owner-prefix and collaborator current-path permissions.
  -- Do not grant reads to collaborators merely because a retained ref exists.
  IF split_part(p_path,'/',1)=auth.uid()::text OR EXISTS(SELECT 1 FROM public.documents d
    WHERE d.file_path=p_path AND public.user_can_access_document(d.id,'viewer')) THEN
    RAISE EXCEPTION 'This PDF requires the generation-aware download route' USING ERRCODE='SG001';
  END IF;
  RETURN false;
END;
$$;

-- Use an uncorrelated subselect so a database with no adopted documents pays
-- one head-existence probe per statement, not one per legacy annotation row.
DO $fences$
DECLARE relation text; key_column text; guard text;
BEGIN
  FOR relation,key_column IN SELECT * FROM (VALUES
    ('documents','id'),('annotation_updates','document_id'),('annotation_snapshots','document_id'),
    ('document_annotations','document_id'),('doc_yjs_state','document_id'),('doc_yjs_updates','document_id'),
    ('document_revisions','document_id'),('excel_sync_ops','document_id')) AS targets(relation,key_column)
  LOOP
    IF to_regclass('public.'||relation) IS NULL THEN CONTINUE; END IF;
    guard:=format('CASE WHEN NOT (SELECT survey_private.has_annotation_generation_heads()) THEN true ELSE survey_private.legacy_generation_read_allowed(%I,%L) END',
      key_column,relation='document_revisions');
    EXECUTE format('DROP POLICY IF EXISTS generation_legacy_read_fence ON public.%I',relation);
    EXECUTE format('CREATE POLICY generation_legacy_read_fence ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (%s)',relation,guard);
  END LOOP;
  FOR relation,key_column IN SELECT * FROM (VALUES ('survey_sessions','id'),('survey_items','session_id')) AS targets(relation,key_column)
  LOOP
    guard:=format('CASE WHEN NOT (SELECT survey_private.has_annotation_generation_heads()) THEN true ELSE survey_private.legacy_survey_generation_read_allowed(%I) END',key_column);
    EXECUTE format('DROP POLICY IF EXISTS generation_legacy_read_fence ON public.%I',relation);
    EXECUTE format('CREATE POLICY generation_legacy_read_fence ON public.%I AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (%s)',relation,guard);
  END LOOP;
END;
$fences$;

-- Every protected stage is gated, including not-yet-adopted candidates. Service
-- BYPASSRLS reads remain necessary for complete byte verification and the future
-- checked download route. No policy or grants widen Storage access.
DROP POLICY IF EXISTS generation_legacy_read_fence ON storage.objects;
CREATE POLICY generation_legacy_read_fence ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(CASE WHEN bucket_id='documents' AND split_part(name,'/',2)='_generations'
    THEN survey_private.legacy_generation_storage_read_allowed(name) ELSE true END);

-- These legacy SECURITY DEFINER content readers bypass RLS. Insert the fence
-- after their tracked permission check and before content read/write. Keep their
-- exact bodies, permission semantics, owner and existing ACL unchanged. Fail on
-- an unknown body instead of silently leaving an unfenced definer installed.
DO $readers$
DECLARE signature text; anchor text; check_sql text; definition text; marker text:='-- generation legacy content read fence';
BEGIN
  FOR signature,anchor,check_sql IN SELECT * FROM (VALUES
    ('public.kal48_create_revision(uuid,text,text)','    IF p_origin NOT IN',
      'PERFORM survey_private.assert_legacy_generation_content_read(p_document_id,true,true);'),
    ('public.kal48_list_revisions(uuid)','    RETURN QUERY',
      'PERFORM survey_private.assert_legacy_generation_content_read(p_document_id,true,false);'),
    ('public.kal48_get_revision(uuid)','    RETURN v_row;',
      'PERFORM survey_private.assert_legacy_generation_content_read(v_row.document_id,true,false);'),
    ('public.kal48_restore_revision(uuid)','    v_pre_restore := public.kal48_create_revision(',
      'PERFORM survey_private.assert_legacy_generation_content_read(v_revision.document_id,true,true);'),
    ('public.kal309_fetch_since(uuid,text,bigint)','  RETURN QUERY',
      'PERFORM survey_private.assert_legacy_generation_content_read(p_document_id,false,false);'),
    -- These owner-only metadata mutations return the full documents row,
    -- including annotations and file_path. Future v2 replacements must return
    -- metadata-only receipts, not bypass the generation entry protocol.
    ('public.kal49_lock_document(uuid,text)','  UPDATE public.documents',
      'PERFORM survey_private.assert_legacy_generation_content_read(doc_id,false,true);'),
    ('public.kal49_unlock_document(uuid)','  UPDATE public.documents',
      'PERFORM survey_private.assert_legacy_generation_content_read(doc_id,false,true);')
  ) AS readers(signature,anchor,check_sql)
  LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'Missing expected legacy content reader: %',signature USING ERRCODE='55000';
    END IF;
    definition:=pg_get_functiondef(to_regprocedure(signature));
    IF position(marker IN definition)>0 THEN CONTINUE; END IF;
    IF position(anchor IN definition)=0 OR (position('_can_access' IN definition)=0
      AND NOT (signature LIKE 'public.kal49_%' AND position('owner_id' IN definition)>0 AND position('auth.uid()' IN definition)>0)) THEN
      RAISE EXCEPTION 'Unrecognized legacy content reader: %',signature USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,anchor,'    '||marker||E'\n    '||check_sql||E'\n'||anchor);
  END LOOP;
END;
$readers$;

ALTER FUNCTION survey_private.has_annotation_generation_heads() OWNER TO postgres;
ALTER FUNCTION survey_private.assert_legacy_generation_content_read(uuid,boolean,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.assert_legacy_generation_content_read(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION survey_private.legacy_generation_read_allowed(uuid,boolean) OWNER TO postgres;
ALTER FUNCTION survey_private.legacy_survey_generation_read_allowed(uuid) OWNER TO postgres;
ALTER FUNCTION survey_private.legacy_generation_storage_read_allowed(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.has_annotation_generation_heads(),survey_private.legacy_generation_read_allowed(uuid,boolean),
  survey_private.legacy_survey_generation_read_allowed(uuid),survey_private.legacy_generation_storage_read_allowed(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION survey_private.has_annotation_generation_heads(),survey_private.legacy_generation_read_allowed(uuid,boolean),
  survey_private.legacy_survey_generation_read_allowed(uuid),survey_private.legacy_generation_storage_read_allowed(text)
  TO anon,authenticated;
COMMIT;
