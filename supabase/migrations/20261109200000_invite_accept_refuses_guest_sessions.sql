-- Invite links can no longer be taken by an anonymous (guest) session.
--
-- Anonymous sign-ins are on in production for guest links. An anonymous
-- session has no email, so the "is this invite for you?" check
--   LOWER(target_email) <> LOWER(caller_email)
-- compared against NULL, came out NULL (not true), and let the session
-- through. Anyone holding an invite link meant for one person could open it
-- in a private window, get a throwaway anonymous session and become a lasting
-- collaborator on that document, project or template, and the real invitee's
-- link then said "already accepted". Proven on a local copy before this fix.
--
-- Now: a guest session is always "wrong account" (a guest gets nothing that
-- outlives its guest link), and the email check uses IS DISTINCT FROM so a
-- missing email can never match.

CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token text)
 RETURNS TABLE(status text, document_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.document_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_document_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite
      FROM public.document_invites di
     WHERE di.token = invite_token
     LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid';
        document_id := NULL; effective_role := NULL; intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted';
        document_id := v_invite.document_id;
        effective_role := v_invite.accepted_role;
        intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT u.email::TEXT INTO v_caller_email FROM auth.users u WHERE u.id = auth.uid();
    IF public.is_guest_session() OR (v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) IS DISTINCT FROM LOWER(v_caller_email)) THEN
        status := 'wrong_account';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT COALESCE(s.tier, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.document_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.document_invites di
       SET accepted_at = now(),
           accepted_by = auth.uid(),
           accepted_role = v_final_role
     WHERE di.id = v_invite.id;

    status := 'accepted';
    document_id := v_invite.document_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.kal31_accept_project_invite(invite_token text)
 RETURNS TABLE(status text, project_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.project_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_project_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.project_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; project_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; project_id := v_invite.project_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF public.is_guest_session() OR (v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) IS DISTINCT FROM LOWER(v_caller_email)) THEN
        status := 'wrong_account'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.project_collaborators (project_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.project_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.project_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    project_id := v_invite.project_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.kal31_accept_template_invite(invite_token text)
 RETURNS TABLE(status text, template_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.template_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_template_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.template_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; template_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; template_id := v_invite.template_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF public.is_guest_session() OR (v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) IS DISTINCT FROM LOWER(v_caller_email)) THEN
        status := 'wrong_account'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.template_collaborators (template_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.template_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (template_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.template_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    template_id := v_invite.template_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$

;
