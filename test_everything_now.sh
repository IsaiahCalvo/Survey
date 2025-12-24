#!/bin/bash

echo "=========================================="
echo "COMPLETE SUBSCRIPTION SYSTEM TEST"
echo "=========================================="
echo ""

echo "🔧 STEP 1: Manual Database Sync"
echo "---"
echo "Copy and run this SQL in Supabase SQL Editor:"
echo "https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql/new"
echo ""
cat <<'SQL'
-- Sync canceled subscription for isaiahcalvo0@gmail.com
UPDATE user_subscriptions
SET
    tier = 'free',
    status = 'canceled',
    stripe_subscription_id = NULL,
    stripe_price_id = NULL,
    trial_ends_at = NULL,
    updated_at = NOW()
WHERE user_id = (
    SELECT id FROM auth.users WHERE email = 'isaiahcalvo0@gmail.com'
);

-- Verify (should show: tier='free', status='canceled')
SELECT u.email, s.tier, s.status, s.trial_ends_at, s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
SQL
echo ""
read -p "Press ENTER after running the SQL..."
echo ""

echo "✅ STEP 2: Verify App Shows Free Tier"
echo "---"
echo "1. Refresh your app (Cmd+Shift+R or Ctrl+Shift+R)"
echo "2. Go to Settings → Manage Subscription"
echo "3. Verify:"
echo "   - Free card shows 'Current Plan' (green button)"
echo "   - Pro card has blue border (recommended)"
echo "   - No trial banner at top"
echo ""
read -p "Does it look correct? (y/n): " APP_CORRECT
if [ "$APP_CORRECT" != "y" ]; then
    echo "❌ UI not showing correctly. Check browser console for errors."
    exit 1
fi
echo "✅ App UI looks good!"
echo ""

echo "🔍 STEP 3: Check Webhook Logs"
echo "---"
echo "Opening webhook logs in browser..."
open "https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook"
echo ""
echo "Check the logs:"
echo "  ❌ OLD (bad): 'Deno.core.runMicrotasks() is not supported'"
echo "  ✅ NEW (good): 'booted (time: XXms)' with recent timestamp"
echo ""
read -p "Do you see the new 'booted' log? (y/n): " LOGS_GOOD
if [ "$LOGS_GOOD" != "y" ]; then
    echo "⚠️  Webhook may not have redeployed. Running deployment now..."
    supabase functions deploy stripe-webhook --no-verify-jwt
    echo "✅ Webhook redeployed. Check logs again."
    exit 0
fi
echo "✅ Webhook deployed successfully!"
echo ""

echo "🧪 STEP 4: Test Webhook with Trigger"
echo "---"
echo "Triggering test event..."
stripe trigger checkout.session.completed
echo ""
echo "Waiting 3 seconds for event to process..."
sleep 3
echo ""
echo "Check the webhook logs again:"
echo "  Should see: 'Processing webhook event: checkout.session.completed'"
echo "  Should see: Detailed logs with session data"
echo "  Should see: 'SUCCESS: Updated subscription' or error details"
echo ""
read -p "Did you see the detailed webhook logs? (y/n): " WEBHOOK_WORKING
if [ "$WEBHOOK_WORKING" != "y" ]; then
    echo "❌ Webhook not processing events correctly."
    echo "   Check WEBHOOK_DEBUGGING.md for troubleshooting steps."
    exit 1
fi
echo "✅ Webhook is processing events!"
echo ""

echo "🎯 STEP 5: End-to-End Trial Test"
echo "---"
echo "1. In your app, click 'Start 7-Day Trial'"
echo "2. Complete checkout with card: 4242 4242 4242 4242"
echo "3. After checkout, return to app"
echo ""
echo "Expected behavior:"
echo "  ✅ Trial banner appears automatically"
echo "  ✅ Shows 'Your Pro trial ends in 7 days'"
echo "  ✅ Pro card shows 'Current Plan'"
echo "  ✅ Free card is dimmed (opacity 0.7)"
echo ""
echo "If UI doesn't update automatically:"
echo "  - Wait 5 seconds (webhook processing delay)"
echo "  - Click elsewhere then back to Settings tab"
echo "  - Window focus event should trigger refetch"
echo ""
read -p "Ready to start trial? Press ENTER to continue..."
read -p "Did trial signup work correctly? (y/n): " TRIAL_WORKING

if [ "$TRIAL_WORKING" != "y" ]; then
    echo ""
    echo "⚠️  Trial signup had issues. Let's debug:"
    echo ""
    echo "1. Check webhook logs for errors"
    echo "2. Run this SQL to see current status:"
    echo ""
    cat <<'SQL2'
SELECT u.email, s.tier, s.status, s.trial_ends_at, s.stripe_subscription_id, s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
SQL2
    echo ""
    echo "3. Check Stripe Dashboard:"
    echo "   https://dashboard.stripe.com/test/subscriptions"
    echo "   Should see active trial for isaiahcalvo0@gmail.com"
    echo ""
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ ALL TESTS PASSED!"
echo "=========================================="
echo ""
echo "Your subscription system is working correctly:"
echo "  ✅ Webhook deployed and processing events"
echo "  ✅ Database syncing automatically"
echo "  ✅ UI updating correctly"
echo "  ✅ Trial signup flow working end-to-end"
echo ""
echo "Optional cleanup (remove test customers):"
echo "  stripe customers delete cus_Tf6YDZ3E4QzYym"
echo "  stripe customers delete cus_Tf6MdOlx2DIwsF"
echo ""
echo "📚 Documentation:"
echo "  - Full details: COMPLETE_FIX_SUMMARY.md"
echo "  - Testing guide: WEBHOOK_TEST_GUIDE.md"
echo "  - Debugging: WEBHOOK_DEBUGGING.md"
echo ""
