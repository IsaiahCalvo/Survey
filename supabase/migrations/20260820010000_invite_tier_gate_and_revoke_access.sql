-- P2-01 / P2-05 — server-side invite paywall + revoke actually drops access.
--
-- P2-01: free-tier sharing was UI-only (ShareModal disabled buttons). Direct
-- PostgREST inserts and send-invite-email Branch A (inviteUserByEmail via
-- service role) never consulted get_user_tier. Add a BEFORE INSERT trigger on
-- all three invite tables plus a matching RLS WITH CHECK so a free-tier JWT
-- cannot mint a row. auth.uid() IS NULL is left open so service-role /
-- superuser fixtures and migrations still seed.
--
-- P2-05: kal31_revoke_document_invite only stamped revoked_at. Existing-account
-- invites grant document_collaborators immediately; a later Revoke left that
-- grant in place. Revoke now deletes the matching active collaborator row
-- (never the document creator) in the same function.

BEGIN;

CREATE OR REPLACE FUNCTION public.kal31_guard_invite_creator_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Service-role / superuser / migration seeds have no JWT.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    IF COALESCE(public.get_user_tier(auth.uid())::text, 'free') = 'free' THEN
        RAISE EXCEPTION 'Sharing invites require a Pro subscription'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.kal31_guard_invite_creator_tier() IS
  'P2-01: free-tier JWT cannot INSERT document/project/template invites. Mirrors claim_email_send + ShareModal paid-tier gate.';

DROP TRIGGER IF EXISTS document_invites_paid_tier_insert ON public.document_invites;
CREATE TRIGGER document_invites_paid_tier_insert
    BEFORE INSERT ON public.document_invites
    FOR EACH ROW
    EXECUTE FUNCTION public.kal31_guard_invite_creator_tier();

DROP TRIGGER IF EXISTS project_invites_paid_tier_insert ON public.project_invites;
CREATE TRIGGER project_invites_paid_tier_insert
    BEFORE INSERT ON public.project_invites
    FOR EACH ROW
    EXECUTE FUNCTION public.kal31_guard_invite_creator_tier();

DROP TRIGGER IF EXISTS template_invites_paid_tier_insert ON public.template_invites;
CREATE TRIGGER template_invites_paid_tier_insert
    BEFORE INSERT ON public.template_invites
    FOR EACH ROW
    EXECUTE FUNCTION public.kal31_guard_invite_creator_tier();

DROP POLICY IF EXISTS document_invites_owner_insert ON public.document_invites;
CREATE POLICY document_invites_owner_insert
    ON public.document_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_document(document_id, 'owner')
        AND created_by = auth.uid()
        AND COALESCE(public.get_user_tier(auth.uid())::text, 'free') <> 'free'
    );

DROP POLICY IF EXISTS project_invites_owner_insert ON public.project_invites;
CREATE POLICY project_invites_owner_insert
    ON public.project_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_project(project_id, 'owner')
        AND created_by = auth.uid()
        AND COALESCE(public.get_user_tier(auth.uid())::text, 'free') <> 'free'
    );

DROP POLICY IF EXISTS template_invites_owner_insert ON public.template_invites;
CREATE POLICY template_invites_owner_insert
    ON public.template_invites FOR INSERT
    WITH CHECK (
        public.user_can_access_template(template_id, 'owner')
        AND created_by = auth.uid()
        AND COALESCE(public.get_user_tier(auth.uid())::text, 'free') <> 'free'
    );

CREATE OR REPLACE FUNCTION public.kal31_revoke_document_invite(invite_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    invite_row public.document_invites%ROWTYPE;
    owner_id UUID;
BEGIN
    SELECT * INTO invite_row FROM public.document_invites WHERE id = invite_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF NOT public.user_can_access_document(invite_row.document_id, 'owner') THEN
        RAISE EXCEPTION 'kal31_revoke_document_invite: only owners can revoke';
    END IF;

    UPDATE public.document_invites
       SET revoked_at = now()
     WHERE id = invite_id AND accepted_at IS NULL;

    -- Drop the immediate grant the create path upserts for existing accounts.
    -- Never remove the document creator even if their email matches.
    SELECT d.user_id INTO owner_id
      FROM public.documents d
     WHERE d.id = invite_row.document_id;

    IF invite_row.target_email IS NOT NULL THEN
        DELETE FROM public.document_collaborators dc
         WHERE dc.document_id = invite_row.document_id
           AND dc.status = 'active'
           AND LOWER(dc.email) = LOWER(invite_row.target_email)
           AND (owner_id IS NULL OR dc.user_id IS DISTINCT FROM owner_id);
    END IF;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.kal31_revoke_document_invite(UUID) IS
  'KAL-31 / P2-05: stamp revoked_at on a pending invite and delete the matching active document_collaborators grant (never the document creator).';

COMMIT;
