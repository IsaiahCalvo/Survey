-- KAL-31 hotfix — the ambiguous-column error persisted after renaming the
-- locals because PL/pgSQL's default `#variable_conflict error` policy treats
-- the OUT parameter name `document_id` (declared in the RETURNS TABLE list)
-- as a variable in scope inside the body. Even when we write column names
-- explicitly in INSERT / ON CONFLICT clauses, PostgreSQL refuses to choose.
-- The supported fix is to flip the policy to `use_column` so inside INSERT
-- column lists and predicates the column reference always wins.

BEGIN;

CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,
    document_id      UUID,
    effective_role   TEXT,
    intended_role    TEXT,
    upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.kal31_accept_document_invite(TEXT) TO authenticated;

COMMIT;
