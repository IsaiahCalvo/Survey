-- Supabase advisor findings (security + performance lints, 2026-10-21).
--
-- 1. Trigger functions were callable over /rest/v1/rpc. Calling one there only
--    errors ("trigger functions can only be called as triggers"), but nothing
--    needs EXECUTE on them: Postgres does not check it when a trigger fires.
--    Revoke it from every trigger function in public.
-- 2. SECURITY DEFINER functions only signed-in callers use stop being callable
--    signed out. Kept for anon on purpose: user_can_access_document/project/
--    template, _kal48_can_access and kal49_document_is_locked (used by
--    policies that apply to every role, so anon must be able to run them and
--    get false), get_my_feature_flags (read before sign-in),
--    report_client_error (error reports from signed-out pages) and
--    agent_session_ok (check_agent_request, PostgREST's pre-request hook,
--    calls it as the caller's role on every request, signed out too).
-- 3. doc_yjs_state had two permissive SELECT policies (viewer SELECT plus the
--    editor FOR ALL), so every read ran both. The editor policy now covers
--    INSERT, UPDATE and DELETE only; the viewer policy alone covers reads,
--    which includes editors.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.sig);
  end loop;
end;
$$;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        '_can_manage_invite_email_delivery',
        'claim_invite_email_delivery',
        'complete_invite_email_delivery',
        'release_invite_email_delivery',
        'rotate_invite_email_delivery',
        'is_feature_flag_admin'
      )
  loop
    execute format('revoke execute on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end;
$$;

drop policy if exists doc_yjs_state_upsert_editor on public.doc_yjs_state;

drop policy if exists doc_yjs_state_insert_editor on public.doc_yjs_state;
create policy doc_yjs_state_insert_editor on public.doc_yjs_state
  for insert
  with check (public.user_can_access_document(document_id, 'editor'));

drop policy if exists doc_yjs_state_update_editor on public.doc_yjs_state;
create policy doc_yjs_state_update_editor on public.doc_yjs_state
  for update
  using (public.user_can_access_document(document_id, 'editor'))
  with check (public.user_can_access_document(document_id, 'editor'));

drop policy if exists doc_yjs_state_delete_editor on public.doc_yjs_state;
create policy doc_yjs_state_delete_editor on public.doc_yjs_state
  for delete
  using (public.user_can_access_document(document_id, 'editor'));
