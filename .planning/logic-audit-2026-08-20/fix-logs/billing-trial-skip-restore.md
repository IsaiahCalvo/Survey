# P2-28 — skip Pro trial if `trial_used_at` is set (restore)

- Date: 2026-08-20
- Status: **restored** (was schema-only in this worktree)
- IDs: **P2-28**
- Event-id verify (P2-29) correctly reported: `trial_used_at` existed on `user_subscriptions` via `20260820120000_billing_trial_used_and_event_idempotency.sql`, but checkout always set `trial_period_days: 7`. `billingTrial.ts` was missing. Webhook never stamped the flag.

Did **not** edit: `PDFViewer.jsx`, CORS `Access-Control-Allow-Origin: '*'`, webhook insert-first `event.id` claim, `ISSUE-INVENTORY.md`, `FEATURE-MATRIX.md`, `FIX-LOG.md`. No commit.

## Verdict

**Skip is now enforced.** First Pro checkout (no `trial_used_at`, no prior Stripe `trial_end`) still attaches a 7-day trial. A recorded `trial_used_at` or any Stripe subscription on the customer with `trial_end` omits `trial_period_days`. Webhook stamps `trial_used_at` on first trial start (`checkout.session.completed` + `customer.subscription.created/updated`) via `trialUsedAtPatch`. Cancel still clears `trial_ends_at` and does **not** clear `trial_used_at`. P2-29 insert-first claim is unchanged.

## Files changed

- `supabase/functions/_shared/billingTrial.ts` — restored (`shouldGrantProTrial` / `proTrialPeriodDays` / `trialUsedAtPatch`)
- `supabase/functions/create-checkout-session/index.ts` — select `trial_used_at`; attach trial only when `proTrialPeriodDays(...)` returns 7; list Stripe `status: 'all'` as backfill when the column is empty
- `supabase/functions/stripe-webhook/index.ts` — spread `trialUsedAtPatch(subscription)` on checkout-completed + subscription-update payloads only (no-op when `trial_end` is null). `withStripeEventIdempotency(supabase, event.id, …)` left intact
- `tests/billing.test.mjs` — added P2-28 case; existing P2-29 cases kept

Migration already present: `supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql` (`trial_used_at` + backfill from `trial_ends_at` / `status = 'trialing'`).

## What was restored

1. **Checkout skip.** `proTrialPeriodDays('pro', used, stripeSubs)` → `undefined` when the column is set or Stripe shows a prior `trial_end`. Enterprise never gets a trial.
2. **Stripe history backfill.** If `trial_used_at` is unset, checkout lists the customer's subscriptions (`status: 'all'`, limit 20). A pre-column canceler with `trial_end` on Stripe is denied a second trial. List failure logs and falls back to the column only (does not invent a denial for first-time users).
3. **Webhook stamp.** `trialUsedAtPatch` writes `trial_used_at` from `trial_start` (else now) only when `trial_end` is present. Paid resubscribe without a trial does not wipe the flag.
4. **Cancel preserves the flag.** Deleted-subscription update still sets `trial_ends_at: null` and never `trial_used_at: null`.

## Test command + result

```
node --test tests/billing.test.mjs
```

**4/4 pass.** P2-28: first Pro grants 7 days; recorded timestamp / Stripe `trial_end` skip; empty-string column still grants; enterprise never grants; `trialUsedAtPatch` no-ops without `trial_end`; checkout selects `trial_used_at` and calls `proTrialPeriodDays`; webhook calls `trialUsedAtPatch` and still claims `event.id` before `sendEmail`. P2-29 cases unchanged (3/3).

## Remaining risk

- **Migration must be applied** before checkout/webhook deploy, or select/update of `trial_used_at` fails.
- **Stripe list failure + empty column** still grants a trial (intentional: do not deny first-time users). Customers who canceled before deploy and have no Stripe trial history could still receive one trial.
- **List is capped at 20** subscriptions. A customer with more than 20 historical subs and a trial only on an older page could theoretically get another (unlikely).
- **`trial_used_at` is stamped after checkout**, when the webhook runs. A second checkout that races the first webhook still skips if Stripe already shows `trial_end` on the new sub; if that list also fails, a double-trial window exists until the stamp lands.
- No live Stripe checkout this wave.
