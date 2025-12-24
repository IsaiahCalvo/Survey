-- Step 1: Check if table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'user_subscriptions'
) as table_exists;

-- Step 2: Check all subscriptions
SELECT
    s.id,
    s.user_id,
    s.tier,
    s.status,
    u.email
FROM user_subscriptions s
LEFT JOIN auth.users u ON s.user_id = u.id
ORDER BY s.created_at DESC;

-- Step 3: Check your specific user's subscription
SELECT
    u.email,
    s.tier,
    s.status,
    s.created_at
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
ORDER BY u.created_at DESC
LIMIT 5;
