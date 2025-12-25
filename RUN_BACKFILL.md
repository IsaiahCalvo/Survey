# Run Backfill Migration (5 minutes)

## Quick Steps

### Step 1: Open Supabase SQL Editor

Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql/new

### Step 2: Copy and Paste This SQL

```sql
-- Backfill Migration: Ensure all users have subscription records

-- Step 1: Check current status
SELECT
    COUNT(DISTINCT u.id) as total_users,
    COUNT(DISTINCT s.user_id) as users_with_subscriptions,
    COUNT(DISTINCT u.id) - COUNT(DISTINCT s.user_id) as users_missing_subscriptions
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id;

-- Step 2: Insert missing subscription records
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
```

### Step 3: Click "Run"

### Step 4: Check Results

**Expected Output**:

- Step 1 shows: How many users are missing subscriptions
- Step 2 inserts: Subscription records for missing users
- Step 3 shows: 0 users still missing (all fixed!)
- Step 4 shows: All users with their subscription tiers

**If you see any errors**, copy the error message and share with me.

### Step 5: Reply Here

Once done, tell me:
- "Done - X users were missing subscriptions, all fixed now"
- OR share any errors

Then I'll move to Step 2 (Database Audit)!

---

## Why This Is Important

Without this migration:
- ❌ Users without subscription records crash the app
- ❌ UI shows errors when accessing Account Settings
- ❌ Webhooks fail to update subscriptions

With this migration:
- ✅ Every user has a subscription record
- ✅ App works smoothly for all users
- ✅ No crashes or errors
