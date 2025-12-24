# Stripe Integration Setup Guide

This guide will walk you through setting up Stripe payments for your tiered pricing system.

## Table of Contents
1. [Stripe Account Setup](#stripe-account-setup)
2. [Create Stripe Products](#create-stripe-products)
3. [Configure Supabase](#configure-supabase)
4. [Apply Database Migrations](#apply-database-migrations)
5. [Set Up Webhook](#set-up-webhook)
6. [Create Developer Account](#create-developer-account)
7. [Testing](#testing)
8. [Going Live](#going-live)

---

## 1. Stripe Account Setup

### 1.1 Create/Login to Stripe Account
1. Go to https://dashboard.stripe.com
2. Create account or login
3. **IMPORTANT**: Start in **Test Mode** (toggle in top-right corner)

### 1.2 Verify Bank Account Connection

**To confirm payments will go to your bank account:**

1. Go to: **Settings → Business settings → Payout details**
2. Click **Add bank account** if not already added
3. Enter your bank account details:
   - Account holder name
   - Routing number
   - Account number
4. Stripe will send 2 small deposits (usually within 1-2 days)
5. Verify the amounts to confirm the account

**Check Payout Schedule:**
- Go to **Settings → Business settings → Payouts**
- Default: Daily automatic payouts
- First payout: 7-14 days after first payment (for new accounts)
- Subsequent payouts: 2-7 days after payment

⚠️ **CRITICAL**: Test mode payments are fake and DO NOT go to your bank. Only LIVE mode payments go to your bank account.

---

## 2. Create Stripe Products

You need to create 3 products with their pricing plans.

### 2.1 Create Pro Monthly Product

1. Go to **Products → Add product**
2. Fill in:
   - **Name**: Pro Monthly
   - **Description**: Full survey and project management features
   - **Pricing**: Recurring
   - **Price**: $9.99 USD
   - **Billing period**: Monthly
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_xxx`) - You'll need this later

### 2.2 Create Pro Annual Product

1. Go to **Products → Add product**
2. Fill in:
   - **Name**: Pro Annual
   - **Description**: Full survey and project management features (Save 17%)
   - **Pricing**: Recurring
   - **Price**: $99.00 USD
   - **Billing period**: Yearly
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_xxx`)

### 2.3 Create Enterprise Product

1. Go to **Products → Add product**
2. Fill in:
   - **Name**: Enterprise
   - **Description**: Team collaboration and advanced features
   - **Pricing**: Recurring
   - **Price**: $20.00 USD
   - **Billing period**: Monthly
   - **Billing scheme**: Per unit (so customers can add multiple users)
3. Click **Save product**
4. **Copy the Price ID** (starts with `price_xxx`)

**📝 Note**: Keep these 3 Price IDs handy - you'll need them in step 3.

---

## 3. Configure Supabase

### 3.1 Get Stripe API Keys

1. In Stripe Dashboard, go to **Developers → API keys**
2. Copy:
   - **Publishable key** (starts with `pk_test_xxx`)
   - **Secret key** (starts with `sk_test_xxx`) - Click "Reveal test key"

### 3.2 Add Keys to Local .env

1. Open `.env` file in your project root
2. Update:
   ```bash
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
   ```

### 3.3 Add Secrets to Supabase Edge Functions

1. Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/settings/functions
2. Click **Add secret**
3. Add the following secrets:

   **Secret 1:**
   - Name: `STRIPE_SECRET_KEY`
   - Value: `sk_test_YOUR_SECRET_KEY`

   **Secret 2:**
   - Name: `STRIPE_PRO_MONTHLY_PRICE_ID`
   - Value: `price_xxx` (from step 2.1)

   **Secret 3:**
   - Name: `STRIPE_PRO_ANNUAL_PRICE_ID`
   - Value: `price_yyy` (from step 2.2)

   **Secret 4:**
   - Name: `STRIPE_ENTERPRISE_PRICE_ID`
   - Value: `price_zzz` (from step 2.3)

   **Secret 5:**
   - Name: `STRIPE_WEBHOOK_SECRET`
   - Value: `whsec_xxx` (You'll get this in step 5 - add placeholder for now)

---

## 4. Apply Database Migrations

Run the following commands to set up the subscription database:

```bash
# Apply all migrations
supabase db push

# Or if using remote database
supabase db push --linked
```

This will create:
- `user_subscriptions` table (stores tier, Stripe IDs, trial dates)
- `usage_metrics` table (tracks usage over time)
- `project_status` table (manages active/archived projects)
- Helper functions (`get_user_tier`, `has_feature_access`, etc.)
- RLS policies (enforces tier limits)

**Verify migrations applied:**
```bash
supabase migration list
```

You should see:
- ✅ `20241223000001_create_user_subscriptions.sql`
- ✅ `20241223000002_create_usage_metrics.sql`
- ✅ `20241223000003_create_project_status.sql`
- ✅ `20241223000004_add_tier_enforcement_policies.sql`

---

## 5. Set Up Webhook

Webhooks allow Stripe to notify your app when payments succeed/fail, subscriptions change, etc.

### 5.1 Deploy Edge Functions

```bash
# Deploy both functions
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

### 5.2 Create Webhook in Stripe

1. Go to **Developers → Webhooks**
2. Click **Add endpoint**
3. Enter endpoint URL:
   ```
   https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook
   ```
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**

### 5.3 Get Webhook Secret

1. After creating the webhook, click on it
2. Click **Reveal** under "Signing secret"
3. Copy the secret (starts with `whsec_xxx`)
4. Go back to Supabase Edge Functions secrets (step 3.3)
5. Update `STRIPE_WEBHOOK_SECRET` with this value

### 5.4 Test Webhook

1. In Stripe webhook settings, click **Send test webhook**
2. Choose event: `checkout.session.completed`
3. Click **Send test webhook**
4. Check Supabase Edge Functions logs:
   ```bash
   supabase functions logs stripe-webhook
   ```
5. You should see: `Processing webhook event: checkout.session.completed`

---

## 6. Create Developer Account

The developer tier gives you unlimited access for testing without paying.

### 6.1 Create Your Developer Account

1. Sign up for a new account in your app (use your developer email)
2. Verify email and login

### 6.2 Manually Set to Developer Tier

**Option 1: Using Supabase Dashboard**
1. Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/editor
2. Open **Table Editor → user_subscriptions**
3. Find your user row (by email)
4. Click to edit
5. Change `tier` to: `developer`
6. Change `status` to: `active`
7. Save

**Option 2: Using SQL Editor**
1. Go to: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql/new
2. Run this SQL (replace with your email):
   ```sql
   UPDATE user_subscriptions
   SET tier = 'developer', status = 'active'
   WHERE user_id = (
       SELECT id FROM auth.users WHERE email = 'your-dev-email@example.com'
   );
   ```

### 6.3 Verify Developer Access

1. Refresh your app
2. You should now have:
   - ✅ Unlimited projects
   - ✅ Unlimited documents
   - ✅ 100GB storage
   - ✅ All Pro features (survey, templates, regions, export)
   - ✅ All Enterprise features (when built)
   - ✅ No payment required
   - ✅ No trial expiration

---

## 7. Testing

### 7.1 Test Stripe Integration

**Test Pro Monthly Subscription:**

1. Create a NEW test account (not your developer account)
2. Click "Upgrade to Pro"
3. Use Stripe test card:
   - Card: `4242 4242 4242 4242`
   - Expiry: Any future date (e.g., 12/25)
   - CVC: Any 3 digits (e.g., 123)
   - ZIP: Any 5 digits (e.g., 12345)
4. Complete checkout
5. Verify:
   - You're redirected back to app
   - User tier is now "Pro"
   - Trial ends in 7 days
   - All Pro features unlocked

**Check Database:**
```sql
SELECT
    u.email,
    s.tier,
    s.status,
    s.trial_ends_at,
    s.stripe_customer_id,
    s.stripe_subscription_id
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
ORDER BY u.created_at DESC
LIMIT 5;
```

**Check Stripe Dashboard:**
1. Go to **Customers** - you should see the test customer
2. Go to **Subscriptions** - you should see an active trial
3. Go to **Payments** - you should see $0.00 payment (trial)

### 7.2 Test Trial Flow

**Day 1 (Start Trial):**
- User has full Pro access
- `status = 'trialing'`
- `trial_ends_at` = 7 days from now

**Day 7 (Trial Ends):**
- Stripe automatically charges the card
- If successful: `status = 'active'`, user keeps Pro
- If failed: `status = 'past_due'`, webhook updates DB

**Test Trial Cancellation:**
1. In Stripe Dashboard, go to **Subscriptions**
2. Click the test subscription
3. Click **Cancel subscription**
4. Choose **Cancel immediately**
5. Check your app - user should be downgraded to Free

### 7.3 Test Tier Limits

**Free Tier:**
- Try creating 2nd project → Should show error/upgrade prompt
- Try uploading 6th document → Should show error/upgrade prompt
- Try creating a template → Should show "Pro required" message
- Try creating a space → Should show "Pro required" message

**Pro Tier:**
- Create 10+ projects → Should work
- Upload 20+ documents → Should work (up to 10GB)
- Create templates → Should work
- Create spaces → Should work

---

## 8. Going Live

When you're ready to accept real payments:

### 8.1 Complete Stripe Onboarding

1. Go to **Settings → Account details**
2. Complete all required information:
   - Business details
   - Tax information
   - Bank account (if not done in step 1.2)
3. Stripe will review your account (usually 1-2 days)

### 8.2 Create LIVE Products

Repeat step 2 but in **LIVE mode**:
1. Toggle to **Live mode** (top-right)
2. Create the 3 products again (Pro Monthly, Pro Annual, Enterprise)
3. Copy the LIVE Price IDs

### 8.3 Update Environment Variables

**Local .env:**
```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_LIVE_KEY
```

**Supabase Edge Functions Secrets:**
1. Update all secrets with LIVE values:
   - `STRIPE_SECRET_KEY` → `sk_live_xxx`
   - `STRIPE_PRO_MONTHLY_PRICE_ID` → LIVE price ID
   - `STRIPE_PRO_ANNUAL_PRICE_ID` → LIVE price ID
   - `STRIPE_ENTERPRISE_PRICE_ID` → LIVE price ID

### 8.4 Update Webhook to LIVE

1. Go to **Developers → Webhooks** (in LIVE mode)
2. Add endpoint (same URL as test)
3. Copy new LIVE webhook secret
4. Update `STRIPE_WEBHOOK_SECRET` in Supabase with LIVE value

### 8.5 Deploy to Production

```bash
# Deploy with production env vars
npm run build
npm run dist
```

### 8.6 Test LIVE Payment

⚠️ **USE A REAL CARD** - This will charge you!

1. Create a real account
2. Subscribe to Pro
3. Use a real credit card
4. Check Stripe Dashboard - you should see a real payment
5. Check **Payouts** - money should be scheduled for your bank

---

## Troubleshooting

### Webhook not working
- Check Edge Functions logs: `supabase functions logs stripe-webhook`
- Verify webhook secret is correct
- Test webhook in Stripe Dashboard

### Payment not updating database
- Check webhook is active and receiving events
- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe
- Check Supabase logs for errors

### Trial not starting
- Verify `trial_period_days: 7` in `create-checkout-session`
- Check Stripe subscription in Dashboard - should show "Trial"

### User still on Free after payment
- Check `user_subscriptions` table - verify tier updated
- Check webhook logs - verify `checkout.session.completed` received
- Manually update tier in database if needed

### Developer tier not working
- Verify tier is exactly `'developer'` (lowercase) in database
- Clear browser cache and refresh
- Check `has_feature_access()` function includes 'developer' tier

---

## Quick Reference

### Stripe Dashboard URLs
- **Main Dashboard**: https://dashboard.stripe.com
- **API Keys**: https://dashboard.stripe.com/apikeys
- **Webhooks**: https://dashboard.stripe.com/webhooks
- **Products**: https://dashboard.stripe.com/products
- **Customers**: https://dashboard.stripe.com/customers
- **Subscriptions**: https://dashboard.stripe.com/subscriptions
- **Payouts**: https://dashboard.stripe.com/payouts

### Supabase Dashboard URLs
- **Edge Functions**: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions
- **Secrets**: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/settings/functions
- **Table Editor**: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/editor
- **SQL Editor**: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql

### Test Cards
- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002
- **Requires Auth**: 4000 0025 0000 3155

### Tier Limits

| Tier | Projects | Documents | Storage | Features |
|------|----------|-----------|---------|----------|
| Free | 1 | 5 | 100MB | Basic annotations |
| Pro | ∞ | ∞ | 10GB | Survey, templates, regions, export |
| Enterprise | ∞ | ∞ | 1TB | + Team collaboration (future) |
| Developer | ∞ | ∞ | 100GB | All features (testing only) |

---

## Need Help?

- **Stripe Docs**: https://stripe.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Stripe Support**: https://support.stripe.com
- **Test your integration**: https://stripe.com/docs/testing
