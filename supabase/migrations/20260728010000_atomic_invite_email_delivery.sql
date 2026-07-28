-- Atomic invite-email delivery claims.
--
-- Prevents two edge-function instances from sending the same invite
-- generation at the same time. Delivery identity is intentionally independent
-- of expires_at: refreshing an expired invite or retrying after a lost HTTP
-- response keeps the same generation and cannot send twice. Only the explicit
-- rotate RPC below creates a new user-requested delivery generation. A claimed
-- generation is never taken over automatically: after the transport may have
-- accepted a message, silence is safer than an accidental duplicate. Failed
-- transports explicitly release; crashed/uncertain sends require an owner to
-- request a new generation.

BEGIN;

ALTER TABLE public.document_invites
    ADD COLUMN email_delivery_version UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.project_invites
    ADD COLUMN email_delivery_version UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.template_invites
    ADD COLUMN email_delivery_version UUID NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE public.invite_email_deliveries (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_kind      TEXT NOT NULL
                     CHECK (invite_kind IN ('document', 'project', 'template')),
    invite_id        UUID NOT NULL,
    delivery_version UUID NOT NULL,
    state            TEXT NOT NULL DEFAULT 'claimed'
                     CHECK (state IN ('claimed', 'completed')),
    claim_id         UUID NOT NULL UNIQUE,
    claimed_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    completed_at     TIMESTAMPTZ,
    attempt_count    INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
    UNIQUE (invite_kind, invite_id, delivery_version)
);

CREATE INDEX invite_email_deliveries_claimed_idx
    ON public.invite_email_deliveries (claimed_at)
    WHERE state = 'claimed';

ALTER TABLE public.invite_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_email_deliveries FROM PUBLIC;
REVOKE ALL ON public.invite_email_deliveries FROM anon, authenticated;

-- Private authorization helper. Current ownership, not original created_by,
-- governs delivery so promoted co-owners retain the same rights as invite-row
-- RLS. The helper never accepts a recipient and cannot be used as a mail relay.
CREATE OR REPLACE FUNCTION public._can_manage_invite_email_delivery(
    p_kind TEXT,
    p_invite_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE p_kind
        WHEN 'document' THEN
            RETURN EXISTS (
                SELECT 1
                  FROM public.document_invites i
                 WHERE i.id = p_invite_id
                   AND public.user_can_access_document(i.document_id, 'owner')
            );
        WHEN 'project' THEN
            RETURN EXISTS (
                SELECT 1
                  FROM public.project_invites i
                 WHERE i.id = p_invite_id
                   AND public.user_can_access_project(i.project_id, 'owner')
            );
        WHEN 'template' THEN
            RETURN EXISTS (
                SELECT 1
                  FROM public.template_invites i
                 WHERE i.id = p_invite_id
                   AND public.user_can_access_template(i.template_id, 'owner')
            );
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_invite_email_delivery(
    p_kind TEXT,
    p_token TEXT,
    p_claim_id UUID,
    p_stale_after_seconds INTEGER DEFAULT 300
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invite_id UUID;
    v_delivery_version UUID;
    v_target_email TEXT;
    v_expires_at TIMESTAMPTZ;
    v_revoked_at TIMESTAMPTZ;
    v_accepted_at TIMESTAMPTZ;
    v_state TEXT;
    v_changed INTEGER;
BEGIN
    IF p_claim_id IS NULL OR p_token IS NULL OR p_kind NOT IN ('document', 'project', 'template') THEN
        RETURN 'error';
    END IF;

    CASE p_kind
        WHEN 'document' THEN
            SELECT i.id, i.email_delivery_version, i.target_email, i.expires_at, i.revoked_at, i.accepted_at
              INTO v_invite_id, v_delivery_version, v_target_email, v_expires_at, v_revoked_at, v_accepted_at
              FROM public.document_invites i
             WHERE i.token = p_token;
        WHEN 'project' THEN
            SELECT i.id, i.email_delivery_version, i.target_email, i.expires_at, i.revoked_at, i.accepted_at
              INTO v_invite_id, v_delivery_version, v_target_email, v_expires_at, v_revoked_at, v_accepted_at
              FROM public.project_invites i
             WHERE i.token = p_token;
        WHEN 'template' THEN
            SELECT i.id, i.email_delivery_version, i.target_email, i.expires_at, i.revoked_at, i.accepted_at
              INTO v_invite_id, v_delivery_version, v_target_email, v_expires_at, v_revoked_at, v_accepted_at
              FROM public.template_invites i
             WHERE i.token = p_token;
    END CASE;

    IF v_invite_id IS NULL
       OR v_target_email IS NULL
       OR v_revoked_at IS NOT NULL
       OR v_accepted_at IS NOT NULL
       OR v_expires_at <= clock_timestamp()
       OR NOT public._can_manage_invite_email_delivery(p_kind, v_invite_id) THEN
        RETURN 'error';
    END IF;

    INSERT INTO public.invite_email_deliveries (
        invite_kind, invite_id, delivery_version, claim_id
    )
    VALUES (p_kind, v_invite_id, v_delivery_version, p_claim_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed = 1 THEN
        RETURN 'claimed';
    END IF;

    SELECT d.state
      INTO v_state
      FROM public.invite_email_deliveries d
     WHERE d.invite_kind = p_kind
       AND d.invite_id = v_invite_id
       AND d.delivery_version = v_delivery_version;

    RETURN CASE WHEN v_state = 'completed' THEN 'completed' ELSE 'busy' END;
END;
$$;

-- A retry never calls this function. It refreshes expires_at through the
-- existing kal31_resend_* RPC while retaining email_delivery_version. The
-- caller must explicitly request a new copy to rotate this UUID.
CREATE OR REPLACE FUNCTION public.rotate_invite_email_delivery(
    p_kind TEXT,
    p_invite_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_version UUID := gen_random_uuid();
    v_expires_at TIMESTAMPTZ := clock_timestamp() + INTERVAL '7 days';
    v_changed INTEGER;
BEGIN
    IF p_kind NOT IN ('document', 'project', 'template')
       OR p_invite_id IS NULL
       OR NOT public._can_manage_invite_email_delivery(p_kind, p_invite_id) THEN
        RETURN NULL;
    END IF;

    CASE p_kind
        WHEN 'document' THEN
            UPDATE public.document_invites
               SET email_delivery_version = v_version,
                   expires_at = v_expires_at,
                   revoked_at = NULL
             WHERE id = p_invite_id
               AND accepted_at IS NULL;
        WHEN 'project' THEN
            UPDATE public.project_invites
               SET email_delivery_version = v_version,
                   expires_at = v_expires_at,
                   revoked_at = NULL
             WHERE id = p_invite_id
               AND accepted_at IS NULL;
        WHEN 'template' THEN
            UPDATE public.template_invites
               SET email_delivery_version = v_version,
                   expires_at = v_expires_at,
                   revoked_at = NULL
             WHERE id = p_invite_id
               AND accepted_at IS NULL;
    END CASE;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'deliveryVersion', v_version,
        'expiresAt', v_expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_invite_email_delivery(p_claim_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind TEXT;
    v_invite_id UUID;
    v_changed INTEGER;
BEGIN
    SELECT d.invite_kind, d.invite_id
      INTO v_kind, v_invite_id
      FROM public.invite_email_deliveries d
     WHERE d.claim_id = p_claim_id
       AND d.state = 'claimed';

    IF v_invite_id IS NULL
       OR NOT public._can_manage_invite_email_delivery(v_kind, v_invite_id) THEN
        RETURN FALSE;
    END IF;

    UPDATE public.invite_email_deliveries
       SET state = 'completed',
           completed_at = clock_timestamp()
     WHERE claim_id = p_claim_id
       AND state = 'claimed';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_invite_email_delivery(p_claim_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind TEXT;
    v_invite_id UUID;
    v_changed INTEGER;
BEGIN
    SELECT d.invite_kind, d.invite_id
      INTO v_kind, v_invite_id
      FROM public.invite_email_deliveries d
     WHERE d.claim_id = p_claim_id
       AND d.state = 'claimed';

    IF v_invite_id IS NULL
       OR NOT public._can_manage_invite_email_delivery(v_kind, v_invite_id) THEN
        RETURN FALSE;
    END IF;

    DELETE FROM public.invite_email_deliveries
     WHERE claim_id = p_claim_id
       AND state = 'claimed';
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    RETURN v_changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public._can_manage_invite_email_delivery(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_invite_email_delivery(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_invite_email_delivery(TEXT, TEXT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_invite_email_delivery(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_invite_email_delivery(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_invite_email_delivery(TEXT, TEXT, UUID, INTEGER)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rotate_invite_email_delivery(TEXT, UUID)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_invite_email_delivery(UUID)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_invite_email_delivery(UUID)
    TO authenticated, service_role;

COMMIT;
