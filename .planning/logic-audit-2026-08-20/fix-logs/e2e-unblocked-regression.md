# E2E unblocked regression — 2026-08-21

**Worktree:** `nifty-elion-773074`  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`; HTTP 200). Restarted once after the first suite killed the prior 5173 process. Did **not** kill 5174.  
**Harness:** `debug/playwright.reuse-5173.config.mjs`  
**Does not mark the audit goal complete.** No commit. Did not apply SQL. Did not write to personal auto-login. Did not read `.bot-credentials.json`. Did not click Stripe / complete MSAL / captcha / wipe / Capacitor / native file-dialog.

## Inventory

`debug/scenarios/e2e-*.spec.mjs` = **24** files. **18 unblocked** (129 Playwright tests). **6 skipped** (hosts / Electron / personal-account writes).

### Ran (unblocked)

| Spec | Tests | Result |
|---|---|---|
| `e2e-adversarial-repass.spec.mjs` | 13 | **13 / 13** (T-05 failed once, then product-fixed + re-proved) |
| `e2e-adversarial-wave2.spec.mjs` | 12 | **12 / 12** (first suite, before Vite death) |
| `e2e-adversarial-wave3.spec.mjs` | 14 | **14 / 14** (export timeout was Vite death; re-pass held) |
| `e2e-adversarial-wave4.spec.mjs` | 15 | **15 / 15** (one in-suite flake; isolation **pass**) |
| `e2e-adversarial-wave5.spec.mjs` | 14 | **14 / 14** |
| `e2e-adversarial-wave6.spec.mjs` | 11 | **11 / 11** |
| `e2e-catalog-completeness.spec.mjs` | 5 | **5 / 5** |
| `e2e-chrome-03-vite.spec.mjs` | 3 | **3 / 3** |
| `e2e-context-menu-spaces.spec.mjs` | 3 | **3 / 3** |
| `e2e-helper-only-live.spec.mjs` | 5 | **5 / 5** (A-01 product-fixed + re-proved) |
| `e2e-hub-templates-leftovers.spec.mjs` | 4 | **4 / 4** (U-03 in-suite flake; isolation **pass**) |
| `e2e-kb1-entire-mode.spec.mjs` | 1 | **1 / 1** |
| `e2e-p1-45-adversarial.spec.mjs` | 6 | **6 / 6** |
| `e2e-u04-archive.spec.mjs` | 1 | **1 / 1** (hubPreview only; cloud usage **not** retried) |
| `e2e-unblocked-followup.spec.mjs` | 6 | **6 / 6** |
| `e2e-unblocked-followup-2.spec.mjs` | 5 | **5 / 5** (D-02 in-suite flake; isolation **pass**) |
| `e2e-wave-remaining.spec.mjs` | 8 | **8 / 8** |
| `e2e-print-panel.spec.mjs` | 1 | **flag-off** — `PRINT_PANEL_ENABLED = false` in `PDFViewer.jsx`. Not a product regression. Repeat live needs a DEV flip. |

**Playwright unblocked:** **128 passed** / **0 product-fail** / **1 flag-off** (print panel).

### Node E2E (audit-produced)

`tests/e2eUnlistedControls.test.mjs` + `tests/e2eWave2ResizeRotationDraw.test.mjs` + `tests/e2eWave3RemainingRows.test.mjs` → **34 / 34** after the mobile stroke-picker restore.

### Skipped (hosts / Electron / personal writes)

| Spec | Why skipped |
|---|---|
| `e2e-electron-file-open.spec.mjs` | Electron native dialog (UL-03 / P-03) |
| `e2e-local-migrations.spec.mjs` | SQL apply + personal auto-login |
| `e2e-named-revision-restore.spec.mjs` | Writes a real named revision on personal auto-login |
| `e2e-outbox-retry.spec.mjs` | Writes a real cloud doc / outbox |
| `e2e-signed-in-leftovers.spec.mjs` | Share mint / real `file.id` writes |
| `e2e-two-tab-presence.spec.mjs` | A-06 / UL-45 roster leftover + presence upserts |

## Resume (this pass)

Did **not** restart the whole 129. The in-flight 117-test run finished on disk: **112 passed / 5 failed** (15.5m). Isolated the five:

| Failure | Isolation | Verdict |
|---|---|---|
| wave4 two text boxes / font isolation | **pass** | in-suite flake (`Edit text` disabled) |
| U-03 templates editor | **pass** | in-suite flake (strict `Click to rename` hit category titles) |
| D-02 highlighter print | **pass** | in-suite flake (Color chrome intercept) |
| A-01 guest Sign in | **fail then pass** | product — preview `signIn` was `asyncNoop` |
| UL-40–43 print panel | not re-flipped | flag-off leftover |

## Product fixes

### 1. Mobile stroke picker lost Match Fill + `minOpacity: 1`

- **File:** `src/mobile/MobilePdfViewerChrome.jsx`
- Rect/ellipse stroke now matches AppShell: `firstPreset: { kind: 'match', … }` and `minOpacity: 1`. Other tools stay transparent-capable.
- **Proof:** Node `stroke pickers pass minOpacity=1 and Match Fill`.

### 2. T-05 — two style undos deleted the created text

- Bold + Georgia during text edit batched into one click-away commit, so undo×2 popped create.
- **Files:** `src/components/TextEditOverlay.jsx` (live `onTextStyleChange` per style; skip replay checkpoint when only styles changed); `src/PDFViewer.jsx` (tiny: `handleSaveAnnotations` `source: 'text:style'` + honor `commitOpts.checkpointPolicy`).
- **Proof:** `e2e-adversarial-repass` T-05 **1 / 1** (10.3s). Intended: Bold then Georgia. Break: first undo drops a style, keeps text. Edge: second undo still keeps create.

### 3. A-01 — guest Sign in closed with no error when Turnstile is off

- Dev auth relay disables `TURNSTILE_ENABLED`. HubPreview `signIn` was `asyncNoop`, so submit succeeded and closed the modal.
- **File:** `src/home/HubPreview.jsx` — `signIn` / `signUp` / Google / SSO now `previewBlocked(...)`.
- **Proof:** A-01 **1 / 1** (2.6s). A-03 + A-04 still **2 / 2**.

### 4. Mobile sheets missing `onTouchCancel` on handles

- Found when `npm test` read `MobilePdfViewerChrome.jsx` after the stroke edit. Text + users sheet handles had `onTouchEnd` only.
- **File:** `src/mobile/MobilePdfViewerChrome.jsx` — bind `onTouchCancel` next to `onTouchEnd`.
- **Proof:** `src/mobile/__tests__/useMobileSheetMotion.touchcancel.test.mjs` **2 / 2**.

`tests/annotationStyleUiContract.test.mjs` now asserts mobile `firstPreset: { kind: 'match'` (the restored one-visible stroke) instead of the stale `firstPreset: 'none'` string. A separate assertion that mobile source contains `FONT_FAMILIES` still fails — mobile uses a local font list. Pre-existing source-contract miss; not chased this pass.

High-risk PDFViewer diff is the T-05 style checkpoint only. Invariants untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`. `graphify update .` succeeded.

## Host-blocked leftovers (unchanged — do not retry)

`X-01`, `X-05` cloud persist, `X-06` writeback, `U-04` cloud usage, `A-01` Turnstile completion, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe click, `A-06` two-client roster, `UL-03` native pick, `UL-13` profile persist, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

SQL apply leftovers unchanged. P-01 / UL-46 native Capacitor already proven on Simulator — not re-run.

## Goal

Stays **open**.
