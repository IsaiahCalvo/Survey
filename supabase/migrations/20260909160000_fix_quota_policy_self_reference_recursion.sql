-- Applied live as 20260909160000 (Management API, 2026-09-09T15:12Z).
-- The 20260907213936 uid-initplan rewrite left the document/project INSERT policies
-- counting rows from the very table they guard. Postgres now raises
-- 42P17 'infinite recursion detected in policy' on every upload and project
-- creation (reproduced as the owner account, 2026-09-09). Move each count into a
-- self-scoped SECURITY DEFINER helper (same idiom as get_actual_storage_usage) so the
-- policy has no self-referencing subquery. Limits and cross-user refusal unchanged.
SET lock_timeout = '3s';
SET statement_timeout = '30s';
-- Self-scoped like get_actual_storage_usage(): an authenticated caller always counts their OWN rows.
CREATE OR REPLACE FUNCTION public.get_active_document_count(p_user_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COUNT(*) FROM public.documents
  WHERE user_id = COALESCE(auth.uid(), p_user_id) AND archived = FALSE;
$$;
CREATE OR REPLACE FUNCTION public.get_active_project_count(p_user_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COUNT(*) FROM public.projects
  WHERE user_id = COALESCE(auth.uid(), p_user_id) AND archived = FALSE;
$$;
REVOKE ALL ON FUNCTION public.get_active_document_count(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_active_project_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_document_count(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_project_count(UUID) TO authenticated, service_role;
ALTER POLICY "Users can upload documents within limits" ON public.documents
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.get_active_document_count((SELECT auth.uid())) < public.get_document_limit((SELECT auth.uid()))
    AND public.get_actual_storage_usage((SELECT auth.uid())) <= public.get_storage_limit((SELECT auth.uid()))
  );
ALTER POLICY "Users can create projects within limit" ON public.projects
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.get_active_project_count((SELECT auth.uid())) < public.get_project_limit((SELECT auth.uid()))
  );
RESET lock_timeout;
RESET statement_timeout;
