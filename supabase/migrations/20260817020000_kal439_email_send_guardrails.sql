-- KAL-439 — send-email guardrails: per-user rate limit + free-tier invite gate.
--
-- The send-email edge function was an authenticated open relay: any signed-in
-- user could send arbitrary {to, subject, template} through our domain. The
-- function now enforces a template allowlist and recipient binding
-- (supabase/functions/send-email/policy.js); this migration supplies the two
-- guards that need database state, combined in ONE atomic SECURITY DEFINER
-- RPC so parallel edge instances cannot race past the cap:
--   * a per-user rolling-hour send cap (30/hour — generous for bulk team
--     invites, useless for spam);
--   * the KAL-31 locked-spec rule "Free users cannot create invites",
--     previously enforced only in the UI, applied to invite-class templates.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_send_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    template TEXT NOT NULL,
    recipient TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_send_events_user_created
    ON public.email_send_events (user_id, created_at DESC);

-- RLS on with NO policies: only the SECURITY DEFINER RPC below may touch the
-- table. Clients cannot read other users' recipients or forge send history.
ALTER TABLE public.email_send_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_send_events FROM PUBLIC;
REVOKE ALL ON TABLE public.email_send_events FROM anon, authenticated;
GRANT ALL ON TABLE public.email_send_events TO service_role;

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

    -- KAL-31 locked spec: free users cannot create invites. Enforced here so
    -- a direct function call cannot dodge the UI gate.
    IF p_is_invite AND public.get_user_tier(v_uid)::text = 'free' THEN
        RETURN 'invite_blocked_free_tier';
    END IF;

    -- Rolling-hour cap. The count+insert pair runs inside one function call;
    -- worst-case interleaving overshoots by a handful, never unbounded.
    SELECT COUNT(*) INTO v_recent
    FROM public.email_send_events
    WHERE user_id = v_uid
      AND created_at > now() - interval '1 hour';
    IF v_recent >= 30 THEN
        RETURN 'rate_limited';
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

COMMENT ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) IS
  'KAL-439: atomic send-budget claim for the send-email edge function — free-tier invite gate + 30/hour per-user rate limit. Returns allowed | rate_limited | invite_blocked_free_tier | error.';

REVOKE ALL ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_email_send(TEXT, TEXT, BOOLEAN) FROM anon;

COMMIT;
