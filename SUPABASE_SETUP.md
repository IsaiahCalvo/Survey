# Supabase Setup Guide

## Step 1: Create Supabase Project

1. Go to https://supabase.com and sign up/login
2. Click "New Project"
3. Fill in:
   - **Name**: Survey App (or whatever you prefer)
   - **Database Password**: Create a strong password (save it!)
   - **Region**: Choose closest to you
4. Wait for project to finish setting up (~2 minutes)

## Step 2: Get API Credentials

1. In your Supabase dashboard, go to **Project Settings** → **API**
2. Copy these two values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (long string under "Project API keys")
3. Paste them into your `.env` file:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

## Step 3: Create Database Tables

1. Go to **Database** → **SQL Editor** in your Supabase dashboard
2. Click **New Query**
3. Copy the entire contents of `supabase-schema.sql` and paste it into the editor
4. Click **Run** (or press Ctrl+Enter)
5. You should see "Success. No rows returned" - this is good!

## Step 4: Set Up Storage Buckets

1. Go to **Storage** in your Supabase dashboard
2. Click **New bucket**
3. Create these two buckets:

### Bucket 1: documents
- **Name**: `documents`
- **Public**: No (unchecked)
- **Allowed MIME types**: `application/pdf`
- **File size limit**: 50 MB (or whatever you prefer)

### Bucket 2: templates (optional)
- **Name**: `templates`
- **Public**: No (unchecked)
- **Allowed MIME types**: `application/pdf`
- **File size limit**: 50 MB

## Step 5: Configure Storage Policies

For each bucket, you need to set up Row Level Security policies:

### For 'documents' bucket:

1. Click on the bucket → **Policies** tab → **New Policy**
2. Create a policy from template or custom:

**SELECT Policy** (Users can view their own files):
```sql
(bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
```

**INSERT Policy** (Users can upload files):
```sql
(bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
```

**UPDATE Policy** (Users can update their files):
```sql
(bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
```

**DELETE Policy** (Users can delete their files):
```sql
(bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
```

Repeat for the 'templates' bucket.

## Step 6: Enable Authentication Providers

### Email/Password (Enabled by default)
1. Go to **Authentication** → **Providers**
2. Email provider should already be enabled

### Google OAuth
1. In **Authentication** → **Providers**, find **Google**
2. Click **Enable**
3. You'll need to:
   - Create a Google OAuth app in Google Cloud Console
   - Add `https://your-project.supabase.co/auth/v1/callback` as authorized redirect URI
   - Copy Client ID and Client Secret from Google and paste into Supabase
4. Follow Supabase's guide: https://supabase.com/docs/guides/auth/social-login/auth-google

### SSO (Enterprise/Team Plan)
1. SSO requires Supabase Pro plan or higher
2. Go to **Authentication** → **SAML 2.0**
3. Configure with your company's identity provider
4. Guide: https://supabase.com/docs/guides/auth/sso/auth-sso-saml

## Step 7: Test Your Setup

1. Make sure your `.env` file has the correct values
2. Restart your development server: `npm run dev`
3. You should see no errors about Supabase connection
4. In the browser console, test:

```javascript
// In browser console
console.log(window.supabase) // Should not be null
```

## File Organization in Storage

Files will be organized like this:
```
documents/
  {user_id}/
    {project_id}/
      document1.pdf
      document2.pdf

templates/
  {user_id}/
    template1.pdf
    template2.pdf
```

This structure ensures:
- Users can only access their own files (enforced by RLS)
- Files are organized by project
- Easy cleanup when projects/users are deleted

## Troubleshooting

### "Invalid API key"
- Check that your `.env` file has the correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Make sure you copied the **anon public** key, not the **service_role** key

### "Row Level Security policy violation"
- Make sure you ran the SQL schema (Step 3)
- Check that RLS policies are enabled on all tables
- Try running the SQL again

### "Could not create bucket"
- Bucket names must be lowercase and unique
- Check if bucket already exists

### Can't upload files
- Check storage policies are set up correctly
- Make sure file path follows format: `{user_id}/{project_id}/{filename}`
- Verify MIME type is allowed (should be `application/pdf`)
