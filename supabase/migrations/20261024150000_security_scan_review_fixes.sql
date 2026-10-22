-- Review follow-ups to 20261024140000_security_scan_fixes (Codex on #1143).
--
-- 1. account_deletion_storage_objects: a sidecar <project_id>/<doc_id>_data.json
--    of the person's OWN document is theirs even when the project belongs to
--    someone else (a document filed in a shared project). The second segment
--    names the document and document ids are unique, so the foreign-prefix
--    skip is not needed there and wrongly left such sidecars out of export
--    and behind after delete.
-- 2. claim_email_send: the "one email, one charge" pass for the send-email
--    fallback after an 'auth-invite' charge was reusable for five minutes. It
--    is now consumed atomically the first time it is used.

BEGIN;

-- 1 ---------------------------------------------------------------------------
create or replace function public.account_deletion_storage_objects(target_user_id uuid)
returns table (bucket_id text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  with owned_docs as (
    select d.id::text as doc_id, d.file_path
    from public.documents d
    where d.user_id = target_user_id
  ),
  owned_projects as (
    select p.id::text as project_id
    from public.projects p
    where p.user_id = target_user_id
  ),
  -- First path segments that belong to somebody else. An id the person chose
  -- that matches one of these never claims those files.
  foreign_prefixes as (
    select u.id::text as prefix from auth.users u where u.id <> target_user_id
    union all
    select d.id::text from public.documents d where d.user_id <> target_user_id
    union all
    select p.id::text from public.projects p where p.user_id <> target_user_id
  )
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id <> 'brand'
    and (
      split_part(o.name, '/', 1) = target_user_id::text
      or (
        split_part(o.name, '/', 1) in (select doc_id from owned_docs)
        and split_part(o.name, '/', 1) not in (select prefix from foreign_prefixes)
      )
      -- Survey JSON sidecars: documents/<project_id>/<document_id>_data.json.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 2) in (select doc_id || '_data.json' from owned_docs)
      )
      -- Anything else under the person's projects, except the sidecars of
      -- other people's documents, which account_deletion_sidecar_moves keeps.
      or (
        o.bucket_id = 'documents'
        and split_part(o.name, '/', 1) in (select project_id from owned_projects)
        and split_part(o.name, '/', 1) not in (select prefix from foreign_prefixes)
        and not exists (
          select 1 from public.documents other
          where split_part(o.name, '/', 2) = other.id::text || '_data.json'
            and other.user_id <> target_user_id
        )
      )
      or (
        o.bucket_id = 'documents'
        and o.name in (select file_path from owned_docs where file_path is not null)
        and not exists (
          select 1 from public.documents other
          where other.file_path = o.name and other.user_id <> target_user_id
        )
      )
    )
  order by o.bucket_id, o.name;
end;
$$;

revoke all on function public.account_deletion_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_storage_objects(uuid) to service_role;

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_email_send(
    p_template TEXT,
    p_recipient TEXT,
    p_is_invite BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_recent INTEGER;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN 'error';
    END IF;

    -- One claim per person at a time, so parallel calls cannot all read the
    -- same count and all pass.
    PERFORM pg_advisory_xact_lock(hashtextextended('email_send:' || v_uid::text, 0));

    -- KAL-31 locked spec: free users cannot create invites. Enforced here so
    -- a direct function call cannot dodge the UI gate.
    IF p_is_invite AND public.get_user_tier(v_uid)::text = 'free' THEN
        RETURN 'invite_blocked_free_tier';
    END IF;

    -- send-invite-email already charged this invite as 'auth-invite' and is
    -- now falling back to send-email for an existing account: one email, one
    -- charge.
    -- The pass is used up on the spot (the row is relabelled, and still
    -- counts toward the hourly cap), so it covers exactly one fallback.
    IF p_template IN ('document-invite', 'document-shared') THEN
        UPDATE public.email_send_events
           SET template = 'auth-invite-fallback'
         WHERE id = (
            SELECT e.id FROM public.email_send_events e
            WHERE e.user_id = v_uid
              AND e.template = 'auth-invite'
              AND e.recipient = left(lower(p_recipient), 320)
              AND e.created_at > now() - interval '5 minutes'
            ORDER BY e.created_at DESC
            LIMIT 1
         );
        IF FOUND THEN
            RETURN 'allowed';
        END IF;
    END IF;

    -- Rolling-hour cap.
    SELECT COUNT(*) INTO v_recent
    FROM public.email_send_events
    WHERE user_id = v_uid
      AND created_at > now() - interval '1 hour';
    IF v_recent >= 30 THEN
        RETURN 'rate_limited';
    END IF;

    -- Security notices go only to the account's own address; a few an hour
    -- is plenty, and more would only spend the shared email quota.
    IF p_template = 'profile-change' THEN
        SELECT COUNT(*) INTO v_recent
        FROM public.email_send_events
        WHERE user_id = v_uid
          AND template = 'profile-change'
          AND created_at > now() - interval '1 hour';
        IF v_recent >= 5 THEN
            RETURN 'rate_limited';
        END IF;
    END IF;

    -- Opportunistic hygiene: drop this user's stale ledger rows so the table
    -- stays bounded without a scheduled job.
    DELETE FROM public.email_send_events
    WHERE user_id = v_uid
      AND created_at < now() - interval '2 days';

    INSERT INTO public.email_send_events (user_id, template, recipient)
    VALUES (v_uid, left(p_template, 64), left(lower(p_recipient), 320));

    RETURN 'allowed';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

COMMIT;
