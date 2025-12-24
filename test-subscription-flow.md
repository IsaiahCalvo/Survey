# Subscription System Test Plan

## Prerequisites
✅ Supabase functions deployed (stripe-webhook, send-email, create-portal-session)
✅ Email sender updated to use onboarding@resend.dev
✅ Dynamic portal URLs configured in webhook
⚠️  RESEND_API_KEY needs to be set in Supabase secrets

## Test Flow

### 1. Test Customer Portal (Works Now!)
1. Open your app and sign in
2. Go to Account Settings → Manage Subscription
3. Click "Manage Billing & Payments" button
4. ✅ Portal should open in new window/tab
5. In portal, try:
   - View payment methods
   - View billing history
   - Cancel subscription (optional - for testing)

### 2. Test Subscription Cancellation Email (Requires Resend)
1. In Stripe portal, cancel your subscription
2. Check webhook logs: `supabase functions logs stripe-webhook --project-ref cvamwtpsuvxvjdnotbeg`
3. ✅ Should see: "Subscription canceled, downgraded to free tier"
4. ✅ Should see: "Email sent: subscription-canceled to [your-email]"
5. Check your email inbox for cancellation confirmation

### 3. Test New Trial Signup Email (Requires Resend)
1. Cancel any existing subscription (if not already done)
2. Sign up for new Pro trial in app
3. Check webhook logs for:
   - ✅ "SUCCESS: Updated subscription for user... to pro (trialing)"
   - Note: Trial ending email won't send until 3 days before trial ends
4. You can manually trigger trial ending email via Stripe CLI:
   ```bash
   stripe trigger customer.subscription.trial_will_end
   ```

### 4. Test Payment Failed Email (Requires Resend)
Trigger via Stripe CLI:
```bash
stripe trigger invoice.payment_failed
```
Check webhook logs and email inbox.

### 5. Test Payment Succeeded Email (Requires Resend)
After trial ends and first payment processes (or trigger via CLI):
```bash
stripe trigger invoice.payment_succeeded
```

## What Works Right Now (Without Resend)
✅ Customer Portal button in app
✅ Portal opens and works
✅ Subscription cancellation via portal
✅ Database syncs with Stripe
✅ UI auto-refreshes on window focus

## What Needs Resend API Key
⚠️  Trial ending emails
⚠️  Payment failed emails
⚠️  Payment succeeded emails
⚠️  Subscription canceled emails

## Setting Resend API Key
1. Sign up at https://resend.com/signup
2. Get API key from https://resend.com/api-keys
3. Run: `supabase secrets set RESEND_API_KEY=re_xxx --project-ref cvamwtpsuvxvjdnotbeg`
4. Verify: `supabase secrets list --project-ref cvamwtpsuvxvjdnotbeg`

## Current Configuration
- Email sender: `Survey App <onboarding@resend.dev>` (works without domain verification)
- Portal return URL: `http://localhost:5173`
- Portal URLs: Dynamically generated for each email
- All email templates ready with proper styling
