# Webhook Testing & Verification Guide

## What Was Fixed

### 1. **RLS Policies** ✅
Added explicit service role policies to allow the webhook (running with service role key) to update the `user_subscriptions` table:
- Service role can now SELECT, INSERT, UPDATE, DELETE all subscriptions
- Migration: `20241224000001_fix_webhook_rls.sql`

### 2. **Webhook Handler Improvements** ✅
Enhanced the webhook handler with:
- Detailed logging at every step
- Check if subscription record exists before updating
- Auto-create record if missing
- Better error handling with fallback logic
- Explicit Supabase client configuration

### 3. **Backfill Migration** ✅
Created migration to ensure all existing users have subscription records:
- Migration: `20241224000002_backfill_user_subscriptions.sql`
- Status: ✅ Deployed successfully - all users now have subscription records

## How to Test the Webhook

### Option 1: Test with Stripe CLI (Recommended for debugging)

1. **Install Stripe CLI** (if not already installed):
   ```bash
   brew install stripe/stripe-cli/stripe
   ```

2. **Login to Stripe**:
   ```bash
   stripe login
   ```

3. **Trigger a test webhook event**:
   ```bash
   # Get your webhook endpoint URL
   echo "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook"

   # Trigger a checkout.session.completed event
   stripe trigger checkout.session.completed
   ```

4. **View the webhook logs** in Supabase Dashboard:
   - Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions
   - Click on "stripe-webhook"
   - Check the "Logs" tab
   - You should see detailed logs showing each step

### Option 2: Test with Real Subscription (End-to-End)

1. **Create a new test account** (or use isaiahcalvo0@gmail.com):
   - Make sure the account has a subscription record in `user_subscriptions`

2. **Start a new trial**:
   - In your app, go to Settings → Manage Subscription
   - Click "Start 7-Day Trial"
   - Complete the Stripe checkout with test card: `4242 4242 4242 4242`

3. **Verify the webhook fired**:
   ```sql
   -- Check if the subscription was updated
   SELECT
       u.email,
       s.tier,
       s.status,
       s.trial_ends_at,
       s.stripe_customer_id,
       s.stripe_subscription_id,
       s.updated_at
   FROM auth.users u
   JOIN user_subscriptions s ON u.id = s.user_id
   WHERE u.email = 'your-test-email@gmail.com';
   ```

4. **Check Stripe Dashboard**:
   - Go to: https://dashboard.stripe.com/test/subscriptions
   - Find the subscription
   - Click on "Events and logs"
   - Verify `checkout.session.completed` was sent

5. **Check webhook logs** in Supabase:
   - Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions
   - Click "stripe-webhook" → "Logs"
   - Look for logs showing the event was processed

## Expected Log Output

When the webhook works correctly, you should see logs like this:

```
Processing webhook event: checkout.session.completed
Initializing Supabase client...
Supabase URL: https://cvamwtpsuvxvjdnotbeg.supabase.co
Service key present: true
=== handleCheckoutCompleted START ===
Session ID: cs_test_xxxxx
Customer ID: cus_xxxxx
Subscription ID: sub_xxxxx
Metadata: { user_id: 'uuid-here', tier: 'pro' }
Fetching subscription from Stripe...
Subscription status: trialing
Trial end: 1735603527
Update data prepared: { tier: 'pro', status: 'trialing', ... }
Attempting to update user_subscriptions for user_id: uuid-here
Checking if subscription record exists...
Found existing subscription record: { id: 'xxx', user_id: 'xxx', ... }
Updating subscription record...
SUCCESS: Updated subscription for user uuid-here to pro (trialing)
Updated rows: [{ ... }]
Number of rows updated: 1
=== handleCheckoutCompleted END ===
```

## If the Webhook Still Fails

### Check 1: Verify Environment Variables
```bash
supabase secrets list
```

Make sure these are set:
- `STRIPE_SECRET_KEY` (should start with `sk_test_`)
- `STRIPE_WEBHOOK_SECRET` (should start with `whsec_`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Check 2: Verify Webhook Endpoint in Stripe

1. Go to: https://dashboard.stripe.com/test/webhooks
2. Find your webhook endpoint
3. Verify the URL is: `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook`
4. Verify these events are selected:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

### Check 3: Manually Verify RLS Policies

Run this SQL in Supabase SQL Editor:
```sql
-- Check RLS policies
SELECT
    tablename,
    policyname,
    cmd,
    roles,
    qual
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'user_subscriptions'
ORDER BY policyname;
```

You should see policies for both regular users AND service_role.

### Check 4: Test Database Write Directly

Run this SQL to verify the service role can write:
```sql
-- This should work without errors
UPDATE user_subscriptions
SET tier = 'pro', status = 'trialing'
WHERE user_id = (SELECT id FROM auth.users LIMIT 1)
RETURNING *;
```

## Stripe Test Cards

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Authentication required**: `4000 0025 0000 3155`

All test cards:
- Use any future expiration date (e.g., 12/34)
- Use any 3-digit CVC (e.g., 123)
- Use any ZIP code (e.g., 12345)

## Next Steps After Testing

Once the webhook is confirmed working:

1. ✅ Test trial countdown display in app
2. ✅ Test subscription status updates
3. ✅ Test downgrade handling
4. 📋 Implement email notifications (trial ending, payment failed)
5. 📋 Add customer portal for subscription management
6. 📋 Implement frontend feature gating
7. 📋 Add usage metrics tracking

## Support Resources

- **Stripe Webhooks Docs**: https://stripe.com/docs/webhooks
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions
- **Test Your Integration**: https://dashboard.stripe.com/test/webhooks/create

## Quick Verification Commands

```bash
# Deploy latest webhook
supabase functions deploy stripe-webhook

# View recent logs
# (Go to Supabase Dashboard → Functions → stripe-webhook → Logs)

# Check database state
psql "postgresql://postgres:[PASSWORD]@db.cvamwtpsuvxvjdnotbeg.supabase.co:5432/postgres" -c "SELECT COUNT(*) FROM user_subscriptions WHERE tier = 'pro';"

# Trigger test event
stripe trigger checkout.session.completed
```
