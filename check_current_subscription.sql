-- Check current subscription for isaiahcalvo0@gmail.com
SELECT 
  u.email,
  s.tier,
  s.status,
  s.stripe_customer_id,
  s.stripe_subscription_id,
  s.trial_ends_at,
  s.current_period_end,
  s.created_at,
  s.updated_at
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com'
ORDER BY s.updated_at DESC;
