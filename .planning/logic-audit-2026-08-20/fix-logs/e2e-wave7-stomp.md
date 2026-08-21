# E2E wave 7 + 96-ID stomp-check — 2026-08-21

**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Checkout:** restored from `995e07b9` + later harness edits, then this pass.  
**Vite:** reused `http://localhost:5173` (`npm run dev:ui`, HTTP 200). Did **not** kill it.  
**Does not mark the audit goal complete.** Did not replay the unblocked catalog. Did not retry the 18 host leftovers. Did not apply prod SQL. Did not loosen 8448 or 75/250. Did not read `.bot-credentials.json` / `.env*`.

## Stomp-check (96 unique IDs)

Canonical set: KB-1 + KB-2 + P1-01…P1-55 + P2-01…P2-39. Citations grepped against current `src/` / `supabase/` / `tests/`.

| Verdict | Count | Notes |
|---|---|---|
| **held** | **93** | Proof symbols still on disk (see COMPLETION-AUDIT §1). |
| **stomped → restored** | **3** | P1-12, P1-38, P1-53. |
| **weak / missing** | **0** | after restore |

### Restored (min-diff)

| ID | What was gone | Restore | Proof |
|---|---|---|---|
| **P1-12** | `excel:` missing from `isLegacyAnnotationHistoryMeta` (FIX-LOG said whitelist landed; `995e07b9` restore only added `bookmark:`) | `src/utils/historyHelpers.js` `startsWith('excel:')` | `tests/historyStacks.test.mjs` intended `excel:auto-sync` + break `zoom:fit`/empty + edge `excel:manual-sync` |
| **P1-38** | Match Fill selected ring still used `localOpacity >= 99` (translucent fill never selected) | `src/components/CompactColorPicker.jsx` `Math.abs(localOpacity - matchOpacityPct) <= 1` | `tests/compactColorPickerLayout.test.mjs` source contract |
| **P1-53** | `pendingCount > 0` still ran **before** `stage === 'pending'`. Producer `currentSyncStatus` emits `pending` **with** `queueSize > 0` on a healthy save, so Saving… was unreachable | `src/utils/syncStatusViewModel.js` pending-before-offline (view-model + compact message) | `tests/syncStatusUi.test.mjs` `pending` + queue 3 → Saving… |

Node contracts after restore: `historyStacks` + `syncStatusUi` + `compactColorPickerLayout` + `reSignInReset` → **26 / 26**.

### Held (spot-check, not a catalog replay)

KB-1 `getEraserOperation` → `'skip'`; KB-2 `resolveAnnotationIndexById`; P1-07 `replaceTextInPageJson`; P1-09 `redoHistoryRef` clear; P1-13 preview-baseline delete; P1-21 `commitShapeCreationRef`; P1-45 `bookmark:delete` + `planBookmarkDelete`; P1-48 `prepareAtomicBookmarkEdit`; FONT_FAMILIES single names + mobile import; ReSignIn `resetPassword` / `planReSignInPasswordReset`; HubPreview / DevTestRoute `previewBlocked('delete accounts')`; CORS `Access-Control-Allow-Origin: '*'`; zero `checkAndQuit` in `src/`.

Invariants held: `zoomGeneration` (`PDFViewer.jsx` `useState(0)` + zoom-start increment), SVG `viewBox={`0 0 ${width} ${height}`}`, container-aware `containerW / width` → `effectiveScale`, single-name `FONT_FAMILIES`, CORS `*`.

SQL apply leftovers still in-tree (not applied): P2-01, P2-03, P2-05, P2-10, P2-21, P2-23, P2-28, P2-29 / E2E-CHROME-01.

## Wave 7 (new surfaces)

**Harness:** `debug/scenarios/e2e-adversarial-wave7.spec.mjs` + `debug/playwright.reuse-5173.config.mjs`  
**Live:** **7 / 7 passed** (16.9s).  
Not a replay of wave5 / wave6 / vm-unblocked catalog.

| Surface | Intended | Break | Edge | Result |
|---|---|---|---|---|
| ReSignInModal reset on `?testPdf=` | Forgot password with email fails closed (`Test PDF cannot send…` / captcha) — no “link has been sent” | Empty email → “Enter your email first”; no notice | Draw chrome + URL stay on `testPdf=` | **held** |
| HubPreview delete-account fail-closed | Type `DELETE` → permanently click → `Preview cannot delete accounts` | Lowercase `delete` keeps permanently disabled | Same session profile Save also fail-closed; still on hub | **held** |
| Form widgets + undo | Fill widget, draw rect, Undo drops rect | Extra Undo does not wipe the field | `file.id` null | **held** |
| Context-menu + bookmark delete | Right-click owned rect opens `[data-annotation-context-menu]`; bookmark delete after dismiss-confirm keeps the rect | Dismiss confirm keeps the bookmark **and** the rect | Undo restores bookmark; rect stays | **held** |
| zoomGeneration mid-draw | Mid-pen Zoom in commits ink | Bare Zoom in adds no user mark | Fit page keeps the committed stroke | **held** |
| Font single-name after mobile `FONT_FAMILIES` | Live Font menu lists the six single names; Georgia commits on the trigger | No option contains `,` / `apple-system` | Mobile chrome still `FONT_FAMILIES.map` (Vite `/src/` fetch when served) | **held** |
| More-menu DismissBarrier after catalog-01 | More stays open on the trigger; first outside click dismisses only | Hub does not navigate off `hubPreview=1` | Reopen More on the same row and on Package 2 | **held** |

### DEV seam (ReSignIn on `?testPdf=`)

`YDocProvider` short-circuits when `docId` is null (`tab.file?.id` is null on the test-PDF route), so Inner (and ReSignInModal) never mounted. Added **DEV-only** `YDocDisabledDevReSignIn`: `window.__test_emitTransportState({ code: 'login_expiry_failure' })` opens the real modal against mock `AuthContext.resetPassword` (`previewBlocked`). Production (`import.meta.env.DEV === false`) keeps the previous null-context wrapper. Not a production login-expiry change.

## Product fixes this pass

1. P1-12 excel history whitelist  
2. P1-38 Match Fill opacity ring  
3. P1-53 pending-before-offline sync pill  
4. DEV-only ReSignIn seam on the no-`file.id` provider path  

High-risk files not edited (`PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`).

## Leftover 18 (unchanged — do not retry)

`X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

## Goal

Stays **open**.
