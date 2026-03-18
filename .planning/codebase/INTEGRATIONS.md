# External Integrations

**Analysis Date:** 2026-03-17

## APIs & External Services

**Azure/Microsoft Services:**
- Azure AD (Azure Entra) - User authentication and authorization
  - Client ID: `0da81a9e-2b05-46ee-b826-5efc5114c765` (hardcoded in `src/authConfig.js`)
  - Authority: `https://login.microsoftonline.com/common`
  - Redirect URI: `http://localhost:5173`
  - SDK: `@azure/msal-browser` 4.26.2, `@azure/msal-node` 3.8.3
  - Config: `src/authConfig.js`

**Microsoft Graph API:**
- Scopes: `User.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`
- Endpoints:
  - `https://graph.microsoft.com/v1.0/me` - Current user profile
  - `https://graph.microsoft.com/v1.0/me/drive/root/children` - OneDrive file listing
- SDK: `@microsoft/microsoft-graph-client` 3.0.7
- Usage: `src/contexts/MSGraphContext.jsx`

**Stripe Payments:**
- Publishable Key: `VITE_STRIPE_PUBLISHABLE_KEY` (environment variable)
- SDK: `@stripe/stripe-js` 8.5.3
- Used for subscription billing with three tiers: free, pro, enterprise
- Checkout flow: Supabase Edge Function `create-checkout-session` initiates, returns Stripe URL
- Webhook handling: Server-side via Supabase Edge Functions (secrets configured there)
- Component: `src/components/StripeCheckout.jsx`
- Subscription state stored in `user_subscriptions` table
- Stripe customer ID tracked in database

## Data Storage

**Databases:**
- Supabase PostgreSQL
  - Connection: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (environment variables)
  - Anon key used for client-side access with RLS (Row Level Security)
  - Tables used:
    - `user_settings` - User preferences and configuration
    - `user_subscriptions` - Subscription tiers and billing status
    - `connected_services` - OAuth tokens for Azure/Microsoft services
    - `documents` - PDF document metadata and associations
    - `annotations` - Canvas annotations on pages
    - Potentially others for projects, spaces, regions (inferred from code)
  - Client: `@supabase/supabase-js` 2.81.1
  - Config: `src/supabaseClient.js`

**File Storage:**
- OneDrive (via Microsoft Graph API)
  - Accessed through MSGraphContext
  - Service: `src/services/excelSessionService.js` - Excel file operations
  - Service: `src/services/excelGraphService.js` - Graph-specific operations
- Local filesystem (Electron app)
  - PDFs loaded from user's local machine

**Caching:**
- Session Storage (browser)
  - Microsoft Graph refresh token cooldown tracking: `ms_refresh_block_until`
- React Context state
  - AuthContext for user session and subscription state
  - MSGraphContext for Microsoft Graph client and account info
- In-memory references
  - Last known Supabase overlay pages (PageAnnotationLayer.jsx)

## Authentication & Identity

**Auth Provider:**
- Azure AD (Entra) via MSAL
  - Configuration: `src/authConfig.js`
  - Implementation: `src/contexts/AuthContext.jsx`
  - Browser client: MSAL v4.26.2

**Session Management:**
- Supabase Auth (email/password and OAuth)
  - Auth state stored in localStorage (browser)
  - MSAL state stored in localStorage (browser)
  - Token management: AuthContext listens to `supabase.auth.onAuthStateChange()`

**Scopes & Permissions:**
- MSAL: `User.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`
- Supabase: Anon key with RLS restrictions

**Token Storage:**
- MSAL: localStorage (configured in `src/authConfig.js`)
- Supabase: Automatic by SDK
- Microsoft Graph: In-memory reference via `tokenRef` in MSGraphContext
- Refresh token cooldown: sessionStorage (60-second cooldown, 30-minute hard block)

## Monitoring & Observability

**Error Tracking:**
- Not detected - no external error tracking service (Sentry, etc.)

**Logs:**
- Console logging (development):
  - MSAL logger configured to suppress COOP/iframe warnings
  - PDF.js warnings about undefined functions suppressed
  - Service-level error logging in hooks and contexts
- No external logging service detected

## CI/CD & Deployment

**Hosting:**
- Not applicable - desktop Electron application, not web service
- Development: Vite dev server on port 5173
- Electron app distributed as platform-specific installers

**CI Pipeline:**
- Playwright tests in `debug/playwright.config.mjs`
- No external CI service detected (GitHub Actions, etc.)
- Manual test scenarios in `debug/scenarios/`

**Build Process:**
- Vite build to `dist/`
- Electron-builder packages desktop app
- Platform-specific targets: macOS (dmg), Windows (NSIS), Linux

## Environment Configuration

**Required env vars:**
```
VITE_SUPABASE_URL              # Supabase project URL
VITE_SUPABASE_ANON_KEY         # Supabase anonymous key
VITE_STRIPE_PUBLISHABLE_KEY    # Stripe publishable key (pk_test_* or pk_live_*)
VITE_SYNCFUSION_LICENSE_KEY    # Optional; fallback key available
```

**Server-side secrets (Supabase Edge Functions only):**
- `STRIPE_SECRET_KEY` - Stripe secret key (sk_test_* or sk_live_*)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature secret
- `STRIPE_PRO_MONTHLY_PRICE_ID` - Stripe price ID for $9.99/month
- `STRIPE_PRO_ANNUAL_PRICE_ID` - Stripe price ID for $99/year
- `STRIPE_ENTERPRISE_PRICE_ID` - Stripe price ID for $20/user/month

**Secrets location:**
- `.env` file (local development, not committed)
- Supabase Dashboard → Edge Functions → Secrets (production)

## Webhooks & Callbacks

**Incoming:**
- Stripe webhooks - Handled by Supabase Edge Function
  - Webhook endpoint: Supabase Edge Function (configuration in Stripe dashboard)
  - Events: `customer.subscription.*`, `payment_intent.*`, etc.
  - Secret: `STRIPE_WEBHOOK_SECRET` environment variable

**Outgoing:**
- OAuth callbacks - Handled by Electron main process
  - Supabase OAuth redirect: Back to `http://localhost:5173` or production URL
  - Microsoft Graph: Token refresh callbacks handled in-memory
  - Electron: `will-navigate` handler processes OAuth hash fragments

**Supabase Edge Functions:**
- `create-checkout-session` - Invoked by `StripeCheckout.jsx`
  - Input: `{ tier, billingPeriod }`
  - Output: `{ url, error }`

## API Communication Patterns

**Supabase Client API:**
- Direct RLS-protected queries from frontend
  - `supabase.from('table_name').select(...)`
  - `supabase.from('table_name').upsert(...)`
  - Error handling: 406 schema cache errors silently ignored
  - Not found errors (PGRST116) distinguished in `useDatabase.js`

**Supabase Edge Functions:**
- Invoked via `supabase.functions.invoke('function-name', { body: {...} })`
- Returns JSON response with potential `error` field

**Microsoft Graph API:**
- Invoked through Graph client initialized in MSGraphContext
- Token injected via authProvider callback
- Refresh token management with cooldown to prevent rate limiting

**Stripe:**
- Client-side: `@stripe/stripe-js` for card elements (not directly used, checkout via Edge Function)
- Server-side: Stripe SDK via Edge Functions
- Webhook validation via signature verification in Edge Function

## Service Availability Handling

**Supabase:**
- Offline mode: App detects missing credentials and logs warning
- `isSupabaseAvailable()` checks before any database operation
- Schema cache errors (406) treated as temporary and retried
- Connected services table may not exist initially (graceful fallback)

**Microsoft Graph:**
- Refresh token refresh blocked during cooldown period (60s)
- Hard block on refresh for 30 minutes if error occurs
- Error code stored to prevent repeated failed requests
- `needsReconnect` flag triggers manual reconnection flow

**Stripe:**
- Payment errors caught and displayed to user
- Electron API fallback: If `window.electronAPI?.openExternal` unavailable, uses `window.open()`

---

*Integration audit: 2026-03-17*
