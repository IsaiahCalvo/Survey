# Leftover-18 A-02 / UL-21 Account Settings Connect fail-closed — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover-18 fail-closed slice after A-05 / UL-20 Start trial. Distinct from leftover18-unblock catalog, chrome-03 Microsoft click, Settings General / Usage, Guest AuthModal A-01, Documents Upload, and Start trial.

## Leftover-18 inventory (this pass)

| ID | Dedicated fail-closed already? | This pass |
|---|---|---|
| X-01 | partial — no `file.id` / Save version owner-gated | parked (needs `.env.local`) |
| X-05 persist | partial — local widgets | parked (needs `file.id`) |
| X-06 writeback | partial — flag off + xlsx | parked (needs sheet host) |
| U-04 | partial — hubPreview `i1: 3` seed | parked (cloud meter) |
| A-01 Turnstile | **yes** — `e2e-a01-hubpreview-adversarial.spec.mjs` | skipped |
| A-02 live MSAL | leftover18-unblock + chrome-03 Connect click | **proved** click + no MSAL completion |
| A-03 inbox | Documents Share Access + Templates Share dedicated | skipped |
| A-05 Stripe | Start trial dedicated | skipped |
| A-06 roster | same-user “just you” | parked (second account) |
| UL-03 | leftover18-unblock `/` Auth + hubPreview Upload | skipped |
| UL-13 / UL-15 / UL-16 | Settings General dedicated | wipe click still leftover18-unblock only |
| UL-20 | same as A-05 | skipped |
| UL-21 / UL-22 | leftover18-unblock / chrome-03 Connect bundled | **proved** Microsoft + Google |
| UL-24 | Share Access fail-closed dedicated | skipped |
| UL-45 | same as A-06 | parked |

## Slice

Account Settings **Connect** (Microsoft + Google) on Connected services. HubPreview / `?testPdf=` set `msalInstance: null` and `login` / `linkGoogleIdentity` to `previewBlocked`. Click must fail-closed: toast / previewBlocked, no OAuth navigation, no token, no MSAL popup completion.

Do **not** invent MSAL, `.env.local`, or a Microsoft/Google OAuth completion.

## Product

`AccountSettings` Microsoft Connect now surfaces `err?.message` (same as Google) so the previewBlocked reason is visible: `Preview cannot start Microsoft login.` / `Test PDF cannot start Microsoft login.` Google already showed `Preview cannot start Google OAuth.` CORS `*` unchanged. No high-risk file. 8448 not loosened.

## Live

Playwright `debug/scenarios/e2e-account-settings-connect-failclosed.spec.mjs` **1 / 1 (23.5s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended | Connected services (real sidebar tab) → Microsoft **Connect** → `Preview cannot start Microsoft login.` Google **Connect** → `Preview cannot start Google OAuth.` OAuth requests **0**. Popup **0**. Still Not connected. No Disconnect/Reconnect. |
| Double-click | Same errors. Still no token / no MSAL host. |
| Subscription isolation | Start trial visible, **not** clicked. Connect **0**. Contact sales present. |
| Usage isolation | Meters `0 B / 100.0 GB`. Connect **0**. Start trial **hidden**. |
| General isolation | Isaiah. Connect **0**. Reopen lands General with no error. Escape closes. Documents Package 2 stay. |
| empty=1 | Same Microsoft + Google fail-closed. |
| Guest | `Sign in` chip. Settings **0**. Connect **0**. A-01 submit not replayed. |
| `?testPdf=` Home | Dev (not Isaiah). `Test PDF cannot start Microsoft login.` / `Test PDF cannot start Google OAuth.` |
| 390 | Same Microsoft + Google fail-closed. Escape closes. |

Node `tests/accountSettingsConnectFailClosed.test.mjs` **4 / 4**. leftover18FailClosed **12 / 12** still holds.

## Light 96-ID audit

ISSUE-INVENTORY unique-ID section still lists **96** IDs, all `**proven**`. Spot-checked stomp one-liners still live:

- P1-12 `historyHelpers.js:124` `reason.startsWith('excel:')`
- P1-38 `CompactColorPicker.jsx:336` match-opacity `<= 1`
- P1-53 `syncStatusViewModel.js:41-48` `pending` before queue-offline

## Next leftover-18 fail-closed slice

Account Settings **Delete account permanently** (UL-16) — leftover18-unblock already clicked wipe once; General only Cancel. Dedicated intended+break+edge (guest / 390 / isolation vs Connected) is still thinner than a host wipe. Do not invent a live account deletion.

Live MSAL / Google OAuth / signed-in Stripe Checkout / portal still parked for a signed-in host.

## Not claimed

Leftover-18 stay parked. Goal stays open. Do **not** re-claim unblocked GAP = 0.
