# Hub Projects file More/Select Delete — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last file-Search/reorder receipt (`hub-projects-file-search-reorder-2026-08-22.md`) named **file More/Select Delete** (`deleteFiles`). That is **local chrome**, **not** leftover-18, **not** project delete (`deleteProjects` / `delete-selected-projects`), and **not** file More Copy/Paste.

| Control | Class |
|---|---|
| File More **Delete** | Real local chrome. `PopupMenu` → `deleteFiles([fileMenu.id])`. Immediate — no `ConfirmModal`. |
| File Select **Delete** | Real local chrome. Files-header / 390 drill Select trash → `deleteFiles(selectedFiles.map(id))`. None-selected stays disabled. Last-file allowed. |
| `onDeleteDocuments` | HubPreview `handleDelete` filters session `documents`. Persist only when `workflowE2E` writes `mobileWorkflowDocuments`. Reload without that flag restores the seed. |

`mobileProjectLayout` rail/teams/drive/browse is **unreachable** (`setMobileProjectLayout` has zero callers; stays `'drill'`). Did not invent that layout.

Did **not** replay Projects extras (Search/Pin/Duplicate/file Copy-Paste), catalog-completeness rename/delete/create, file Move/Copy, card reorder, Team write fail-closed, file Search, file-row reorder, Documents extras / Lock persist, Archive empty chrome, Templates family, Spaces, Survey-rail, PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / signed-in Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Select; Upload; More; Preview Close; Share | Documents extras + Lock persist **proven**. Catalog-completeness already held Documents Search / rename / delete. |
| `/?hubPreview=1&tab=projects` | File More/Select Delete **this slice**. Search / Pin / Duplicate / file Copy-Paste = extras (not replayed). New project / rename / delete / Manage-team = catalog-completeness (not replayed). Move/Copy / card reorder / Team write = thin chrome (not replayed). File Search / file-row reorder = prior slice (not replayed). Add member / Get link / Upload / Share / Lock = leftover-18 fail-closed (not invented). |
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

- Desktop Tower More Delete of SE-011 is immediate (no confirm). RFI stays. Projects stay.
- Session switch Lab → MEP → Tower keeps SE-011 gone. Lab still has Door; MEP still has Coordination.
- Desktop Select none-selected Delete **disabled**. Select RFI → Delete removes RFI; SE-011 stays; Delete returns disabled.
- Last-file Lab Select Delete of Door is allowed → `No files in this project yet.` Lab project stays. MEP Coordination stays.
- 390 drill Tower More Delete SE-011; Select Delete RFI → empty card. Lab More Delete Door → empty. MEP Coordination isolated.

**Break**

- `?empty=1`: file More **0**, file Select Delete **0**, file More Delete menuitem **0**.
- More Escape / outside click keep SE-011.
- Select Delete disabled until a row is checked.
- No confirm dialog on More or Select (desktop or 390).

**Edge**

- Reload (no `workflowE2E`) restores SE-011 + RFI (session-only).
- Isolation: Tower delete never moved Door / Coordination; Lab last-file never removed MEP.
- Project-list `delete-selected-projects` stays **0** while Files Select is on (different control).
- 390 stays drill — no rail / browse / drive chrome.

## Product

No product bug. `deleteFiles` already resolves ids via `pickByIds(openFiles)` at action time, hands targets to `onDeleteDocuments` (or local filter), and clears `selFiles`. Desktop file Select Delete uses `title="Delete"` (accessible name); 390 uses `title` + `aria-label`. Confirm is intentionally absent — do not invent one.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened. No high-risk file.

## Evidence

- Playwright `debug/scenarios/e2e-hub-projects-file-delete.spec.mjs` **1 / 1 (6.0s)**
- Node `tests/projectsFileDelete.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `HUB_PROJECTS_FILE_DELETE_PROOF` `emptyFileMore: 0`, `moreImmediate: true`, `selectNoneDisabled: true`, `lastFileAllowed: true`, `sessionKept: true`, `reloadRestores: true`, `isolation: true`, `mobileLastFile: true`, `noConfirm: true`

## What is not claimed

This is **not** unblocked GAP = 0. Remaining reachable after this slice includes leftover-18, compile-hidden tools, dead stubs, unreachable `mobileProjectLayout` variants, and thinner Projects chrome: **file-row Open** (`onOpenDocument` / HubPreview `handleOpenDocument` — distinct from Documents Preview / Open file and from leftover-18 Upload). Goal stays open.
