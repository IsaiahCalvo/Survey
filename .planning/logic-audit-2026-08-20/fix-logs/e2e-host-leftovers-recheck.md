# Host leftovers recheck — 2026-08-21

**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not apply migrations. Did not click Stripe / complete MSAL / Google / captcha / wipe / Capacitor / native file-dialog. Did not read `.bot-credentials.json`. Did not invent accounts.

## 1. Authoritative artifacts

Restored **exact** blobs from git `00fda232` (byte-identical `git show` vs working tree). Not invented.

| File | Lines | On disk |
|---|---|---|
| `.planning/logic-audit-2026-08-20/REPORT.md` | 548 | yes |
| `.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md` | 274 | yes |
| `.planning/logic-audit-2026-08-20/FIX-LOG.md` | 125 | yes |
| `.planning/logic-audit-2026-08-20/known-bugs-deep-dive.json` | 52 | yes |

Neighbors: only `00fda232` has these four paths. `FEATURE-MATRIX.md` was already on disk.

## 2. Signed-in writes

`.env.local` auto-login is **personal** (not `bot-*@` / `*@example.test`). **Writes skipped.** Did not open a disposable cloud document, persist profile, form values, Excel writeback, usage, or inbox send.

## 3. Per-ID host-blocked recheck (was 21)

Each leftover was checked: truly host-blocked vs misclassified (Vite 5173 `?testPdf=` / `?hubPreview=1` already enough).

| ID | Classification | Why |
|---|---|---|
| X-01 | **host-blocked** | Outbox / chip-hidden on `?testPdf=` already proven. Live identity-churn needs a signed-in identity change. Not invented. Personal writes skipped. |
| X-05 (cloud persist) | **host-blocked** | 8 widgets already live. Persist needs `file.id` + a write. Personal writes skipped. |
| X-06 (host writeback) | **host-blocked** | Local EXPORT proven (see §4). Live workbook / Graph push still needs the Excel host. |
| U-04 (cloud usage) | **host-blocked** | hubPreview archive-with-markers already proven. Cloud usage count needs Dashboard + Supabase. Personal writes skipped. |
| A-01 (Turnstile) | **host-blocked** | Guest chrome already proven. Password+captcha completion forbidden this pass. |
| A-02 (live MSAL) | **host-blocked** | Connect fail-closed proven on Vite (§4). Live Microsoft login forbidden. |
| A-03 (inbox) | **host-blocked** | Mint + invalid Send already proven. Real inbox send would write. Personal writes skipped. |
| A-05 (Stripe click) | **host-blocked** | Catalog + `?billing=` return proven on Vite (§4). Checkout click forbidden. |
| A-06 (roster) | **host-blocked** | Self / same-user two-tab already **just you**. No in-repo `email\|userId\|tier\|status` tuple. Lease not assigned. |
| P-01 (native) | **host-blocked** | 390×844 proxy already proven. Native Capacitor forbidden. |
| UL-03 (native pick/cancel) | **host-blocked** | IPC + panel-open already recorded. Native pick/cancel forbidden. |
| UL-13 (profile persist) | **host-blocked** | Empty-name chrome already proven. `updateProfile` would mutate the personal account. Writes skipped. |
| UL-15 | **host-blocked** | Mismatch chrome already proven. Turnstile completion forbidden. |
| UL-16 | **host-blocked** | DELETE confirm chrome already proven. Account wipe forbidden. |
| UL-20 | **host-blocked** | Same leftover as A-05 Checkout click. |
| UL-21 | **host-blocked** | Same leftover as A-02 live MSAL. |
| UL-22 | **host-blocked** | Live Google OAuth forbidden. Connect fail-closed already proven. |
| UL-24 (inbox send) | **host-blocked** | Same leftover as A-03 inbox. |
| UL-45 | **host-blocked** | Same leftover as A-06 roster. |
| UL-46 | **host-blocked** | Same leftover as P-01 native Capacitor. |
| **E2E-CHROME-03** | **moved → proven** | Coverage umbrella for A-02 / X-06 / A-05. Vite intended + break + edge closed this pass. Host leftovers stay on those leaf IDs. |

## 4. E2E-CHROME-03 Vite proof

Vite `http://localhost:5173` (this worktree). Harness: `debug/scenarios/e2e-chrome-03-vite.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`. Did not use 5174. Did not write to a cloud account.

| Row | Intended | Break | Edge | Result |
|---|---|---|---|---|
| A-02 | Settings → Connected services → Microsoft Connect visible (localhost, Capacitor hide false) | Connect fail-closed (`Preview cannot` / `Failed to connect Microsoft`); no MSAL popup; URL stays off `login.microsoftonline` | Still **Not connected**; no invented token | **pass** |
| A-05 | Pro / Enterprise catalog; Start trial visible **not clicked**; Contact sales | Contact sales is `mailto:` + `Enterprise Plan Inquiry` (window.open intercepted); no Stripe Checkout URL | `?billing=nope` → no toast; `?billing=cancelled` → `Checkout cancelled.` and query stripped | **pass** |
| X-06 | Survey → KAL-436 → Walls → EXPORT downloads `KAL-436_Preservation_Template_export.xlsx` | No Graph/OneDrive navigation; Sync Microsoft 365 not enabled | `data-document-id` count 0; Live Sync row hidden (OneDrive-only) | **pass** |

First run: A-02 + A-05 passed; X-06 hung on `getAttribute('data-document-id')` waiting for a missing attr. Spec switched to `count()`. Re-run `-g X-06` → **1 / 1** (5.5s). Combined: **3 / 3**.

CORS `Access-Control-Allow-Origin: '*'` still on checkout / portal / excel-apply-changeset (not tightened). `EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false` (`src/utils/excelWritebackGate.js:14`).

No product bug. No `src/` edit.

## 5. Remaining host-blocked list (20)

`X-01`, `X-05` (cloud persist), `X-06` (host writeback), `U-04` (cloud usage), `A-01` (Turnstile), `A-02` (live MSAL), `A-03` (email delivery), `A-05` (Stripe click), `A-06` (two-client roster), `P-01` (native Capacitor), `UL-03` (native pick/cancel), `UL-13` (profile persist), `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24` (inbox send), `UL-45`, `UL-46`.

SQL apply leftovers unchanged (not retried): `P2-01` / `P2-03` / `P2-05` / `P2-10` / `P2-21` / `P2-23` / `P2-28` / `P2-29` / `E2E-CHROME-01`.

## Files

- Restored: `REPORT.md`, `ISSUE-INVENTORY.md`, `FIX-LOG.md`, `known-bugs-deep-dive.json`
- Added: `debug/scenarios/e2e-chrome-03-vite.spec.mjs`
- Updated: `COMPLETION-AUDIT.md` (110 proven / 20 host-blocked), `E2E-NEW-ISSUES-CHROME.md` status line

Invariants untouched. No commit. **Goal stays open.**
