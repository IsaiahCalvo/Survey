-- Check current subscription status for isaiahcalvo0@gmail.com
SELECT
    u.email,
    s.tier,
    s.status,
    s.trial_ends_at,
    s.current_period_end,
    s.stripe_subscription_id,
    s.stripe_customer_id,
    s.updated_at,
    s.created_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
