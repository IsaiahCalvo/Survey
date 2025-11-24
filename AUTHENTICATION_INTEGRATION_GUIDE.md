# Authentication Integration Guide

## Overview

You now have a complete authentication system set up! This guide will walk you through integrating it into your PDF viewer application.

## What's Been Created

### 1. **Core Setup**
- ✅ Supabase client (`src/supabaseClient.js`)
- ✅ Environment configuration (`.env`, `.env.example`)
- ✅ Database schema (`supabase-schema.sql`)
- ✅ TypeScript types (`src/types/database.ts`)

### 2. **Authentication System**
- ✅ Auth context (`src/contexts/AuthContext.jsx`)
- ✅ Database hooks (`src/hooks/useDatabase.js`)
- ✅ Auth modal component (`src/components/AuthModal.jsx`)
- ✅ User menu component (`src/components/UserMenu.jsx`)

### 3. **Features Available**
- Email/Password authentication
- Google OAuth sign-in
- SSO (company sign-in)
- Password reset
- User profile management
- Project/document/template/space CRUD operations
- PDF file upload/download via Supabase Storage

## Next Steps: Integration

### Step 1: Complete Supabase Setup

1. **Create your Supabase project** (if you haven't already):
   - Go to https://supabase.com
   - Create a new project
   - Wait for it to finish provisioning

2. **Add your credentials to `.env`**:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Run the database schema**:
   - Open your Supabase dashboard
   - Go to Database → SQL Editor
   - Copy all contents from `supabase-schema.sql`
   - Paste and run it

4. **Set up storage buckets** (follow `SUPABASE_SETUP.md`)

### Step 2: Add Authentication to Your App

Now you need to add the optional login flow to your `App.jsx`. Here's how:

#### Option A: Add to Your Existing App Component

Add this code near the top of your `App.jsx` component (after imports):

```javascript
import { useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/AuthModal';
import { UserMenu } from './components/UserMenu';
import { useEffect, useState } from 'react';

function App() {
  const { user, isAuthenticated, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPromptDismissed, setAuthPromptDismissed] = useState(false);

  // Show auth prompt on first visit (if not dismissed and not logged in)
  useEffect(() => {
    const dismissed = localStorage.getItem('authPromptDismissed');
    if (dismissed) {
      setAuthPromptDismissed(true);
    } else if (!loading && !isAuthenticated) {
      // Show modal after a brief delay
      const timer = setTimeout(() => {
        setShowAuthModal(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading, isAuthenticated]);

  const handleDismissAuthPrompt = () => {
    localStorage.setItem('authPromptDismissed', 'true');
    setAuthPromptDismissed(true);
    setShowAuthModal(false);
  };

  // ... rest of your App component
}
```

#### Option B: Add "Sign In" Button to Your Toolbar

Find where you render your toolbar/header and add:

```javascript
<div className="toolbar">
  {/* ... your existing toolbar items ... */}

  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
    {!isAuthenticated ? (
      <button
        onClick={() => setShowAuthModal(true)}
        style={{
          padding: '8px 16px',
          background: '#0066ff',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '500'
        }}
      >
        Sign In
      </button>
    ) : (
      <UserMenu />
    )}
  </div>
</div>

{/* Render the auth modal */}
<AuthModal
  isOpen={showAuthModal}
  onClose={() => setShowAuthModal(false)}
  onDismiss={!authPromptDismissed ? handleDismissAuthPrompt : null}
/>
```

### Step 3: Using the Database Hooks

Once users are authenticated, you can use the database hooks to manage their data:

```javascript
import { useProjects, useDocuments, useStorage } from './hooks/useDatabase';

function YourComponent() {
  const { projects, createProject, updateProject, deleteProject } = useProjects();
  const { documents, createDocument } = useDocuments();
  const { uploadDocument, downloadDocument } = useStorage();
  const { user } = useAuth();

  const handleCreateProject = async () => {
    try {
      const newProject = await createProject({
        name: 'My Project',
        description: 'Project description',
        color: '#667eea'
      });
      console.log('Created project:', newProject);
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handleUploadPDF = async (file, projectId) => {
    try {
      // Upload file to Supabase Storage
      const filePath = await uploadDocument(file, projectId);

      // Create document record in database
      const document = await createDocument({
        project_id: projectId,
        name: file.name,
        file_path: filePath,
        file_size: file.size,
        page_count: 0, // You can get this after loading the PDF
      });

      console.log('Document created:', document);
    } catch (error) {
      console.error('Error uploading document:', error);
    }
  };

  return (
    <div>
      {/* Your component UI */}
    </div>
  );
}
```

### Step 4: Syncing User Settings

Use the `useUserSettings` hook to save and load user preferences:

```javascript
import { useUserSettings } from './hooks/useDatabase';

function YourComponent() {
  const { settings, updateSettings } = useUserSettings();

  // Load user's preferred zoom level
  useEffect(() => {
    if (settings?.default_zoom) {
      setZoom(settings.default_zoom);
    }
  }, [settings]);

  // Save zoom preference when it changes
  const handleZoomChange = async (newZoom) => {
    setZoom(newZoom);
    if (user) {
      await updateSettings({ default_zoom: newZoom });
    }
  };

  return (
    <div>
      {/* Your component UI */}
    </div>
  );
}
```

## Example: Save to Cloud Feature

Here's how to implement "Save to Cloud" for anonymous users:

```javascript
function App() {
  const { user } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState(null);

  const handleSaveToCloud = (data) => {
    if (!user) {
      // Prompt user to sign in
      setPendingSaveData(data);
      setShowAuthModal(true);
    } else {
      // User is authenticated, save directly
      saveToCloud(data);
    }
  };

  const saveToCloud = async (data) => {
    // Upload document and create project
    try {
      const project = await createProject({ name: 'My Work' });
      const filePath = await uploadDocument(data.file, project.id);
      await createDocument({
        project_id: project.id,
        name: data.name,
        file_path: filePath,
        // ... other fields
      });
      alert('Saved to cloud!');
    } catch (error) {
      console.error('Error saving:', error);
    }
  };

  // When user successfully logs in, save pending data
  useEffect(() => {
    if (user && pendingSaveData) {
      saveToCloud(pendingSaveData);
      setPendingSaveData(null);
    }
  }, [user, pendingSaveData]);

  return (
    <div>
      {/* Your app UI */}

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => {
          setShowAuthModal(false);
          setPendingSaveData(null); // Clear pending data if user closes modal
        }}
      />
    </div>
  );
}
```

## Testing Your Implementation

### 1. Test Authentication
- Click "Sign In" button
- Create a new account with email/password
- Check your email for verification link
- Try signing in with Google (requires OAuth setup)
- Test password reset

### 2. Test Database Operations
- Create a project
- Upload a PDF document
- View your projects/documents
- Update and delete items
- Check that only your data is visible (RLS working)

### 3. Test in Browser DevTools
```javascript
// In browser console:
console.log(window.supabase); // Should see Supabase client
console.log(await window.supabase.auth.getUser()); // See current user
```

## Common Issues and Solutions

### Issue: "Invalid API key"
**Solution**: Check your `.env` file has the correct credentials and restart dev server.

### Issue: "Row Level Security policy violation"
**Solution**: Make sure you ran the `supabase-schema.sql` in your Supabase SQL Editor.

### Issue: Google OAuth not working
**Solution**: You need to configure Google OAuth in Supabase dashboard and Google Cloud Console. See `SUPABASE_SETUP.md` for details.

### Issue: Can't upload files
**Solution**: Make sure you created the storage buckets and set up the RLS policies. See `SUPABASE_SETUP.md` Step 5.

### Issue: App shows "offline mode"
**Solution**: Your `.env` credentials are missing or invalid. Check `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Next Steps

Now that authentication is integrated, you can:

1. **Create a Projects Dashboard**: Build a UI to list, create, and manage projects
2. **Add Document Library**: Show user's uploaded documents with search/filter
3. **Implement Templates**: Let users create and save reusable templates
4. **Add Spaces UI**: Allow users to define page ranges for project phases
5. **Sync Preferences**: Save zoom, view mode, theme, etc.
6. **Collaborative Features**: Add sharing and permissions (requires additional RLS policies)

## Architecture Diagram

```
User Signs In → AuthContext → Supabase Auth
                    ↓
                User Object
                    ↓
    ┌───────────────┴───────────────┐
    ↓                               ↓
Database Hooks              Storage Hooks
    ↓                               ↓
Projects/Documents          File Upload/Download
Templates/Spaces
Settings
    ↓
Row Level Security (RLS)
    ↓
User Can Only Access Their Own Data
```

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **Auth Guide**: https://supabase.com/docs/guides/auth
- **Storage Guide**: https://supabase.com/docs/guides/storage
- **RLS Guide**: https://supabase.com/docs/guides/auth/row-level-security

---

**Need Help?** Check the example code in this guide or refer to the Supabase documentation.
