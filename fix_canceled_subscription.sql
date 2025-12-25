-- Manually fix the canceled subscription for isaiahcalvo0@gmail.com
UPDATE user_subscriptions
SET 
  tier = 'free',
  status = 'canceled',
  stripe_subscription_id = NULL,
  stripe_price_id = NULL,
  trial_ends_at = NULL
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'isaiahcalvo0@gmail.com'
);

-- Verify the update
SELECT 
  u.email,
  s.tier,
  s.status,
  s.stripe_customer_id,
  s.stripe_subscription_id,
  s.trial_ends_at,
  s.updated_at
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
