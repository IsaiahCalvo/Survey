-- P2-28 / P2-29 — durable Pro-trial flag + Stripe event-id idempotency.
--
-- trial_used_at survives cancel (unlike trial_ends_at, which the webhook
-- clears). processed_stripe_events is insert-first so retried webhooks do
-- not re-send billing emails.

BEGIN;

ALTER TABLE public.user_subscriptions
    ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_subscriptions.trial_used_at IS
    'Set when a Pro trial is first granted. Cancel/resubscribe must not grant another.';

-- Anyone who already started a trial (live or historical trial_ends_at) has used it.
UPDATE public.user_subscriptions
SET trial_used_at = COALESCE(trial_ends_at, NOW())
WHERE trial_used_at IS NULL
  AND (trial_ends_at IS NOT NULL OR status = 'trialing');

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
    event_id TEXT PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.processed_stripe_events IS
    'Stripe webhook event ids already applied. Insert-first guard against at-least-once delivery.';

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.processed_stripe_events FROM PUBLIC;
REVOKE ALL ON TABLE public.processed_stripe_events FROM anon, authenticated;
GRANT ALL ON TABLE public.processed_stripe_events TO service_role;

COMMIT;
