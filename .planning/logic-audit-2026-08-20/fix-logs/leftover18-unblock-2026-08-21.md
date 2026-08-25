# Leftover-18 legal unblock — 2026-08-21

**2026-08-25 fold:** owner-local receipts in PR 800 comment `5414370572` host-proved X-01, X-05, U-04, UL-13, A-06 / UL-45. Still human-gated: A-01 / UL-15, UL-22, A-02 / X-06 / UL-21, UL-03, UL-16, A-05 / UL-20, A-03 / UL-24. See `leftover18-owner-local-receipts-2026-08-25.md` and `fix-logs/leftover18-owner-local-receipts-fold-2026-08-25.md`. This file stays the fail-closed local-slice record. Do not replay host-proved slices from this VM.

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** All 18 stay parked. No leftover was fully proven.

**This-pass evidence:** Node `tests/leftover18FailClosed.test.mjs` **12 / 12**. Playwright `e2e-leftover18-save-export.spec.mjs` **5 / 5 (11.9s)** on reused Vite `http://localhost:5173`.

## Host facts (inspected, not invented)

| Check | Result |
|---|---|
| `.env` | Present. Keys only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. |
| `.env.local` | **Missing** — no `VITE_DEV_AUTO_LOGIN_*`, no `SUPABASE_SERVICE_ROLE_KEY`. Dev auto-login / `/__dev-auth/session` not usable. |
| `.env.test` | **Missing** — `npm run test:integration` / `test:privacy` cannot run. |
| `.bot-credentials.json` | **Missing**. Official lease `assign` needs a human `email\|userId\|tier\|status` tuple **and** that credentials file. Did not guess emails. Did not invent accounts. |
| `.survey-test-account.json` | **Missing**. |
| Docker / local Supabase | `docker` not installed. Five in-tree `20260820*.sql` files remain unapplied. Not applied to prod Survey `cvamwtpsuvxvjdnotbeg`. |
| Live Stripe / MSAL / Turnstile | Network hosts blocked. Fail-closed / preview gates asserted instead. |

## Leftover-18 table

Verdicts: **unblocked-and-proven** = original host path done. **partial** = legal slice proven; named host still missing. **still-blocked** = no legal slice this pass.

| ID | Verdict | Proven slice (this pass + prior) | Exact missing host |
|---|---|---|---|
| X-01 | **partial** | `?testPdf=` consumes `__devTestPdf` and never stamps `file.id`. Sync chip / presence hidden. History **Save version** owner-gated off (`Only the document owner…`). Node: `DevTestRoute.jsx` “Do NOT set file.id”. | Signed-in cloud user whose session identity changes. Needs `.env.local` auto-login (missing). |
| X-05 persist | **partial** | `kal441-form-fields.pdf` widgets live; typed `leftover18-form` stuck after blur. `file.id` still null. | Cloud persist of form values on a saved `file.id`. |
| X-06 writeback | **partial** | `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false`. Survey **EXPORT** downloaded `KAL-436_Preservation_Template_export.xlsx`. | Live Microsoft 365 sheet writeback / linked workbook. |
| U-04 | **partial** | HubPreview static seed `i1: 3` + archive-with-markers (prior `e2e-u04-archive.spec.mjs`). | Dashboard + Supabase live usage meter. |
| A-01 Turnstile | **partial** | Guest AuthModal: submit without a captcha token stays gated (`I'm human` / auth-error). No token invented. Node: `TURNSTILE_ENABLED && !captchaToken`. | Live Turnstile completion + real password login. |
| A-02 live MSAL | **partial** | HubPreview Connect → `Preview cannot` / `Failed to connect Microsoft`. `msalInstance: null`. | Live MSAL / Graph login. |
| A-03 inbox | **partial** | Share Copy link + Send fail-closed (`Must be signed in` / `Sharing needs a signed-in cloud account`). Roles Viewer/Editor/Owner. Prior signed-in mint stands. | Live invite email delivery. |
| A-05 Stripe | **partial** | Subscription catalog (Pro / Enterprise). Start trial **not clicked**. Developer-tier button disables `StripeCheckout`. No invented checkout URL. | Live Stripe Checkout session. |
| A-06 roster | **partial** | `PresenceAvatars` dedupes by `user_id`. Same-user two-tab stays “just you” (prior). Hidden on `?testPdf=`. | Second signed-in collab account. Lease missing tuple + `.bot-credentials.json`. |
| UL-03 | **partial** | Web `/` opens Auth modal (`Welcome back`) — File→Open stays guest-gated. Electron IPC `menu:open-pdf` exists. `window.electronAPI.openFile` is false here. | Native Electron NSOpenPanel pick/cancel (no display / no Electron in this VM). |
| UL-13 | **partial** | Empty required names blocked. Changed-name Save → `Preview cannot save profile changes`. | Real `updateProfile` persist (would mutate prod; `.env.local` missing). |
| UL-15 | **partial** | Password mismatch / human gate without a captcha token (prior helper-only + this Node gate). | Live Turnstile password change. |
| UL-16 | **partial** | `delete` stays disabled; `DELETE` enables; click → `Preview cannot delete accounts`. Settings stay open. | Live account wipe (destructive; no session). |
| UL-20 | **partial** | Same as A-05 catalog. Trial not clicked. | Live Stripe Checkout. |
| UL-21 | **partial** | Microsoft Connect fail-closed. | Live MSAL. |
| UL-22 | **partial** | Google Connect fail-closed. | Live Google OAuth. |
| UL-24 | **partial** | HubPreview Copy link + Send fail-closed. Prior signed-in mint stands. | Inbox send of a real invite email. |
| UL-45 | **partial** | Same as A-06 (`user_id` dedupe). | Second-account lease tuple. |

**Counts:** **0** unblocked-and-proven · **18** partial · **0** still-blocked with no legal slice.

None moved out of leftover-18. Goal stays open.

## Track B — save / export / import inventory

User-facing controls found (toolbar, File menu, pages, print, download, Excel, spaces, history). Live-proved every control that does **not** need leftover-18 cloud write.

| Control | Where | Status |
|---|---|---|
| Export annotated PDF | AppShell toolbar `aria-label="Export annotated PDF"` | **live** — two downloads `clickable-link-test-annotated.pdf` after a rect draw |
| File → Export annotated PDF… | Electron `Cmd+Shift+E` | IPC only (P-03). Headless web has no File menu |
| Cmd+P Print PDF | blob-iframe (`PRINT_PANEL_ENABLED=false`) | **live** — `[PrintPanel] OPEN` |
| Cmd+Shift+P Print with annotations | File menu / flatten | Prior wave flatten stands. Not re-claimed as a new host |
| Custom Print panel “Save as PDF…” | compile-gated | Flag stays `false` |
| `?testPdf=` fixture import | DevTestRoute | **live** — `kal412-mixed-import-e2e.pdf` imported ≥1 |
| Hub Upload / Ctrl+O web file control | Dashboard | **leftover-18** — `/` Auth modal intercepts Upload (`UL-03` / `A-01`) |
| Electron File → Open PDF… | NSOpenPanel | **leftover-18 UL-03** native pick/cancel |
| Survey Excel EXPORT | Survey rail | **live** — `.xlsx` |
| Excel Sync Microsoft 365 / writeback | linked workbook | **leftover-18 X-06** |
| Space CSV | Spaces header after Create space + Add page 1 | **live** — `Space_1_export.csv` (new this pass; empty space toasts “no pages”) |
| Space PDF Pages | same menu | **live** — `Space_1_export.pdf` |
| History Save version | RevisionsPanel | **fail-closed** — hidden without `file.id` / owner |
| Cloud save / sync chip | collab footer | Hidden on `?testPdf=` (**X-01**) |
| Save Log | `Ctrl+Shift+L` | **live** — `save-log-banner-start` / Description |
| Re-import PDF Bookmarks | Electron File menu | IPC only |
| OneDrive save | A-02 | leftover-18 |
| Form field values | AcroForm widgets | **local live**; cloud persist leftover-18 X-05 |
| Extract Pages | — | **does not exist** (not invented) |
| Annotation JSON download | — | **does not exist** (not invented) |
| Forms create tools | AppShell `{false &&` | compile-hidden (not invented) |

**Gaps found:** none that are product bugs. The previously unproven unblocked slice was **space CSV / PDF Pages** (needs an assigned page or it toast-warns). Proven this pass. Hub web import / cloud save / named cloud revision / Excel writeback stay leftover-18.

## Product

No min-viable product diff. No leftover-18 item fully unblocked.

## Files

- `tests/leftover18FailClosed.test.mjs`
- `debug/scenarios/e2e-leftover18-save-export.spec.mjs`
- this receipt
