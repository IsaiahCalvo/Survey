-- One authority observation for a checked, adopted document open. This does
-- not activate generation routes, grant publication, or return content bytes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION public.read_document_generation_collaboration(
 p_document_id uuid,p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' SET lock_timeout='2s' AS $$
DECLARE checked jsonb; effective_role text;
BEGIN
 IF p_generation_id IS NULL THEN
  RAISE EXCEPTION 'A checked generation is required' USING ERRCODE='22023';END IF;
 -- 099 holds the shared publication lock, document row, inherited project
 -- row when needed, account guards and exact PDF identity through transaction
 -- end. 040 membership triggers also lock parent rows for INSERT/UPDATE/DELETE,
 -- including a new direct viewer that overrides inherited editor access.
 -- Keep these reads in this transaction, not two independent HTTP requests.
 checked:=public.read_document_generation_open(p_document_id,p_generation_id,false);
 effective_role:=public.get_my_document_role(p_document_id);
 IF effective_role IS NULL OR effective_role NOT IN ('owner','editor','viewer') THEN
  RAISE EXCEPTION 'Document content is not permitted' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('version',1,'actor_user_id',checked->'actor_user_id',
  'document_id',checked->'document_id','generation_id',checked->'generation_id',
  'pdf',checked->'pdf','publication',checked->'publication','role',effective_role);
END; $$;
ALTER FUNCTION public.read_document_generation_collaboration(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.read_document_generation_collaboration(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_document_generation_collaboration(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.read_document_generation_collaboration(uuid,uuid) IS
 'Single checked generation and effective-role observation. Same transaction authority locks as generation open; no snapshot, private source/history or download URL.';
COMMIT;
