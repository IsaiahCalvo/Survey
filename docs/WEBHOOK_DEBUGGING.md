# Webhook Not Working - Debugging Steps

## Problem
- Canceled trial in Stripe
- Not reflected in Supabase database
- Not reflected in app
- **No webhook logs in Supabase**

This suggests webhooks aren't being delivered from Stripe to Supabase.

---

## Step 1: Check Webhook Deliveries in Stripe Dashboard

1. **Go to Stripe Dashboard**:
   - https://dashboard.stripe.com/test/webhooks

2. **Click on your webhook endpoint**:
   - Should see: `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook`

3. **Click the "Events" or "Deliveries" tab**

4. **Look for recent events**:
   - Should see `customer.subscription.deleted` (from your cancellation)
   - Should see `checkout.session.completed` (from your trial signup)

5. **Check delivery status**:
   - ✅ **Green checkmark** = Successfully delivered (200 response)
   - ❌ **Red X** = Failed delivery
   - ⏳ **Pending** = Still trying to deliver

6. **Click on a failed delivery** (if any):
   - Look at the "Response" section
   - Look at the "Error" message
   - Take note of what it says

---

## Step 2: Check Webhook Secret

**The most common issue is an incorrect webhook secret.**

1. **In Stripe Dashboard** → Webhooks → Click your endpoint

2. **Click "Reveal" next to "Signing secret"**

3. **Copy the secret** (should start with `whsec_`)

4. **Compare with Supabase secret**:
   ```bash
   # Check what's currently set in Supabase
   supabase secrets list
   ```

5. **If they don't match, update Supabase**:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_ACTUAL_SECRET_HERE
   ```

6. **Redeploy the webhook function**:
   ```bash
   supabase functions deploy stripe-webhook
   ```

---

## Step 3: Check API Version Mismatch

I noticed the events are using API version `2025-10-29.clover` but the webhook is configured for `2025-12-15.clover`.

**To fix this**:

1. **In Stripe Dashboard** → Webhooks → Click your endpoint

2. **Click the three dots menu** (⋮) → **Update details**

3. **Change "Events API version" to**: `Default account version` or `2025-10-29.clover`

4. **Save changes**

---

## Step 4: Manually Resend Failed Events

1. **In Stripe Dashboard** → Webhooks → Your endpoint → Events tab

2. **Find the `customer.subscription.deleted` event** (most recent)

3. **Click on it**

4. **Click "Resend event"**

5. **Wait a few seconds**

6. **Check Supabase logs**:
   - Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions
   - Click "stripe-webhook"
   - Click "Logs" tab
   - Should see logs now if it worked

---

## Step 5: Test with CLI

Run this command to trigger a test event:

```bash
stripe trigger customer.subscription.deleted
```

Then check:
1. Supabase function logs (should see detailed logs)
2. Your app (should show subscription canceled)
3. Database:
   ```sql
   SELECT u.email, s.tier, s.status, s.stripe_subscription_id
   FROM auth.users u
   JOIN user_subscriptions s ON u.id = s.user_id
   WHERE u.email = 'isaiahcalvo0@gmail.com';
   ```

---

## Expected Behavior

### When webhook works correctly:

**Supabase Logs will show**:
```
Processing webhook event: customer.subscription.deleted
Initializing Supabase client...
Supabase URL: https://cvamwtpsuvxvjdnotbeg.supabase.co
Service key present: true
```

**Database will update to**:
```
tier: free
status: canceled
stripe_subscription_id: null
```

**App will show**:
- No Pro badge
- "Start 7-Day Trial" button visible again

---

## Common Issues & Fixes

### Issue 1: Webhook Secret Mismatch
**Symptoms**: 401 errors in Stripe delivery logs, or no logs at all
**Fix**: Update STRIPE_WEBHOOK_SECRET in Supabase to match Stripe

### Issue 2: API Version Mismatch
**Symptoms**: Events not being sent to webhook
**Fix**: Change webhook API version in Stripe Dashboard

### Issue 3: Webhook Disabled
**Symptoms**: No deliveries attempted
**Fix**: In Stripe Dashboard, make sure webhook status is "Enabled", not "Disabled"

### Issue 4: Wrong URL
**Symptoms**: 404 errors
**Fix**: Verify URL is exactly: `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook`

### Issue 5: Supabase Function Not Deployed
**Symptoms**: 404 or no response
**Fix**: Run `supabase functions deploy stripe-webhook`

---

## Quick Diagnostic Checklist

Run these commands and share the output:

```bash
# 1. Check webhook endpoint configuration
stripe webhook_endpoints list

# 2. Check recent events
stripe events list --limit 5 --type "customer.subscription.*"

# 3. Check Supabase secrets (will show hashes, not actual values)
supabase secrets list | grep STRIPE

# 4. Test endpoint reachability
curl -I https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook

# 5. Check current subscription status
# (Run this SQL in Supabase SQL Editor)
SELECT u.email, s.tier, s.status, s.stripe_subscription_id, s.updated_at
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'isaiahcalvo0@gmail.com';
```

---

## What I Need You To Check

1. **Go to Stripe Dashboard webhooks page and tell me**:
   - Are there any failed deliveries? What's the error message?
   - What's the "Signing secret" (starts with `whsec_`)?
   - What API version is the webhook set to?

2. **Run the SQL query** in Supabase SQL Editor:
   ```sql
   SELECT u.email, s.tier, s.status, s.stripe_subscription_id, s.updated_at
   FROM auth.users u
   JOIN user_subscriptions s ON u.id = s.user_id
   WHERE u.email = 'isaiahcalvo0@gmail.com';
   ```
   - What does it show?

3. **Check Supabase function logs**:
   - Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook
   - Click "Logs" tab
   - Do you see ANY logs at all? (Even errors are good - means it's being called)

Once you provide this info, I can pinpoint exactly what's wrong!
