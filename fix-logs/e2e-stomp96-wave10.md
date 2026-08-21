# Stomp-check 96 + adversarial wave 10 — insert-blank

**Date:** 2026-08-21  
**Workspace:** `/workspace`  
**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Goal:** stays open

Did **not** replay wave7/8/9, leftover **18**, the VM catalog, or official `npm test`.  
Did **not** duplicate sibling survey-marker (`debug/scenarios/e2e-survey-marker.spec.mjs` — already exists and **1 / 1** in `fix-logs/e2e-survey-marker.md`).  
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

High-risk files **not** edited: `PDFViewer.jsx`, `PageAnnotationLayer.jsx`, `FabricEraserCanvas.jsx`, `SVGAnnotationLayer.jsx`, `viewerShared.js`, `package.json`, `vite.config.js`.

## 2. Wave 10 — new surface (not a replay)

Sibling already live-proved **survey-marker** (`e2e-survey-marker.spec.mjs` **1 / 1**). Skipped that spec.

Unused hunt: **desktop Pages “Insert blank page”** after flatten/export waves. Handler `handleInsertBlankPage` was wired but only reachable from mobile “Add” and the legacy canvas PAL menu. Live SVG desktop path had Duplicate/Rotate/Delete and no Insert.

### Product min-diff

`src/sidebar/PagesPanel.jsx`

- Desktop context menu item **Insert blank page** → existing `onInsertBlankPage`
- Escape dismiss (menu previously outside-click only)
- `data-pages-context-menu="true"` hook
- Viewport clamp `420` → `480` so Delete stays on-screen after the extra row
- Defer outside-click listener one frame so the opening right-click cannot auto-dismiss

`tests/pagesPanelUtils.test.mjs` — source-wiring asserts for the new strings.

### Live prove

Vite already on `http://localhost:5173` (HTTP 200). Reused; not killed.

```bash
node --test tests/pagesPanelUtils.test.mjs
# 5 / 5

npx playwright test --config debug/playwright.reuse-5173.config.mjs \
  debug/scenarios/e2e-adversarial-wave10.spec.mjs
```

**Live: 1 / 1 passed (8.3s).**  
Fixture: `?testPdf=text-search-glyph-lab.pdf` (3 native pages, no annots).

| Hunt | Verdict | Live proof |
|---|---|---|
| **Intended** — Insert after page 1 remaps later pages; draw on the blank; export | **pass** | 3 → 4 pages. Page-1 rect stayed. Inserted page 2 empty then accepted a Line. Page-2 ellipse remapped to page 3. Export: `/Square` / `/Line` / `/Circle` / `[]`. In-app print (`Ctrl+Shift+P`) opened. |
| **Break** — Escape dismisses without inserting | **pass** | Menu offered Insert blank page; Escape; still 3 pages. |
| **Edge** — undo the inserted-page draw; dismiss Delete; accept Delete remaps back | **pass** | Undo dropped the Line; Square + Circle stayed. Dismiss Delete kept 4 pages. Accept Delete of the blank → 3 pages; Circle back on page 2. Export `/Square` / `/Circle` / `[]`. |

`W10_INSERT_BLANK` log: rect `cc3eb622-…`, ellipse `2c3171d4-…`, line `2ed819cd-…`.

Node `tests/pagesPanelUtils.test.mjs` **5 / 5**. Did **not** run official `npm test`.

## Leftover 18 — unchanged

Not retried. Still open: `X-01`, `X-05` persist, `X-06` writeback, `U-04`, `A-01` Turnstile complete, `A-02` live MSAL, `A-03` inbox, `A-05` Stripe, `A-06`, `UL-03` native pick, `UL-13`, `UL-15`, `UL-16`, `UL-20`, `UL-21`, `UL-22`, `UL-24`, `UL-45`.

Crossing-cuts allocation leftover unchanged. Cap not loosened.

## Spec

`debug/scenarios/e2e-adversarial-wave10.spec.mjs`

Cited sibling (not duplicated): `debug/scenarios/e2e-survey-marker.spec.mjs` + `fix-logs/e2e-survey-marker.md` **1 / 1**.

## Goal

Stays **open**.
