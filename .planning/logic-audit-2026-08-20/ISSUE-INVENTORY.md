# Logic-audit issue inventory

Written: 2026-08-20 · Wave 1 foundation
Sources: `REPORT.md` + `known-bugs-deep-dive.json`

## Count reconciliation

| Source | Claimed | Canonical unique IDs in this inventory |
|---|---|---|
| Pass 1 (incl. 2 known bugs) | 58 | **57** = KB-1 + KB-2 + P1-01…P1-55 |
| Pass 2 | 45 | **39** = P2-01…P2-39 |
| **Headline total** | **103** | **96 unique issues** |

**Why 103 ≠ 96.** The synthesis headline counts *pre-fold / pre-merge* auditor tickets:

- Pass 1 “58” includes the z-order finding both as known-bug 2.2 **and** as a later “z-order persistence” ticket that REPORT.md then folded into KB-2. Unique after fold: 57.
- Pass 2 “45” expands two merged composites: P2-34 (3 shortcut tickets) and P2-35 (3 mobile-sheet tickets). Unique IDs: 39. Expanded sub-defects: 39 − 2 + 6 = 43. Remaining +2 vs 45 is undocumented double-count in the pass-2 rollup (no additional unique defect text exists).

**This inventory is the source of truth: 96 unique issues.** Workers must close every ID below. P2-34 and P2-35 each list their sub-defects so E2E coverage is not lost.

**Wave 1 closed (10):** P1-01, P1-02, P1-03, P1-04, P1-12, P1-37, P1-38, P1-39, P1-53, P2-37. Remaining open: **86**.

Known-bugs JSON contributes **no extra IDs** — it is the deep-dive for KB-1 and KB-2 only.

---

## Status legend

- `open` — not fixed this wave
- `fixed` — landed + evidenced in `FIX-LOG.md`
- `wontfix` — rejected with reason (none yet)

**User-visible** = a person can hit it in the running product without opening DevTools/tests.
**Test-only** = dead code, comment drift, or a path only a test/harness can reach.

---

## High-risk serialization (do not parallelize)

These files are load-bearing. Any two workers that both write them **must be serialized**.

| File | Risk |
|---|---|
| `src/PDFViewer.jsx` | Highest — ~34k lines |
| `src/PageAnnotationLayer.jsx` | Legacy canvas path |
| `src/components/FabricEraserCanvas.jsx` | `zoomGeneration` contract |
| `src/components/SVGAnnotationLayer.jsx` | SVG viewBox owns zoom |
| `src/viewerShared.js` | Imported by both big files |
| `package.json` / `vite.config.js` | Infra |

**Buckets that share a high-risk file are marked `SERIALIZE`.** Parallel-safe buckets have non-overlapping primary-file ownership.

---

## Feature-bucket roster (spawn one worker per bucket)

| Bucket | IDs | Count | Primary ownership (non-overlapping) | Parallel? |
|---|---|---|---|---|
| `export-print` | P1-01, P1-02, P1-03, P1-04, P2-37 | 5 · **all fixed wave 1** | `src/utils/pdfAnnotationsPdfLib.js`, `src/utils/pdfAppAnnotationMetadata.js`, `src/utils/lineRenderHelpers.js` | YES (internally serial — one file) |
| `eraser-policy` | KB-1 | 1 | `src/utils/eraserPolicy.js`, `src/utils/pageSpaceEraser.js`, `src/utils/eraserHitTest.js`, `src/utils/surveyMarkerEraser.js` | YES for utils; **SERIALIZE** if touching `FabricEraserCanvas.jsx` |
| `color-picker` | P1-37, P1-38, P1-39 | 3 · **all fixed wave 1** | `src/components/CompactColorPicker.jsx`, `src/AppShell.jsx` (font-color opacity only) | YES |
| `sharing-invites` | P2-01, P2-05, P2-33 | 3 | `src/home/ShareModal.jsx`, `src/services/documentInviteService.js`, `src/home/InviteAcceptPage.jsx`, `supabase/functions/send-invite-email/`, invite RLS migrations | YES |
| `roles-team` | P2-06, P2-07 | 2 | `src/home/ProjectsFolderTree.jsx`, `src/home/ManageTeamModal.jsx`, `src/home/SurveyHub.jsx`, `src/home/AccessManagementModal.jsx` | YES |
| `account-settings` | P2-03, P2-08, P2-15, P2-30, P2-31, P2-32 | 6 | `src/components/AccountSettings.jsx`, `src/contexts/AuthContext.jsx`, `src/utils/accountPlatform.js`, `supabase/functions/delete-account/` | YES · P2-03 **before** P2-15 |
| `billing` | P2-27, P2-28, P2-29, P2-38 | 4 | `supabase/functions/stripe-webhook/`, `supabase/functions/create-checkout-session/`, `supabase/functions/_shared/billingReturn.ts` | YES |
| `bookmarks-panel` | P1-44, P1-45, P1-47, P1-48 | 4 | `src/sidebar/BookmarksPanel.jsx` | YES |
| `pages-panel` | P1-42, P1-43, P1-54 | 3 | `src/sidebar/PagesPanel.jsx` | YES |
| `sync-status-history` | P1-12, P1-53, P1-55 | 3 · **P1-12 + P1-53 fixed**; P1-55 open | `src/utils/historyHelpers.js`, `src/utils/syncStatusViewModel.js`, `src/services/annotationCloudSync.js` | YES |
| `excel-identity-sql` | P2-10, P2-21 | 2 | `supabase/migrations/20260625120000_kal309_excel_sync.sql` | YES |
| `mobile-sheets` | P2-35 | 1 (3 sub) | `src/hooks/useMobileSheetMotion.js` | YES |
| `electron-desktop` | P2-11, P2-36 | 2 | `src/electron-main.js` | YES |
| `microsoft-auth` | P2-13, P2-14, P2-24, P2-25, P2-26 | 5 | `src/contexts/MSGraphContext.jsx`, `src/utils/microsoftOAuthRouting.js`, `src/msalAuthMain.js`, `src/utils/microsoftConnectionMarker.js` | YES |
| `text-commit` | P1-28 | 1 | `src/utils/textEditCommit.js` | YES |
| `counter-numbering` | P1-14 | 1 | `src/utils/counterNumbering.js` | YES |
| `collab-ux` | P1-30, P2-12, P2-16 | 3 | `src/components/collab/YDocProvider.jsx` | YES · P2-16 needs a publisher from SVG path later |
| `last-owner-race` | P2-23 | 1 | last-owner SQL migration (`20260802010000`) | YES |
| `svg-interaction` | P1-05, P1-06, P1-08, P1-29 | 4 | `src/hooks/useSVGInteraction.js` | YES unless also editing SVG layer |
| `z-order` | KB-2, P1-33 | 2 | `src/services/annotationDocStore.js` (read sort) + write sites in PDFViewer / context menu | **SERIALIZE** (PDFViewer write) |
| `pdfviewer-undo` | P1-09, P1-10, P1-11, P1-13, P1-32, P1-36 | 6 | `src/PDFViewer.jsx`, `src/utils/annotationLocalHistory.js` | **SERIALIZE** |
| `pdfviewer-stale-index` | P1-07, P1-15 | 2 | `src/PDFViewer.jsx`, `src/components/TextEditOverlay.jsx` | **SERIALIZE** |
| `pdfviewer-pages` | P1-17, P1-18, P1-19, P1-46, P1-49 | 5 | `src/PDFViewer.jsx`, `src/hooks/usePageOperations.js` | **SERIALIZE** |
| `pdfviewer-survey` | P1-16, P1-24 | 2 | `src/PDFViewer.jsx` | **SERIALIZE** |
| `pdfviewer-shortcuts` | P1-20, P1-21, P1-34, P1-35, P1-40, P1-41, P2-34, P2-39 | 8 | `src/PDFViewer.jsx`, `src/utils/shapeBleedDiagnostics.js`, `src/components/SVGAnnotationLayer.jsx`, `src/components/KeyboardShortcutsOverlay.jsx` | **SERIALIZE** |
| `pdfviewer-legacy-tools` | P1-25, P1-26, P1-27 | 3 | `src/PDFViewer.jsx`, `src/utils/svgAnnotationRenderers.jsx` | **SERIALIZE** |
| `pdfviewer-erase-perms` | P1-22, P1-23 | 2 | `src/PDFViewer.jsx`, `src/utils/pdfAnnotationImporter.js`, `src/utils/permissionScope.js` | **SERIALIZE** |
| `pdfviewer-excel-onedrive` | P2-04, P2-09, P2-19, P2-20, P2-22 | 5 | `src/PDFViewer.jsx`, `src/services/excelGraphService.js` | **SERIALIZE** |
| `pdfviewer-spaces` | P1-50, P1-51, P1-52 | 3 | `src/PDFViewer.jsx`, `src/services/annotationDocStore.js` | **SERIALIZE** |
| `pdfviewer-presence` | P2-17, P2-18 | 2 | `src/PDFViewer.jsx`, `src/components/collab/YDocProvider.jsx` | **SERIALIZE** |
| `eraser-preview` | KB-1 preview/Part 2 | (same ID) | `src/components/FabricEraserCanvas.jsx` | **SERIALIZE** after `eraser-policy` |
| `svg-locks` | P1-31 | 1 | `src/components/SVGAnnotationLayer.jsx` | **SERIALIZE** |

**Spawn order for this wave’s remaining work:** all YES buckets in parallel; then one SERIALIZE worker at a time on `src/PDFViewer.jsx` (merge `pdfviewer-*` + `z-order` write sites into a single sequential queue).

---

## All issues

Columns: id · title · sev · area · primary files · user-visible · bucket · status

### Known bugs

| ID | Title | Sev | Area | Primary files | Visible? | Bucket | Status |
|---|---|---|---|---|---|---|---|
| KB-1 | Eraser deletes everything it touches (no ink-only / no topmost) | HIGH (user-reported) | Eraser | `src/utils/eraserPolicy.js`, `src/utils/pageSpaceEraser.js`, `src/utils/eraserHitTest.js`, `src/components/FabricEraserCanvas.jsx`, `src/utils/surveyMarkerEraser.js` | user-visible | `eraser-policy` then `eraser-preview` | open |
| KB-2 | Bring-to-front/back does not persist; snaps back on next edit / reload | HIGH (user-reported) | Z-order | `src/PDFViewer.jsx`, `src/hooks/useAnnotationContextMenu.jsx`, `src/services/annotationDocStore.js`, `src/services/annotationDocSync.js` | user-visible | `z-order` | open |

### Pass 1 — CRITICAL / HIGH

| ID | Title | Sev | Area | Primary files | Visible? | Bucket | Status |
|---|---|---|---|---|---|---|---|
| P1-01 | Drawn/edited line/arrow exports and prints at wrong page position | CRITICAL | Export/print | `src/utils/pdfAnnotationsPdfLib.js` (`createLineAnnotation`, `drawFlattenedLine`), `src/utils/lineRenderHelpers.js`, `src/utils/annotationCreationCommit.js` | user-visible | `export-print` | **fixed** |
| P1-02 | Arrowheads silently dropped on export (and re-import) | HIGH | Export | `src/utils/pdfAnnotationsPdfLib.js` | user-visible | `export-print` | **fixed** |
| P1-03 | Cloud rectangle borders permanently lost on export | HIGH | Export | `src/utils/pdfAnnotationsPdfLib.js`, `src/utils/pdfAppAnnotationMetadata.js` | user-visible | `export-print` | **fixed** |
| P1-04 | Printed circles/ovals/rects use pre-resize size | HIGH | Print | `src/utils/pdfAnnotationsPdfLib.js` (`drawFlattenedObject`) | user-visible | `export-print` | **fixed** |
| P1-05 | Multi-select rotate/resize displaces lines; wrong position saved | HIGH | Select/transform | `src/hooks/useSVGInteraction.js` | user-visible | `svg-interaction` | open |
| P1-06 | Resize/rotate/move commits by stale index (collab delete corrupts/crashes) | HIGH | Collab + transform | `src/hooks/useSVGInteraction.js` | user-visible | `svg-interaction` | open |
| P1-07 | Text-edit commit by stale index can replace a teammate’s annotation | HIGH | Text + collab | `src/PDFViewer.jsx`, `src/components/TextEditOverlay.jsx` | user-visible | `pdfviewer-stale-index` | open |
| P1-08 | Undo retargets selection to a different shape | HIGH | Undo + select | `src/hooks/useSVGInteraction.js`, `src/PDFViewer.jsx` | user-visible | `svg-interaction` | open |
| P1-09 | Redo resurrects old page snapshot and deletes newest work | HIGH | Undo | `src/PDFViewer.jsx` | user-visible | `pdfviewer-undo` | open |
| P1-10 | Own undo wipes teammate edits document-wide | HIGH | Undo + collab | `src/PDFViewer.jsx`, `src/hooks/useAnnotationDoc.js` | user-visible | `pdfviewer-undo` | open |
| P1-11 | Own undo reverts teammate’s concurrent edit to same annotation | HIGH | Undo + collab | `src/utils/annotationLocalHistory.js`, `src/services/annotationDocStore.js` | user-visible | `pdfviewer-undo` | open |
| P1-12 | Excel auto-sync permanently jams undo | HIGH | Undo + Excel | `src/utils/historyHelpers.js`, `src/PDFViewer.jsx` (call site only) | user-visible | `sync-status-history` | **fixed** |
| P1-13 | First edit-and-undo after import permanently deletes imported markups | HIGH | Import + undo | `src/PDFViewer.jsx` | user-visible | `pdfviewer-undo` | open |
| P1-14 | Cross-page counter renumber never saves or syncs | HIGH | Counters | `src/utils/counterNumbering.js` | user-visible | `counter-numbering` | open |
| P1-15 | Callout text edit clobbers teammate move/restyle | HIGH | Callouts + collab | `src/PDFViewer.jsx` | user-visible | `pdfviewer-stale-index` | open |
| P1-16 | Reopened documents hide all survey markers until a module is selected | HIGH | Survey markers | `src/PDFViewer.jsx`, `src/components/SVGAnnotationLayer.jsx` | user-visible | `pdfviewer-survey` | open |
| P1-17 | Page ops revert other edits made during a prior upload | HIGH | Pages | `src/hooks/usePageOperations.js`, `src/PDFViewer.jsx` | user-visible | `pdfviewer-pages` | open |
| P1-18 | Cut/copy page clipboard goes stale — paste hits the wrong page | HIGH | Pages | `src/PDFViewer.jsx`, `src/hooks/usePageOperations.js` | user-visible | `pdfviewer-pages` | open |
| P1-19 | Two people doing page ops silently overwrite each other | HIGH | Pages + collab | `src/hooks/useDatabase.js`, `src/AppShell.jsx` | user-visible | `pdfviewer-pages` | open |
| P1-20 | Cmd/Ctrl+Shift+D downloads two debug files instead of duplicating | HIGH | Shortcuts | `src/PDFViewer.jsx`, `src/utils/shapeBleedDiagnostics.js`, `src/main.jsx` | user-visible | `pdfviewer-shortcuts` | open |

### Pass 1 — MEDIUM / LOW

| ID | Title | Sev | Area | Primary files | Visible? | Bucket | Status |
|---|---|---|---|---|---|---|---|
| P1-21 | Switching tools mid-stroke discards in-progress ink/shape | MED | Draw | `src/components/SVGAnnotationLayer.jsx` | user-visible | `pdfviewer-shortcuts` | open |
| P1-22 | Eraser skips cross-author delete confirmation | MED | Eraser + perms | `src/PDFViewer.jsx` | user-visible | `pdfviewer-erase-perms` | open |
| P1-23 | Non-owners cannot erase/edit imported (unstamped) PDF markups | MED | Perms + import | `src/utils/pdfAnnotationImporter.js`, `src/utils/permissionScope.js` | user-visible | `pdfviewer-erase-perms` | open |
| P1-24 | Survey-marker move/resize fails open when owner metadata unresolved | MED | Survey + perms | `src/PDFViewer.jsx` | user-visible | `pdfviewer-survey` | open |
| P1-25 | Legacy group arrows ignore rotation/scale; frame lies | MED | Legacy arrows | `src/utils/svgAnnotationRenderers.jsx`, `src/PDFViewer.jsx` | user-visible | `pdfviewer-legacy-tools` | open |
| P1-26 | Double-click edit is a no-op on legacy group arrows | MED | Legacy arrows | `src/PDFViewer.jsx` | user-visible | `pdfviewer-legacy-tools` | open |
| P1-27 | Legacy `circle`-typed ellipses ignore toolbar restyle | MED | Shapes | `src/PDFViewer.jsx` | user-visible | `pdfviewer-legacy-tools` | open |
| P1-28 | Clearing all text leaves an invisible ghost annotation | MED | Text | `src/utils/textEditCommit.js` | user-visible | `text-commit` | open |
| P1-29 | Shift+marquee replaces callout selection (Alt-subtract no-op) | MED | Select | `src/hooks/useSVGInteraction.js` | user-visible | `svg-interaction` | open |
| P1-30 | Remote-delete “Removed by X — Restore?” toast is dead | MED | Collab UX | `src/components/collab/YDocProvider.jsx` | user-visible | `collab-ux` | open |
| P1-31 | AutoCAD SHX Text shows working resize/rotate handles despite lock | MED | Import + transform | `src/components/SVGAnnotationLayer.jsx`, `src/utils/pdfAnnotationImporter.js` | user-visible | `svg-locks` | open |
| P1-32 | Holding rotation-field arrow key creates one undo per keypress | MED | Undo | `src/components/RotationInputField.jsx`, `src/PDFViewer.jsx` | user-visible | `pdfviewer-undo` | open |
| P1-33 | Open context menu can apply z-order to the wrong shape after collab splice | MED | Z-order + collab | `src/hooks/useAnnotationContextMenu.jsx`, `src/PDFViewer.jsx` | user-visible | `z-order` | open |
| P1-34 | Cmd+C/X only work for exactly one shape; callouts have no kb clipboard | MED | Clipboard | `src/components/SVGAnnotationLayer.jsx` | user-visible | `pdfviewer-shortcuts` | open |
| P1-35 | Repeat-paste offset hardcodes US-Letter / ignores page size | MED | Clipboard | `src/PDFViewer.jsx` | user-visible | `pdfviewer-shortcuts` | open |
| P1-36 | Owner-scoping silently drops undo for contributor edits of unstamped imports | MED | Undo + perms | `src/utils/annotationLocalHistory.js`, `src/PDFViewer.jsx` | user-visible | `pdfviewer-undo` | open |
| P1-37 | Font color opacity slider is dead on desktop | MED | Color / text | `src/AppShell.jsx` | user-visible | `color-picker` | **fixed** (hidden; alpha not implemented) |
| P1-38 | “Match Fill” swatch never shows selected when fill is translucent | MED | Color | `src/components/CompactColorPicker.jsx` | user-visible | `color-picker` | **fixed** |
| P1-39 | Hex field accepts invalid colors like `zzzzzz` | MED | Color | `src/components/CompactColorPicker.jsx` | user-visible | `color-picker` | **fixed** |
| P1-40 | Cmd/Ctrl+0/1/2 silently degrade fit mode to Manual | MED | Zoom | `src/PDFViewer.jsx` | user-visible | `pdfviewer-shortcuts` | open |
| P1-41 | Keyboard fit % disagrees with dropdown fit | MED | Zoom | `src/utils/zoomController.js`, `src/components/PdfjsViewerContainer.jsx` | user-visible | `pdfviewer-shortcuts` | open |
| P1-42 | Sidebar thumbnails never use the existing IndexedDB cache | MED | Pages | `src/sidebar/PagesPanel.jsx` | user-visible | `pages-panel` | open |
| P1-43 | Drag-reorder in a filtered Space also moves hidden pages | MED | Pages + spaces | `src/sidebar/PagesPanel.jsx` | user-visible | `pages-panel` | open |
| P1-44 | New bookmarks jump to top of an already-ordered list | MED | Bookmarks | `src/sidebar/BookmarksPanel.jsx` | user-visible | `bookmarks-panel` | open |
| P1-45 | Deleting a bookmark group nukes nested bookmarks with no count/undo | MED | Bookmarks | `src/sidebar/BookmarksPanel.jsx`, `src/PDFViewer.jsx` | user-visible | `bookmarks-panel` | open |
| P1-46 | Bookmarks/page names/spaces metadata live only in per-browser localStorage | MED | Bookmarks + sync | `src/PDFViewer.jsx` | user-visible | `pdfviewer-pages` | open |
| P1-47 | Bookmark drag-reorder is O(n²) | MED | Bookmarks | `src/sidebar/BookmarksPanel.jsx` | user-visible | `bookmarks-panel` | open |
| P1-48 | Rejected duplicate-name bookmark rename keeps showing unsaved name | MED | Bookmarks | `src/sidebar/BookmarksPanel.jsx` | user-visible | `bookmarks-panel` | open |
| P1-49 | Search results go stale after page reorder/rotate | MED | Search | `src/PDFViewer.jsx`, `src/sidebar/SearchTextPanel.jsx` | user-visible | `pdfviewer-pages` | open |
| P1-50 | Concurrent Spaces edits are whole-array LWW | MED | Spaces + collab | `src/services/annotationDocStore.js` | user-visible | `pdfviewer-spaces` | open |
| P1-51 | Activating an empty Space blanks the canvas with no explanation | MED | Spaces | `src/PDFViewer.jsx` | user-visible | `pdfviewer-spaces` | open |
| P1-52 | Deleting a region while a teammate draws inside it orphans their annotation | MED | Spaces + collab | `src/utils/annotationVisibilityRules.js` | user-visible | `pdfviewer-spaces` | open |
| P1-53 | Sync pill shows red “Offline” during every healthy save | MED | Sync UX | `src/utils/syncStatusViewModel.js` | user-visible | `sync-status-history` | **fixed** |
| P1-54 | Black-thumbnail-detection guard is dead code | LOW | Pages | `src/sidebar/PagesPanel.jsx` | test-only | `pages-panel` | open |
| P1-55 | Legacy dual-write to `document_annotations` is dead (comments claim live) | LOW | Sync | `src/services/annotationCloudSync.js` | test-only | `sync-status-history` | open |

### Pass 2 — CRITICAL / HIGH

| ID | Title | Sev | Area | Primary files | Visible? | Bucket | Status |
|---|---|---|---|---|---|---|---|
| P2-01 | Free-tier sharing paywall is client-side only | CRITICAL | Sharing / abuse | `src/home/ShareModal.jsx`, invite RLS migrations, `supabase/functions/send-invite-email/` | user-visible | `sharing-invites` | open |
| P2-02 | Offline/conflict retry queue is never fed | CRITICAL | Offline queue | `src/lib/collab/crdtDualWriteQueue.js`, `src/services/annotationCloudSync.js`, `src/services/annotationDocSync.js` | user-visible (missing safety net) | *decision* — see note | open |
| P2-03 | Account deletion destroys collaborators’ work; backend callable today | HIGH | Account | `supabase/functions/delete-account/`, account-deletion migration, `src/components/AccountSettings.jsx` | user-visible via API | `account-settings` | open |
| P2-04 | OneDrive/SharePoint save silently overwrites existing files | HIGH | OneDrive | `src/PDFViewer.jsx`, `src/services/excelGraphService.js` | user-visible | `pdfviewer-excel-onedrive` | open |
| P2-05 | Revoke pending invite does not remove already-granted access | HIGH | Sharing | `src/services/documentInviteService.js`, `kal31_revoke_document_invite` | user-visible | `sharing-invites` | open |
| P2-06 | Any project member can open Manage Team and fire false emails | HIGH | Roles | `src/home/ProjectsFolderTree.jsx`, `src/home/ManageTeamModal.jsx` | user-visible | `roles-team` | open |
| P2-07 | Promoting to Owner never unlocks Manage Access | HIGH | Roles | `src/home/SurveyHub.jsx`, `src/home/AccessManagementModal.jsx` | user-visible | `roles-team` | open |
| P2-08 | “Connect Google” is sign-in, not link — can switch accounts | HIGH | Auth | `src/components/AccountSettings.jsx`, `src/contexts/AuthContext.jsx` | user-visible | `account-settings` | open |
| P2-09 | Manual Sync to Excel reports success when every write failed | HIGH | Excel | `src/PDFViewer.jsx` | user-visible | `pdfviewer-excel-onedrive` | open |
| P2-10 | SharePoint-tier can mint duplicate Survey Markers for one Excel row | HIGH | Excel identity | `supabase/migrations/20260625120000_kal309_excel_sync.sql` | user-visible | `excel-identity-sql` | open |
| P2-11 | Desktop quit is a fixed ~5s hang and abandons long saves | HIGH | Electron | `src/electron-main.js`, `src/PDFViewer.jsx` (`notifySaveComplete` already fires) | user-visible | `electron-desktop` | open |
| P2-12 | Access-removed banner can be permanently lost after re-sign-in | HIGH | Collab UX | `src/components/collab/YDocProvider.jsx` | user-visible | `collab-ux` | open |
| P2-13 | Microsoft sign-in on iOS/Android is a dead end | HIGH | MS auth + mobile | `src/contexts/MSGraphContext.jsx`, `src/utils/microsoftOAuthRouting.js` | user-visible | `microsoft-auth` | open |
| P2-14 | Desktop Microsoft connect clobbers web/mobile tokens | HIGH | MS auth | `src/contexts/MSGraphContext.jsx`, `src/utils/microsoftConnectionMarker.js` | user-visible | `microsoft-auth` | open |
| P2-15 | Delete-account button permanently disabled (backend is live) | HIGH | Account | `src/components/AccountSettings.jsx` | user-visible | `account-settings` | open · **after P2-03** |

### Pass 2 — MEDIUM / LOW

| ID | Title | Sev | Area | Primary files | Visible? | Bucket | Status |
|---|---|---|---|---|---|---|---|
| P2-16 | Remote-delete Restore? toast permanently dead (pass-2 confirmation of P1-30) | MED | Collab | `src/components/collab/YDocProvider.jsx` | user-visible | `collab-ux` | open · same defect family as P1-30; close together |
| P2-17 | “N viewing” drops anyone idle 2 minutes on one page | MED | Presence | `src/PDFViewer.jsx`, `src/utils/presenceRoster.js` | user-visible | `pdfviewer-presence` | open |
| P2-18 | Re-sign-in modal accepts a different account mid-session | MED | Auth + collab | `src/components/collab/YDocProvider.jsx`, `src/contexts/AuthContext.jsx` | user-visible | `pdfviewer-presence` | open |
| P2-19 | “Live sync real-time” copy is only half-true (app→Excel push disabled) | MED | Excel | `src/utils/excelWritebackGate.js`, `src/components/SurveySpacesRail.jsx` | user-visible | `pdfviewer-excel-onedrive` | open |
| P2-20 | Every Live Sync connect double-fires and orphans a workbook session | MED | Excel | `src/PDFViewer.jsx` | user-visible | `pdfviewer-excel-onedrive` | open |
| P2-21 | Excel `create` ops skip the field/template whitelist `apply` enforces | MED | Excel identity | `supabase/migrations/20260625120000_kal309_excel_sync.sql` | user-visible (abuse) | `excel-identity-sql` | open |
| P2-22 | OneDrive picker never refreshes the Microsoft token | MED | OneDrive | `src/components/OneDriveFolderBrowser.jsx`, `src/PDFViewer.jsx` | user-visible | `pdfviewer-excel-onedrive` | open |
| P2-23 | Two owners removing each other can leave a document ownerless | MED | Sharing | last-owner trigger migration | user-visible | `last-owner-race` | open |
| P2-24 | One tab’s stale MS token failure wipes the shared connection row | MED | MS auth | `src/contexts/MSGraphContext.jsx` | user-visible | `microsoft-auth` | open |
| P2-25 | Switching MS accounts on desktop can silently refresh as the old account | MED | MS auth | `src/msalAuthMain.js` | user-visible | `microsoft-auth` | open |
| P2-26 | Network blip at desktop launch treated as broken MS connection | MED | MS auth | `src/contexts/MSGraphContext.jsx` | user-visible | `microsoft-auth` | open |
| P2-27 | Billing lifecycle emails route “return to merchant” to google.com | MED | Billing | `supabase/functions/stripe-webhook/index.ts` | user-visible | `billing` | open |
| P2-28 | Unlimited repeat 7-day Pro trials via cancel → resubscribe | MED | Billing | `supabase/functions/create-checkout-session/index.ts` | user-visible | `billing` | open |
| P2-29 | Stripe webhook emails are not idempotent | MED | Billing | `supabase/functions/stripe-webhook/index.ts` | user-visible | `billing` | open |
| P2-30 | Half-failed account deletion strands a live account whose data is gone | MED | Account | `supabase/functions/_shared/accountDeletion.ts` | user-visible | `account-settings` | open |
| P2-31 | Profile save reports total failure even when name already saved | MED | Account | `src/components/AccountSettings.jsx` | user-visible | `account-settings` | open |
| P2-32 | Google-only accounts see a Change Password form that can never succeed | MED | Auth | `src/components/AccountSettings.jsx` | user-visible | `account-settings` | open |
| P2-33 | Invite link → sign-in → dashboard; invite abandoned | MED | Auth + invites | `src/home/InviteAcceptPage.jsx` | user-visible | `sharing-invites` | open |
| P2-34 | Eight documented keyboard shortcuts do nothing (3 merged tickets) | MED | Shortcuts | `src/components/KeyboardShortcutsOverlay.jsx`, `src/PDFViewer.jsx`, `src/electron-main.js` | user-visible | `pdfviewer-shortcuts` | open |
| P2-35 | Mobile bottom sheets: reopen race, missing exits, stuck mid-drag (3 merged) | MED | Mobile | `src/hooks/useMobileSheetMotion.js` | user-visible | `mobile-sheets` | open |
| P2-36 | Launching desktop twice races the Microsoft token cache | MED | Electron | `src/electron-main.js` | user-visible | `electron-desktop` | open |
| P2-37 | Export/print can serialize literal `Infinity`/`NaN` into the PDF | MED | Export | `src/utils/pdfAnnotationsPdfLib.js` | user-visible (hostile/corrupt data) | `export-print` | **fixed** |
| P2-38 | Post-checkout `?billing=success` is never read | LOW | Billing | `supabase/functions/_shared/billingReturn.ts` | user-visible | `billing` | open |
| P2-39 | Save Log local-disk write hardcoded to maintainer path | LOW | Electron | `src/AppShell.jsx`, `src/PDFViewer.jsx` | test-only (swallowed) | `pdfviewer-shortcuts` | open |

### P2-02 placement note

P2-02 is a **product decision**, not a file-local bug: either wire the live `annotationDocSync` / outbox failures into `enqueueDualWrite`, or retire `crdtDualWriteQueue` and port stuck-banner/quarantine UX onto the outbox that actually runs. Do **not** leave two half-systems. Owner: orchestrator + a dedicated `offline-queue` worker after the decision. Primary files would then be either `src/services/annotationDocSync.js` + `src/lib/collab/crdtDualWriteQueue.js` **or** a deletion of the unused queue. Not assigned to a parallel YES bucket until the decision is made.

### P2-34 sub-defects (keep all three)

1. Home/End and ←/→ page-nav do nothing in continuous mode.
2. `B` does not toggle the sidebar.
3. Overlay lists Ctrl+W / Ctrl+Tab which are browser-reserved on web and unimplemented on Electron.

### P2-35 sub-defects (keep all three)

1. Dismiss-then-reopen race (uncancellable close timer).
2. Survey-sheet close paths hard-hide (no exit animation) and desync motion.
3. No `touchcancel` — interrupted drag leaves the sheet stranded.

---

## Suggested owner feature buckets (for E2E later)

See `FEATURE-MATRIX.md`. Issue → E2E feature mapping:

| Issue IDs | E2E feature |
|---|---|
| P1-01..04, P2-37 | Save / Export / Print |
| KB-1, P1-22 | Eraser |
| KB-2, P1-33 | Z-order / context menu |
| P1-05, P1-06, P1-08, P1-29, P1-31 | Select / move / resize / rotate |
| P1-07, P1-28, P1-37 | Text tool + formatting |
| P1-15, P1-34 (callout half) | Callouts |
| P1-09..13, P1-32, P1-36 | Undo / redo |
| P1-14, P1-27 | Counters / shapes toolbar |
| P1-16, P1-24 | Survey markers |
| P1-17..19, P1-42, P1-43, P1-54 | Pages |
| P1-44..48, P1-46 | Bookmarks |
| P1-49 | Search |
| P1-50..52 | Spaces / regions |
| P1-20, P1-21, P1-34, P1-35, P1-40, P1-41, P2-34 | Shortcuts / zoom / clipboard |
| P1-38, P1-39 | Color pickers |
| P2-01, P2-05, P2-33 | Sharing / invites |
| P2-06, P2-07, P2-23 | Roles / team |
| P2-03, P2-08, P2-15, P2-30..32 | Account / auth |
| P2-04, P2-09, P2-10, P2-19..22 | Excel / OneDrive |
| P2-11, P2-36, P2-39 | Electron |
| P2-13, P2-14, P2-24..26 | Microsoft connect |
| P2-27..29, P2-38 | Billing |
| P2-12, P2-16..18, P1-30 | Collab UX / presence |
| P2-35 | Mobile chrome |

---

## Worker-prompt allowlists (copy-paste)

See the “Recommended next worker prompts” section in the wave-1 return message. File allowlists are the **Primary ownership** column above. High-risk files may be read but not edited except by the serialized `pdfviewer-*` / `z-order` / `eraser-preview` / `svg-locks` workers.
