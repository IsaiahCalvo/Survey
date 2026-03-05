# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**Microsoft Graph API (OneDrive / SharePoint / Excel Online):**
- Purpose: Cloud file storage, Excel sync, real-time co-authoring
- SDK: `@microsoft/microsoft-graph-client` ^3.0.7
- Auth: Direct OAuth2 PKCE flow via `@azure/msal-browser` ^4.26.2
- Azure App Client ID: `0da81a9e-2b05-46ee-b826-5efc5114c765` (hardcoded in `src/authConfig.js` and `src/contexts/MSGraphContext.jsx`)
- Redirect URI: `http://localhost:5173`
- Scopes: `User.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `openid`, `profile`, `offline_access`
- Token endpoint: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Token storage: Supabase `connected_services` table (access_token, refresh_token, id_token, expires_at)
- Token refresh: Automatic every 10 minutes via interval in `src/contexts/MSGraphContext.jsx`
- Electron flow: Uses dedicated OAuth window (`src/electron-main.js` `oauth:openWindow` IPC handler)
- Key files:
  - `src/authConfig.js` - MSAL configuration and scopes
  - `src/contexts/MSGraphContext.jsx` - OAuth flow, token lifecycle, Graph client initialization
  - `src/services/excelGraphService.js` - OneDrive file CRUD (upload, download, list, metadata)
  - `src/services/excelSessionService.js` - Excel workbook session API for real-time co-authoring
  - `src/components/OneDriveConnectButton.jsx` - UI for connecting OneDrive
  - `src/components/OneDriveFolderBrowser.jsx` - Folder browsing UI
  - `src/components/OneDriveFileSaveModal.jsx` - Save-to-OneDrive dialog
  - `src/utils/oneDriveUtils.js` - OneDrive utility helpers

**Stripe (Payments & Subscriptions):**
- Purpose: Subscription billing (Free / Pro / Enterprise tiers)
- Client SDK: `@stripe/stripe-js` ^8.5.3
- Server SDK: Stripe via ESM (`https://esm.sh/stripe@...`) in Deno Edge Functions
- Client-side env var: `VITE_STRIPE_PUBLISHABLE_KEY`
- Server-side secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- Pricing: Pro Monthly (~$9.99), Pro Annual (~$99), Enterprise
- Trial: 7-day free trial for Pro tier
- Key files:
  - `src/components/StripeCheckout.jsx` - Checkout button, invokes `create-checkout-session` edge function
  - `supabase/functions/create-checkout-session/index.ts` - Creates Stripe Checkout Session
  - `supabase/functions/create-portal-session/index.ts` - Creates Stripe Billing Portal Session
  - `supabase/functions/stripe-webhook/index.ts` - Handles webhook events (subscription lifecycle)

**Resend (Transactional Email):**
- Purpose: Subscription lifecycle emails (trial ending, payment failed, cancellation, receipts)
- SDK: `resend` ^2.0.0 (via ESM in Deno)
- Auth env var: `RESEND_API_KEY` (Supabase Edge Function secret)
- From address: `Survey <onboarding@resend.dev>`
- Templates (inline HTML): `trial-ending`, `payment-failed`, `subscription-canceled`, `payment-succeeded`
- Key files:
  - `supabase/functions/send-email/index.ts` - Template-based email sending
  - `supabase/functions/send-profile-change-notification/index.ts` - Account security alerts
  - `supabase/functions/stripe-webhook/index.ts` - Triggers emails on subscription events

## Data Storage

**Supabase PostgreSQL Database:**
- Provider: Supabase (hosted PostgreSQL 17)
- Client: `@supabase/supabase-js` ^2.81.1 (`src/supabaseClient.js`)
- Connection env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Offline support: App functions without Supabase (`isSupabaseAvailable()` check)
- RLS: Enabled on all tables (enforced via 22+ migration files)
- Key tables:
  - `user_subscriptions` - Stripe subscription state, tier, customer/subscription IDs
  - `user_settings` - Per-user preferences (zoom, view mode, theme)
  - `projects` - User project containers
  - `documents` - PDF documents within projects
  - `templates` - Survey templates
  - `spaces` - Page range subdivisions within documents
  - `document_annotations` - Per-document annotation data (highlight positions, categories, metadata)
  - `document_collaborators` - Document-level sharing permissions
  - `project_collaborators` - Project-level sharing permissions
  - `document_presence` - Real-time user presence tracking
  - `connected_services` - OAuth token storage (Microsoft, etc.)
  - `usage_metrics` - Usage tracking per user
- Database types: `src/types/database.ts`
- Database hooks: `src/hooks/useDatabase.js` (useProjects, useDocuments, useTemplates, useSpaces, useStorage, useConnectedServices, useDocumentToolPreferences)
- Migrations: `supabase/migrations/` (22 migration files)
- RPC functions: `check_collaborator_by_email`, `check_user_collaborator_eligibility`, `handle_downgrade_to_free`

**Supabase Storage:**
- Bucket: `documents`
- Path pattern: `{user_id}/{project_id}/{timestamp}.{ext}`
- Operations: Upload, download, delete, public URL generation
- File size limit: 50 MiB (configured in `supabase/config.toml`)
- Key file: `src/hooks/useDatabase.js` (`useStorage` hook)

**Supabase Realtime:**
- Enabled: Yes (`supabase/config.toml` realtime.enabled = true)
- Used for: Document annotation sync, presence updates
- Channel pattern: `document-annotations:{documentId}`, `document-presence:{documentId}`
- Events: postgres_changes (INSERT, UPDATE, DELETE on `document_annotations` and `document_presence`)
- Key file: `src/services/documentAnnotationService.js` (`subscribeToDocumentAnnotations`, `subscribeToDocumentPresence`)

**Local File System (Electron):**
- Purpose: PDF file reading/writing, Excel export to disk, file watching
- API: Electron IPC via preload bridge (`window.electronAPI`)
- Capabilities:
  - `dialog:openFile` - Native file picker for PDFs
  - `dialog:saveFile` - Native save dialog
  - `fs:readFile` / `fs:writeFile` / `fs:writeFileAtomic` - File I/O (atomic writes with temp/backup)
  - `fs:fileExists` / `fs:getFileStats` / `fs:listDir` - File system queries
  - `fileWatcher:start` / `fileWatcher:stop` - File change monitoring via chokidar
- Key files: `src/electron-main.js`, `src/preload.js`

**Local Storage (Browser):**
- Purpose: Tool preferences, MSAL token cache, PKCE session state
- Key patterns: `toolPrefs_{documentId}`, `ms_refresh_block_until`, `ms_pkce_verifier`, `ms_oauth_state`
- Key file: `src/hooks/useDatabase.js` (`useDocumentToolPreferences`)

## Authentication & Identity

**Supabase Auth (Primary):**
- Methods: Email/password, Google OAuth, SSO (enterprise)
- Implementation: `src/contexts/AuthContext.jsx`
- Features:
  - Sign up, sign in, sign out
  - Password reset (via email)
  - Profile metadata updates
  - Google OAuth via Supabase (redirects to Google)
  - SSO via Supabase (domain-based)
  - Electron-aware: Handles OAuth redirects in Electron `will-navigate` events
- Session: Managed by Supabase client (auto-refresh, `onAuthStateChange` listener)

**Microsoft OAuth (Secondary - Service Connection):**
- Purpose: OneDrive/SharePoint access (NOT login)
- Flow: OAuth2 Authorization Code with PKCE
- Auth window: Separate Electron BrowserWindow or browser redirect
- Token lifecycle: Access tokens refreshed every 10 minutes, refresh tokens stored in Supabase
- Hard failure handling: 30-minute block after invalid_grant/revoked tokens
- Implementation: `src/contexts/MSGraphContext.jsx`

**Subscription Tiers (Authorization):**
- Tiers: `free`, `pro`, `enterprise`, `developer`
- Feature gating: `src/contexts/AuthContext.jsx` `features` object
- Limit enforcement: `src/hooks/useSubscriptionLimits.js` (`TIER_LIMITS`)
- Free: 1 project, 5 documents, 100 MB storage, basic annotations
- Pro: Unlimited projects/documents, 10 GB storage, survey tools, templates, Excel export, OneDrive
- Enterprise: Unlimited everything, 1 TB storage, SSO

## Monitoring & Observability

**Error Tracking:**
- No external service (Sentry, Datadog, etc.)
- Error boundary: `src/components/ErrorBoundary.jsx` (React error boundary)

**Logs:**
- Console-based logging throughout
- Performance logging: `src/utils/performanceLogger.js`
- PDF debug logging: `src/utils/pdfDebug.js`
- Supabase Edge Functions: `console.log` / `console.error` (visible in Supabase Dashboard)

## CI/CD & Deployment

**App Hosting:**
- Desktop: Electron (distributed as DMG/NSIS/Linux packages via electron-builder)
- No web hosting for main app (Electron only)

**Landing Page:**
- Platform: Vercel (`landing/vercel.json`)
- Content: Static HTML/CSS (`landing/index.html`, `landing/styles.css`)

**Backend:**
- Platform: Supabase (managed PostgreSQL, Edge Functions, Storage, Auth, Realtime)
- Edge Functions: Deployed to Supabase (Deno runtime)

**CI Pipeline:**
- Not detected (no `.github/workflows/`, `Jenkinsfile`, etc.)

**Backup Scripts:**
- `scripts/auto-backup.sh` - Automated backup
- `scripts/backup-control.sh` - Backup management
- `scripts/backup-daemon.sh` - Background backup daemon
- `scripts/restore-backup.sh` - Restore from backup
- `scripts/protect-backups.sh` - Backup protection

## Environment Configuration

**Required env vars (client .env):**
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous/public key
- `VITE_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key (test or live)
- `VITE_SYNCFUSION_LICENSE_KEY` - Syncfusion license key (optional, has fallback)

**Required secrets (Supabase Edge Function Secrets):**
- `STRIPE_SECRET_KEY` - Stripe server-side key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_PRO_MONTHLY_PRICE_ID` - Stripe price ID for Pro monthly
- `STRIPE_PRO_ANNUAL_PRICE_ID` - Stripe price ID for Pro annual
- `STRIPE_ENTERPRISE_PRICE_ID` - Stripe price ID for Enterprise
- `RESEND_API_KEY` - Resend email API key
- `SUPABASE_URL` - Auto-provided by Supabase
- `SUPABASE_ANON_KEY` - Auto-provided by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Auto-provided by Supabase

**Secrets location:**
- Client-side: `.env` file (gitignored)
- Server-side: Supabase Dashboard -> Edge Functions -> Secrets
- `.env.example` documents all required vars

## Webhooks & Callbacks

**Incoming:**
- `supabase/functions/stripe-webhook/index.ts` - Stripe webhook endpoint
  - JWT verification disabled (`supabase/config.toml` `[functions.stripe-webhook] verify_jwt = false`)
  - Uses Stripe signature verification instead
  - Events handled:
    - `checkout.session.completed` - New subscription activation
    - `customer.subscription.created` / `updated` - Tier changes
    - `customer.subscription.deleted` - Cancellation (downgrades to free, archives excess data)
    - `customer.subscription.trial_will_end` - Trial expiry warning email
    - `invoice.payment_succeeded` - Payment confirmation email
    - `invoice.payment_failed` - Payment failure notification

**Outgoing:**
- Transactional emails via Resend (triggered by webhook events and user actions)
- No outgoing webhooks to external services

---

*Integration audit: 2026-03-04*
