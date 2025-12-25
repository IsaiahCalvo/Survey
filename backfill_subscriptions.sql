-- Backfill Migration: Ensure all users have subscription records
-- This prevents app crashes when users don't have a subscription entry

-- Step 1: Check current status
SELECT
    COUNT(DISTINCT u.id) as total_users,
    COUNT(DISTINCT s.user_id) as users_with_subscriptions,
    COUNT(DISTINCT u.id) - COUNT(DISTINCT s.user_id) as users_missing_subscriptions
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id;

-- Step 2: Insert missing subscription records
-- All users without subscriptions get Free tier by default
INSERT INTO user_subscriptions (user_id, tier, status)
SELECT id, 'free', 'active'
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_subscriptions)
ON CONFLICT (user_id) DO NOTHING;

-- Step 3: Verify the backfill worked
SELECT
    COUNT(DISTINCT u.id) as total_users,
    COUNT(DISTINCT s.user_id) as users_with_subscriptions,
    COUNT(DISTINCT u.id) - COUNT(DISTINCT s.user_id) as users_still_missing
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id;

-- Step 4: Show all user subscriptions
SELECT
    u.email,
    s.tier,
    s.status,
    s.created_at,
    s.updated_at
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
ORDER BY s.created_at DESC;
