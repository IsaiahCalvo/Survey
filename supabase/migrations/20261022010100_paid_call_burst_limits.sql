-- Backend pass: short-window limits on the edge functions that cost money.
--
-- 1. survey-agent (Groq): each person already had monthly request and cost
--    caps, but nothing stopped one person spending the shared provider rate
--    limit in a burst. reserve_survey_agent_request now also allows at most
--    20 requests per person per minute (a spoken turn is about two).
-- 2. send-profile-change-notification (Brevo) had no limit, so one account
--    could spend the whole daily email quota and block everyone's invites.
--    It now claims from the same per-person email ledger as send-email
--    (claim_email_send, 30 an hour), and profile-change notices alone are
--    capped at 5 an hour.
BEGIN;

ALTER TABLE public.survey_agent_usage
  ADD COLUMN IF NOT EXISTS minute_start timestamptz,
  ADD COLUMN IF NOT EXISTS minute_requests integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.reserve_survey_agent_request(
  p_user_id uuid,
  p_request_cap integer,
  p_cost_cap_micros bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_cap < 1 OR p_cost_cap_micros < 1 THEN
    RETURN false;
  END IF;
  INSERT INTO public.survey_agent_usage AS u (user_id, month, requests, minute_start, minute_requests)
  VALUES (p_user_id, date_trunc('month', now())::date, 1, now(), 1)
  ON CONFLICT (user_id, month) DO UPDATE SET
    requests = u.requests + 1,
    minute_start = CASE WHEN u.minute_start > now() - interval '1 minute' THEN u.minute_start ELSE now() END,
    minute_requests = CASE WHEN u.minute_start > now() - interval '1 minute' THEN u.minute_requests + 1 ELSE 1 END,
    updated_at = now()
  WHERE u.requests < p_request_cap
    AND u.cost_micros < p_cost_cap_micros
    AND (u.minute_start IS NULL OR u.minute_start <= now() - interval '1 minute' OR u.minute_requests < 20);
  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_survey_agent_request(uuid, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_survey_agent_request(uuid, integer, bigint) TO service_role;

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
