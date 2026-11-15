-- Collaborator changes go through the server (KAL-369, "Sharing").
--
-- Until now the app wrote document_collaborators and project_collaborators
-- straight from the browser, and the only rule was "you own the document or
-- project". So an owner could:
--   * add any account by its id, with any role and status 'active', without an
--     invite and on the Free plan ("Free users cannot create invites", KAL-31);
--   * give a Free account the editor or owner role on an email invite, which
--     the app only capped to viewer in the browser;
--   * rewrite a row's user_id, document_id, project_id, status, email or
--     invited_by, which hands the grant to someone else.
--
-- Now:
--   1. Nobody signed in may insert a collaborator row directly. Rows come only
--      from the server: accepting an invite (kal31_accept_*), the company sync,
--      and, for an email invite to someone who already has an account,
--      grant_document_invite_to_account below, which does the account lookup,
--      the plan rules and the insert in one place.
--   2. A signed-in owner may still change a row's role and remove a row (Manage
--      Access), and a member may still leave a project. The role is the only
--      column the browser may update.
-- Service-role callers, migrations and SECURITY DEFINER functions are not
-- affected: the policy and the column grants apply to the browser's role only.

BEGIN;

-- 1. No direct inserts --------------------------------------------------------
DROP POLICY IF EXISTS "Document owners can add collaborators" ON public.document_collaborators;
DROP POLICY IF EXISTS "Project owners can add collaborators" ON public.project_collaborators;
REVOKE INSERT ON TABLE public.document_collaborators FROM anon, authenticated;
REVOKE INSERT ON TABLE public.project_collaborators FROM anon, authenticated;

-- 2. Only the role can be updated from the browser -----------------------------
REVOKE UPDATE ON TABLE public.document_collaborators FROM anon, authenticated;
REVOKE UPDATE ON TABLE public.project_collaborators FROM anon, authenticated;
GRANT UPDATE (role) ON TABLE public.document_collaborators TO authenticated;
GRANT UPDATE (role) ON TABLE public.project_collaborators TO authenticated;

-- The two triggers that add the owner's own row when a project or document is
-- made ran as the signed-in caller, so they need to run as the server now.
-- Same bodies as before; they only write rows taken from the new project or
-- document, which the caller was just allowed to insert.
CREATE OR REPLACE FUNCTION public.add_project_owner_collaborator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.project_collaborators (project_id, user_id, role, status)
    VALUES (NEW.id, NEW.user_id, 'owner', 'active')
    ON CONFLICT (project_id, user_id) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_project_owner_collaborator() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_document_owner_collaborator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    owner_id UUID;
BEGIN
    -- The project owner is an owner of every document in the project.
    SELECT p.user_id INTO owner_id FROM public.projects p WHERE p.id = NEW.project_id;
    IF owner_id IS NOT NULL THEN
        INSERT INTO public.document_collaborators (document_id, user_id, role, status)
        VALUES (NEW.id, owner_id, 'owner', 'active')
        ON CONFLICT (document_id, user_id) DO NOTHING;
    END IF;
    -- The person who added it is an editor when that is someone else.
    IF NEW.user_id IS NOT NULL AND NEW.user_id != owner_id THEN
        INSERT INTO public.document_collaborators (document_id, user_id, role, status)
        VALUES (NEW.id, NEW.user_id, 'editor', 'active')
        ON CONFLICT (document_id, user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_document_owner_collaborator() FROM PUBLIC, anon, authenticated;

-- 3. Email invite to an existing account: grant on the server -----------------
-- The owner calls this right after creating an email invite. If the address
-- belongs to an account, that account gets access now (role capped to viewer
-- for a Free account, as on accept), and the answer says so. If not, nothing
-- changes and the invite stays pending for the link in the email.
--   { granted: true,  user_id, role }
--   { granted: false }                 no account with that address (or self)
CREATE OR REPLACE FUNCTION public.grant_document_invite_to_account(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invite public.document_invites%ROWTYPE;
  v_doc_owner uuid;
  v_target uuid;
  v_target_email text;
  v_tier text;
  v_role text;
BEGIN
  IF v_uid IS NULL OR public.is_guest_session() OR public.is_agent_session() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite FROM public.document_invites i WHERE i.id = p_invite_id;
  IF v_invite.id IS NULL OR NOT public.user_can_access_document(v_invite.document_id, 'owner') THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = '42501';
  END IF;
  IF v_invite.revoked_at IS NOT NULL OR v_invite.accepted_at IS NOT NULL
     OR v_invite.expires_at <= now() OR v_invite.target_email IS NULL THEN
    RAISE EXCEPTION 'This invite is no longer open' USING ERRCODE = '22023';
  END IF;

  -- KAL-31 locked spec: Free users cannot share (same rule as claim_email_send).
  IF public.get_user_tier(v_uid)::text = 'free' THEN
    RAISE EXCEPTION 'Sharing needs a paid plan' USING ERRCODE = '42501';
  END IF;

  SELECT u.id, u.email::text INTO v_target, v_target_email
    FROM auth.users u
   WHERE lower(u.email) = lower(btrim(v_invite.target_email))
   LIMIT 1;
  SELECT d.user_id INTO v_doc_owner FROM public.documents d WHERE d.id = v_invite.document_id;
  IF v_target IS NULL OR v_target = v_uid OR v_target = v_doc_owner THEN
    RETURN jsonb_build_object('granted', false);
  END IF;

  -- Same plan rule as kal31_accept_document_invite: a Free account (without a
  -- company seat) joins as viewer.
  SELECT COALESCE(s.tier::text, 'free') INTO v_tier
    FROM public.user_subscriptions s WHERE s.user_id = v_target LIMIT 1;
  v_tier := COALESCE(v_tier, 'free');
  IF v_tier IN ('free', 'pro') AND public._company_seated(v_target) THEN
    v_tier := 'enterprise';
  END IF;
  v_role := CASE
    WHEN v_invite.role IN ('editor', 'owner') AND v_tier = 'free' THEN 'viewer'
    WHEN v_invite.role IN ('viewer', 'editor', 'owner') THEN v_invite.role
    ELSE 'viewer'
  END;

  INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
  VALUES (v_invite.document_id, v_target, v_target_email, v_role, 'active', v_uid)
  ON CONFLICT (document_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         status = 'active',
         email = EXCLUDED.email,
         invited_by = EXCLUDED.invited_by;

  RETURN jsonb_build_object('granted', true, 'user_id', v_target, 'role', v_role);
END;
$$;
REVOKE ALL ON FUNCTION public.grant_document_invite_to_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_document_invite_to_account(uuid) TO authenticated;

COMMIT;
