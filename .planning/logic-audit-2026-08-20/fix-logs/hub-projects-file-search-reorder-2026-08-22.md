# Hub Projects file Search + file-row reorder — 2026-08-22

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Does **not** re-claim unblocked GAP = 0.

## Why this leftover

Last thin-chrome receipt (`hub-projects-thin-chrome-2026-08-22.md`) proved file Move/Copy / card reorder / Team write and left **file Search** (`Search files...`) and **file-row reorder** (`reorderFiles`). Those are **not** leftover-18, **not** `Search projects...`, and **not** project **card** reorder.

| Control | Class |
|---|---|
| **Search files...** | Mobile-drill only. `fileSearch` case-insensitive substring on the open project's file names. Desktop chrome stays `Search projects...` — do **not** invent a desktop file Search. |
| **file-row reorder** | Real local chrome. `reorderFiles` + `SortableRearrangeList` on `openFiles` / `mobileDrillFiles` + `mergeProjectDocumentOrder`. Distinct from `reorderProjects` / card handles. |

Did **not** replay Projects extras (Search/Pin/Duplicate/file Copy-Paste), catalog-completeness rename/delete/create, file Move/Copy, card reorder, Team write fail-closed, Documents extras / Lock persist, Archive empty chrome, Templates family, Spaces, Survey-rail, PDF waves. Did **not** invent Print / stamp / measure / Group / Extract / Note-Link / Copy-to-Spaces / category Move/Copy. Share send / Upload picker / signed-in Team writeback / cloud `lockDocument` stay leftover-18.

## Hunt (what was actually opened)

| Surface | Opened / clicked | Class |
|---|---|---|
| `/?hubPreview=1&tab=documents` | Documents / Projects / Templates / Archive nav; Upload; More; Preview Close; Share | Documents extras + Lock persist **proven** |
| `/?hubPreview=1&tab=projects` | File Search + file-row reorder **this slice**. Search / Pin / Duplicate / file Copy-Paste = extras (not replayed). New project / rename / delete / Manage-team = catalog-completeness (not replayed). Move/Copy / card reorder / Team write = thin chrome (not replayed). Add member / Get link / Upload / Share = leftover-18 fail-closed (not invented). |
| `/?hubPreview=1&tab=templates` | New template / module tabs / New category / Add item / New entity | Templates family **proven** |
| `/?hubPreview=1&tab=archive` | Heading Archive; sort “Most recently archived”; Select | Empty copy **not** mounted this session (`archiveEmpty: 0`) |
| `/?testPdf=clickable-link-test.pdf` | Export / Undo / Redo / Draw / Shapes / Text / Pages / Search text / Bookmarks / Spaces / History / Survey / Zoom / Fit options | PDF waves **proven** |
| leftover-18 | — | Parked |
| Print / stamp / measure / Group / Extract / Note-Link / Forms | — | Compile-hidden |
| Templates / category Move/Copy; Copy-to-Spaces; checklist Y/N/N-A | — | Stub / parked |
| UL-31 Continue pin | — | Parked |
| `mobileProjectLayout` rail/teams/drive/browse/recent/grid/cards/compact/focus/files/team | — | Unreachable — `setMobileProjectLayout` has zero callers (stays `'drill'`) |

## Live proof (`/?hubPreview=1&tab=projects`)

**Intended**

- Desktop file-row SE-011 handle → RFI: `['RFI-014 Lobby Camera Coverage.pdf','SE-011 Security Shop Drawings.pdf']`.
- Session switch stays on Tower with RFI first. Reload (no `workflowE2E`) restores SE-011 first (session-only prefs).
- 390 drill Tower: `Search files...` `rfi` / `SE-011` / `RFI`; clear restores both; Back clears the query.
- 390 Tower file-row drop `mobileReordered: true`.

**Break**

- `?empty=1`: Search files **0**, file-row handles **0**.
- Desktop `Search files...` **0**; `Search projects...` **1** (do not invent).
- Lab (one file) handles **1** — no sibling to swap.
- 390 list view: `Search files...` **0** (placeholder is `Search projects...` until drill).

**Edge**

- Escape cancel + same-handle self-drag keep SE-011 first.
- Whitespace query keeps both Tower files.
- `xyzzy` → `No files match your search.` Escape keeps `xyzzy` (Search DismissBarrier blurs; does **not** clear).
- Back from drill clears `fileSearch` (session-only query).
- Isolation: Tower list never gained Door Hardware / MEP Coordination; after reload Lab still has Door, MEP still has Coordination, neither has RFI.

## Product

Desktop file rows wrapped `SortableRearrangeList` in an inner CSS grid. The list’s `minHeight: 100%` stretched that grid so `d1`’s droppable covered the pane — keyboard/pointer drops landed `d1` over `d1`. Rows are now direct children with `gap={1}` (same shape as project cards). File rows also set `disableSettledTransition` + `animateLayoutChanges={() => false}` so Escape cancel does not leave a visual swap that turns the next handle grab into a neighbor drop.

`zoomGeneration` / SVG `viewBox` / container-aware canvas / single-name `fontFamily` / CORS `*` untouched. Official `npm test` 8448 not loosened.

## Evidence

- Playwright `debug/scenarios/e2e-hub-projects-file-search-reorder.spec.mjs` **1 / 1 (7.1s)**
- Node `tests/projectsFileSearchReorder.test.mjs` **3 / 3**
- Vite reused `http://localhost:5173` (`npm run dev:ui`)
- Proof log `HUB_PROJECTS_FILE_SEARCH_REORDER_PROOF` `orderAfter: ["RFI-014 Lobby Camera Coverage.pdf","SE-011 Security Shop Drawings.pdf"]`, `sessionKept: true`, `reloadResets: true`, `mobileReordered: true`, `labHandles: 1`

## What is not claimed

This is **not** unblocked GAP = 0. Remaining reachable after this slice includes leftover-18, compile-hidden tools, dead stubs, unreachable `mobileProjectLayout` variants, and thinner Projects chrome: **file More/Select Delete** (`deleteFiles` — distinct from project delete and from file Copy/Paste). Goal stays open.
