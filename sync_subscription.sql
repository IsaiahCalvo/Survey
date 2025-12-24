-- Manually sync the subscription from Stripe to Supabase
UPDATE user_subscriptions
SET
    tier = 'pro',
    status = 'trialing',
    stripe_subscription_id = 'sub_1Shl5wJrLcKBpjdDMLpI0dKk',
    stripe_price_id = 'price_1ShkVfJrLcKBpjdDwf84s29l',
    trial_ends_at = '2024-12-30 22:25:27+00',
    current_period_start = '2024-12-23 22:25:27+00',
    current_period_end = '2024-12-30 22:25:27+00'
WHERE stripe_customer_id = 'cus_Tf5Eiu0s5tm6jq';

-- Verify it worked
SELECT
    u.email,
    s.tier,
    s.status,
    s.trial_ends_at,
    s.current_period_end,
    s.stripe_customer_id,
    s.stripe_subscription_id
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
