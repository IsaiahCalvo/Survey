-- Metadata only. This is not an open receipt or a grant to fetch document bytes.
-- Keep the generation-aware content fence on public.documents unchanged.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE INDEX IF NOT EXISTS documents_library_owner_cursor_idx
 ON public.documents(user_id,id) WHERE archived=false AND user_archived_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_library_project_cursor_idx
 ON public.documents(project_id,id) WHERE archived=false AND user_archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.list_document_catalog(
 p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 100,p_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE actor uuid:=auth.uid(); rows jsonb; more boolean; cursor_id uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN
  RAISE EXCEPTION 'Document catalog is not permitted' USING ERRCODE='42501';END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN
  RAISE EXCEPTION 'Invalid catalog page bounds' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM survey_private.account_write_guards WHERE user_id=actor AND closing) THEN
  RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514';END IF;
 -- One statement snapshot, like RLS list reads. Do not take a write lock or
 -- create account rows for browsing. Opening rechecks current authority under
 -- document/membership locks; a catalog row is never lasting access authority.
 WITH visible AS NOT MATERIALIZED (
  SELECT d.id,d.user_id,d.project_id
  FROM public.documents d
  WHERE d.archived=false AND d.user_archived_at IS NULL
   AND (p_after_id IS NULL OR d.id>p_after_id)
   AND (p_project_id IS NULL OR d.project_id=p_project_id)
   AND NOT EXISTS(SELECT 1 FROM survey_private.account_write_guards g WHERE g.user_id=d.user_id AND g.closing)
   AND public.user_can_access_document(d.id,'viewer') IS TRUE
 ), candidates AS (
  -- Bound each independent access path before the union. Overlapping grants
  -- are deduplicated before the final limit; duplicates cannot hide a next page.
  (SELECT d.id FROM visible d WHERE d.user_id=actor ORDER BY d.id LIMIT p_limit+1)
  UNION ALL
  (SELECT d.id FROM visible d WHERE EXISTS(SELECT 1 FROM public.document_collaborators c
    WHERE c.document_id=d.id AND c.user_id=actor AND c.status='active') ORDER BY d.id LIMIT p_limit+1)
  UNION ALL
  (SELECT child.id FROM public.project_collaborators c
    CROSS JOIN LATERAL (SELECT d.id FROM visible d WHERE d.project_id=c.project_id ORDER BY d.id LIMIT p_limit+1) child
    WHERE c.user_id=actor AND c.status='active' ORDER BY child.id LIMIT p_limit+1)
  UNION ALL
  (SELECT child.id FROM public.projects p
    CROSS JOIN LATERAL (SELECT d.id FROM visible d WHERE d.project_id=p.id ORDER BY d.id LIMIT p_limit+1) child
    WHERE p.user_id=actor ORDER BY child.id LIMIT p_limit+1)
 ), bounded AS MATERIALIZED (
  SELECT DISTINCT id FROM candidates ORDER BY id LIMIT p_limit+1
 ), ranked AS (
  SELECT *,row_number() OVER(ORDER BY id) AS ordinal FROM bounded
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'user_id',d.user_id,'project_id',d.project_id,
    'name',left(d.name,1024),'name_truncated',length(left(d.name,1025))>1024,
    'file_size',d.file_size::text,'page_count',d.page_count,
    'created_at',d.created_at,'updated_at',d.updated_at,'locked_at',d.locked_at
   ) ORDER BY r.id) FILTER(WHERE ordinal<=p_limit),'[]'::jsonb),
   coalesce(bool_or(ordinal>p_limit),false),
   (array_agg(r.id ORDER BY r.id DESC) FILTER(WHERE ordinal<=p_limit))[1]
  INTO rows,more,cursor_id FROM ranked r
  -- Keep the final metadata projection to bounded primary-key lookups, rather
  -- than letting a hash join rescan the whole documents table for one page.
  JOIN LATERAL (SELECT d.user_id,d.project_id,d.name,d.file_size,d.page_count,d.created_at,d.updated_at,d.locked_at
    FROM public.documents d WHERE d.id=r.id LIMIT 1) d ON true;
 RETURN jsonb_build_object('version',1,'actor_user_id',actor,'rows',rows,
  'has_more',more,'next_cursor',CASE WHEN more THEN cursor_id ELSE NULL END);
END; $$;
ALTER FUNCTION public.list_document_catalog(uuid,integer,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_document_catalog(uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_document_catalog(uuid,integer,uuid) TO authenticated;
COMMENT ON FUNCTION public.list_document_catalog(uuid,integer,uuid) IS
 'Bounded metadata-only active library, ordered by immutable UUID. Names over 1024 characters are display excerpts with name_truncated=true. No content, path, generation receipt, or lasting access grant. Each page uses its own statement snapshot.';
COMMIT;
