# E2E-CHROME-01 / P2-29 — Stripe event-id idempotency verify

- Date: 2026-08-20
- Status: **restored** (was missing in this worktree)
- IDs: **E2E-CHROME-01**, **P2-29**
- Chrome E2E was **not stale**. The earlier billing worker claimed insert-first `event.id` + `stripeEventIdempotency.ts` + `20260820120000_billing_trial_used_and_event_idempotency.sql`. None of those files were in the tree. Chrome had only `shouldTreatCheckoutReplayAsNoop` (soft upsert; unused by the webhook) and filed emails-can-double.

Did **not** edit: `PDFViewer.jsx`, CORS `Access-Control-Allow-Origin: '*'`, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`, `E2E-NEW-ISSUES-CHROME.md`. No commit.

## Verdict

**Restored, not intact.** On arrival, `supabase/functions/stripe-webhook/index.ts` ran handlers (including `sendEmail` + billing-portal create) with no persisted `event.id`. Stripe retry after a 200-not-yet-returned would re-send trial/payment/cancel emails.

Insert-first is back: claim `processed_stripe_events.event_id` **before** any handler / email.

## Files changed

- `supabase/functions/_shared/stripeEventIdempotency.ts` — restored (`claimStripeEvent` / `withStripeEventIdempotency` / release-on-throw)
- `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql` — restored (`processed_stripe_events` PK + service_role only; also `trial_used_at` from the claimed P2-28/P2-29 migration)
- `supabase/functions/stripe-webhook/index.ts` — wrap switch in `withStripeEventIdempotency(supabase, event.id, …)` before emails
- `supabase/functions/_shared/stripeWebhookPolicy.ts` — comment only (event-id persistence is no longer missing)
- `tests/billing.test.mjs` — restored P2-29 cases (was missing)

Portal `return_url` stays `BILLING_PORTAL_RETURN_URL` (`https://surveytool.app/`). CORS `*` untouched.

## What was restored

1. **Insert-first claim.** First `evt_*` inserts `processed_stripe_events`. Unique-violation (`23505`) → `{ status: 'duplicate' }` and handlers do not run.
2. **Emails gated by the claim.** `sendEmail` / portal-session create sit inside the wrapped switch. Replay returns `{ received: true, duplicate: true }`.
3. **Failed work can retry.** Handler throw deletes the claim so Stripe retry can run.
4. **Independent event ids** still run.

## Test command + result

```
node --test tests/billing.test.mjs
```

**3/3 pass.** Intended send once; same-id replay no-op; throw releases claim then retry sends; other event id handled; empty id refused; non-unique insert error thrown; webhook source claims `event.id` before `await sendEmail(`; migration creates `processed_stripe_events`.

Related: `tests/chromeE2EContracts.test.mjs` A-05 (CORS `*`, portal not google.com, soft replay helper) still pass.

## Remaining risk

- **Migration must be applied** before the webhook deploy, or insert into `processed_stripe_events` fails and Stripe gets 400 (retry loop) until the table exists.
- **`sendEmail` still swallows fetch errors.** A silent send after a successful claim will not retry. A crash after claim and before `sendEmail` also skips retry (insert-first tradeoff).
- **`trial_used_at` is schema-only here.** Checkout still always sets `trial_period_days: 7`. P2-28 skip-if-used was not re-wired in this verify.
- **Soft upsert helper is unused** in the webhook. Event-id is the replay gate; `shouldTreatCheckoutReplayAsNoop` remains a chrome contract only.
- No live Stripe retry this wave.
