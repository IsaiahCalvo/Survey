# Hub Documents Open file — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last Projects file-row Open receipt (`hub-projects-file-open-2026-08-22.md`) named **Documents Open file** (`onOpenDocument` / HubPreview `handleOpenDocument` with `returnTab='documents'`). That is **local chrome**, **not** leftover-18, **not** Documents Preview pane extras, and **not** Projects file-row Open.

| Control | Class |
|---|---|
| Desktop row **single-click** | Preview pane (already extras). Stays on hub. **Not** Open. |
| Desktop Preview-pane **Open file** | Real local chrome. `onOpenDocument(sel.raw)` → SurveyHub `'documents'` → HubPreview fixture. |
| Desktop row **double-click** | Real local chrome. `onOpenDocument(d.raw)` unless Select is on. |
| 390 row click `openMobileDoc` | Real local chrome. Card click calls `onOpenDocument(d.raw)` unless Select is on. |
| 390 More → Preview & details → **Open file** | Real local chrome. Detail button calls `onOpenDocument(mobileDetailDoc.raw)`. |
| File More | Has Preview & details / Rename / Copy / Paste / Delete / Share / Lock. **No Open item.** |
| Files Select click | Toggles selection. Does **not** Open. |
| HubPreview `handleOpenDocument` | `window.location.assign` to `/?testPdf=Package 2 - Rev 4 -- IC.pdf&previewName=<file.name>&returnTab=documents`. Same fixture for every file (do not invent per-file PDF load). `workflowE2E` uses `clickable-link-test.pdf`. |
| Home / Back | `returnTab=documents` → `returnToDevHubPreview` lands on `/?hubPreview=1&tab=documents`. 390 uses `Back to documents`. |

`mobileProjectLayout` rail/teams/drive/browse is **unreachable** (`setMobileProjectLayout` has zero callers; stays `'drill'`). Did not invent that layout.

Did **not** replay Projects extras / file Move/Copy / card reorder / Team write / file Search / file-row reorder / file Delete / file-row Open; catalog-completeness; Documents extras / Lock persist; Archive empty chrome; Templates family; Spaces; Survey-rail; PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / signed-in Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Preview pane + **Open file** | **Open file** is this slice. Extras + Lock persist already proven. |
| `/?hubPreview=1&tab=projects` | Fresh load has **0** Open file / Close preview (those are Documents). File-row Open already proven (`returnTab=projects`). | Do not replay. |
| `/?hubPreview=1&tab=templates` | New template / module tabs / New category / Add item | Templates family **proven** |
| `/?hubPreview=1&tab=archive` | Heading Archive; sort “Most recently archived”; Select | Empty copy **not** mounted this session (`archiveEmpty: 0`) |
| `/?testPdf=clickable-link-test.pdf` | Export / Undo / Redo / Draw / Shapes / Text / Pages / Search text / Bookmarks / Spaces / History / Survey / Zoom / Fit options | PDF waves **proven** |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | — | Unreachable — `setMobileProjectLayout` has zero callers (stays `'drill'`) |

## Live proof (`/?hubPreview=1&tab=documents`)

**Intended**

- Desktop Preview-pane **Open file** of SE-011 leaves hubPreview and loads the Package 2 fixture viewer. URL `testPdf=Package 2 - Rev 4 -- IC.pdf`, `previewName=SE-011 Security Shop Drawings.pdf`, `returnTab=documents`. PDF tab title is SE-011 (not the fixture filename). AppShell consumes `window.__devTestPdf`. Draw is live.
- Home tab returns to `/?hubPreview=1&tab=documents`. SE-011 + RFI still listed.
- Desktop row **double-click** of RFI uses `previewName=RFI-014…` + `returnTab=documents`.
- Isolation: `test.pdf` and Door each carry their own `previewName`. Same fixture PDF. Package 2 row stays on Documents after return. Em-dash Door name round-trips.
- 390 More → Preview & details of SE-011 opens the detail sheet (stays hub). Detail **Open file** same URL. `Back to documents` returns to Documents list.
- 390 row click `openMobileDoc` of RFI Opens. `Back to documents` returns Documents. Stays drill.

**Break**

- `?empty=1`: rows **0**; Open file **0**; URL stays hubPreview (no `testPdf`).
- Desktop single-click of test.pdf stays on hub — Preview pane + **Open file** button; no `testPdf`. Confirmed this leftover is Open, not Preview.
- File More has no Open menuitem; Preview & details is present; Escape keeps SE-011; URL stays hub.
- Close preview hides Open file; URL stays hub.
- Select click of SE-011 stays on hub; Done restores Open.
- 390 Select card click stays on hub.

**Edge**

- Fresh Projects tab has **0** Open file / Close preview controls (those are Documents).
- Every file opens the same Package 2 fixture — HubPreview design, not a missing per-file viewer.
- Em-dash Door name round-trips in `previewName`.
- 390 stays drill — no rail / browse / drive chrome.

## Product

No product bug. Preview-pane Open file, row double-click, 390 `openMobileDoc`, and detail Open file already call `onOpenDocument`; SurveyHub passes `returnTab='documents'`; HubPreview assigns the fixture + `previewName`. Do not invent a real document blob, a File More Open item, a per-file PDF, or `mobileProjectLayout` variants.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-hub-docs-open-file.spec.mjs` **1 / 1 (9.0s)**
- Node `tests/documentsOpenFile.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `HUB_DOCS_OPEN_FILE_PROOF` `emptyRows: 0`, `emptyOpenFile: 0`, `singleClickStayed: true`, `moreDidNotOpen: true`, `closePreviewHidOpen: true`, `selectDidNotOpen: true`, `openedSe011.returnTab: documents`, `openedFileName: SE-011…`, `consumedDevFile: true`, `homeReturnedDocuments: true`, `dblclickOpened: true`, `isolation: true`, `projectsHasNoOpenFile: true`, `mobileDetailOpened.returnTab: documents`, `mobileRowOpened.previewName: RFI-014…`, `mobileReturnedDocuments: true`

## What is not claimed

This is **not** unblocked GAP = 0. Hunt after this slice: `fix-logs/docs-open-file-hunt-2026-08-22.md`. Remaining reachable is leftover-18 + compile-hidden + dead stubs + unreachable `mobileProjectLayout`. Goal stays open.
