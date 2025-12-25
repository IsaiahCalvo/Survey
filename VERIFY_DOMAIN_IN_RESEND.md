# Verify survey-app.vercel.app in Resend

## What I've Done ✅

1. ✅ Updated email sender to: `noreply@survey-app.vercel.app`
2. ✅ Redeployed send-email function

## Your Turn: Add Domain to Resend (3 minutes)

### Step 1: Open Resend Domains

Go to: **https://resend.com/domains**

### Step 2: Add Domain

1. Click **"Add Domain"** button
2. Enter: `survey-app.vercel.app`
3. Click **"Add"** or **"Continue"**

### Step 3: What Happens Next

Resend will show you one of two things:

**Scenario A: DNS Records Required**

If Resend shows DNS records (TXT, MX, CNAME), we have a problem:
- You don't control DNS for `survey-app.vercel.app` (Vercel does)
- We can't add DNS records

**Solution:** Use a different approach (see below)

**Scenario B: Automatic Verification**

If Resend verifies automatically or doesn't require DNS:
- ✅ You're done!
- Emails will work immediately

---

## If DNS Records Are Required (Likely)

Don't worry! We have a workaround.

### Option 1: Use Resend's Shared Domain (Recommended)

Resend has a feature for this exact situation:

1. In Resend domains page, look for **"Verified Domains"** or **"Shared Sending Domain"**
2. Resend provides a pre-verified domain you can use
3. Example: `resend.dev` or similar

I'll update the code to use Resend's verified domain instead.

**Tell me:** Do you see any pre-verified domains in your Resend dashboard?

### Option 2: Use Your Custom Domain (survey-app.app)

Since you already own `survey-app.app`, we can:
1. Verify `survey-app.app` in Resend (requires DNS setup)
2. Use sender: `noreply@survey-app.app`
3. More professional!

**This requires:** Adding DNS records where you bought survey-app.app

---

## Quick Test First

Before we decide, let's test if the current setup works:

Run this in terminal:

```bash
curl -X POST "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/send-email" \
  -H "Content-Type: application/json" \
  -d '{"to":"isaiahcalvo0@gmail.com","subject":"Test from survey-app.vercel.app","template":"subscription-canceled","data":{"firstName":"Isaiah","appUrl":"https://survey-app.vercel.app"}}'
```

**Check your email:** `isaiahcalvo0@gmail.com`

**If you get an email:** ✅ It's working! Resend might have auto-verified!

**If you get an error in the response:** We need to use Option 1 or 2 above.

---

## What To Do Now

**Step 1:** Try adding `survey-app.vercel.app` to Resend

**Step 2:** Run the test command above

**Step 3:** Tell me what happens:
- "Added to Resend successfully, email received!" ✅
- "Added to Resend but need DNS records" → We'll use Option 1 or 2
- "Got an error: [error message]" → I'll help troubleshoot

Let me know what happens! 🚀
