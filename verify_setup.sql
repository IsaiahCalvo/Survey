-- Quick verification script to check subscription system health
-- Run this in Supabase SQL Editor after webhook fixes

-- ============================================================================
-- 1. VERIFY ALL USERS HAVE SUBSCRIPTIONS
-- ============================================================================
SELECT
    'User Count' as check_name,
    (SELECT COUNT(*) FROM auth.users) as user_count,
    (SELECT COUNT(*) FROM user_subscriptions) as subscription_count,
    CASE
        WHEN (SELECT COUNT(*) FROM auth.users) = (SELECT COUNT(*) FROM user_subscriptions)
        THEN '✅ PASS: All users have subscriptions'
        ELSE '❌ FAIL: Missing subscription records'
    END as status;

-- ============================================================================
-- 2. CHECK RLS POLICIES FOR SERVICE ROLE
-- ============================================================================
SELECT
    'RLS Policies' as check_name,
    COUNT(*) as service_role_policy_count,
    CASE
        WHEN COUNT(*) >= 4
        THEN '✅ PASS: Service role policies exist'
        ELSE '❌ FAIL: Missing service role policies'
    END as status
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_subscriptions'
AND 'service_role' = ANY(roles);

-- ============================================================================
-- 3. VERIFY SUBSCRIPTION DATA INTEGRITY
-- ============================================================================
-- Check for invalid tiers
SELECT
    'Tier Validation' as check_name,
    COUNT(*) as invalid_tier_count,
    CASE
        WHEN COUNT(*) = 0
        THEN '✅ PASS: All tiers valid'
        ELSE '❌ FAIL: Invalid tier values found'
    END as status
FROM user_subscriptions
WHERE tier NOT IN ('free', 'pro', 'enterprise', 'developer');

-- Check for invalid statuses
SELECT
    'Status Validation' as check_name,
    COUNT(*) as invalid_status_count,
    CASE
        WHEN COUNT(*) = 0
        THEN '✅ PASS: All statuses valid'
        ELSE '❌ FAIL: Invalid status values found'
    END as status
FROM user_subscriptions
WHERE status NOT IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete');

-- ============================================================================
-- 4. CHECK CURRENT SUBSCRIPTION DISTRIBUTION
-- ============================================================================
SELECT
    tier,
    status,
    COUNT(*) as count,
    ARRAY_AGG(u.email) as emails
FROM user_subscriptions s
JOIN auth.users u ON s.user_id = u.id
GROUP BY tier, status
ORDER BY tier, status;

-- ============================================================================
-- 5. CHECK FOR STRIPE INTEGRATION DATA
-- ============================================================================
SELECT
    'Stripe Integration' as check_name,
    COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL) as users_with_customer_id,
    COUNT(*) FILTER (WHERE stripe_subscription_id IS NOT NULL) as users_with_subscription_id,
    COUNT(*) FILTER (WHERE trial_ends_at IS NOT NULL) as users_with_trial
FROM user_subscriptions;

-- ============================================================================
-- 6. CHECK ACTIVE TRIALS
-- ============================================================================
SELECT
    u.email,
    s.tier,
    s.status,
    s.trial_ends_at,
    CASE
        WHEN s.trial_ends_at > NOW()
        THEN EXTRACT(DAY FROM (s.trial_ends_at - NOW())) || ' days remaining'
        ELSE 'Trial ended'
    END as trial_status,
    s.stripe_subscription_id
FROM user_subscriptions s
JOIN auth.users u ON s.user_id = u.id
WHERE s.status = 'trialing'
OR s.trial_ends_at IS NOT NULL;

-- ============================================================================
-- 7. VERIFY DEVELOPER ACCOUNT
-- ============================================================================
SELECT
    u.email,
    s.tier,
    s.status,
    CASE
        WHEN s.tier = 'developer'
        THEN '✅ Developer account configured'
        ELSE '❌ Not a developer account'
    END as developer_status
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo123@gmail.com';

-- ============================================================================
-- 8. CHECK FOR ORPHANED OR DUPLICATE RECORDS
-- ============================================================================
-- Orphaned subscriptions (no user)
SELECT
    'Orphaned Subscriptions' as check_name,
    COUNT(*) as orphaned_count,
    CASE
        WHEN COUNT(*) = 0
        THEN '✅ PASS: No orphaned subscriptions'
        ELSE '❌ FAIL: Found orphaned subscriptions'
    END as status
FROM user_subscriptions s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE u.id IS NULL;

-- Duplicate subscriptions (multiple per user)
SELECT
    'Duplicate Subscriptions' as check_name,
    COUNT(*) as duplicate_count,
    CASE
        WHEN COUNT(*) = 0
        THEN '✅ PASS: No duplicate subscriptions'
        ELSE '❌ FAIL: Found users with multiple subscriptions'
    END as status
FROM (
    SELECT user_id, COUNT(*) as sub_count
    FROM user_subscriptions
    GROUP BY user_id
    HAVING COUNT(*) > 1
) duplicates;

-- ============================================================================
-- 9. SUMMARY
-- ============================================================================
SELECT
    '=== SYSTEM HEALTH SUMMARY ===' as summary,
    (SELECT COUNT(*) FROM auth.users) as total_users,
    (SELECT COUNT(*) FROM user_subscriptions WHERE tier = 'free') as free_users,
    (SELECT COUNT(*) FROM user_subscriptions WHERE tier = 'pro') as pro_users,
    (SELECT COUNT(*) FROM user_subscriptions WHERE tier = 'enterprise') as enterprise_users,
    (SELECT COUNT(*) FROM user_subscriptions WHERE tier = 'developer') as developer_users,
    (SELECT COUNT(*) FROM user_subscriptions WHERE status = 'trialing') as active_trials;
