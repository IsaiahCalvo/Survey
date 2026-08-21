# Stomp-check 96 + adversarial wave 11 — desktop Pages menu

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave7/8/9/10, leftover **18**, the VM catalog, or official `npm test`.  
Did **not** start wave 12. Sibling spec + receipt are on disk: `debug/scenarios/e2e-adversarial-wave11.spec.mjs` + `fix-logs/e2e-wave11-pages-menu.md` **1 / 1 (8.4s)**. This pass independently re-ran the same spec once (receipt appeared mid-pass) — **1 / 1 (8.0s)**; same verdict. Did **not** spawn a second suite against 5173 after that.  
No prod SQL. Cap **8448** / **75/250** not loosened. No secrets. No `.bot-credentials.json` / `.env*`.

## 1. Stomp-check — 96 unique proven IDs

Sources: `.planning/logic-audit-2026-08-20/COMPLETION-AUDIT.md` §1 + `FIX-LOG.md` + on-disk `fix-logs/*` receipts.

Every original ID (KB-1, KB-2, P1-01…P1-55, P2-01…P2-39) was grepped against current `src/` / `supabase/` / `electron` paths. First-pass “misses” were **path aliases**, not stomps:

| Claimed path in audit | Current on-disk path | Symbol |
|---|---|---|
| `src/utils/annotationDocStore.js` | `src/services/annotationDocStore.js` | `docToByPage`, `SPACES_MAP` |
| `src/utils/annotationCloudSync.js` | `src/services/annotationCloudSync.js` | `DOCUMENT_ANNOTATIONS_DUAL_WRITE_LIVE = false` |
| `src/utils/annotationOutboxRetryView.js` | `src/services/annotationOutboxRetryView.js` | `summarizeOutboxRetry` |
| `src/utils/quitCoordinator.cjs` | `src/electron/quitCoordinator.cjs` | `createQuitCoordinator` |
| `src/utils/collabBannerState.js` | `src/components/collab/collabBannerState.js` | `storageStateAfterResignIn` |
| `src/utils/presenceRoster.js` | `src/hooks/presenceRoster.js` | `PRESENCE_STALE_MS = 10 * 60 * 1000` |
| `src/utils/reSignInAccount.js` | `src/components/collab/reSignInAccount.js` | `isSameReSignInUser` |
| `src/utils/msalAuthMain.js` | `src/electron/msalAuthMain.js` | `selectPreferredAccount`, `classifySilentTokenError` |
| `src/utils/billingReturn.ts` | `supabase/functions/_shared/billingReturn.ts` + `src/utils/billingReturn.js` | `surveytool.app` / `readBillingQuery` |
| `src/utils/billingTrial.ts` | `supabase/functions/_shared/billingTrial.ts` | `proTrialPeriodDays` |
| `src/utils/stripeEventIdempotency.ts` | `supabase/functions/_shared/stripeEventIdempotency.ts` | `withStripeEventIdempotency` |
| `src/utils/accountDeletion.ts` | `supabase/functions/_shared/accountDeletion.ts` | `isDataRemovedDeletionError` |
| `src/utils/pendingInviteResume.js` | `src/services/pendingInviteResume.js` | `resumePendingInviteAfterAuth` |
| `src/components/PDFSidebar.jsx` | `src/PDFSidebar.jsx` | `onTouchCancel` |
| `electron-main.js` | `src/electron-main.js` | `requestSingleInstanceLock` |
| `src/utils/bookmarkEditUtils.js` | `src/sidebar/bookmarkEditUtils.js` | `nextBookmarkOrder`, `planBookmarkDelete` |
| `src/utils/bookmarkReorderUtils.js` | `src/sidebar/bookmarkReorderUtils.js` | `collectBookmarkTreePersistUpdates` |

Prior stomp class (P1-12/38/53, the nine, the thirteen leftover-drops) still present: `excel:` history gate, `matchOpacityPct`, pending-before-offline, `resolveExportedLineEnding2`, pages-panel cache/black/reorder, `nextBookmarkOrder`, `collectBookmarkTreePersistUpdates`, dual-write `false`, team/access gates, `getLineEndpoints` / cloud `/BE` / scale flatten, SVG id remap, `renumberCounters`, MS routing/marker/msal helpers.

**Stomps found: 0. Restores: 0.**

### Invariants (re-grepped)

| Invariant | Holds? |
|---|---|
| `zoomGeneration` / `setZoomGeneration` | yes — `PDFViewer.jsx` |
| SVG `viewBox={`0 0 ${width} ${height}`}` | yes — `SVGAnnotationLayer.jsx` |
| Container-aware canvas (`offsetWidth` → `containerW / width`) | yes — `PageAnnotationLayer.jsx` |
| Single-name `FONT_FAMILIES` (6 names, no CSS stack) | yes — `annotationStyleCatalog.js` |
| CORS `Access-Control-Allow-Origin: '*'` | yes — checkout / portal / send-email / send-profile / excel-apply |
| Zero `checkAndQuit` in `src/` | yes |

High-risk files this pass: `PDFViewer.jsx` only gained the two-line `onRotatePageCCW: handleRotatePageCCW` / dep-list publish (already on `ba4ef0e5`). Did **not** edit `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

## 2. Wave 11 — desktop Pages menu gaps (not a replay)

Sibling launched **PagesPanel desktop menu gaps + wave 11**. Cite (do not treat as missing): `fix-logs/e2e-wave11-pages-menu.md` **1 / 1**. Did **not** start wave 12.

### Product min-diff (`ba4ef0e5`)

`src/sidebar/PagesPanel.jsx` + left-rail publish:

- Desktop context menu item **Rotate counter-clockwise** → existing `handleRotatePageCCW` (`delta: -90`). Canvas/legacy PAL already had it; desktop Pages only offered CW **Rotate**.
- Desktop **Move up** / **Move down** (were `mobileMode`-only). Same `movePageByOffset` → `onReorderPages`. Menu path now honors P1-43 `canReorderPages` (full 1..n sequence), matching drag-reorder.
- Viewport clamp `540` → `620` so the extra rows stay on-screen.
- `tests/pagesPanelUtils.test.mjs` source-wiring asserts for the new strings.

Tiny high-risk publish: `PDFViewer.jsx` `onRotatePageCCW: handleRotatePageCCW` (plus `PDFSidebar.jsx` / `AppShell.jsx` comment).

### Live prove

Vite already on `http://localhost:5173` (HTTP 200). Reused; not killed. No other Playwright on the port.

```bash
node --test tests/pagesPanelUtils.test.mjs
# 5 / 5

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave11.spec.mjs
```

**Live: 1 / 1 passed (8.0s).**  
Fixture: `?testPdf=text-search-glyph-lab.pdf` (3 native pages, portrait).

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — CCW rotate page 2 remaps nothing; export `/Rotate 270` | **pass** | Page-2 rect stayed. Page-3 ellipse stayed. Page 1 empty. Export rotations `[0, 270, 0]`. Page 2 `/Square`. Page 3 `/Circle`. |
| **Break** — Escape dismisses without rotating | **pass** | Menu offered Rotate counter-clockwise; Escape; page 2 stayed portrait; still 3 pages. |
| **Edge** — CW restore; last-page CCW isolated | **pass** | CW on page 2 → export `[0, 0, 0]`. CCW on page 3 → `[0, 0, 270]`. Page-2 rect + page-3 ellipse stayed put. |

Sibling `W11_ROTATE_CCW` log: rect `e41c675d-…`, ellipse `d1efc457-…` (8.4s).  
This-pass re-run: rect `0c6d8d63-…`, ellipse `642892d0-…` (8.0s). Same export rotations.

Node `tests/pagesPanelUtils.test.mjs` **5 / 5**. Did **not** run official `npm test`.  
`graphify` CLI was not on PATH (`graphify-out/graph.json` still present); no graph refresh this pass.

Cited sibling receipt: `fix-logs/e2e-wave11-pages-menu.md`. Note: that audit says desktop Move up/down was left to drag-reorder; `ba4ef0e5` also landed desktop Move up/down + P1-43 `canReorderPages` on the menu path (source-wiring in `tests/pagesPanelUtils.test.mjs`).

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-adversarial-wave11.spec.mjs`

Did **not** write or run wave 12.

## Goal

Stays **open**.
