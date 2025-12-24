-- Manually sync the canceled subscription from Stripe to Supabase
-- Run this in Supabase SQL Editor

-- First, check current status
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

-- Update to canceled/free tier
UPDATE user_subscriptions
SET
    tier = 'free',
    status = 'canceled',
    stripe_subscription_id = NULL,
    stripe_price_id = NULL,
    trial_ends_at = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    updated_at = NOW()
WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'isaiahcalvo0@gmail.com'
);

-- Verify it worked
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
