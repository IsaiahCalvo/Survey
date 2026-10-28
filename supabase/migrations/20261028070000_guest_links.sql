-- Guest links (Nightly, flag 'guest-links'; Drawboard Projects audit item 6).
-- A document's owner makes a link that lets someone without a Survey account
-- open that one document as a viewer or an editor until a set time. The guest
-- types a name and gets an anonymous Supabase session (is_anonymous in the
-- JWT); redeeming the link records that session as a guest of the document.
--
-- Security model (full review: /mnt/project-files/drawboard-projects/
-- guest-links-security.md):
--   * Only a hash of the link's secret is stored; the secret is shown once.
--   * A guest grant reaches ONE document, as viewer or editor, never owner,
--     and only while its link is live (not revoked, not expired): every
--     access check (user_can_access_document) reads the link each time, so
--     revoking or expiry cuts the guest off at once, Realtime included.
--   * An anonymous session cannot make anything of its own: no documents,
--     projects, templates, files, linked accounts, survey sessions, agent
--     links (restrictive policies below), and the edge functions turn it
--     away. It cannot see other people's email addresses.
--   * Only the owner makes, lists and revokes links; an anonymous session
--     never can, even on a document it can edit.

-- ---------------------------------------------------------------------------
-- Who is a guest session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_guest_session()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.is_guest_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_guest_session() TO anon, authenticated, service_role;

-- An anonymous user has no email: the profile row's token_identifier (NOT
-- NULL) falls back to the user id instead of failing the sign-in.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.users (
    id,
    user_id,
    email,
    name,
    full_name,
    avatar_url,
    token_identifier,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.id::text,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.email, NEW.id::text),
    NEW.created_at,
    NEW.updated_at
  );
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_guest_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS document_guest_links_document_idx ON public.document_guest_links (document_id);
CREATE INDEX IF NOT EXISTS document_guest_links_created_by_idx ON public.document_guest_links (created_by);

CREATE TABLE IF NOT EXISTS public.document_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.document_guest_links(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 60),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_guests_user_doc_idx ON public.document_guests (user_id, document_id);
CREATE INDEX IF NOT EXISTS document_guests_document_idx ON public.document_guests (document_id);

ALTER TABLE public.document_guest_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_guests ENABLE ROW LEVEL SECURITY;

-- Reads only; every write goes through the functions below. The secret's
-- hash is never readable.
REVOKE ALL ON TABLE public.document_guest_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.document_guests FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, document_id, created_by, role, expires_at, revoked_at, created_at, last_used_at, use_count)
  ON public.document_guest_links TO authenticated;
GRANT SELECT ON public.document_guests TO authenticated;
GRANT ALL ON public.document_guest_links, public.document_guests TO service_role;

DROP POLICY IF EXISTS document_guest_links_owner_read ON public.document_guest_links;
CREATE POLICY document_guest_links_owner_read ON public.document_guest_links
  FOR SELECT TO authenticated
  USING (NOT public.is_guest_session() AND public.user_can_access_document(document_id, 'owner'));

-- The owner sees who came in; a guest sees only their own row.
DROP POLICY IF EXISTS document_guests_read ON public.document_guests;
CREATE POLICY document_guests_read ON public.document_guests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (NOT public.is_guest_session() AND public.user_can_access_document(document_id, 'owner')));

-- ---------------------------------------------------------------------------
-- Access: a live guest grant counts as viewer or editor of its one document
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    doc_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    SELECT user_id, project_id, user_archived_at
      INTO doc_owner_id, doc_project_id, doc_archived_at
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- KAL-426: an archived document exists only for its permanent owner.
    IF doc_archived_at IS NOT NULL THEN
        RETURN doc_owner_id = auth.uid();
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id AND user_id = auth.uid() AND status = 'active';

        IF user_role IS NULL THEN
            SELECT 'owner' INTO user_role
              FROM public.projects
             WHERE id = doc_project_id AND user_id = auth.uid();
        END IF;
    END IF;

    -- Guest links: the best live grant on this document (never 'owner').
    IF user_role IS NULL THEN
        SELECT l.role INTO user_role
          FROM public.document_guests g
          JOIN public.document_guest_links l ON l.id = g.link_id
         WHERE g.document_id = doc_id
           AND g.user_id = auth.uid()
           AND l.document_id = doc_id
           AND l.revoked_at IS NULL
           AND l.expires_at > now()
         ORDER BY (l.role = 'editor') DESC
         LIMIT 1;
    END IF;

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN CASE required_role
        WHEN 'viewer' THEN user_role IN ('viewer', 'editor', 'owner')
        WHEN 'editor' THEN user_role IN ('editor', 'owner')
        WHEN 'owner'  THEN user_role = 'owner'
        ELSE FALSE
    END;
END;
$$;

-- The role the document screen shows controls for: a live guest grant
-- reports 'viewer' or 'editor', same as the access check above.
CREATE OR REPLACE FUNCTION public.get_my_document_role(doc_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    doc_archived_at TIMESTAMPTZ;
    user_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT user_id, project_id, user_archived_at
      INTO doc_owner_id, doc_project_id, doc_archived_at
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- KAL-426: while archived only the permanent owner has any role at all.
    IF doc_archived_at IS NOT NULL THEN
        RETURN CASE WHEN doc_owner_id = auth.uid() THEN 'owner' ELSE NULL END;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN 'owner';
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id AND user_id = auth.uid() AND status = 'active';

    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id AND user_id = auth.uid() AND status = 'active';

        IF user_role IS NULL THEN
            SELECT 'owner' INTO user_role
              FROM public.projects
             WHERE id = doc_project_id AND user_id = auth.uid();
        END IF;
    END IF;

    -- Guest links: the best live grant on this document (never 'owner').
    IF user_role IS NULL THEN
        SELECT l.role INTO user_role
          FROM public.document_guests g
          JOIN public.document_guest_links l ON l.id = g.link_id
         WHERE g.document_id = doc_id
           AND g.user_id = auth.uid()
           AND l.document_id = doc_id
           AND l.revoked_at IS NULL
           AND l.expires_at > now()
         ORDER BY (l.role = 'editor') DESC
         LIMIT 1;
    END IF;

    RETURN user_role;
END;
$$;

-- True when the caller reaches the document only through a guest link (not
-- its owner, a collaborator or on its project).
CREATE OR REPLACE FUNCTION public.document_access_is_guest_only(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.documents d
     WHERE d.id = p_document_id
       AND (
         d.user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.document_collaborators c
                     WHERE c.document_id = d.id AND c.user_id = auth.uid() AND c.status = 'active')
         OR (d.project_id IS NOT NULL AND (
              EXISTS (SELECT 1 FROM public.project_collaborators pc
                       WHERE pc.project_id = d.project_id AND pc.user_id = auth.uid() AND pc.status = 'active')
              OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = d.project_id AND p.user_id = auth.uid())))
       )
  );
$$;

REVOKE ALL ON FUNCTION public.document_access_is_guest_only(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_access_is_guest_only(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Make, revoke and redeem links
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_guest_link(p_document_id uuid, p_role text, p_expires_in text)
RETURNS TABLE (id uuid, token text, role text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_interval interval;
  v_token text;
  v_row public.document_guest_links;
BEGIN
  IF v_uid IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'owner') THEN
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('viewer', 'editor') THEN
    RAISE EXCEPTION 'A guest is a viewer or an editor' USING ERRCODE = '22023';
  END IF;
  v_interval := CASE p_expires_in
    WHEN '4 hours' THEN interval '4 hours'
    WHEN '1 day' THEN interval '1 day'
    WHEN '1 week' THEN interval '7 days'
    WHEN '1 month' THEN interval '1 month'
    WHEN '2 months' THEN interval '2 months'
    WHEN '6 months' THEN interval '6 months'
  END;
  IF v_interval IS NULL THEN
    RAISE EXCEPTION 'Pick how long the link works' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.document_guest_links l
       WHERE l.document_id = p_document_id AND l.revoked_at IS NULL AND l.expires_at > now()) >= 20 THEN
    RAISE EXCEPTION 'This document has 20 live guest links; turn one off first' USING ERRCODE = '22023';
  END IF;
  -- 244 random bits; only its SHA-256 is kept.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO public.document_guest_links (document_id, created_by, role, token_hash, expires_at)
  VALUES (p_document_id, v_uid, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), now() + v_interval)
  RETURNING * INTO v_row;
  RETURN QUERY SELECT v_row.id, v_token, v_row.role, v_row.expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_guest_link(p_link_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT document_id INTO v_doc FROM public.document_guest_links WHERE id = p_link_id;
  IF v_doc IS NULL OR NOT public.user_can_access_document(v_doc, 'owner') THEN
    RAISE EXCEPTION 'Link not found' USING ERRCODE = '42501';
  END IF;
  UPDATE public.document_guest_links SET revoked_at = now() WHERE id = p_link_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

-- The guest's side: a signed-in session (usually anonymous) hands over the
-- link's secret and a name. Same answer for an unknown, revoked or expired
-- link, so the call says nothing about which links exist.
CREATE OR REPLACE FUNCTION public.redeem_guest_link(p_token text, p_name text)
RETURNS TABLE (document_id uuid, document_name text, role text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_link public.document_guest_links;
  v_name text := btrim(regexp_replace(COALESCE(p_name, ''), '[[:cntrl:]]', '', 'g'));
BEGIN
  IF v_uid IS NULL OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Type a name of 1 to 60 letters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_link FROM public.document_guest_links l
   WHERE l.token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex')
     AND l.revoked_at IS NULL
     AND l.expires_at > now()
   FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'This guest link has ended or was turned off' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.document_guests g WHERE g.link_id = v_link.id AND g.user_id <> v_uid) >= 50 THEN
    RAISE EXCEPTION 'This guest link is full' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.document_guests (link_id, document_id, user_id, display_name)
  VALUES (v_link.id, v_link.document_id, v_uid, v_name)
  ON CONFLICT (link_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  UPDATE public.document_guest_links SET use_count = use_count + 1, last_used_at = now() WHERE id = v_link.id;
  RETURN QUERY
  SELECT d.id, d.name::text, v_link.role, v_link.expires_at FROM public.documents d WHERE d.id = v_link.document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_guest_link(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_guest_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_guest_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_guest_link(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_guest_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_guest_link(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- An anonymous session makes nothing of its own
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('public', 'documents', 'INSERT'), ('public', 'documents', 'UPDATE'), ('public', 'documents', 'DELETE'),
    ('public', 'projects', 'INSERT'), ('public', 'projects', 'UPDATE'), ('public', 'projects', 'DELETE'),
    ('public', 'templates', 'INSERT'), ('public', 'templates', 'UPDATE'), ('public', 'templates', 'DELETE'),
    ('public', 'spaces', 'INSERT'), ('public', 'spaces', 'UPDATE'), ('public', 'spaces', 'DELETE'),
    ('public', 'document_templates', 'INSERT'), ('public', 'document_templates', 'DELETE'),
    ('public', 'document_collaborators', 'INSERT'), ('public', 'document_collaborators', 'UPDATE'), ('public', 'document_collaborators', 'DELETE'),
    ('public', 'document_invites', 'INSERT'), ('public', 'document_invites', 'UPDATE'),
    ('public', 'document_revisions', 'INSERT'),
    ('public', 'connected_services', 'INSERT'), ('public', 'connected_services', 'UPDATE'),
    ('public', 'survey_sessions', 'INSERT'), ('public', 'survey_sessions', 'UPDATE'),
    ('public', 'survey_items', 'INSERT'), ('public', 'survey_items', 'UPDATE'),
    ('public', 'excel_schema_mapping', 'INSERT'), ('public', 'excel_schema_mapping', 'UPDATE'),
    ('public', 'survey_agent_voice_logs', 'INSERT'),
    ('public', 'mark_library_items', 'INSERT'), ('public', 'mark_library_items', 'UPDATE'), ('public', 'mark_library_items', 'DELETE'),
    ('storage', 'objects', 'INSERT'), ('storage', 'objects', 'UPDATE'), ('storage', 'objects', 'DELETE')
  ) AS v(s, tbl, cmd)
  LOOP
    IF to_regclass(format('%I.%I', t.s, t.tbl)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'Guests cannot ' || lower(t.cmd), t.s, t.tbl);
    IF t.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_guest_session())',
        'Guests cannot ' || lower(t.cmd), t.s, t.tbl);
    ELSIF t.cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_guest_session()) WITH CHECK (NOT public.is_guest_session())',
        'Guests cannot ' || lower(t.cmd), t.s, t.tbl);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_guest_session())',
        'Guests cannot ' || lower(t.cmd), t.s, t.tbl);
    END IF;
  END LOOP;
END;
$$;

-- Company workspaces are written only through SECURITY DEFINER functions,
-- which skip row rules, so a trigger refuses a guest session there instead:
-- a guest cannot make a company, invite people or add a sign-in domain.
CREATE OR REPLACE FUNCTION public.refuse_guest_session_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF public.is_guest_session() THEN
    RAISE EXCEPTION 'Guests cannot do that' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_guest_session_write() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'organization_members', 'organization_invites', 'organization_domains'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS refuse_guest_session_write ON public.%I', t);
    EXECUTE format('CREATE TRIGGER refuse_guest_session_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.refuse_guest_session_write()', t);
  END LOOP;
END;
$$;

-- No agent links or agent consent for a guest session.
DROP POLICY IF EXISTS "Guests cannot manage agent links" ON public.agent_links;
CREATE POLICY "Guests cannot manage agent links" ON public.agent_links
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_guest_session()) WITH CHECK (NOT public.is_guest_session());

-- Other people's email addresses: a guest sees only their own collaborator row.
DROP POLICY IF EXISTS "Guests see only themselves" ON public.document_collaborators;
CREATE POLICY "Guests see only themselves" ON public.document_collaborators
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.is_guest_session() OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.approve_agent_link(p_user_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF public.is_agent_session() THEN
    RAISE EXCEPTION 'agents cannot approve agents' USING ERRCODE = '42501';
  END IF;
  IF public.is_guest_session() THEN
    RAISE EXCEPTION 'guests cannot link agents' USING ERRCODE = '42501';
  END IF;
  UPDATE public.agent_links
     SET user_id = auth.uid(), status = 'approved', approved_at = now()
   WHERE user_code = upper(trim(p_user_code))
     AND status = 'pending'
     AND user_id IS NULL
     AND code_expires_at > now()
  RETURNING agent_name INTO v_name;
  RETURN v_name;
END;
$$;

-- A guest gets no lasting template access from the document (it would
-- outlive the link): the survey panel's templates stay with the team.
CREATE OR REPLACE FUNCTION public.claim_document_templates(p_document_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role  TEXT;
    v_email TEXT;
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'claim_document_templates: must be authenticated';
    END IF;

    -- Reached only through a guest link: nothing that outlives the link.
    IF public.is_guest_session() OR public.document_access_is_guest_only(p_document_id) THEN
        RETURN 0;
    END IF;

    IF public.user_can_access_document(p_document_id, 'editor') THEN
        v_role := 'editor';
    ELSIF public.user_can_access_document(p_document_id, 'viewer') THEN
        v_role := 'viewer';
    ELSE
        RETURN 0;
    END IF;

    SELECT email::TEXT INTO v_email FROM auth.users WHERE id = auth.uid();

    INSERT INTO public.template_collaborators (template_id, user_id, email, role, status, invited_by)
    SELECT dt.template_id, auth.uid(), v_email, v_role, 'active', dt.linked_by
      FROM public.document_templates dt
      JOIN public.templates t ON t.id = dt.template_id
     WHERE dt.document_id = p_document_id
       AND t.user_id = dt.linked_by          -- the linker still owns it
       AND t.user_id <> auth.uid()
       AND t.user_archived_at IS NULL
    ON CONFLICT (template_id, user_id) DO UPDATE
       SET role = 'editor'
     WHERE public.template_collaborators.status = 'active'
       AND public.template_collaborators.role = 'viewer'
       AND EXCLUDED.role = 'editor';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- No address-book lookups from a guest session.
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
    IF public.is_guest_session() THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;

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

-- The owner's name for the document header; a guest does not get the email.
CREATE OR REPLACE FUNCTION public.get_document_owner_profile(doc_id UUID)
RETURNS TABLE (user_id UUID, name TEXT, email TEXT)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.user_can_access_document(doc_id, 'viewer') THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT u.id,
           NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::TEXT,
           CASE WHEN public.is_guest_session() THEN NULL ELSE u.email::TEXT END
      FROM public.documents d
      JOIN auth.users u ON u.id = d.user_id
     WHERE d.id = doc_id;
END;
$$;

-- Comment authors include guests (by the name they typed, marked guest);
-- a guest sees names only. Guests are never @mention targets (no email).
DROP FUNCTION IF EXISTS public.mark_comment_people(uuid);
CREATE FUNCTION public.mark_comment_people(p_document_id uuid)
RETURNS TABLE (user_id uuid, name text, email text, guest boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_guest_caller boolean := public.is_guest_session();
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_document(p_document_id, 'viewer') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH d AS (SELECT id, user_id, project_id FROM public.documents WHERE id = p_document_id),
  people AS (
    SELECT d.user_id AS uid FROM d
    UNION SELECT c.user_id FROM public.document_collaborators c, d
     WHERE c.document_id = d.id AND c.status = 'active' AND c.user_id IS NOT NULL
    UNION SELECT pc.user_id FROM public.project_collaborators pc, d
     WHERE d.project_id IS NOT NULL AND pc.project_id = d.project_id AND pc.status = 'active' AND pc.user_id IS NOT NULL
    UNION SELECT p.user_id FROM public.projects p, d WHERE d.project_id IS NOT NULL AND p.id = d.project_id
  ),
  guests AS (
    SELECT DISTINCT ON (g.user_id) g.user_id AS uid, g.display_name
      FROM public.document_guests g, d
     WHERE g.document_id = d.id AND g.user_id NOT IN (SELECT uid FROM people)
     ORDER BY g.user_id, g.joined_at DESC
  )
  SELECT u.id,
         NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::text,
         CASE WHEN v_guest_caller THEN NULL ELSE u.email::text END,
         false
    FROM people
    JOIN auth.users u ON u.id = people.uid
  UNION ALL
  SELECT guests.uid, guests.display_name, NULL::text, true FROM guests
   ORDER BY 4, 2 NULLS LAST, 3;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_comment_people(uuid) TO authenticated, service_role;

-- Survey Nightly lets in anyone holding a live guest link, signed in or not
-- (every guest link is made on Nightly, by a tester). A guest session can
-- reach only its linked documents; an account holder gets Nightly's beta
-- tools while the link is live.
CREATE OR REPLACE FUNCTION public.can_use_nightly()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND NOT public.is_agent_session()
     AND (
       EXISTS (SELECT 1 FROM public.feature_flag_admins a WHERE a.user_id = auth.uid())
       OR EXISTS (
         SELECT 1 FROM public.feature_flags f
          WHERE COALESCE(lower(auth.jwt() ->> 'email'), '') <> ''
            AND lower(auth.jwt() ->> 'email') = ANY (f.tester_emails)
       )
       OR EXISTS (
         SELECT 1 FROM public.document_guests g
           JOIN public.document_guest_links l ON l.id = g.link_id
          WHERE g.user_id = auth.uid() AND l.revoked_at IS NULL AND l.expires_at > now()
       )
     );
$$;

-- Flag row (beta: Survey Nightly only).
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('guest-links', 'off', 'Guest links: open one document without an account, as viewer or editor, until a set time.')
ON CONFLICT (key) DO NOTHING;
