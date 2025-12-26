## Stripe Live Mode Setup Guide

This guide walks you through switching from Stripe **Test Mode** to **Live Mode** for production launch.

**⚠️ CRITICAL**: Only do this when you're ready to accept real payments. Test mode uses fake credit cards; live mode charges real money.

---

## Overview

**Current State**: Using Stripe Test Mode
- Test API keys (sk_test_...)
- Test price IDs
- Test webhook secret
- Can use test credit cards (4242 4242 4242 4242)

**After Setup**: Using Stripe Live Mode
- Live API keys (sk_live_...)
- Live price IDs
- Live webhook secret
- Real credit cards only
- Real charges

---

## Prerequisites

✅ Stripe account fully activated (not restricted)
✅ Bank account connected for payouts
✅ Business details completed in Stripe dashboard
✅ All test transactions working correctly
✅ Ready to accept real payments

---

## Step 1: Create Live Mode Products and Prices

### 1.1 Switch to Live Mode

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Toggle from **Test Mode** to **Live Mode** (top right corner)
3. If prompted, complete any required business verification

### 1.2 Create Pro Product (Monthly)

1. Go to **Products** → **Add Product**
2. Fill in details:
   - **Name**: `Pro Plan - Monthly`
   - **Description**: `Unlimited projects, unlimited documents, 10GB storage`
   - **Pricing model**: Standard pricing
   - **Price**: `$9.99` USD
   - **Billing period**: Monthly
   - **Free trial**: `7 days` (optional but recommended)
3. Click **Save**
4. **Copy the Price ID** (starts with `price_...`)
   - Example: `price_1Abc123LiveXXXXXXXXXXXX`
   - Save this as `LIVE_PRO_MONTHLY_PRICE_ID`

### 1.3 Create Pro Product (Annual)

1. Go to **Products** → **Add Product**
2. Fill in details:
   - **Name**: `Pro Plan - Annual`
   - **Description**: `Unlimited projects, unlimited documents, 10GB storage (20% off)`
   - **Pricing model**: Standard pricing
   - **Price**: `$95.88` USD (equivalent to $7.99/month)
   - **Billing period**: Yearly
   - **Free trial**: `7 days` (optional)
3. Click **Save**
4. **Copy the Price ID**
   - Example: `price_1Def456LiveYYYYYYYYYYYY`
   - Save this as `LIVE_PRO_ANNUAL_PRICE_ID`

### 1.4 Create Enterprise Product (if needed)

1. Go to **Products** → **Add Product**
2. Fill in details:
   - **Name**: `Enterprise Plan`
   - **Description**: `Custom pricing, 1TB storage, priority support`
   - **Pricing model**: Standard pricing
   - **Price**: `$99.00` USD (or custom amount)
   - **Billing period**: Monthly or Yearly
3. Click **Save**
4. **Copy the Price ID**
   - Example: `price_1Ghi789LiveZZZZZZZZZZZZ`
   - Save this as `LIVE_ENTERPRISE_PRICE_ID`

---

## Step 2: Get Live API Keys

### 2.1 Get Secret Key

1. In Stripe Dashboard (Live Mode), go to **Developers** → **API Keys**
2. Find **Secret key** (starts with `sk_live_...`)
3. Click **Reveal** and copy the key
4. Save this as `LIVE_STRIPE_SECRET_KEY`

**⚠️ Security**: Never commit this key to version control or share it publicly

### 2.2 Get Publishable Key (if needed for frontend)

1. Find **Publishable key** (starts with `pk_live_...`)
2. Copy this for frontend use (safe to expose publicly)

---

## Step 3: Set Up Live Webhook

### 3.1 Create Webhook Endpoint

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Fill in details:
   - **Endpoint URL**: `https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook`
   - **Description**: `Production webhook for subscription events`
   - **Events to send**: Select these events:
     - ✅ `checkout.session.completed`
     - ✅ `customer.subscription.created`
     - ✅ `customer.subscription.updated`
     - ✅ `customer.subscription.deleted`
     - ✅ `customer.subscription.trial_will_end`
     - ✅ `invoice.payment_succeeded`
     - ✅ `invoice.payment_failed`
4. Click **Add endpoint**

### 3.2 Get Webhook Signing Secret

1. Click on the newly created webhook
2. Find **Signing secret** (starts with `whsec_...`)
3. Click **Reveal** and copy the secret
4. Save this as `LIVE_STRIPE_WEBHOOK_SECRET`

---

## Step 4: Update Supabase Secrets

Run these commands to update your Supabase project with live Stripe keys:

```bash
# Update Stripe Secret Key
supabase secrets set STRIPE_SECRET_KEY=sk_live_YOUR_ACTUAL_KEY_HERE

# Update Pro Monthly Price ID
supabase secrets set STRIPE_PRO_MONTHLY_PRICE_ID=price_YOUR_LIVE_MONTHLY_ID

# Update Pro Annual Price ID
supabase secrets set STRIPE_PRO_ANNUAL_PRICE_ID=price_YOUR_LIVE_ANNUAL_ID

# Update Enterprise Price ID (if applicable)
supabase secrets set STRIPE_ENTERPRISE_PRICE_ID=price_YOUR_LIVE_ENTERPRISE_ID

# Update Webhook Secret
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_LIVE_WEBHOOK_SECRET
```

**Example**:
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_51AbC123...xyz
supabase secrets set STRIPE_PRO_MONTHLY_PRICE_ID=price_1DeF456...abc
supabase secrets set STRIPE_PRO_ANNUAL_PRICE_ID=price_1GhI789...def
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_1JkL012...ghi
```

### Verify Secrets Were Set

```bash
supabase secrets list
```

You should see all your secrets with updated digests.

---

## Step 5: Test Webhook Connection

### 5.1 Test from Stripe Dashboard

1. In Stripe Dashboard → **Webhooks** → Select your webhook
2. Scroll to **Send test webhook**
3. Select event: `customer.subscription.created`
4. Click **Send test webhook**
5. Check **Response** tab - should see `200 OK`

### 5.2 Test with Real Checkout (Recommended)

**⚠️ Important**: Use a real credit card (will create real charge) or Stripe test cards won't work in live mode

1. Go to your app's pricing page
2. Click "Subscribe to Pro"
3. Use a real credit card or a test card that works in live mode:
   - **Test card for live mode**: No such thing - you must use real cards
   - **Option**: Create a $0.01 test product first to avoid large charges
4. Complete checkout
5. Check Stripe Dashboard → **Payments** to see the transaction
6. Check your database to verify subscription was created

---

## Step 6: Update Frontend (if needed)

If your frontend uses Stripe's publishable key:

```javascript
// Before (Test Mode)
const stripe = Stripe('pk_test_...');

// After (Live Mode)
const stripe = Stripe('pk_live_...');
```

Update environment variables:
```bash
# .env or .env.production
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_KEY_HERE
```

---

## Step 7: Monitor and Verify

### 7.1 Check Logs

Monitor Supabase Edge Function logs:
```bash
# Or via Dashboard
https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook/logs
```

### 7.2 Test All Flows

✅ **New subscription** (checkout.session.completed)
✅ **Trial ending** (7 days before trial ends)
✅ **Payment succeeded** (first charge after trial)
✅ **Payment failed** (test with declined card if possible)
✅ **Subscription canceled** (via billing portal)

### 7.3 Verify Database Updates

Check `user_subscriptions` table after each event:
```sql
SELECT user_id, tier, status, stripe_subscription_id, trial_ends_at
FROM user_subscriptions
ORDER BY updated_at DESC
LIMIT 10;
```

---

## Rollback Plan (If Issues Arise)

If you encounter problems and need to rollback to test mode:

```bash
# Restore test mode secrets
supabase secrets set STRIPE_SECRET_KEY=sk_test_YOUR_TEST_KEY
supabase secrets set STRIPE_PRO_MONTHLY_PRICE_ID=price_YOUR_TEST_MONTHLY_ID
supabase secrets set STRIPE_PRO_ANNUAL_PRICE_ID=price_YOUR_TEST_ANNUAL_ID
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_YOUR_TEST_WEBHOOK_SECRET
```

---

## Important Notes

### Pricing Recommendations

**Pro Plan Monthly**: $9.99/month
- Unlimited projects
- Unlimited documents
- 10GB storage
- 7-day free trial

**Pro Plan Annual**: $95.88/year ($7.99/month equivalent)
- Same features as monthly
- 20% discount vs monthly
- 7-day free trial

**Enterprise**: Custom (usually $99+/month)
- 1TB storage
- Priority support
- Custom features

### Tax Collection

Consider setting up Stripe Tax for automatic tax calculation:
1. Go to **Settings** → **Tax**
2. Enable **Stripe Tax**
3. Configure tax registration numbers

### Billing Portal

Ensure billing portal is configured:
1. Go to **Settings** → **Billing → Customer Portal**
2. Enable features:
   - ✅ Update payment method
   - ✅ Cancel subscription
   - ✅ View invoice history
3. Set branding (logo, colors, etc.)

### Email Receipts

Configure Stripe email receipts:
1. Go to **Settings** → **Emails**
2. Customize templates for:
   - Payment receipts
   - Subscription confirmations
   - Failed payment notifications

---

## Checklist Before Going Live

- [ ] Stripe account fully verified
- [ ] Bank account connected
- [ ] Live products created (Pro Monthly, Pro Annual, Enterprise)
- [ ] Live price IDs copied
- [ ] Live API secret key copied
- [ ] Live webhook endpoint created
- [ ] Live webhook secret copied
- [ ] All Supabase secrets updated
- [ ] Webhook test successful (200 OK)
- [ ] Test transaction completed successfully
- [ ] Database updated correctly
- [ ] Billing portal configured
- [ ] Tax settings configured (if needed)
- [ ] Email receipts customized
- [ ] Rollback plan documented
- [ ] Team notified of live mode switch

---

## Post-Launch Monitoring

### Week 1
- Check webhook delivery daily
- Monitor failed payments
- Review customer support tickets
- Check database consistency

### Monthly
- Review successful subscriptions
- Check churn rate
- Monitor webhook errors
- Review Stripe dashboard analytics

---

## Support

**Stripe Issues**: [Stripe Support](https://support.stripe.com/)
**Supabase Issues**: [Supabase Discord](https://discord.supabase.com/)
**Webhook Debugging**: Check Supabase function logs and Stripe webhook attempts

---

**Remember**: Live mode means real money. Test thoroughly before switching!
