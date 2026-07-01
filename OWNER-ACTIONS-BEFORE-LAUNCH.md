# Owner actions before launch — the human-only steps

_Compiled 2026-07-01 during the MVP-wrapup build. Everything an agent could
build/verify is done and committed on `claude/quirky-taussig-7fda28`; the items
below need Isaiah's hands (accounts, portals, secrets, live money) and cannot be
done by an agent._

## 1. Microsoft 365 + Excel live two-way sync — the core selling point

All the code is built, wired, and dormant behind a master gate; it waits ONLY on
these two human steps, then a live pass.

- **Azure app-registration change** (app `0da81a9e-2b05-46ee-b826-5efc5114c765`):
  add a **"Mobile and desktop applications"** platform with redirect
  `http://localhost`, and enable **"Allow public client flows"**. For the
  browser build also add the hosted web origin(s) as redirect URIs once the site
  URL is known.
- **Sign in with a real work/school Microsoft account** in the app (system
  browser; passkey / Windows Hello should render).
- Then the 6-step **Verify Live Sync** checklist on a SCRATCH OneDrive-for-Business
  / SharePoint workbook (never the production survey file), per
  `HANDOFF-excel-sync-next.md` §"Recommended order". Only after it passes green:
  authorize flipping the live write-back master gate
  (`LIVE_WRITEBACK_ENABLED` in `src/services/excelCapability.js`), then re-run
  the drain on the scratch workbook and confirm Row IDs land in column A with
  read-back before touching a real file.

## 2. Stripe / payments — go live (currently TEST mode)

The client key is a `pk_test_…` key and the deployed function secrets are
test-mode. To sell a paid tier on day one:

- In the Stripe dashboard, switch to **live mode** and create the live
  products/prices.
- Replace the deployed function secrets on the production Supabase project with
  **live** values: `STRIPE_SECRET_KEY` (`sk_live_…`), the three price IDs
  (`STRIPE_PRO_MONTHLY_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`,
  `STRIPE_ENTERPRISE_PRICE_ID`), and `STRIPE_WEBHOOK_SECRET` from a **live**
  webhook endpoint pointed at the deployed `stripe-webhook` function.
- Replace `VITE_STRIPE_PUBLISHABLE_KEY` in the client env with the `pk_live_…`
  key.
- Run **one real checkout** and confirm the account upgrades.
- Product choice: **free/trial vs paid at launch** — if free/trial-only, nothing
  to flip.

## 3. New-user sign-up on the live site (Supabase dashboard config)

The account screens are all built and browser-verified (sign up, "check your
email" with resend, password reset page, change password with current-password
check). But production auth config is still dev defaults:

- Site URL is still `http://localhost:3000` → set it to the real hosted URL.
- No SMTP sender configured → configure a real email sender, OR set a verified
  Resend domain and set the `SEND_EMAIL_FROM` function secret (the invite/share
  emails currently send from Resend's sandbox address, which only delivers to the
  account owner).
- Redirect allow-list is empty → add the production URL plus the
  `/reset-password` and `/invite/<token>` return links.
- Confirm the email-confirmation on/off setting matches the "check your email"
  copy.

## 4. Rotate two dev secrets (hygiene — not a public leak)

Both live only in the git-ignored local env, but rotate for hygiene:

- Revoke the old **GitHub personal-access token**; if you still want the
  push-logs-to-GitHub debug feature, store the new one as a **non-`VITE_`** env
  var so it never enters a browser bundle.
- Rotate the **dev Supabase database password**.

## 5. Small product choices (decide one at a time)

Not blockers, but each needs your call before the relevant screen ships:
image/stamp annotations in or out; the exact print/export options; the
imported-ink policy; the few dead-end buttons; free vs paid at launch.

## 6. Mobile stores (only if shipping the phone/tablet apps day one)

Apple Developer membership + signing identity → TestFlight/App Store; Google
Play Console + signing key → Play. The current bundle builds into both native
projects cleanly.
