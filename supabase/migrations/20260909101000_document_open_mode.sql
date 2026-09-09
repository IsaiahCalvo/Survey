-- Explicit mode discovery only. This is not a content grant, a checked bundle,
-- or a lease across requests. Existing generation read/write fences stay intact.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_document_open_mode(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path='' SET lock_timeout='2s' AS $$
DECLARE actor uuid:=auth.uid(); owner_id uuid; generation uuid; account_id uuid; closing boolean;
BEGIN
 IF actor IS NULL OR p_document_id IS NULL
  OR public.user_can_access_document(p_document_id,'viewer') IS NOT TRUE THEN
  RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Document mode requires READ COMMITTED' USING ERRCODE='25001';END IF;
 -- The same shared lock as 099 prevents adoption between discovery and scope
 -- validation. TRY/NOWAIT avoids reverse-order waits with publication writers.
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended(p_document_id::text,0)) THEN
  RAISE EXCEPTION 'Document mode contention' USING ERRCODE='40001';END IF;
 SELECT d.user_id INTO owner_id FROM public.documents d WHERE d.id=p_document_id FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 SELECT h.generation_id INTO generation FROM survey_private.annotation_generation_heads h WHERE h.document_id=p_document_id;
 -- Recheck the exact current mode and authority after taking the locks. 090
 -- locks an inherited project only when needed; 040 membership parent guards
 -- also fence absent direct membership becoming a new role override.
 PERFORM survey_private.annotation_generation_scope(p_document_id,generation,false);
 FOR account_id IN SELECT DISTINCT x FROM unnest(ARRAY[actor,owner_id]) x ORDER BY x LOOP
  SELECT g.closing INTO closing FROM survey_private.account_write_guards g WHERE g.user_id=account_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN
   PERFORM survey_private.assert_account_open(account_id);
  ELSIF closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;
 END LOOP;
 -- A head always means checked, even if its receipt/asset is invalid. Only the
 -- full checked reader may validate that publication; never fall back to legacy.
 RETURN jsonb_build_object('version',1,'actor_user_id',actor,'document_id',p_document_id,
  'mode',CASE WHEN generation IS NULL THEN 'legacy' ELSE 'checked' END,'generation_id',generation);
END; $$;
ALTER FUNCTION public.read_document_open_mode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_document_open_mode(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_document_open_mode(uuid) TO authenticated;
COMMENT ON FUNCTION public.read_document_open_mode(uuid) IS
 'Authorized mode observation under generation, membership and account guards. No content, paths, role, snapshot or URL. A head always requires checked open; legacy must be rechecked after asynchronous reads and remains subject to all existing server fences.';
COMMIT;
