-- Database Audit Script
-- Comprehensive checks for production readiness

-- ===========================================
-- 1. RLS (Row Level Security) Policy Check
-- ===========================================

SELECT
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname IN ('public', 'auth')
ORDER BY schemaname, tablename;

-- ===========================================
-- 2. User Subscriptions Integrity Check
-- ===========================================

-- Check: All users have subscription records
SELECT
    'Users without subscriptions' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '❌ FAIL - Run backfill migration!'
    END as status
FROM auth.users u
WHERE u.id NOT IN (SELECT user_id FROM user_subscriptions);

-- Check: No duplicate subscriptions
SELECT
    'Duplicate subscriptions' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '❌ FAIL - Data integrity issue!'
    END as status
FROM (
    SELECT user_id, COUNT(*) as subscription_count
    FROM user_subscriptions
    GROUP BY user_id
    HAVING COUNT(*) > 1
) duplicates;

-- Check: Invalid subscription statuses
SELECT
    'Invalid subscription statuses' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '❌ FAIL - Invalid status values!'
    END as status
FROM user_subscriptions
WHERE status NOT IN ('active', 'canceled', 'trialing', 'past_due', 'incomplete');

-- Check: Invalid subscription tiers
SELECT
    'Invalid subscription tiers' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '❌ FAIL - Invalid tier values!'
    END as status
FROM user_subscriptions
WHERE tier NOT IN ('free', 'pro', 'enterprise', 'developer');

-- ===========================================
-- 3. Subscription Distribution
-- ===========================================

SELECT
    tier,
    status,
    COUNT(*) as user_count
FROM user_subscriptions
GROUP BY tier, status
ORDER BY tier, status;

-- ===========================================
-- 4. Orphaned Stripe Data Check
-- ===========================================

-- Check: Subscriptions with Stripe IDs but no customer ID
SELECT
    'Stripe subscription without customer' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '⚠️ WARNING - May need cleanup'
    END as status
FROM user_subscriptions
WHERE stripe_subscription_id IS NOT NULL
  AND stripe_customer_id IS NULL;

-- Check: Trialing subscriptions without trial end date
SELECT
    'Trialing without trial_ends_at' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '❌ FAIL - Data inconsistency!'
    END as status
FROM user_subscriptions
WHERE status = 'trialing'
  AND trial_ends_at IS NULL;

-- ===========================================
-- 5. Expired Trials Check
-- ===========================================

SELECT
    'Expired trials still marked as trialing' as check_name,
    COUNT(*) as count,
    CASE
        WHEN COUNT(*) = 0 THEN '✅ PASS'
        ELSE '⚠️ WARNING - Webhook may not have processed'
    END as status
FROM user_subscriptions
WHERE status = 'trialing'
  AND trial_ends_at < NOW();

-- ===========================================
-- 6. Recent Activity Summary
-- ===========================================

-- Subscriptions created in last 7 days
SELECT
    'Subscriptions created (last 7 days)' as metric,
    COUNT(*) as count
FROM user_subscriptions
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Subscriptions updated in last 7 days
SELECT
    'Subscriptions updated (last 7 days)' as metric,
    COUNT(*) as count
FROM user_subscriptions
WHERE updated_at >= NOW() - INTERVAL '7 days';

-- ===========================================
-- 7. User Account Health
-- ===========================================

-- Users with email verification
SELECT
    'Email verified users' as metric,
    COUNT(*) as count,
    ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM auth.users) * 100, 2) as percentage
FROM auth.users
WHERE email_confirmed_at IS NOT NULL;

-- ===========================================
-- 8. Detailed Subscription Report
-- ===========================================

SELECT
    u.email,
    s.tier,
    s.status,
    s.stripe_customer_id,
    s.stripe_subscription_id,
    s.trial_ends_at,
    s.current_period_end,
    s.created_at,
    s.updated_at,
    CASE
        WHEN s.status = 'trialing' AND s.trial_ends_at > NOW() THEN 'Active Trial'
        WHEN s.status = 'trialing' AND s.trial_ends_at < NOW() THEN 'Expired Trial (needs sync)'
        WHEN s.status = 'active' AND s.tier = 'pro' THEN 'Active Pro'
        WHEN s.status = 'active' AND s.tier = 'free' THEN 'Active Free'
        WHEN s.status = 'canceled' THEN 'Canceled'
        WHEN s.status = 'past_due' THEN 'Payment Issue'
        ELSE s.status::text
    END as subscription_health
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
ORDER BY s.updated_at DESC NULLS LAST;

-- ===========================================
-- 9. Summary Report
-- ===========================================

SELECT
    '========================================' as summary;
SELECT 'DATABASE AUDIT COMPLETE' as summary;
SELECT '========================================' as summary;

SELECT
    'Total Users' as metric,
    COUNT(*) as value
FROM auth.users
UNION ALL
SELECT
    'Users with Subscriptions',
    COUNT(*)
FROM user_subscriptions
UNION ALL
SELECT
    'Free Tier Users',
    COUNT(*)
FROM user_subscriptions
WHERE tier = 'free'
UNION ALL
SELECT
    'Pro Tier Users',
    COUNT(*)
FROM user_subscriptions
WHERE tier = 'pro'
UNION ALL
SELECT
    'Active Trials',
    COUNT(*)
FROM user_subscriptions
WHERE status = 'trialing' AND trial_ends_at > NOW()
UNION ALL
SELECT
    'Active Subscriptions',
    COUNT(*)
FROM user_subscriptions
WHERE status = 'active'
UNION ALL
SELECT
    'Canceled Subscriptions',
    COUNT(*)
FROM user_subscriptions
WHERE status = 'canceled';
