# Resend Domain Verification Guide

This guide walks you through verifying a custom domain with Resend so your transactional emails (trial ending, payment confirmations, etc.) come from your domain instead of `resend.dev`.

## Why Verify a Domain?

**Current State**: Emails are sent from `onboarding@resend.dev`
**After Verification**: Emails will be sent from `noreply@yourdomain.com` (or whatever you choose)

**Benefits**:
- ✅ Professional appearance
- ✅ Better deliverability (less likely to be marked as spam)
- ✅ Brand trust
- ✅ Required for production use

---

## Step 1: Access Resend Dashboard

1. Go to [https://resend.com/domains](https://resend.com/domains)
2. Sign in with the account you used to create your API key
3. Click **"Add Domain"**

---

## Step 2: Add Your Domain

1. Enter your domain (e.g., `yourdomain.com`)
2. Choose your region (usually **US East (N. Virginia)**)
3. Click **"Add"**

---

## Step 3: Add DNS Records

Resend will provide you with DNS records to add to your domain. You'll need to add these records to your DNS provider (e.g., Cloudflare, GoDaddy, Namecheap, etc.).

### Example Records:

You'll see something like this:

| Type  | Name/Host         | Value                                  | Priority |
|-------|-------------------|----------------------------------------|----------|
| TXT   | @                 | resend-domain-verify=abc123...         | -        |
| MX    | @                 | feedback-smtp.us-east-1.amazonses.com  | 10       |
| TXT   | @ (SPF)           | v=spf1 include:amazonses.com ~all      | -        |
| TXT   | resend._domainkey | k=rsa; p=MIGfMA0GCS...                 | -        |

### How to Add DNS Records:

#### **Option A: Cloudflare**
1. Log in to Cloudflare
2. Select your domain
3. Go to **DNS** > **Records**
4. Click **Add record** for each record type
5. Copy the Type, Name, and Value from Resend
6. Click **Save**

#### **Option B: Other DNS Providers**
- **GoDaddy**: Domains → Manage DNS → Add Record
- **Namecheap**: Domain List → Manage → Advanced DNS → Add New Record
- **Google Domains**: DNS → Custom records → Manage custom records

**Important Notes**:
- For `@` in the Name/Host field, some providers require you to enter your full domain or leave it blank
- For the DKIM record (`resend._domainkey`), make sure to include the full name exactly as shown
- DNS changes can take 24-48 hours to propagate (usually much faster, often 5-15 minutes)

---

## Step 4: Verify the Domain

1. Return to the Resend dashboard
2. Click **"Verify Records"** next to your domain
3. If all records are correct, you'll see: ✅ **Domain Verified**
4. If verification fails, double-check your DNS records and wait a bit longer for propagation

---

## Step 5: Update Email Templates (Optional)

Once verified, you can update the "from" address in your email templates:

### Current Code (in `stripe-webhook/index.ts`):
```typescript
from: 'Survey App <onboarding@resend.dev>',
```

### Update to:
```typescript
from: 'Survey App <noreply@yourdomain.com>',
```

**Example**:
```typescript
await resend.emails.send({
    from: 'Survey Team <noreply@surveyapp.com>',  // ← Update this
    to: email,
    subject: 'Your trial is ending soon',
    // ...
});
```

---

## Step 6: Redeploy Supabase Function

After updating the email templates:

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

---

## Testing

After verification and redeployment:

1. Trigger a test email (e.g., cancel a trial subscription to trigger "trial ending" email)
2. Check your inbox
3. Verify the email now comes from `noreply@yourdomain.com` instead of `resend.dev`
4. Check spam folder if you don't see it (first emails from new domain may be flagged)

---

## Troubleshooting

### ❌ "Domain not verified"
- Wait longer (DNS propagation can take up to 48 hours)
- Double-check DNS records match exactly what Resend shows
- Use [MX Toolbox](https://mxtoolbox.com/) to verify DNS records are live
- Try the "Verify Records" button again

### ❌ Emails going to spam
- Make sure all DNS records are added (especially SPF and DKIM)
- Wait a few days for domain reputation to build
- Ask recipients to mark as "Not Spam" to train filters
- Consider adding DMARC record for extra security

### ❌ DNS records not propagating
- Check with your DNS provider's support
- Some providers have caching delays
- Use `dig` or `nslookup` to check if records are live:
  ```bash
  dig TXT yourdomain.com
  dig TXT resend._domainkey.yourdomain.com
  ```

---

## Current Status

- [ ] Domain added to Resend
- [ ] DNS records added to DNS provider
- [ ] Domain verified in Resend dashboard
- [ ] Email templates updated with new "from" address
- [ ] Supabase function redeployed
- [ ] Test email sent and verified

---

## Next Steps

Once domain is verified:
1. ✅ Update all email templates in `supabase/functions/stripe-webhook/index.ts`
2. ✅ Redeploy the function
3. ✅ Test with real subscription events
4. ✅ Move to production Stripe setup

---

## Resources

- [Resend Domains Documentation](https://resend.com/docs/dashboard/domains/introduction)
- [DNS Record Checker](https://mxtoolbox.com/)
- [Resend Support](https://resend.com/support)

---

**Questions?** If you run into issues, check the Resend dashboard for detailed error messages and DNS status.
