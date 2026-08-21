# Host leftovers — 2026-08-21

**Worktree:** `nifty-elion-773074`  
**Does not mark the audit goal complete.** No commit. Did not apply migrations. Did not invent identity-churn / Stripe / MSAL / captcha / wipe / Capacitor passes.

## 1. Stomp / completion check of original 96 IDs

Canonical list reconstructed from `RECONCILE.md` + `COMPLETION-AUDIT.md`. Still missing on disk: `REPORT.md`, `ISSUE-INVENTORY.md`, `FIX-LOG.md`, `known-bugs-deep-dive.json`.

**96 / 96 closed. Stomps found: 0. Restored: 0.**

Every claimed `src/` / SQL symbol was re-checked on disk this pass. Naive string misses that were **not** stomps:

| ID | Why the first miss was false |
|---|---|
| KB-2 | `annotationZOrder.js` + `resolveAnnotationIndexById` + `docToByPage` present; file does not export a symbol named `annotationZOrder` |
| P1-07 | `tests/pdfViewerStaleIdCommits.test.mjs` re-resolves by `findIndex` / `originalRef`; does not contain the word `stale` |
| P1-30 | `remoteDeleteInteraction.js` + YDocProvider `Restore?` toast still present |
| P2-19 | Copy is in `SurveySpacesRail.jsx` (“Automatic writeback is off”). Flag is `EXCEL_AUTOMATIC_WRITEBACK_ENABLED` in `src/utils/excelWritebackGate.js` (imported by `PDFViewer.jsx`), not a rail identifier |

Invariants still hold: `zoomGeneration`, SVG `viewBox`, container-aware `effectiveScale`, single-name `FONT_FAMILIES`, CORS `Access-Control-Allow-Origin: '*'`. Zero `checkAndQuit` in `src/`.

`E2E-CATALOG-01` still in `src/home/DocumentsLedger.jsx`: `DismissBarrier insideRefs={[ref, trigger]}`. Stale Node contract expected `[ref]` only — updated `tests/hubDismissBarrierContracts.test.mjs` to the trigger wiring. Product file unchanged this pass.

`PRINT_PANEL_ENABLED` was flipped `true` for the live panel pass, then **restored `false`**. `src/PDFViewer.jsx` product diff vs this session’s start: none.

## 2. Second-account lease (A-06 / UL-45)

**Blocked. Did not assign. Did not run a leased harness.**

Official CLI (`node scripts/test-account-lease.mjs`):

```
Usage: test-account-lease.mjs <assign|verify|run|attest-cleanup|recover-run|release>
```

There is **no `list` command**. `assign --task KAL-AUDIT-E2E` without `--account` exits:

```
At least one exact account assignment is required
```

`assign` requires one or more human-supplied `--account email|userId|tier|status` tuples **and** resolves passwords from the coordinator credentials file. This pass did **not** read `.bot-credentials.json` (file exists at the script’s default path; contents unread). No existing `.survey-test-account.json` in the worktree.

Exact blocker: the official script cannot reserve an existing second account without a human-supplied `email|userId|tier|status` tuple (or reading secrets). Two-client presence remains unproven.

## 3. DEV-only leftovers

### UL-40–43 custom print panel — **live this pass**

Vite `http://localhost:5173` already serving this worktree (not killed). `PRINT_PANEL_ENABLED` flipped `true` in DEV, then restored.

`npx playwright test --config=debug/playwright.reuse-5173.config.mjs debug/scenarios/e2e-print-panel.spec.mjs` → **1 / 1** (2.9s) on `?testPdf=clickable-link-test.pdf`.

| ID | Intended | Break | Edge |
|---|---|---|---|
| UL-40 | 10 paper options + Custom W×H fields | empty W blurs to `8.5` | H `999` clamps to `200` |
| UL-41 | Rotate clockwise keeps the dialog | — | clockwise click after copies clamp |
| UL-42 | Copies start at 1; More → 2 | Fewer at 1 stays 1; typed `0` → `1` | typed `1000` → `999` |
| UL-43 | Markups + Color switches + dest `Save as PDF…` option | Clear → Print 0 disabled | All restores Print; Markups toggle off; close hides dialog |

Flag after restore: `const PRINT_PANEL_ENABLED = false` at `src/PDFViewer.jsx:29147`. Repeat live needs another DEV flip. Default Cmd+P remains blob/OS print.

### UL-03 Electron File→Open native chooser — **opened, drive blocked**

Spawned `npm run dev` in this worktree (Vite **5175**; 5173/5174 already taken). Native `File → Open PDF…` opened real NSOpenPanel **Open PDF document** (PDF filter; non-PDFs gray). Could not pick a fixture, Cancel, or force a non-PDF: Electron AX is menu-bar only (no dialog buttons); `System Events` `click at` hits `loginwindow` **Login**; HID/Escape did not reach the panel. IPC stub **not** used as a pass. Receipt `fix-logs/electron-desktop.md`. Native chooser remains unproven.

## 4. Remaining host-blocked (goal stays open)

| Leftover | Why |
|---|---|
| Five in-tree SQL migrations | Production-linked Survey (`cvamwtpsuvxvjdnotbeg`) + no local Docker. Not applied. |
| A-06 / UL-45 two-client roster | Official lease has no `list`; `assign` needs a human `email\|userId\|tier\|status` tuple. Secrets unread. |
| UL-03 native Electron chooser | Panel opened on 5175; pick/cancel unproven (AX + loginwindow click-steal). `fix-logs/electron-desktop.md`. |
| UL-40–43 repeat live | Flag restored `false`. Proven once this pass. |
| X-01 identity-churn | Needs a signed-in cloud user whose session identity changes. Not invented. |
| A-01 / UL-15 captcha completion | Turnstile + real password form. |
| UL-16 wipe | Destructive account delete. |
| A-05 / UL-20 Stripe | Checkout not clicked. |
| A-02 / UL-21 live MSAL | Host OAuth. |
| UL-22 Google OAuth | Host OAuth. |
| A-03 / UL-24 email delivery | Invalid Send already fail-closed. No real inbox send. |
| P-01 / UL-46 native Capacitor | No device / XCUI. |
| X-06 Excel host writeback | Live sheet host. |
| X-05 form cloud persist | Needs a saved `file.id`. |
| UL-13 profile persist | Would mutate the production profile. |
| Hub Archive restore / delete forever | Real Supabase archive when `user.id` is set. |
| U-04 cloud usage count | Needs Dashboard + Supabase. |

## Files

- `debug/scenarios/e2e-print-panel.spec.mjs` — intended + break + edge (requires DEV flag flip)
- `tests/hubDismissBarrierContracts.test.mjs` — contract matches E2E-CATALOG-01 trigger
- `src/PDFViewer.jsx` — flag restored `false` (no lasting product diff from this pass)
- `COMPLETION-AUDIT.md` — leftover list aligned to this evidence

No commit. **Goal stays open.**
