# Leftover-18 owner-local receipts fold — 2026-08-25

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this fold:** `23d042ca` docs: record Manage Team More type live 3/3 (16.2s).  
**Receipt source:** PR 800 issue comment `5414370572` by IsaiahCalvo (2026-08-25T17:44:12Z) — **"Leftover-18: local receipts delivered"**. That comment **supersedes** issue comment `5411980649` ("Leftover-18 unblock handoff") secret-provisioning plan. No dashboard secrets are coming. This VM did **not** replay those slices.

**Does not mark the audit goal complete.** Did **not** hunt a new leftover. Did **not** write a 103-ID completion-audit refresh. Did **not** write another X-01 parking note as if hosts were still missing. Did **not** pad FEATURE-MATRIX. Did **not** apply the five `20260820*.sql` migrations. Did **not** invent extra proof.

Manage Team member-row More `type="button"` already landed (`b91bf65a` / `b387e6bb` / `23d042ca`). Not replayed.

## Host-proved via owner-local receipts

Owner's local coordinator ran the secret-dependent leftovers on the owner's machine against this branch's harness (`debug/playwright.reuse` pattern, Vite on `127.0.0.1:5178`, official lease flow on `phase28-bot-1` / `phase28-bot-2`, released clean). Full receipt texts are inline in PR comment `5414370572`. Session-mint workaround (`leftover18-bot-session.mjs` magic-link mint) was used because live password login is server-side captcha-blocked.

| ID | Verdict | Receipt (PR 800 comment 5414370572) |
|---|---|---|
| **X-01** | **host-proved** | Identity churn + isolation. `X01_IDENTITY_ISOLATION {"bot2SeesBot1Upload":false}`. `X01_CHURN_CONSOLE` max-update-depth **0**. |
| **X-05** | **host-proved** | Cloud persist of form values on a real `file.id`. `X05_PERSIST_PROOF` field persisted + anno count after reopen. Combined with X-01 test **1 / 1**. |
| **U-04** | **host-proved** | Live usage meter on leased bots. Combined with X-01 / X-05. |
| **UL-13** | **host-proved** | Real `updateProfile` persist + reload. `UL13_PERSIST_PROOF`. Restored via service-role when baseline was empty. |
| **A-06 / UL-45** | **host-proved** | Two signed-in accounts on the same document. `A06_ROSTER_PROOF` both pages still open; owner Document Access shows both rows. **1 / 1 (26.0s)**. |

Do **not** replay these slices from this VM.

## Still human-gated — parked; do not spin

| ID | Why still parked (owner receipt) |
|---|---|
| **A-01 / UL-15** | Live Turnstile captcha + real password+captcha login. Headless cannot complete a real challenge. |
| **UL-22** | Live Google OAuth. Interactive account chooser. |
| **A-02 / X-06 / UL-21** | Live Microsoft 365 / MSAL / Graph login and sheet writeback. Interactive Microsoft chooser + linked workbook. |
| **UL-03** | Native macOS `NSOpenPanel`. Needs Electron `npm run dev` + display. |
| **UL-16** | Live account wipe. Not authorized even on a leased bot. |
| **A-05 / UL-20** | Live Stripe Checkout. Do not click/create checkout sessions. |
| **A-03 / UL-24** | Live invite email delivery. Do not send email. |

Fail-closed local slices stay dedicated. Isolated official **8448** still standing. Cap **8448** / 75/250 not loosened.

## New product bugs from the receipts (not leftover-18)

Documented in comment `5414370572`. Folded here so the next product pass can fix them. Not claimed fixed in this docs-only fold.

1. Archived documents still count toward the free-tier 5-document cap — `useSubscriptionLimits` count query lacks the `archived` / `user_archived_at` filters `useDatabase` list query applies.
2. Invite links falsely report "already accepted" to a second real account and grant no access — `?docId=` deep-link only searches the visitor's own document list. "Remove collaborator" clears the visible list but leaves invite rows in the DB.
3. A saved profile first/last name cannot be cleared back to blank — `#firstName` / `#lastName` HTML5 `required`.

## Files

- `.planning/logic-audit-2026-08-20/leftover18-owner-local-receipts-2026-08-25.md`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` (leftover-18 table + this-pass note only; not a 103-ID refresh)
- this receipt

Goal stays open.
