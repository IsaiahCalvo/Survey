# E2E VM unblocked re-proof — 2026-08-21

**Workspace:** `/workspace` (Linux cloud VM)  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, pid 16483, HTTP 200). Did **not** kill it.  
**Harness:** `debug/playwright.reuse-5173.config.mjs`  
**Does not mark the audit goal complete.** Did not apply prod SQL. Did not loosen 8448 or 75/250. Did not read `.bot-credentials.json`. Did not retry the 18 host leftovers. Did not flip `PRINT_PANEL_ENABLED`.

Transferred receipts from another machine were treated as **unproven here**. This pass re-ran the unblocked catalog in small batches (not a 117-test one-shot).

## Inventory (`debug/scenarios/e2e-*.spec.mjs` = 27)

### Already proven on this VM (not re-run)

| Spec | Tests | Prior receipt |
|---|---|---|
| `e2e-a01-hubpreview-adversarial.spec.mjs` | 5 | HubPreview A-01 5/5 |
| `e2e-hubpreview-noop-hunt.spec.mjs` | 10 | noop-hunt 10/10 |
| `e2e-silent-stub-hunt.spec.mjs` | 10 | `?testPdf=` stubs 10/10 |
| `e2e-p1-45-adversarial.spec.mjs` | 6 | P1-45 6/6 |

### Skipped (Capacitor / Electron-native / host leftovers)

| Spec | Why |
|---|---|
| `e2e-electron-file-open.spec.mjs` | UL-03 native pick |
| `e2e-local-migrations.spec.mjs` | SQL apply |
| `e2e-named-revision-restore.spec.mjs` | writes a real named revision |
| `e2e-outbox-retry.spec.mjs` | writes a real cloud doc / outbox |
| `e2e-signed-in-leftovers.spec.mjs` | share mint / `file.id` writes |
| `e2e-two-tab-presence.spec.mjs` | A-06 / UL-45 roster |
| `e2e-u04-archive.spec.mjs` | U-04 leftover (standalone) |
| `e2e-print-panel.spec.mjs` | flag-off (`PRINT_PANEL_ENABLED = false`); did not flip |

### Ran here (unblocked)

| Batch | Specs | Tests | Result |
|---|---|---|---|
| 1 | chrome-03 + context-menu-spaces + kb1 | 7 | **7 / 7** (18.3s) |
| 2 | helper-only + hub-templates | 9 | first 7/9; after harness **9 / 9** (14.7s) |
| 3 | catalog-completeness + unblocked-followup | 11 | **11 / 11** (39.1s) |
| 4 | unblocked-followup-2 + wave-remaining | 13 | first 12/13 (D-02 timeout); after harness followup-2 **5 / 5** (16.6s); wave-remaining **8 / 8** |
| 5 | adversarial-repass | 13 | first 12/13 (U-03 Meta+A); after `ControlOrMeta+A` **13 / 13** (37.8s) |
| 6 | adversarial-wave2 | 12 | **12 / 12** (37.7s) |
| 7 | adversarial-wave3 | 14 | first 13/14 (ControlOrMeta+A blocked text create); after Meta+A revert isolation **1 / 1**; other 13 already passed → **14 / 14** |
| 8 | adversarial-wave4 | 15 | **15 / 15** (55.4s) |
| 9 | adversarial-wave5 | 15 | **15 / 15** (49.5s) |
| 10 | adversarial-wave6 | 12 | first 10/12; after harness **12 / 12** (35.0s) |

**Playwright unblocked this pass:** **121 / 121**.  
**Prior this-VM proofs:** **31 / 31**.  
**Combined this-VM unblocked:** **152** Playwright tests. **0 product-fail.**

### Related Node wave/catalog specs

`tests/e2eUnlistedControls.test.mjs` + `tests/e2eWave2ResizeRotationDraw.test.mjs` + `tests/e2eWave3RemainingRows.test.mjs` → **34 / 34**.

## Harness fixes (no product `src/` edit)

### 1. A-04 helper-only Sign out

HubPreview `signOut` is `previewBlocked('sign out')`, not a silent no-op. Settings stay open with `.account-error` = `Preview cannot sign out.`  
**File:** `debug/scenarios/e2e-helper-only-live.spec.mjs`  
**Proof:** A-04 **1 / 1** in the 9 / 9 re-run.

### 2. U-03 / wave6 template title locator

`Click to rename` / first `.cat-title` matches category titles (strict-mode flake). Scoped to the 22px header input.  
**Files:** `e2e-hub-templates-leftovers.spec.mjs`, `e2e-adversarial-wave6.spec.mjs`  
**Proof:** U-03 **1 / 1**; wave6 hubPreview **1 / 1**.

### 3. D-02 Color popover covers Highlighter

Annotation Color picker (`<span>Color</span>` in `chrome-top-host`) intercepts the Highlighter sub-tool. Escape alone did not close it here. Toggle the trigger closed; skip the click when `btn-active`.  
**File:** `e2e-unblocked-followup-2.spec.mjs`  
**Proof:** D-02 **1 / 1** (3.0s) then suite **5 / 5**.

### 4. U-03 blank-rename select-all on Linux

`Meta+A` is macOS-only. On Linux it deleted one character (`Hold` → `Hol`) so blank-rename restore never ran.  
**File:** `e2e-adversarial-repass.spec.mjs` uses `ControlOrMeta+A` **only inside the title input**.  
**Proof:** U-03 **1 / 1** then suite **13 / 13**.

Wave3 annotation “Cmd+A if offered” stays `Meta+A`. `ControlOrMeta+A` on the page fired browser Ctrl+A and left text-overlay create dead. Reverted. Isolation **1 / 1**.

### 5. Wave6 Match Fill picker tabs

Fill/Border clicks were racing the closed picker. Reused the re-pass `openFillPicker` / `openStrokePicker` helpers.  
**File:** `e2e-adversarial-wave6.spec.mjs`  
**Proof:** Match Fill **1 / 1** then suite **12 / 12**.

## Product

None. High-risk files not touched. Invariants untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`.

## Host-blocked leftovers (unchanged — do not retry)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged. P-01 / UL-46 native Capacitor not re-run. Print panel stays flag-off.

## Goal

Stays **open**.
