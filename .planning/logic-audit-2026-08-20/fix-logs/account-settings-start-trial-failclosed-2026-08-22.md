# Leftover-18 A-05 / UL-20 Account Settings Start trial fail-closed — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover-18 fail-closed slice after UL-03 Hub Documents Upload. Distinct from leftover18-unblock catalog (trial **not** clicked), chrome-03 Contact sales mailto, Settings General / Usage, Guest AuthModal A-01, Documents Upload, and Connect.

## Leftover-18 inventory (this pass)

| ID | Dedicated fail-closed already? | This pass |
|---|---|---|
| X-01 | partial — no `file.id` / Save version owner-gated | parked (needs `.env.local`) |
| X-05 persist | partial — local widgets | parked (needs `file.id`) |
| X-06 writeback | partial — flag off + xlsx | parked (needs sheet host) |
| U-04 | partial — hubPreview `i1: 3` seed | parked (cloud meter) |
| A-01 Turnstile | **yes** — `e2e-a01-hubpreview-adversarial.spec.mjs` | skipped |
| A-02 live MSAL | leftover18-unblock + chrome-03 Connect click | **next** leftover-18 fail-closed slice |
| A-03 inbox | Documents Share Access + Templates Share dedicated | skipped |
| A-05 Stripe | catalog only; Start trial **clicked** fail-closed | **proved** click + no Checkout mint |
| A-06 roster | same-user “just you” | parked (second account) |
| UL-03 | leftover18-unblock `/` Auth + hubPreview Upload | skipped |
| UL-13 / UL-15 / UL-16 | Settings General dedicated | skipped |
| UL-20 | same as A-05 | **proved** Start trial click |
| UL-21 / UL-22 | leftover18-unblock / chrome-03 Connect bundled | after Start trial |
| UL-24 | Share Access fail-closed dedicated | skipped |
| UL-45 | same as A-06 | parked |

## Slice

Account Settings **Start trial** (`StripeCheckout` on Subscription → Manage). HubPreview / `?testPdf=` set `isSupabaseAvailable: false` and leave `subscription` **null**, so the Pro card shows **Start 7-day trial** (not the disabled Developer account button). Click must fail-closed: no `create-checkout-session` invoke, no `checkout.stripe.com` navigation, no minted session.

Do **not** invent a Stripe Checkout URL, `.env.local`, or a billing backend.

## Product

`StripeCheckout` now gates on `supabase.auth.getSession()` before `functions.invoke('create-checkout-session')`. No session / no supabase → `Error: Must be signed in to start a trial.` Button returns from Processing. CORS `*` on the edge function is unchanged. No high-risk file. 8448 not loosened.

## Live

Playwright `debug/scenarios/e2e-account-settings-start-trial-failclosed.spec.mjs` **1 / 1 (7.6s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended | Subscription (real sidebar tab) → Manage → **Start 7-day trial**. Error `Must be signed in to start a trial`. Checkout invoke **0**. Stripe host **0**. URL stays hubPreview. Settings stay open. Monthly/Annual **0**. Contact sales present, not used as the trial proof. |
| Double-click | Same error. Still no session. |
| Usage isolation | Meters `0 B / 100.0 GB`. Start trial **hidden**. Error **hidden**. |
| General isolation | Isaiah. Start trial **0**. Reopen lands General. Escape closes. Documents SE-011 / Package 2 stay. |
| empty=1 | Same Start trial fail-closed. |
| Guest | `Sign in` chip. Settings **0**. Start trial **0**. A-01 submit not replayed. |
| `?testPdf=` Home | Dev Test User (not Isaiah). Same fail-closed click. |
| 390 | Same Start trial fail-closed. Escape closes. |

Node `tests/accountSettingsStartTrialFailClosed.test.mjs` **4 / 4**. leftover18FailClosed **12 / 12** still holds.

## Light 96-ID audit

ISSUE-INVENTORY unique-ID section still lists **96** IDs, all `**proven**`. Spot-checked stomp one-liners still live:

- P1-12 `historyHelpers.js:124` `reason.startsWith('excel:')`
- P1-38 `CompactColorPicker.jsx:336` match-opacity `<= 1`
- P1-53 `syncStatusViewModel.js:41-48` `pending` before queue-offline

## Next leftover-18 fail-closed slice

Account Settings **Connect** (A-02 / UL-21) — dedicated intended+break+edge still thinner than this Start trial proof. leftover18-unblock + chrome-03 already click Microsoft/Google fail-closed; next pass should open Connect, prove it does not complete MSAL (guest / 390 / isolation vs Subscription). Do not invent MSAL.

Live Stripe Checkout / portal still parked for a signed-in host.

## Not claimed

Leftover-18 stay parked. Goal stays open. Do **not** re-claim unblocked GAP = 0.
