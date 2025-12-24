-- COMPREHENSIVE DATABASE AUDIT
-- Run this in Supabase SQL Editor to review everything

-- ============================================================================
-- PART 1: LIST ALL TABLES
-- ============================================================================
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================================
-- PART 2: USER_SUBSCRIPTIONS TABLE STRUCTURE
-- ============================================================================
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'user_subscriptions'
ORDER BY ordinal_position;

-- ============================================================================
-- PART 3: CHECK RLS POLICIES ON USER_SUBSCRIPTIONS
-- ============================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_subscriptions';

-- ============================================================================
-- PART 4: CHECK RLS POLICIES ON ALL CRITICAL TABLES
-- ============================================================================
SELECT
    tablename,
    policyname,
    cmd,
    CASE
        WHEN qual IS NOT NULL THEN 'Has USING clause'
        ELSE 'No USING clause'
    END as using_clause,
    CASE
        WHEN with_check IS NOT NULL THEN 'Has WITH CHECK clause'
        ELSE 'No WITH CHECK clause'
    END as with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
AND tablename IN ('user_subscriptions', 'projects', 'documents', 'templates', 'spaces', 'usage_metrics')
ORDER BY tablename, cmd;

-- ============================================================================
-- PART 5: CHECK FOR TABLES WITHOUT RLS ENABLED
-- ============================================================================
SELECT
    t.tablename,
    CASE
        WHEN c.relrowsecurity THEN 'RLS Enabled'
        ELSE 'RLS DISABLED - SECURITY RISK!'
    END as rls_status
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE t.schemaname = 'public'
AND t.tablename IN ('user_subscriptions', 'projects', 'documents', 'templates', 'spaces', 'usage_metrics', 'user_settings', 'connected_services', 'project_status')
ORDER BY t.tablename;

-- ============================================================================
-- PART 6: CHECK FOREIGN KEY RELATIONSHIPS
-- ============================================================================
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
AND tc.table_name IN ('user_subscriptions', 'projects', 'documents', 'templates', 'spaces', 'usage_metrics', 'project_status')
ORDER BY tc.table_name;

-- ============================================================================
-- PART 7: CHECK INDEXES ON USER_SUBSCRIPTIONS
-- ============================================================================
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'user_subscriptions';

-- ============================================================================
-- PART 8: CHECK ALL FUNCTIONS RELATED TO SUBSCRIPTIONS
-- ============================================================================
SELECT
    routine_name,
    routine_type,
    data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%subscription%'
OR routine_name LIKE '%tier%'
OR routine_name LIKE '%feature%'
ORDER BY routine_name;

-- ============================================================================
-- PART 9: VERIFY TRIGGER ON AUTH.USERS FOR AUTO-SUBSCRIPTION CREATION
-- ============================================================================
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth'
AND event_object_table = 'users'
AND trigger_name LIKE '%subscription%';

-- ============================================================================
-- PART 10: CHECK CURRENT SUBSCRIPTION DATA INTEGRITY
-- ============================================================================
-- Users without subscriptions (should be empty)
SELECT
    u.id,
    u.email,
    u.created_at,
    'Missing subscription record' as issue
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
WHERE s.id IS NULL;

-- Subscriptions without users (orphaned - should be empty)
SELECT
    s.id,
    s.user_id,
    s.tier,
    'Orphaned subscription' as issue
FROM user_subscriptions s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE u.id IS NULL;

-- Subscriptions with invalid tier values
SELECT
    u.email,
    s.tier,
    'Invalid tier value' as issue
FROM user_subscriptions s
JOIN auth.users u ON s.user_id = u.id
WHERE s.tier NOT IN ('free', 'pro', 'enterprise', 'developer');

-- Subscriptions with invalid status values
SELECT
    u.email,
    s.status,
    'Invalid status value' as issue
FROM user_subscriptions s
JOIN auth.users u ON s.user_id = u.id
WHERE s.status NOT IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete');

-- ============================================================================
-- PART 11: CHECK STORAGE BUCKET POLICIES
-- ============================================================================
SELECT
    id,
    name,
    public,
    allowed_mime_types,
    file_size_limit
FROM storage.buckets
WHERE name = 'documents';

-- ============================================================================
-- PART 12: SUMMARY OF ALL SUBSCRIPTIONS
-- ============================================================================
SELECT
    s.tier,
    s.status,
    COUNT(*) as count,
    ARRAY_AGG(u.email) as emails
FROM user_subscriptions s
JOIN auth.users u ON s.user_id = u.id
GROUP BY s.tier, s.status
ORDER BY s.tier, s.status;
