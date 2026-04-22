# Subscription System - Testing Guide

## ✅ What's Complete

### Backend:
- ✅ Database tables: `user_subscriptions`, `usage_metrics`, `project_status`
- ✅ RLS policies enforcing tier limits
- ✅ Edge Functions: `create-checkout-session`, `stripe-webhook`
- ✅ Stripe products created (Pro Monthly, Pro Annual, Enterprise)
- ✅ Price IDs configured in Supabase
- ✅ Webhook configured in Stripe Dashboard

### Frontend:
- ✅ Updated "Manage Subscription" tab with correct pricing
- ✅ Real-time subscription data fetching
- ✅ Trial countdown display
- ✅ Developer account badge
- ✅ Monthly/Annual billing toggle
- ✅ Three tiers: Free ($0), Pro ($9.99/mo or $99/yr), Enterprise ($20/user/mo)

---

## 🧪 Test Plan

### Test 1: Verify Developer Account

**Your developer account should be set to `tier = 'developer'` in the database.**

1. Open your app: http://localhost:5173
2. Login with your developer account
3. Open Settings → Manage Subscription
4. **Expected**:
   - Purple banner: "🔧 Developer Account"
   - Message: "Unlimited access for testing and development"
   - All three pricing cards visible
   - Your cards should be dimmed/disabled (Developer Account buttons)

---

### Test 2: Test Pro Subscription Flow (New Account)

**Create a completely new test account:**

1. Sign out of your developer account
2. Create new account with different email: testuser@example.com
3. Verify email and login
4. Open Settings → Manage Subscription

**Expected on Free tier:**
- ✅ "Current Plan" button on Free card
- ✅ "Start 7-Day Trial" button on Pro card
- ✅ Monthly/Annual toggle visible
- ✅ No banner (you're on Free)

**Test Monthly Subscription:**

5. Click Monthly toggle (if not already selected)
6. Click "Start 7-Day Trial" on Pro card
7. **Stripe Checkout should open** with:
   - Price: $9.99/month
   - 7-day trial notice
8. Use test card: `4242 4242 4242 4242`
   - Expiry: 12/25
   - CVC: 123
   - ZIP: 12345
9. Complete checkout
10. **Expected redirect** back to app

**Verify Subscription Active:**

11. Refresh the app
12. Open Settings → Manage Subscription
13. **Expected**:
    - ✅ Blue banner: "🎉 Trial Active"
    - ✅ "Your Pro trial ends in 7 days • All features unlocked"
    - ✅ "Current Plan" button on Pro card
    - ✅ Free and Enterprise cards dimmed
    - ✅ Trial info box at bottom: "💳 No Payment Required Yet"

**Test Annual Subscription (New Account):**

14. Sign out and create another test account
15. Open Settings → Manage Subscription
16. Click Annual toggle
17. **Expected**:
    - Pro card shows: "$99/year"
    - Strikethrough price: "$119.88 Save $20"
    - Button says: "Start Annual Trial"
18. Click button, complete checkout with test card
19. Verify trial active with annual pricing

---

### Test 3: Verify Database Updates

Run this in Supabase SQL Editor:

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

**Expected:**
- Your test accounts show `tier = 'pro'`
- `status = 'trialing'`
- `trial_ends_at` is 7 days from now
- `stripe_customer_id` and `stripe_subscription_id` are populated

---

### Test 4: Verify Stripe Dashboard

Go to https://dashboard.stripe.com (TEST mode):

1. **Customers** tab:
   - ✅ See your test customer(s)
   - ✅ Email matches test account

2. **Subscriptions** tab:
   - ✅ Active subscription(s)
   - ✅ Status: "Trialing"
   - ✅ Trial ends in 7 days
   - ✅ Price: $9.99/month or $99/year

3. **Webhooks** tab:
   - ✅ Click your webhook endpoint
   - ✅ Recent events show: `checkout.session.completed`
   - ✅ Status: Succeeded (green checkmark)

---

### Test 5: Test Webhook Functionality

**Manually cancel a subscription to test webhook:**

1. In Stripe Dashboard → Subscriptions
2. Click on your test subscription
3. Click "Cancel subscription"
4. Choose "Cancel immediately"
5. Refresh your app
6. Open Settings → Manage Subscription

**Expected:**
- ✅ No more blue "Trial Active" banner
- ✅ Back to Free tier
- ✅ "Current Plan" button on Free card
- ✅ "Start 7-Day Trial" button back on Pro card

**Check database:**
```sql
SELECT email, tier, status
FROM auth.users u
JOIN user_subscriptions s ON u.id = s.user_id
WHERE u.email = 'testuser@example.com';
```

**Expected:**
- `tier = 'free'`
- `status = 'canceled'`

---

### Test 6: Visual Regression Tests

**Free Tier (New Account):**
- [ ] Monthly toggle visible
- [ ] Pro card has blue border (Recommended)
- [ ] All features listed correctly
- [ ] "Current Plan" on Free card (green outline)

**Pro Tier (Trial Active):**
- [ ] Blue banner with trial countdown
- [ ] "Current Plan" on Pro card
- [ ] Free and Enterprise cards dimmed (opacity 0.7)
- [ ] Trial info box at bottom

**Developer Tier (Your Account):**
- [ ] Purple banner: "🔧 Developer Account"
- [ ] All cards dimmed with "Developer Account" buttons
- [ ] Purple developer notice at bottom

---

## 🐛 Troubleshooting

### Issue: "Loading subscription..." never finishes
- **Check**: Is `user_subscriptions` table accessible?
- **Fix**: Run migrations: `supabase db push`

### Issue: Stripe Checkout doesn't open
- **Check**: Browser console for errors
- **Fix**: Verify Edge Function deployed: `supabase functions deploy create-checkout-session`

### Issue: Subscription doesn't update after payment
- **Check**: Stripe webhook logs (Dashboard → Webhooks)
- **Check**: Supabase Edge Function logs: `supabase functions logs stripe-webhook`
- **Fix**: Verify webhook secret is set: `supabase secrets list`

### Issue: Price IDs not found
- **Check**: Supabase secrets contain price IDs
- **Fix**: Run: `supabase secrets list`
- **Fix**: Set missing secrets: `supabase secrets set STRIPE_PRO_MONTHLY_PRICE_ID=price_xxx`

---

## 📊 Test Results Checklist

After testing, verify:

- [ ] Developer account shows purple badge
- [ ] Free tier shows all 3 pricing cards correctly
- [ ] Pro monthly trial works ($9.99/mo)
- [ ] Pro annual trial works ($99/year with discount)
- [ ] Trial countdown displays correctly
- [ ] Stripe Checkout opens in browser (not Electron modal)
- [ ] Subscription updates in database after payment
- [ ] Webhook receives and processes events
- [ ] User sees "Current Plan" on correct tier
- [ ] Cancellation downgrades to Free tier
- [ ] All pricing matches ($0, $9.99, $99, $20)
- [ ] All features listed correctly per tier

---

## 🎯 Success Criteria

✅ **Phase 1 Complete** when:
1. Developer account shows unlimited access
2. New user can start Pro trial
3. Stripe processes payment
4. Database updates automatically
5. User sees trial countdown
6. Cancellation works and downgrades to Free

---

## 📝 Notes

- All prices are in USD
- Trial is 7 days for Pro tier
- No trial for Enterprise (Contact Sales)
- Developer tier is manual-only (not available via Stripe)
- Test mode uses fake cards - no real charges
- Webhook secret must match between Stripe and Supabase

