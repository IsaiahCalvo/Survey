-- Step 1: Check current status
SELECT
    u.email,
    s.tier,
    s.status,
    s.stripe_subscription_id,
    s.trial_ends_at,
    s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';

-- Step 2: Sync the active trial from Stripe
-- Based on webhook logs: subscription ID is sub_1ShmjOJrLcKBpjdDdgyPlIpV
-- Trial end: 1767167017 (Unix timestamp = 2024-12-30 22:16:57 UTC)

UPDATE user_subscriptions
SET
    tier = 'pro',
    status = 'trialing',
    stripe_subscription_id = 'sub_1ShmjOJrLcKBpjdDdgyPlIpV',
    stripe_customer_id = 'cus_Tf5Eiu0s5tm6jq',
    stripe_price_id = 'price_1ShkVfJrLcKBpjdDwf84s29l',
    trial_ends_at = to_timestamp(1767167017),
    current_period_start = NOW(),
    current_period_end = to_timestamp(1767167017),
    updated_at = NOW()
WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'isaiahcalvo0@gmail.com'
);

-- Step 3: Verify it worked
SELECT
    u.email,
    s.tier,
    s.status,
    s.trial_ends_at,
    EXTRACT(DAY FROM (s.trial_ends_at - NOW())) as days_remaining,
    s.stripe_subscription_id,
    s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
