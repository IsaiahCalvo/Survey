-- Security scan fixes (2026-10-22).
--
-- 1. Clients pick documents.id and projects.id on insert (offline-safe copies,
--    idempotent uploads), and storage is keyed by those ids: survey-media by
--    document id, sidecars by project id, PDFs by user id. A chosen id equal
--    to another person's user id, document id or project id made their files
--    look like the chooser's: export-account handed out signed URLs for them
--    and delete-account removed them. guard_owned_id_collision refuses such an
--    id for signed-in callers (the service role and migrations are exempt).
-- 2. account_deletion_storage_objects also skips any prefix that belongs to
--    someone else, in case such a row was created before (1).
-- 3. A new documents row may only point file_path into the caller's own folder
--    (<uid>/...) or at a path the caller already owns. Before this, inserting a
--    row with someone else's file_path made the caller its owner and the
--    collaborator storage policy then served the other person's PDF. UPDATE of
--    file_path was already locked (enforce_documents_file_path_immutable).
-- 4. check_collaborator_by_email answered "which account and plan is this
--    email?" for any address. It now answers only for an address the caller
--    has an open invite for (the app always creates the invite first), and no
--    longer returns the plan.
-- 5. claim_email_send: send-invite-email now charges an 'auth-invite' send
--    before the auth mailer (which runs as the service role and skipped the
--    plan gate and hourly cap). When that recipient already has an account the
--    function falls back to send-email, which claims again; that second claim
--    for the same recipient within five minutes is not counted twice.

BEGIN;

-- 1 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_owned_id_collision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id IS NOT DISTINCT FROM OLD.id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.id)
     OR (TG_TABLE_NAME = 'documents'
         AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = NEW.id))
     OR (TG_TABLE_NAME = 'projects'
         AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = NEW.id)) THEN
    RAISE EXCEPTION 'That id is already in use' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_owned_id_collision() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_documents_guard_id_collision ON public.documents;
CREATE TRIGGER trg_documents_guard_id_collision
  BEFORE INSERT OR UPDATE OF id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_owned_id_collision();

DROP TRIGGER IF EXISTS trg_projects_guard_id_collision ON public.projects;
CREATE TRIGGER trg_projects_guard_id_collision
  BEFORE INSERT OR UPDATE OF id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_owned_id_collision();

-- 2 ---------------------------------------------------------------------------
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
        and split_part(o.name, '/', 1) not in (select prefix from foreign_prefixes)
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

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_documents_file_path_owner_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NEW.file_path IS NULL THEN
    RETURN NEW;
  END IF;
  IF split_part(NEW.file_path, '/', 1) = v_uid::text THEN
    RETURN NEW;
  END IF;
  -- Same bytes filed again by the person who already owns them.
  IF EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.file_path = NEW.file_path AND d.user_id = v_uid
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documents.file_path must be in your own storage folder'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_documents_file_path_owner_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_documents_file_path_owner_insert ON public.documents;
CREATE TRIGGER trg_documents_file_path_owner_insert
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_file_path_owner_insert();

-- 4 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_collaborator_by_email(email_address text)
RETURNS TABLE (
    user_id uuid,
    email text,
    tier text,
    can_collaborate boolean,
    reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text := lower(btrim(coalesce(email_address, '')));
    found_user_id uuid;
BEGIN
    -- Only for an address the caller has an open invite for, so this cannot
    -- be used to look up who has an account. Same answer as "no account".
    IF v_uid IS NULL OR NOT (
        EXISTS (SELECT 1 FROM public.document_invites i
                WHERE i.created_by = v_uid AND i.revoked_at IS NULL
                  AND lower(i.target_email) = v_email)
        OR EXISTS (SELECT 1 FROM public.project_invites i
                   WHERE i.created_by = v_uid AND i.revoked_at IS NULL
                     AND lower(i.target_email) = v_email)
        OR EXISTS (SELECT 1 FROM public.template_invites i
                   WHERE i.created_by = v_uid AND i.revoked_at IS NULL
                     AND lower(i.target_email) = v_email)
    ) THEN
        found_user_id := NULL;
    ELSE
        SELECT u.id INTO found_user_id
        FROM auth.users u
        WHERE lower(u.email) = v_email;
    END IF;

    IF found_user_id IS NULL THEN
        RETURN QUERY
        SELECT
            NULL::uuid,
            email_address,
            NULL::text,
            FALSE,
            'User not found. They need to create an account first.'::text;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT e.user_id, e.email, NULL::text, e.can_collaborate, e.reason
    FROM public.check_user_collaborator_eligibility(found_user_id) e;
END;
$$;

REVOKE ALL ON FUNCTION public.check_collaborator_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_collaborator_by_email(text) TO authenticated, service_role;

-- 5 ---------------------------------------------------------------------------
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
    IF p_template IN ('document-invite', 'document-shared') AND EXISTS (
        SELECT 1 FROM public.email_send_events e
        WHERE e.user_id = v_uid
          AND e.template = 'auth-invite'
          AND e.recipient = left(lower(p_recipient), 320)
          AND e.created_at > now() - interval '5 minutes'
    ) THEN
        RETURN 'allowed';
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
