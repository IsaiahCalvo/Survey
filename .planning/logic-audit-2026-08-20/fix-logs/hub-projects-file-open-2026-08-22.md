# Hub Projects file-row Open — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last file More/Select Delete receipt (`hub-projects-file-delete-2026-08-22.md`) named **file-row Open** (`onOpenDocument` / HubPreview `handleOpenDocument`). That is **local chrome**, **not** leftover-18, **not** Documents Preview / Open file, and **not** leftover-18 Upload.

| Control | Class |
|---|---|
| Projects file-row **click** | Real local chrome. Desktop name cell + 390 drill `.projects-mobile-file-row` call `onOpenDocument(f)` unless Files Select is on. |
| File More | Has Copy / Paste / Delete / Share / Lock. **No Open item.** More `stopPropagation` does not navigate. |
| Files Select click | Toggles selection. Does **not** Open. |
| HubPreview `handleOpenDocument` | `window.location.assign` to `/?testPdf=Package 2 - Rev 4 -- IC.pdf&previewName=<file.name>&returnTab=projects`. Same fixture for every file (do not invent per-file PDF load). `workflowE2E` uses `clickable-link-test.pdf`. |
| Home / Back | `returnTab=projects` → `returnToDevHubPreview` lands on `/?hubPreview=1&tab=projects`. 390 uses `Back to documents`. |

`mobileProjectLayout` rail/teams/drive/browse is **unreachable** (`setMobileProjectLayout` has zero callers; stays `'drill'`). Did not invent that layout.

Did **not** replay Projects extras (Search/Pin/Duplicate/file Copy-Paste), catalog-completeness rename/delete/create, file Move/Copy, card reorder, Team write fail-closed, file Search, file-row reorder, file More/Select Delete, Documents extras / Lock persist, Archive empty chrome, Templates family, Spaces, Survey-rail, PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / signed-in Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Preview pane + **Open file** button visible | Documents extras + Lock persist **proven**. Catalog-completeness already held Documents Search / rename / delete. **Open file** (navigate via `returnTab=documents`) was **not** this slice. |
| `/?hubPreview=1&tab=projects` | File-row Open **this slice**. Search / Pin / Duplicate / file Copy-Paste = extras (not replayed). New project / rename / delete / Manage-team = catalog-completeness (not replayed). Move/Copy / card reorder / Team write = thin chrome (not replayed). File Search / file-row reorder / file Delete = prior slices (not replayed). Add files / Get link / Share / Lock = leftover-18 fail-closed (not invented). |
| `/?hubPreview=1&tab=templates` | New template / module tabs / New category / Add item | Templates family **proven** |
| `/?hubPreview=1&tab=archive` | Heading Archive; sort “Most recently archived”; Select | Empty copy **not** mounted this session (`archiveEmpty: 0`) |
| `/?testPdf=clickable-link-test.pdf` | Export / Undo / Redo / Draw / Shapes / Text / Pages / Search text / Bookmarks / Spaces / History / Survey / Zoom / Fit options | PDF waves **proven** |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | — | Unreachable — `setMobileProjectLayout` has zero callers (stays `'drill'`) |

## Live proof (`/?hubPreview=1&tab=projects`)

**Intended**

- Desktop Tower row click of SE-011 leaves hubPreview and loads the Package 2 fixture viewer. URL `testPdf=Package 2 - Rev 4 -- IC.pdf`, `previewName=SE-011 Security Shop Drawings.pdf`, `returnTab=projects`. PDF tab title is SE-011 (not the fixture filename). AppShell consumes `window.__devTestPdf`. Draw is live.
- Home tab returns to `/?hubPreview=1&tab=projects`. Tower still has SE-011 + RFI.
- Isolation: RFI Open uses `previewName=RFI-014…`; Lab Door uses `previewName=Door Hardware Schedule — A.601.pdf`. Same fixture PDF. MEP file stays on Projects after return.
- 390 drill Tower row click of SE-011 same URL. `Back to documents` returns to Projects list (3 projects). Stays drill.

**Break**

- `?empty=1`: file rows **0**; URL stays hubPreview (no `testPdf`).
- Documents row click stays on hub — Preview pane + **Open file** button; no `testPdf`. Confirmed this leftover is the Projects file row, not Documents Preview.
- File More has no Open menuitem; Escape keeps SE-011; URL stays hub.
- Files Select click of SE-011 stays on hub; Done restores Open.

**Edge**

- Projects tab has **0** Open file / Close preview controls (those are Documents).
- Every file opens the same Package 2 fixture — HubPreview design, not a missing per-file viewer.
- Em-dash Door name round-trips in `previewName`.
- 390 stays drill — no rail / browse / drive chrome.

## Product

No product bug. `onOpenDocument(f)` is already the row click; SurveyHub passes `returnTab='projects'`; HubPreview assigns the fixture + `previewName`. Do not invent a real document blob, a File More Open item, or `mobileProjectLayout` variants.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-hub-projects-file-open.spec.mjs` **1 / 1 (6.9s)**
- Node `tests/projectsFileOpen.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `HUB_PROJECTS_FILE_OPEN_PROOF` `emptyFileRows: 0`, `docsPreviewStayed: true`, `moreDidNotOpen: true`, `selectDidNotOpen: true`, `openedSe011.returnTab: projects`, `openedFileName: SE-011…`, `consumedDevFile: true`, `homeReturnedProjects: true`, `isolation: true`, `mobileReturnedProjects: true`

## What is not claimed

This is **not** unblocked GAP = 0. Remaining reachable after this slice includes leftover-18, compile-hidden tools, dead stubs, unreachable `mobileProjectLayout` variants, and thinner Documents chrome: **Open file** (`onOpenDocument` / HubPreview `handleOpenDocument` with `returnTab='documents'` — desktop Preview-pane button + row double-click; 390 row click `openMobileDoc` + detail Open file). Distinct from Documents Preview pane (already extras) and from this Projects file-row Open. Goal stays open.
