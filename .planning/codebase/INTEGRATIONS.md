# External Integrations

**Analysis Date:** 2026-07-19 (rewritten from 2026-03-17 Syncfusion-era sheet)

## APIs & External Services

**Supabase (primary backend):**
- Auth (email/password + OAuth) and PostgreSQL with RLS
- Client: `@supabase/supabase-js` via `src/supabaseClient.js`
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (seeded by `scripts/bootstrap-dev-env.mjs`)
- Offline mode when env is absent (`supabase` export may be null)

**Microsoft / Azure AD + Graph:**
- MSAL browser + node (`@azure/msal-browser`, `@azure/msal-node`)
- Config: `src/authConfig.js`; context: `src/contexts/MSGraphContext.jsx`
- Graph scopes typically include `User.Read`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`
- Used for OneDrive / Excel sync (`src/services/excelGraphService.js`, `excelSessionService.js`, …)

**Stripe (billing via edge functions):**
- Client invokes Supabase functions — **no** `@stripe/stripe-js` dependency
- Components: `src/components/StripeCheckout.jsx` (+ portal flows in account UI)
- Edge functions: `create-checkout-session`, `create-portal-session`, `stripe-webhook`
- Setup guide: `docs/STRIPE_SETUP.md`

**Email / invites (edge functions):**
- `send-email`, `send-invite-email`, `send-profile-change-notification`
- Excel apply: `excel-apply-changeset`

## Data Storage

**Database:** Supabase PostgreSQL — documents, annotations, subscriptions, project/space data, Yjs-related tables (see migrations under `supabase/migrations/`).

**Files:**
- PDF bytes / storage via Supabase storage + local Electron paths
- Excel via OneDrive (Graph) or local file paths depending on session

**CRDT:**
- Yjs (`yjs`, `y-protocols`, `y-indexeddb`) dual-write for cutover-sealed docs

## Authentication & Identity

- Primary app auth: Supabase Auth (`AuthContext.jsx`)
- Optional Microsoft connection for Graph/Excel (MSAL + `MSGraphContext`)
- Cloudflare Turnstile gates signup/signin server-side — see `AGENTS.md` for DEV auto-login / `?testPdf=` bypass

## CI/CD & Deployment

- Web build: `npm run build` → `dist/` (assert: no pdf.js demo in dist)
- Desktop: `npm run dist` (electron-builder)
- Mobile: Capacitor (`npm run mobile:sync` / `mobile:ios` / `mobile:android`)
- Marketing: `landing/` + `vercel.json` as applicable
- Playwright scenarios: `debug/playwright.config.mjs`

## Environment Configuration

**Client / Vite (examples):**
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_STRIPE_PUBLISHABLE_KEY          # optional; checkout mainly via edge functions
VITE_DEV_AUTO_LOGIN_EMAIL            # .env.local only
VITE_DEV_AUTO_LOGIN_PASSWORD         # .env.local only
```

**Not required:** `VITE_SYNCFUSION_LICENSE_KEY` (Syncfusion removed).

**Server-side (Supabase Edge Function secrets / `.env.test`):**
- Stripe secret + webhook + price IDs
- `SUPABASE_SERVICE_ROLE_KEY` for integration tests / DEV auth plugin

## CORS note (intentional)

Edge functions use `Access-Control-Allow-Origin: '*'`. Required for one bundle across web, Electron (`file://` → `Origin: null`), and Capacitor. Auth is Bearer JWT + `auth.getUser()` — do not “tighten” to an origin allowlist. See `CLAUDE.md` / `HANDOFF-post-launch-hardening.md`.

## API Communication Patterns

- Supabase tables: `supabase.from(...).select/upsert/...` with `{ data, error }` handling
- Edge functions: `supabase.functions.invoke(name, { body })`
- Microsoft Graph: client from `MSGraphContext` with token provider + refresh cooldown

---

*Integration audit: 2026-07-19*
