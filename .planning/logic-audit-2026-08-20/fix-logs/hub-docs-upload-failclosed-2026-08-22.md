# Leftover-18 UL-03 Hub Documents Upload fail-closed — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.**

Named leftover-18 fail-closed slice after the hunt that found no unique unblocked leftover. Distinct from leftover18-unblock web `/` Auth-modal gate + Electron IPC, Guest AuthModal A-01, Documents Select All / Share Access / extras / Lock persist / Open file, Hub Try again, Settings General / Usage, A-04, Archive, TabBar, Projects / Templates / Spaces / Survey-rail / PDF waves.

## Leftover-18 inventory (this pass)

| ID | Dedicated fail-closed already? | This pass |
|---|---|---|
| X-01 | partial — no `file.id` / Save version owner-gated | parked (needs `.env.local`) |
| X-05 persist | partial — local widgets | parked (needs `file.id`) |
| X-06 writeback | partial — flag off + xlsx | parked (needs sheet host) |
| U-04 | partial — hubPreview `i1: 3` seed | parked (cloud meter) |
| A-01 Turnstile | **yes** — `e2e-a01-hubpreview-adversarial.spec.mjs` | skipped |
| A-02 live MSAL | leftover18-unblock Connect click (bundled) | next-but-one; not this slice |
| A-03 inbox | Documents Share Access + Templates Share dedicated | skipped |
| A-05 Stripe | catalog only; Start trial **not** clicked | **next** leftover-18 fail-closed slice |
| A-06 roster | same-user “just you” | parked (second account) |
| UL-03 | leftover18-unblock `/` Auth + Electron IPC only | **proved** hubPreview Upload |
| UL-13 / UL-15 / UL-16 | Settings General dedicated | skipped |
| UL-20 | same as A-05 | next |
| UL-21 / UL-22 | leftover18-unblock Connect bundled | after Start trial |
| UL-24 | Share Access fail-closed dedicated | skipped |
| UL-45 | same as A-06 | parked |

## Slice

Hub Documents **Upload** (`DocumentsLedger` header Upload + EmptyState **Upload PDF** → `HubPreview.handleUpload`). Without `workflowE2E`, the handler `console.log('[hub preview] upload')` and returns. No `<input type=file>`. No filechooser. Rows do not change.

Do **not** invent a native picker, Stripe session, MSAL login, or Turnstile token.

## Live

Playwright `debug/scenarios/e2e-hub-docs-upload-failclosed.spec.mjs` **1 / 1 (3.9s)** on reused Vite `http://localhost:5173`.

| Check | Result |
|---|---|
| Intended | Seed header Upload logs `[hub preview] upload`. File input **0**. Chooser **0**. Six rows including SE-011 stay. URL stays hubPreview. Draw **0**. |
| Double-click | Still no chooser / no extra row. |
| empty=1 Upload PDF | Stay `No documents yet`. File input **0**. |
| empty=1 header Upload | Same. |
| Search no-match | Upload does not mint a row. |
| Guest | Continue without (A-01 submit not replayed) then Upload. Still guest. File input **0**. |
| workflowE2E | Harness input cataloged only. No `setInputFiles`. Start trial / Connect **0** on Documents. |
| 390 empty | Upload PDF + mobile header Upload stay empty. Desktop Upload hidden. |
| 390 seed | Mobile header Upload keeps six cards. |

Node `tests/documentsUploadFailClosed.test.mjs` **4 / 4**. leftover18FailClosed **12 / 12** still holds.

## Light 96-ID audit

ISSUE-INVENTORY unique-ID section still lists **96** IDs, all `**proven**`. Spot-checked stomp one-liners still live:

- P1-12 `historyHelpers.js:124` `reason.startsWith('excel:')`
- P1-38 `CompactColorPicker.jsx:336` match-opacity `<= 1`
- P1-53 `syncStatusViewModel.js:41-48` `pending` before queue-offline

No min-viable local bug found.

## Product

None. Fail-closed Upload is already the HubPreview contract. No high-risk file. 8448 not loosened.

## Next leftover-18 fail-closed slice

Account Settings **Start trial** (A-05 / UL-20) — classify live, do not complete a purchase. Connect (A-02 / UL-21) remains bundled leftover18-unblock only.

## Not claimed

Leftover-18 stay parked. Goal stays open. Do **not** re-claim unblocked GAP = 0.
