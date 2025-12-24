#!/bin/bash

echo "==========================================="
echo "TESTING WEBHOOK AFTER FIX"
echo "==========================================="
echo ""

echo "Step 1: Manually sync the canceled subscription to database"
echo "---"
echo "Run this SQL in Supabase SQL Editor:"
echo ""
cat <<'SQL'
UPDATE user_subscriptions
SET
    tier = 'free',
    status = 'canceled',
    stripe_subscription_id = NULL,
    stripe_price_id = NULL,
    trial_ends_at = NULL,
    current_period_start = NULL,
    current_period_end = NULL,
    updated_at = NOW()
WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'isaiahcalvo0@gmail.com'
);

SELECT u.email, s.tier, s.status, s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
SQL

echo ""
echo "Step 2: After running the SQL, refresh your app"
echo "   - Should show Free tier"
echo "   - Should show 'Start 7-Day Trial' button"
echo ""

echo "Step 3: Start a new trial to test the webhook"
echo "   1. Click 'Start 7-Day Trial' in your app"
echo "   2. Use card: 4242 4242 4242 4242"
echo "   3. Complete checkout"
echo ""

echo "Step 4: Check webhook logs"
echo "   URL: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook"
echo "   - Should see detailed logs (no more 'runMicrotasks' error)"
echo "   - Should see 'Processing webhook event: checkout.session.completed'"
echo "   - Should see 'SUCCESS: Updated subscription'"
echo ""

echo "Step 5: Verify database updated automatically"
echo "   Run this SQL to confirm:"
echo ""
cat <<'SQL2'
SELECT u.email, s.tier, s.status, s.trial_ends_at, s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
SQL2

echo ""
echo "==========================================="
echo "CLEANUP TEST CUSTOMERS (Optional)"
echo "==========================================="
echo ""
echo "To remove the test customers created by 'stripe trigger':"
echo ""
echo "stripe customers delete cus_Tf6YDZ3E4QzYym"
echo "stripe customers delete cus_Tf6MdOlx2DIwsF"
echo ""
echo "Jenny Rosen is Stripe's default test customer - you can leave it."
echo ""
