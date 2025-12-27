-- Check current subscription status for isaiahcalvo123@gmail.com
SELECT
  u.email,
  s.tier,
  s.status,
  s.created_at,
  s.updated_at
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo123@gmail.com';

-- If no subscription exists, create one as developer
INSERT INTO user_subscriptions (user_id, tier, status)
SELECT id, 'developer', 'active'
FROM auth.users
WHERE email = 'isaiahcalvo123@gmail.com'
ON CONFLICT (user_id)
DO UPDATE SET tier = 'developer', status = 'active';

-- Verify the change
SELECT
  u.email,
  s.tier,
  s.status
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo123@gmail.com';
