-- SECURITY (2026-07-03) — fix subscription-tier self-escalation.
--
-- The base user_subscriptions policies let any authenticated user write their
-- OWN row's `tier`/`status`/`stripe_*` columns via a direct PostgREST call
-- (the UPDATE policy has USING but no column restriction; the INSERT policy
-- allows an upsert). A free user could run
--   supabase.from('user_subscriptions').update({ tier: 'enterprise', status: 'active' })
-- and unlock every paid feature — and because get_user_tier()/has_feature_access()
-- (SECURITY DEFINER, wired into the projects/documents/templates/spaces RLS
-- policies) read this same `tier` column, the forged value defeats server-side
-- enforcement too (unlimited projects/storage, SSO, Excel export, etc.).
--
-- The app only ever SELECTs this table. All legitimate writes come from either
-- the stripe-webhook edge function (service_role, which has its own policies) or
-- the handle_new_user_subscription trigger (SECURITY DEFINER). So the client
-- INSERT/UPDATE policies serve no legitimate purpose — drop them. Reads
-- ("Users can view own subscription") and the service_role billing writes are
-- unaffected.

DROP POLICY IF EXISTS "Users can insert own subscription" ON public.user_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.user_subscriptions;

COMMENT ON TABLE public.user_subscriptions IS
  'Subscription tiers + Stripe data. Client role has SELECT only; all writes go through the stripe-webhook (service_role) or the new-user trigger (SECURITY DEFINER). Do NOT re-add client INSERT/UPDATE policies (tier self-escalation).';
