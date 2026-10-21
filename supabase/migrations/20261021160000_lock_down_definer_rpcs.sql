-- Backend security pass (2026-10-21): close RPC holes the Supabase security
-- advisor and a live check turned up.
--
-- 1. archive_* / restore_* / purge_archived_* were executable by `anon`. Their
--    owner check is `v_owner <> auth.uid()`, which is NULL (so skipped) when
--    there is no signed-in user. Anyone holding the public anon key and a
--    document/project/template id could archive it and then purge it for good.
--    Only signed-in users call these, so anon loses EXECUTE.
-- 2. kal308_apply_changeset and kal309_persist_created_token are meant to be
--    service-role only (the excel-apply-changeset edge function), but
--    authenticated still had EXECUTE. apply_changeset's in-body gate reads the
--    legacy `request.jwt.claim.role` setting, which PostgREST no longer sets,
--    so a signed-in user could call it straight from PostgREST with any
--    p_actor_id. Both are now service-role only.
-- 3. check_user_collaborator_eligibility (user id -> email + plan),
--    get_user_id_by_email (email -> user id) and get_active_projects (any
--    user's project names) took a user id or email from the caller and checked
--    nothing. No client code calls them; check_collaborator_by_email still
--    calls the eligibility helper as definer, so it keeps working.
-- 4. delete_account_owned_rows already refuses non-service callers; drop the
--    grants anyway so it stops showing as callable.
-- 5. Functions created later in public no longer default to EXECUTE for anon /
--    PUBLIC. A migration that adds an RPC must grant it on purpose.
-- 6. spaces had a second, plan-free INSERT/UPDATE policy beside the "Only Pro"
--    ones. Permissive policies OR together, so the Pro gate did nothing. Drop
--    the duplicates (the table holds no rows and the client does not use it).

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.archive_document(uuid)',
    'public.archive_project(uuid)',
    'public.archive_template(uuid)',
    'public.restore_document(uuid)',
    'public.restore_project(uuid)',
    'public.restore_template(uuid)',
    'public.purge_archived_document(uuid)',
    'public.purge_archived_project(uuid)',
    'public.purge_archived_template(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.kal308_apply_changeset(uuid,uuid,text,text,text,text,text,text,jsonb,jsonb)',
    'public.kal309_persist_created_token(uuid,text,text,text,text,text)',
    'public.check_user_collaborator_eligibility(uuid)',
    'public.get_user_id_by_email(text)',
    'public.get_active_projects(uuid)',
    'public.delete_account_owned_rows(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Users can insert spaces for own documents" ON public.spaces;
DROP POLICY IF EXISTS "Users can update spaces for own documents" ON public.spaces;
DROP POLICY IF EXISTS "Users can view spaces for own documents" ON public.spaces;
DROP POLICY IF EXISTS "Users can delete spaces for own documents" ON public.spaces;
