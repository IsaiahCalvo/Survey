# Email Notification Setup Guide

This guide will help you set up email notifications when users change their profile information (name or password).

## Overview

The email notification system uses:
- **Supabase Edge Functions** (serverless functions)
- **Resend API** (email delivery service - free tier: 100 emails/day)

## Step 1: Install Supabase CLI

```bash
# Install Supabase CLI (macOS)
brew install supabase/tap/supabase

# Or using npm
npm install -g supabase
```

## Step 2: Sign Up for Resend

1. Go to [resend.com](https://resend.com)
2. Sign up for a free account
3. Verify your email address
4. Go to **API Keys** in the dashboard
5. Click **Create API Key**
6. Copy the API key (starts with `re_...`)

## Step 3: Configure Resend Email Domain (Optional but Recommended)

By default, emails will be sent from `onboarding@resend.dev`. To use your own domain:

1. In Resend dashboard, go to **Domains**
2. Click **Add Domain**
3. Enter your domain name
4. Follow DNS configuration instructions
5. Wait for verification

Then update the Edge Function code:
```typescript
// In supabase/functions/send-profile-change-notification/index.ts
from: 'Survey <notifications@yourdomain.com>', // Replace this line
```

## Step 4: Link Your Supabase Project

```bash
# Navigate to your project directory
cd /Users/isaiahcalvo/Desktop/Survey

# Login to Supabase
supabase login

# Link to your project (you'll be prompted to select your project)
supabase link
```

## Step 5: Set Environment Variables

Set the Resend API key as a secret in Supabase:

```bash
supabase secrets set RESEND_API_KEY=re_your_api_key_here
```

## Step 6: Deploy the Edge Function

```bash
# Deploy the function
supabase functions deploy send-profile-change-notification
```

## Step 7: Test the Email Notification

1. Open your app at http://localhost:5173
2. Sign in to your account
3. Click on your name (bottom left) → **Account**
4. Click **Edit Profile**
5. Change your first or last name
6. Click **Save Changes**
7. Check your email inbox for the security notification

## Email Template

The email sent to users includes:
- **Subject**: "Security Alert: Your [name/password/name and password] Was Changed"
- **Content**:
  - Confirmation of what changed
  - Warning: "If this wasn't you, contact isaiahcalvo123@gmail.com"
  - Security tips

## Troubleshooting

### Function not found error
```bash
# Make sure the function is deployed
supabase functions list
```

### Email not sending
1. Check Edge Function logs:
```bash
supabase functions logs send-profile-change-notification
```

2. Verify Resend API key is set:
```bash
supabase secrets list
```

3. Check Resend dashboard for any errors

### Testing locally
You can test the Edge Function locally:
```bash
# Start local Supabase
supabase start

# Serve the function locally
supabase functions serve send-profile-change-notification --env-file .env.local
```

## Cost

- **Resend Free Tier**: 100 emails/day, 3,000 emails/month - FREE
- **Supabase Edge Functions**: 500,000 invocations/month - FREE

## Need Help?

If you encounter any issues:
1. Check the browser console for errors
2. Check Supabase Edge Function logs
3. Verify all environment variables are set correctly
4. Ensure your Resend API key is valid

## Alternative: Using Supabase's Built-in Email (Not Recommended for Production)

If you want to skip Resend and use Supabase's built-in email service for testing:
- Note: Limited to 2 emails per hour
- Not reliable for production use
- Would require creating a Database Trigger instead of an Edge Function
