# Leftover-18 UL-16 Delete account permanently fail-closed — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover-18 fail-closed slice after A-02 / UL-21 Connect. Distinct from leftover18-unblock wipe click, Settings General Cancel, Connect, Start trial, Usage, Guest AuthModal A-01, and Documents Upload.

## Leftover-18 inventory (this pass)

| ID | Dedicated fail-closed already? | This pass |
|---|---|---|
| X-01 | partial — no `file.id` / Save version owner-gated | parked (needs `.env.local`) |
| X-05 persist | partial — local widgets | parked (needs `file.id`) |
| X-06 writeback | partial — flag off + xlsx | parked (needs sheet host) |
| U-04 | partial — hubPreview `i1: 3` seed | parked (cloud meter) |
| A-01 Turnstile | **yes** — `e2e-a01-hubpreview-adversarial.spec.mjs` | skipped |
| A-02 live MSAL | Connect fail-closed dedicated | skipped |
| A-03 inbox | Documents Share Access + Templates Share dedicated | skipped |
| A-05 Stripe | Start trial dedicated | skipped |
| A-06 roster | same-user “just you” | parked (second account) |
| UL-03 | leftover18-unblock `/` Auth + hubPreview Upload | skipped |
| UL-13 / UL-15 | Settings General dedicated | skipped |
| UL-16 | leftover18-unblock wipe click + General Cancel | **proved** confirm path fail-closed |
| UL-20 | same as A-05 | skipped |
| UL-21 / UL-22 | Connect fail-closed dedicated | skipped |
| UL-24 | Share Access fail-closed dedicated | skipped |
| UL-45 | same as A-06 | parked |

## Slice

Account Settings **Delete account permanently** on General. HubPreview / `?testPdf=` set `deleteAccount` to `previewBlocked`. Confirm must fail-closed: `.account-error` / previewBlocked, no `delete-account` invoke, no reload, Isaiah still signed in, rows stay.

Do **not** invent a live account deletion, `.env.local`, or a wipe backend.

## Product

No min-viable product diff. Confirm/Cancel/`delete` vs `DELETE` already exist. Wipe surfaces `err?.message` via `accountDeletionUserMessage`. CORS `*` unchanged. No high-risk file. 8448 not loosened.

## Live

Playwright `debug/scenarios/e2e-account-settings-delete-account-failclosed.spec.mjs` **1 / 1 (16.2s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended | General → Delete account → `delete` / `Delete` / `DELETES` stay disabled; `DELETE` enables; Cancel hides confirm; Confirm → `Preview cannot delete accounts.`; wipe invoke **0**; chip still Isaiah Calvo; Settings stay. |
| Double-click | Same error. Still signed in. No reload. |
| Connect isolation | Connected services Connect **2**, **not** clicked. Wipe **0**. |
| Start trial isolation | Start trial visible, **not** clicked. Wipe **0**. Contact sales present. |
| Usage isolation | Meters `0 B / 100.0 GB`. Wipe **0**. Start trial **hidden**. |
| Escape / reopen | Package 2 stay. Reopen lands General with no error. Isaiah still signed in. |
| empty=1 | Same Confirm fail-closed. `No documents yet` stays. |
| Guest | `Sign in` chip. Settings **0**. Wipe **0**. A-01 submit not replayed. |
| `?testPdf=` Home | Dev (not Isaiah). `Test PDF cannot delete accounts.` |
| 390 | Same Confirm fail-closed. Escape closes. Visible Package 2 card stays. |

Node `tests/accountSettingsDeleteAccountFailClosed.test.mjs` **4 / 4**. leftover18FailClosed **12 / 12** still holds.

## Light 96-ID audit

ISSUE-INVENTORY unique-ID section still lists **96** IDs, all `**proven**`. Spot-checked stomp one-liners still live:

- P1-12 `historyHelpers.js:124` `reason.startsWith('excel:')`
- P1-38 `CompactColorPicker.jsx:336` match-opacity `<= 1`
- P1-53 `syncStatusViewModel.js:41-48` `pending` before queue-offline

## Next leftover-18 fail-closed slice

Leftover-18 now needs real hosts. Every leftover-18 control that can fail-closed without a signed-in cloud / Stripe / MSAL / Turnstile / second-account / Electron host already has a dedicated intended+break+edge proof. Do not invent `.env.local`, a wipe backend, Checkout, or a second account.

Live wipe / live profile persist / live Turnstile / live MSAL / Google OAuth / signed-in Stripe Checkout / portal / native File→Open still parked.

## Not claimed

Leftover-18 stay parked. Goal stays open. Do **not** re-claim unblocked GAP = 0.
