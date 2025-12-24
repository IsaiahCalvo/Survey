-- Run this in Supabase SQL Editor to check what already exists
-- https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql

-- Check if user_subscriptions table exists
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'user_subscriptions'
) as user_subscriptions_exists;

-- If it exists, show the schema
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'user_subscriptions'
ORDER BY ordinal_position;

-- Check which migrations have been applied
SELECT version, name, executed_at
FROM supabase_migrations.schema_migrations
ORDER BY executed_at DESC
LIMIT 10;
