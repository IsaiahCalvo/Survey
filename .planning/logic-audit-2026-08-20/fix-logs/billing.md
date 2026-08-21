# Billing bucket — P2-27, P2-28, P2-29, P2-38

Date: 2026-08-20
Status: fixed
Test command + result: `node --test tests/billing.test.mjs` → 5/5 pass

---

### P2-27 — Billing lifecycle emails route “return to merchant” to google.com
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/_shared/billingReturn.ts` (`appBillingPortalReturnUrl`, `billingPortalSessionParams`)
- Intended behavior confirmed: trial-ending / payment-succeeded / payment-failed portal sessions use `https://surveytool.app/?billing=success`. In-app `create-portal-session` already resolved to the app and is unchanged.
- Break / adversarial attempts: `google.com` is gone from the webhook. Open-redirect candidates still fall through `resolveBillingReturnUrl` to the canonical host.
- Edges covered: no request origin (email-created portal) → canonical app URL + `?billing=success`.
- Test command + result: `node --test tests/billing.test.mjs` (P2-27 case) pass
- Remaining risk: live Stripe portal click not exercised this wave. Email HTML still uses the Stripe-hosted `portalUrl`; only the portal’s return-to-merchant target changed.

### P2-28 — Unlimited repeat 7-day Pro trials via cancel → resubscribe
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/functions/create-checkout-session/index.ts`, `supabase/functions/_shared/billingTrial.ts`, `supabase/functions/stripe-webhook/index.ts` (`trialUsedAtPatch` on checkout completed + subscription update), `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql`
- Intended behavior confirmed: first Pro checkout (`trial_used_at` empty, no prior Stripe `trial_end`) still sets `trial_period_days: 7`. A recorded `trial_used_at` or any prior Stripe subscription with `trial_end` omits the trial. Cancel still clears `trial_ends_at` but does **not** clear `trial_used_at`.
- Break / adversarial attempts: enterprise never gets a trial; empty-string `trial_used_at` still grants (treat as unset); Stripe list failure falls back to the column only (does not invent a trial denial for first-time users).
- Edges covered: used-trial skip; Stripe-history skip for pre-column cancelers; `trialUsedAtPatch` no-ops when `trial_end` is null so a paid resubscribe cannot wipe the flag.
- Test command + result: `node --test tests/billing.test.mjs` (P2-28 case) pass
- Remaining risk: migration must be applied before checkout/webhook can read/write `trial_used_at`. Customers who canceled before deploy and have no Stripe trial history could still receive one trial (Stripe list is the backfill). No live Stripe checkout this wave.

### P2-29 — Stripe webhook emails are not idempotent
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/functions/stripe-webhook/index.ts`, `supabase/functions/_shared/stripeEventIdempotency.ts`, `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql`
- Intended behavior confirmed: first `evt_*` insert-claims `processed_stripe_events` and runs handlers (including `sendEmail`). A replay of the same event id returns `{ received: true, duplicate: true }` and does not re-enter handlers.
- Break / adversarial attempts: unique-violation → duplicate skip; handler throw releases the claim so Stripe retry can run; a different event id is handled independently.
- Edges covered: intended send once; replay no-op; failed-then-retry send.
- Test command + result: `node --test tests/billing.test.mjs` (P2-29 case) pass
- Remaining risk: `sendEmail` still swallows fetch errors, so a silent email failure after a successful claim will not retry (pre-existing). Insert-first means a crash after claim and before `sendEmail` also skips the retry. Table is service-role only.

### P2-38 — Post-checkout `?billing=success` is never read
- Date: 2026-08-20
- Status: fixed
- Files changed: `supabase/functions/_shared/billingReturn.ts` (`parseBillingResult`, `stripBillingResult`, `consumeBillingReturn`), `src/utils/billingReturn.js`, `src/components/ToastHost.jsx` (boot consume after the toast listener attaches)
- Intended behavior confirmed: `?billing=success` toasts “You're subscribed. Your plan is now active.” and `history.replaceState` strips `billing`. `?billing=cancelled` toasts info and strips. Sibling query params and the hash stay.
- Break / adversarial attempts: `SUCCESS` / `evil` / missing param / invalid URL → no toast, no replace. Second consume on a stripped URL is a no-op. `?docId=` kept. `/mobile?mobileNav=tabs&nativeShell=expo` kept.
- Edges covered: success strip; cancelled strip; extra params; hash; unknown values; already-stripped; checkout `withBillingResult` URL is readable.
- Test command + result: `node --test tests/billing.test.mjs` (both P2-38 cases) pass
- Remaining risk: ToastHost must be mounted (it is on AppShell + HubPreview). Electron `file://` checkout already returns to `https://surveytool.app` via `buildBillingReturnUrl`, so the toast runs on the web origin, not inside the desktop window, unless the user is already on http(s). No visual toast confirmation in a running app this wave.

---

## CORS

`Access-Control-Allow-Origin: '*'` on `create-checkout-session` (and the untouched portal function) was left as-is — intentional for web + Electron `file://` + Capacitor.

## Not edited

`ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`, `src/PDFViewer.jsx`. No commit.
