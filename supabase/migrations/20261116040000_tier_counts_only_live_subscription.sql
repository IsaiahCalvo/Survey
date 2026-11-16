-- KAL-369, the tier part of the old Strix branch ("status_aware_get_user_tier").
--
-- get_user_tier read the stored tier and ignored the subscription's status, so
-- a row left at tier 'pro' with status 'incomplete' (first payment never went
-- through) or 'canceled' still counted as Pro. Now a paid tier counts only while
-- the subscription is live: active, trialing, or past_due. past_due stays paid
-- on purpose, so a card that fails once keeps Pro while Stripe retries; when
-- Stripe gives up it deletes the subscription and the webhook sets tier 'free'.
--
-- Everything else is the 20261028040000_company_billing.sql body, unchanged:
--   * the caller's own id wins whenever there is one (20261021190000), which is
--     stricter than the Strix draft and already live;
--   * a paid company seat still counts as enterprise.
--
-- Paid owner / free collaborator (the check the ticket asked for). On the live
-- database (2026-11-15) every RLS policy and function that calls get_user_tier,
-- get_storage_limit, get_document_limit, get_project_limit or
-- has_feature_access passes the caller's own id, except
-- enforce_documents_storage_quota, whose v_owner is the uploader in both
-- buckets (documents: the policy requires the caller's own folder;
-- survey-media: owner_id is the uploader). So no rule reads another account's
-- plan while someone else is signed in, and this change can't flip a free
-- collaborator's view of a paid owner's file. Live rows today: active/free 19,
-- active/pro 2, active/developer 1, canceled/free 1, so no one's plan changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
 RETURNS subscription_tier
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_tier_text TEXT;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    SELECT CASE
             WHEN status::text IN ('active', 'trialing', 'past_due') THEN tier::text
             ELSE 'free'
           END
      INTO user_tier_text
      FROM user_subscriptions
     WHERE user_id = p_user_id;

    user_tier_text := COALESCE(user_tier_text, 'free');
    IF user_tier_text IN ('free', 'pro') AND public._company_seated(p_user_id) THEN
        user_tier_text := 'enterprise';
    END IF;

    RETURN user_tier_text::subscription_tier;
END;
$function$;

COMMENT ON FUNCTION public.get_user_tier(uuid) IS
  'Caller''s own tier (any id for server callers). A paid tier counts only while the subscription is active, trialing or past_due; a paid company seat counts as enterprise.';

-- Same grants as 20261021190000: no signed-out callers.
REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated, service_role;

COMMIT;
