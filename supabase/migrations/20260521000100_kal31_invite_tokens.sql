-- KAL-31 — Phase B
-- Invite tokens table + acceptance RPC + RLS.
--
-- Two flavors of invite are modeled by `target_email`:
--   * If `target_email IS NULL` -> link-only invite, any signed-in user holding
--     the link may accept (acceptance still required, not anonymous access).
--   * If `target_email IS NOT NULL` -> email-bound invite. Acceptance requires
--     the signed-in account email to match `target_email` (case-insensitive).
--
-- Tokens expire after 7 days (locked spec). Owners may revoke. Resending an
-- email invite refreshes the 7-day window (handled at the RPC layer below).

BEGIN;

CREATE TABLE IF NOT EXISTS public.document_invites (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    token          TEXT NOT NULL UNIQUE,             -- url-safe random token
    role           TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    target_email   TEXT,                            -- NULL means link-only
    intended_role  TEXT NOT NULL CHECK (intended_role IN ('viewer', 'editor', 'owner')),
    created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    accepted_by    UUID REFERENCES auth.users(id),
    accepted_role  TEXT CHECK (accepted_role IN ('viewer', 'editor', 'owner'))
);

CREATE INDEX IF NOT EXISTS idx_document_invites_document_id ON public.document_invites(document_id);
CREATE INDEX IF NOT EXISTS idx_document_invites_token       ON public.document_invites(token);
CREATE INDEX IF NOT EXISTS idx_document_invites_target_email ON public.document_invites(target_email);

ALTER TABLE public.document_invites ENABLE ROW LEVEL SECURITY;

-- Owners of the document can list invites for their document.
DROP POLICY IF EXISTS document_invites_owner_select ON public.document_invites;
CREATE POLICY document_invites_owner_select
    ON public.document_invites FOR SELECT
    USING (
        public.user_can_access_document(document_id, 'owner')
    );

-- Owners can create invites for documents they own.
DROP POLICY IF EXISTS document_invites_owner_insert ON public.document_invites;
CREATE POLICY document_invites_owner_insert
    ON public.document_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_document(document_id, 'owner')
        AND created_by = auth.uid()
    );

-- Owners can update (revoke / resend) invites for their documents.
DROP POLICY IF EXISTS document_invites_owner_update ON public.document_invites;
CREATE POLICY document_invites_owner_update
    ON public.document_invites FOR UPDATE
    USING (public.user_can_access_document(document_id, 'owner'))
    WITH CHECK (public.user_can_access_document(document_id, 'owner'));

-- ---------------------------------------------------------------------------
-- Acceptance RPC: validates token, applies effective role, returns next state.
-- ---------------------------------------------------------------------------
-- effective_role rules (locked spec):
--   * Free user accepting viewer        -> viewer
--   * Free user accepting editor/owner  -> viewer, intended role preserved
--   * Paid user accepting editor/owner  -> editor/owner directly
-- Tier is read from subscriptions.tier; default 'free'.

CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,         -- accepted | wrong_account | invalid | expired | revoked | already_accepted
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

    -- Wrong-account check on email-bound invites.
    SELECT email::TEXT INTO caller_email FROM auth.users WHERE id = auth.uid();
    IF invite_row.target_email IS NOT NULL AND LOWER(invite_row.target_email) <> LOWER(caller_email) THEN
        status := 'wrong_account';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    -- Tier-based downgrade for free users.
    SELECT COALESCE(s.tier, 'free') INTO caller_tier
      FROM public.subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    caller_tier := COALESCE(caller_tier, 'free');

    IF invite_row.intended_role IN ('editor', 'owner') AND caller_tier = 'free' THEN
        final_role := 'viewer';
        needs_upgrade := TRUE;
    ELSE
        final_role := invite_row.intended_role;
    END IF;

    -- Upsert collaborator row.
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

COMMENT ON FUNCTION public.kal31_accept_document_invite(TEXT) IS
  'KAL-31 — Acceptance RPC. Returns accepted | wrong_account | invalid | expired | revoked | already_accepted. Free-user editor/owner intents downgrade to viewer with upgrade_required=true.';

-- Resend RPC: refresh the 7-day expiration window for a pending email invite.
CREATE OR REPLACE FUNCTION public.kal31_resend_document_invite(invite_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    invite_row public.document_invites%ROWTYPE;
    new_expiry TIMESTAMPTZ;
BEGIN
    SELECT * INTO invite_row FROM public.document_invites WHERE id = invite_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'kal31_resend_document_invite: invite not found';
    END IF;
    IF NOT public.user_can_access_document(invite_row.document_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_resend_document_invite: only owners can resend';
    END IF;
    IF invite_row.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'kal31_resend_document_invite: invite already accepted';
    END IF;
    new_expiry := now() + INTERVAL '7 days';
    UPDATE public.document_invites
       SET expires_at = new_expiry,
           revoked_at = NULL
     WHERE id = invite_id;
    RETURN new_expiry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_resend_document_invite(UUID) TO authenticated;

-- Revoke RPC.
CREATE OR REPLACE FUNCTION public.kal31_revoke_document_invite(invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    invite_row public.document_invites%ROWTYPE;
BEGIN
    SELECT * INTO invite_row FROM public.document_invites WHERE id = invite_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF NOT public.user_can_access_document(invite_row.document_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_revoke_document_invite: only owners can revoke';
    END IF;
    UPDATE public.document_invites
       SET revoked_at = now()
     WHERE id = invite_id AND accepted_at IS NULL;
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_revoke_document_invite(UUID) TO authenticated;

COMMIT;
