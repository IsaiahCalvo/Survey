# Leftover-18 host-bundle — 2026-08-22 (X-01 first)

**2026-08-25 fold:** X-01 / X-05 / U-04 / UL-13 / A-06 / UL-45 are **host-proved** via owner-local receipts (PR 800 comment `5414370572`). This 2026-08-22 host-bundle is historical (hosts were absent in this VM). Do **not** treat X-01 as still missing hosts. See `leftover18-owner-local-receipts-2026-08-25.md`.

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.  
Did **not** invent `.env.local`. Did **not** write `.env.local`. Did **not** read `.bot-credentials.json`.  
Did **not** create accounts, plus-aliases, or SQL. Did **not** launch another catalog hunt.  
X-01 **not** live-proved.

Re-inspected the current environment as authoritative (prior `host-probe-2026-08-22.md` is not reused as truth). Hosts are still **absent**. This receipt lists the exact files / vars / leases needed for **X-01** first, then the rest of leftover-18. **No secret values.**

## Host-probe result: ABSENT

| Check | Result |
|---|---|
| `.env` | Present. Key names only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Public bootstrap. |
| `.env.local` | **Missing** |
| `.env.test` / `.env.test.local` | **Missing** (`.env.test.example` present; names only) |
| Process env `VITE_DEV_AUTO_LOGIN_EMAIL` | **ABSENT** |
| Process env `VITE_DEV_AUTO_LOGIN_PASSWORD` | **ABSENT** |
| Process env `SUPABASE_SERVICE_ROLE_KEY` | **ABSENT**. Quote-wrap check N/A. |
| Process env Stripe / MSAL / Turnstile | All **ABSENT** (`STRIPE_*`, `VITE_STRIPE_*`, `VITE_MSAL_CLIENT_ID`, `MSAL_CLIENT_ID`, `VITE_AZURE_CLIENT_ID`, `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `VITE_GOOGLE_*`) |
| Process env `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | **ABSENT** in process (file `.env` only) |
| Vite `127.0.0.1:5173` process environ | No `VITE_*` / Stripe / MSAL / Turnstile / auto-login names |
| `.bot-credentials.json` | **Missing** (existence check only; not read) |
| `.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json` | **Missing** (existence check only; not read) |
| `.survey-test-account.json` | **Missing** |
| Docker / `supabase` CLI | **Absent**. Five in-tree `20260820*.sql` files remain unapplied. Not applied. |
| Official lease tuple | No human `email\|userId\|tier\|status` supplied |
| `.cursor/environment.json` | **Missing** |
| Cursor cloud run | `bc-8dbc93f8-83de-55b5-b11d-c3d0ab1a95e2` (“Re-probe hosts for X-01”). Repo `github.com/kal-voe/survey`. |
| Cursor cloud environment | **null** — no linked environment / no dashboard secrets. Egress unknown. |
| Cursor cloud environment builds | **empty** (`environmentPublicId` null, `builds: []`) |
| Vite `http://localhost:5173` | Listening (reuse; do not spawn `npm run dev`) |

**X-01 hosts:** **absent**. Signed-in cloud save / identity-churn cannot be live-proved. STOP.

## 1. X-01 first — identity-churn / signed-in cloud save

Live intended + break + edge needs a **real signed-in identity** and a **session identity change** on a document that already has `file.id`. `?testPdf=` / `DevTestRoute` never stamps `file.id` (sync chip / presence hidden; History Save version owner-gated). Prior signed-in leftover (`e2e-signed-in-leftovers.md`) still left X-01 blocked when the session stayed the same auto-login user.

### Files (gitignored; do not invent)

| File | Why |
|---|---|
| `.env.local` | Vite only exposes `VITE_*` from a `.env` file, not process env. After create/edit, **restart** `npm run dev:ui` and do a fresh full page load. |
| Existing public `.env` | Already present: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Keep. Do not rewrite. |

### Vars (names only; strip surrounding quotes if a value arrives quoted)

| Name | Where | Why |
|---|---|---|
| `VITE_DEV_AUTO_LOGIN_EMAIL` | `.env.local` | Existing user email. `AuthContext` reads `import.meta.env.VITE_DEV_AUTO_LOGIN_EMAIL`. |
| `VITE_DEV_AUTO_LOGIN_PASSWORD` | `.env.local` | Same existing user. |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` | Captcha-fallback `/__dev-auth/session` mint. Not a `VITE_*` browser secret; Vite plugin only. |

### Leases / identity change

X-01 is **not** finished by auto-login alone. The leftover is a **session identity change** on a real `file.id` (outbox / sync chip / chrome publish must not drop or loop).

| Need | Exact form |
|---|---|
| Cloud document | Existing saved doc UUID (`file.id`). Do not stamp `file.id` on `?testPdf=`. |
| Identity change | Signed-in session whose user / token identity changes (re-sign-in or second existing account). Do not invent plus-aliases. |
| If using shared bots | Coordinator `assign` **before** any real-auth test: `node scripts/test-account-lease.mjs assign --task <TASK> --account 'email\|userId\|tier\|status'` (identify by email **and** Supabase user ID, never array position). Then `run --task <TASK> --lease-token <TOKEN> -- <COMMAND>`. |
| Credentials file | Official `assign` resolves passwords from `.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json` (or workspace `.bot-credentials.json`). Workers must not read it, create accounts, or select/switch accounts. |
| Assignment file | `.survey-test-account.json` is produced by `assign`. Missing here. |

Optional Cursor path (not present): a **linked** cloud environment with those three `.env.local` names as secrets. This run’s environment is **null**; do not trigger a draft build to invent them.

## 2. Rest of leftover-18 (after X-01)

Shared with X-01 unless noted: `.env.local` auto-login trio + Vite restart + real `file.id`. Do not apply the five `supabase/migrations/20260820*.sql` files. Do not loosen official `npm test` **8448** MiB.

| ID | Still-parked host | Extra files / vars / leases (names only) |
|---|---|---|
| X-05 persist | Cloud persist of form values on a saved `file.id` | Same X-01 signed-in + real doc. Local `kal441-form-fields.pdf` widgets already proven. Do not invent `file.id`. |
| X-06 writeback | Live Microsoft 365 sheet writeback / linked workbook | Interactive MSAL / Graph session. `AZURE_CLIENT_ID` is hardcoded in `src/authConfig.js` / `MSGraphContext.jsx` / `msalAuthMain.js` (no env var required). `EXCEL_AUTOMATIC_WRITEBACK_ENABLED` stays `false` unless a real linked workbook exists. Electron `file://` uses msal-node. |
| U-04 cloud | Dashboard + Supabase live usage meter | Same X-01 signed-in. HubPreview `i1: 3` seed is **not** this host. |
| A-01 Turnstile | Live captcha completion + real password login | `VITE_TURNSTILE_SITE_KEY` optional (code default in `turnstileConfig.js`). Cloud VM cannot mint a valid Turnstile token. Human/browser host required. Do not invent a captcha token. |
| A-02 / UL-21 | Live MSAL / Graph login | Same as X-06 interactive Microsoft login. Connect fail-closed already dedicated. |
| A-03 / UL-24 | Live invite email delivery | Signed-in + working `send-email` edge function + real recipient inbox. Copy-link mint already proven. Do not send from an unleased personal account. CORS `*` stays intentional. |
| A-05 / UL-20 | Live Stripe Checkout click | Client: `VITE_STRIPE_PUBLISHABLE_KEY` in `.env` / `.env.local`. Edge secrets (Supabase dashboard, not this repo): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`. Start-trial fail-closed already dedicated. Do not invent a Checkout URL. |
| A-06 / UL-45 | Second signed-in collab roster | Coordinator supplies **two** exact existing-account `email\|userId\|tier\|status` tuples + credentials file. Official `assign` / `run` / `attest-cleanup` / `release`. Same-user two-tab stays “just you”. |
| UL-03 | Native Electron NSOpenPanel pick/cancel | Display + `npm run dev` (Electron), **not** `dev:ui`. Web `/` Auth-modal + hubPreview Upload fail-closed already dedicated. Headless VM cannot drive `loginwindow`. |
| UL-13 | Real `updateProfile` persist | Same X-01 `.env.local`. Mutates the signed-in account — use a leased bot, not a personal profile. Preview save fail-closed already dedicated. |
| UL-15 | Live Turnstile password change | Same A-01 captcha host + signed-in session. |
| UL-16 | Live account wipe | Leased disposable account + wipe allowed. Destructive. Confirm-chrome fail-closed already dedicated. |
| UL-22 | Live Google OAuth | Interactive Google login. Connect fail-closed already dedicated. |

### Integration / privacy (not leftover-18 live E2E, still missing)

`.env.test` copied from `.env.test.example` would need (names only): `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_KEY`, `SUPABASE_PRIVACY_PROBE_SERVICE_KEY`. `npm run test:integration` / `test:privacy` cannot run without them.

## Classification

Unblocked leftover that is **not** leftover-18 / compile-hidden / stub: **none named this pass** (no catalog hunt). Leftover-18 fail-closed local slices stay dedicated. Compile-hidden tools stay unreachable.

**Next leftover-18 live host remains X-01.** Goal stays open. STOP.
