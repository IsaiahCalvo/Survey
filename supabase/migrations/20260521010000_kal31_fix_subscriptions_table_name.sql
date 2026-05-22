-- KAL-31 Phase F hotfix — the acceptance RPC was reading from `subscriptions`
-- but the real app table is `user_subscriptions`. Without this fix every
-- caller falls back to 'free' (the COALESCE default) and free-tier downgrade
-- still works correctly by accident — but paid users were also downgraded
-- to viewer, which violates the locked spec.

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
DECLARE
    invite_row     public.document_invites%ROWTYPE;
    caller_email   TEXT;
    caller_tier    TEXT;
    final_role     TEXT;
    needs_upgrade  BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_document_invite: must be authenticated';
    END IF;

    SELECT * INTO invite_row
      FROM public.document_invites
     WHERE token = invite_token
     LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid';
        document_id := NULL; effective_role := NULL; intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF invite_row.revoked_at IS NOT NULL THEN
        status := 'revoked';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF invite_row.expires_at < now() THEN
        status := 'expired';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF invite_row.accepted_at IS NOT NULL THEN
        status := 'already_accepted';
        document_id := invite_row.document_id;
        effective_role := invite_row.accepted_role;
        intended_role := invite_row.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT email::TEXT INTO caller_email FROM auth.users WHERE id = auth.uid();
    IF invite_row.target_email IS NOT NULL AND LOWER(invite_row.target_email) <> LOWER(caller_email) THEN
        status := 'wrong_account';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    -- FIX: read from user_subscriptions, not subscriptions.
    SELECT COALESCE(s.tier, 'free') INTO caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    caller_tier := COALESCE(caller_tier, 'free');

    IF invite_row.intended_role IN ('editor', 'owner') AND caller_tier = 'free' THEN
        final_role := 'viewer';
        needs_upgrade := TRUE;
    ELSE
        final_role := invite_row.intended_role;
    END IF;

    INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
    VALUES (invite_row.document_id, auth.uid(), caller_email, final_role, 'active', invite_row.created_by)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.document_invites
       SET accepted_at = now(),
           accepted_by = auth.uid(),
           accepted_role = final_role
     WHERE id = invite_row.id;

    status := 'accepted';
    document_id := invite_row.document_id;
    effective_role := final_role;
    intended_role := invite_row.intended_role;
    upgrade_required := needs_upgrade;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_accept_document_invite(TEXT) TO authenticated;

COMMIT;
