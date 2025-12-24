-- Backfill user_subscriptions for any existing users without subscription records
-- This handles users created before the subscription system was implemented

-- Insert subscription records for users that don't have one
INSERT INTO user_subscriptions (user_id, tier, status)
SELECT
    u.id,
    'free'::subscription_tier,
    'active'::subscription_status
FROM auth.users u
LEFT JOIN user_subscriptions s ON u.id = s.user_id
WHERE s.id IS NULL;

-- Verify the backfill worked
DO $$
DECLARE
    users_without_subs INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO users_without_subs
    FROM auth.users u
    LEFT JOIN user_subscriptions s ON u.id = s.user_id
    WHERE s.id IS NULL;

    IF users_without_subs > 0 THEN
        RAISE WARNING 'Backfill incomplete: % users still without subscriptions', users_without_subs;
    ELSE
        RAISE NOTICE 'Backfill successful: All users now have subscription records';
    END IF;
END $$;
