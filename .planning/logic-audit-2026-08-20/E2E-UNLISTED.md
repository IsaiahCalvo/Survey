# E2E unlisted controls — not in the 59-row matrix

**This-pass (2026-08-22 Hub load-error Try again):** not a new UL row. Live desktop + 390 Hub **Try again** (`HubLoadError` / `retryLoad`) on `hubError=documents|projects|templates`. Distinct from Documents Select All / extras / Lock persist / Open file / Share Access, leftover-18 Upload, empty=1 EmptyState, and hubLoading skeletons. Receipt `fix-logs/hub-load-error-retry-2026-08-22.md`. Playwright `e2e-hub-load-error-retry.spec.mjs` **1 / 1 (2.8s)**. Node `hubLoadErrorRetry.test.mjs` **3 / 3**. Hunt `fix-logs/hub-load-error-retry-hunt-2026-08-22.md` — last Select-All hunt did not open `hubError`; do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Documents Select All / None / Done):** not a new UL row. Live desktop + 390 + empty=1 Documents **Select / All / None / Done**. Distinct from Documents extras / Lock persist / Open file / Share Access and from Archive Select. Receipt `fix-logs/hub-docs-select-all-2026-08-22.md`. Playwright `e2e-hub-docs-select-all.spec.mjs` **1 / 1 (3.4s)**. Node `documentsSelectAll.test.mjs` **3 / 3**. Hunt `fix-logs/hub-docs-select-all-hunt-2026-08-22.md` — last Share-Access exhausted claim **falsified**; do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Documents More Share / Document Access):** not a new UL row. Live desktop + 390 + guest + empty=1 Documents More → **Share** → **Document Access** on SE-011 (Invite + Done; empty list; Copy link / Send fail-closed). Distinct from Documents extras / Lock persist / Open file, leftover-18 A-03 inbox mint, and Templates Share. Product: skip live collaborator lookup when `isSupabaseAvailable === false`. Receipt `fix-logs/hub-docs-share-access-2026-08-22.md`. Playwright `e2e-hub-docs-share-access.spec.mjs` **1 / 1 (4.7s)**. Node `documentsShareAccess.test.mjs` **3 / 3**. Hunt `fix-logs/hub-docs-share-access-hunt-2026-08-22.md` — that this-catalog exhausted claim was **falsified** by Documents Select All / None. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Account Settings Usage local empty chrome):** UL-18 leftover (not a new UL row). Last General hunt called Usage leftover-18 and empty — **false**. Live desktop + 390 + guest + empty=1 + `?testPdf=` Home: `Projects 0 / ∞` / `Documents 0 / ∞` / `Storage 0 B / 100.0 GB` + DEVELOPER. Manage hides meters. Start trial not clicked. Receipt `fix-logs/account-settings-usage-2026-08-22.md`. Playwright `e2e-account-settings-usage.spec.mjs` **1 / 1 (7.1s)**. Node `accountSettingsUsage.test.mjs` **3 / 3**. Hunt `fix-logs/account-settings-usage-hunt-2026-08-22.md` — Documents More Share → Document Access remains; do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Account Settings General pane):** not a new UL row. Live desktop + 390 + guest + `?testPdf=` Home **General** contents (last A-04 hunt only opened tabs). No Theme pane. Connected / Subscription leftover-18. Receipt `fix-logs/account-settings-general-2026-08-22.md`. Playwright `e2e-account-settings-general.spec.mjs` **1 / 1 (7.5s)**. Node `accountSettingsGeneral.test.mjs` **3 / 3**. Hunt `fix-logs/account-settings-general-hunt-2026-08-22.md` — this-catalog hunt exhausted (thinner Settings leftover-18; color/font already every-swatch); do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 A-04 Account menu hunt):** not a new UL row. Independent live hunt classified A-04 as **already a dedicated slice** (not leftover-18). HubPreview Settings opens AccountSettings; guest Sign in stays A-01; `?testPdf=` editor chip is Home-under-overlay, not reachable. Receipt `fix-logs/a04-account-menu-hunt-2026-08-22.md`. Playwright `e2e-a04-account-menu-hunt.spec.mjs` **1 / 1 (4.9s)**. Do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Archive Select / All / None / Done):** not a new UL row. Live desktop + 390 Archive **Select / All / None / Done** (`selectMode` / `nextSelectAll`). Distinct from Documents Select and leftover-18 Restore / Delete forever (fail-closed toast; rows stay). Product: Archive mobile summary now uses `mobile-header-select-row` so 390 actions are not under the account chip. Receipt `fix-logs/archive-select-2026-08-22.md`. Hunt `fix-logs/archive-select-hunt-2026-08-22.md` — this-catalog hunt exhausted (leftover-18 + parked A-04); do **not** re-claim unblocked GAP = 0. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Archive row Preview / Close preview + Show documents):** not a new UL row. Live desktop + 390 Archive **row Preview / Close preview** (`previewId` / `Close preview`) and sibling **Show documents** expand. Distinct from Documents Preview extras / Open file and leftover-18 Restore / Delete forever. 390 has no Preview pane. Product: Archive Close preview now `aria-label="Close preview"`. Receipt `fix-logs/archive-preview-2026-08-22.md`. Hunt `fix-logs/archive-preview-hunt-2026-08-22.md` — next leftover to classify: Archive Select / All / None / Done. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Archive Search / filter / sort):** not a new UL row. Live desktop + 390 Archive **Search / filter / sort** (`Search archive...` / `ARCHIVE_FILTERS` / `ARCHIVE_SORT_OPTIONS`). Distinct from Archive empty chrome (`empty=1`) and leftover-18 Restore / Delete forever. Product: HubPreview local seed (no host UUID error); Search filter-button passthrough. Receipt `fix-logs/archive-search-2026-08-22.md`. Hunt `fix-logs/archive-search-hunt-2026-08-22.md` — next leftover to classify: Archive row Preview / Close preview. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 AppShell TabBar Close tab):** not a new UL row. Live desktop **Close tab** (`onTabClose` / `handleTabClose`). Distinct from Home click / 390 Back (`returnToDevHubPreview`) and from Documents Open file. HubPreview has no TabBar. 390 has no TabBar. Page-drop toast stays a stub. Product: unlabeled X now `aria-label="Close tab"`. Receipt `fix-logs/tab-close-2026-08-22.md`. Hunt `fix-logs/tab-close-hunt-2026-08-22.md` — next leftover to classify: Archive Search / filter / sort. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Documents Open file):** not a new UL row. Live desktop + 390 Documents **Open file** (`onOpenDocument` / HubPreview `handleOpenDocument` with `returnTab='documents'`). Desktop Preview-pane button + row double-click; 390 row click `openMobileDoc` + detail Open file. Distinct from Documents Preview pane extras and from Projects file-row Open. File More has no Open item. Same Package 2 fixture for every file; `previewName` is the row name; Home / Back land Documents. Receipt `fix-logs/hub-docs-open-file-2026-08-22.md`. Hunt `fix-logs/docs-open-file-hunt-2026-08-22.md` — leftover-18 / stubs / compile-hidden remain; no new unique unblocked leftover named. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Projects file-row Open):** not a new UL row. Live desktop + 390 Projects file-row **Open** (`onOpenDocument` / HubPreview `handleOpenDocument`). Distinct from Documents Preview / Open file and leftover-18 Upload. File More has no Open item. Same Package 2 fixture for every file; `previewName` is the row name; `returnTab=projects`. Receipt `fix-logs/hub-projects-file-open-2026-08-22.md`. Next leftover: Documents Open file. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Projects file More/Select Delete):** not a new UL row. Live desktop + 390 Projects file More **Delete** + file Select **Delete** (`deleteFiles`). Distinct from project delete and from file More Copy/Paste. Immediate (no confirm). Session-only unless `workflowE2E`. Last-file allowed. Receipt `fix-logs/hub-projects-file-delete-2026-08-22.md`. Next leftover: file-row Open. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Projects file Search + file-row reorder):** not a new UL row. Live desktop + 390 Projects **Search files...** (mobile drill) + **file-row reorder** (`reorderFiles`). Distinct from project Search and project card reorder. Product: file-row list no longer wraps an inner grid (self-drop); file rows skip settle animation after Escape. Receipt `fix-logs/hub-projects-file-search-reorder-2026-08-22.md`. Next leftover: file More/Select Delete. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Projects thin chrome):** not a new UL row. Live desktop + 390 Projects file Select **Move/Copy** / project **card reorder** / **Team write** fail-closed. Distinct from Projects extras (Search / Pin / Duplicate / file More Copy-Paste), catalog-completeness, and Templates category Move/Copy stub. Product: MoveCopyModal dest/mode now reset on open. Receipt `fix-logs/hub-projects-thin-chrome-2026-08-22.md`. Next leftover: file Search + file-row reorder. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Hub Projects extras):** not a new UL row. Live desktop + 390 Projects **Search** / **Pin/Unpin** / Select **Duplicate** / file More **Copy/Paste**. Distinct from Projects catalog-completeness (rename/delete/create) and from Hub Documents extras / Lock persist. Share send / Upload picker / Team writeback stay leftover-18. Product: Projects More trigger now inside `DismissBarrier`. Receipt `fix-logs/hub-projects-extras-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 entity opacity/border + Documents Lock persist):** U-03 leftover + Hub Documents leftover (not new UL rows). Live desktop + 390 Fill opacity 80 + independent Border `#0000FF`@50 Cancel/Save + isolation; CompactColorPicker remounts per layer. Documents More → Lock: owner enabled, guest/non-owner disabled, empty 0, click fail-closed (never Unlock) — cloud persist leftover-18. Distinct from fill-only entity color, Hub Documents extras, leftover-18 Space CSV / PDF Pages. Receipts `fix-logs/templates-entity-opacity-border-2026-08-22.md` + `fix-logs/hub-docs-lock-persist-2026-08-22.md`. Hunt `fix-logs/opacity-border-lock-hunt-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates permanent-delete of archived items):** U-03 leftover (not a new UL row). Live desktop + 390 `hardDeleteItem` / `aria-label="Permanently delete (orphans historical responses)"` + 390 `aria-label="Permanently delete"` on already-archived rows — immediate (no confirm), orphan copy, dirty-bar Cancel restores archived, Save empties the Archived section, isolation. Distinct from unused hard-delete / archive-confirm and leftover-18 U-04 cloud usage. No product bug. Receipt `fix-logs/templates-archived-hard-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates checklist item Delete):** U-03 leftover (not a new UL row). Live desktop + 390 `deleteItem` / `aria-label="Delete item"` — unused hard-delete vs usage>0 archive-confirm (Cancel / Escape / outside / Archive) + dirty-bar + last-item + isolation. Distinct from Add item / item rename / item reorder and leftover-18 U-04 cloud usage. Product: archive-confirm Escape now dismisses. Receipt `fix-logs/templates-checklist-item-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates More menu overflow):** U-03 leftover (not a new UL row). Live desktop + 390 template-row More Copy / Rename / Share / Delete + entity More Duplicate / Move/Copy / Share / Rename / Delete. Distinct from Select chrome and leftover-18 Space CSV / PDF Pages. Product: More Rename now focuses the field (entity used to only `setOpenColor(null)`). Move/Copy stays a dead stub. Receipt `fix-logs/templates-more-menu-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates existing-row rename):** U-03 leftover (not a new UL row). Live desktop + 390 `renameModule` / `renameCategory` / `renameEntity` / `renameItem` on seed Cameras / Installation Phase / GC / item text. Create flows only minted new names. Distinct from leftover-18 Space CSV / PDF Pages, and from U-03 template-list create/rename/delete. Product: same-reference no-ops; tab Escape restore; Edit-modules title snap-back; blur-path dirty via `flushSync`; item field remount on Cancel. Receipt `fix-logs/templates-existing-row-rename-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates list Search + mobile content Search + Edit-modules Search modules):** U-03 leftover (not a new UL row). Live desktop + 390 `templateMatchesSearch` / `templateContentSearch` / `modSearch`. Distinct from PDF find, leftover-18 Space CSV / PDF Pages, and from U-03 template create/rename/delete. Product: Search DismissBarrier now passthroughs a result click. Receipt `fix-logs/templates-search-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates template-list reorder + checklist item reorder):** U-03 leftover (not a new UL row). Live desktop + 390 `reorderTemplates` / `saveTemplateOrderPreference` + `reorderItems`. List reorder is preference persist (no dirty bar). Distinct from entity/category/module reorder, survey-rail item reorder, leftover-18 Space CSV / PDF Pages, and from U-03 template create/rename/delete. No product bug. Receipt `fix-logs/templates-list-item-reorder-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates entity / category / module reorder + Share):** U-03 leftover (not a new UL row). Live desktop + 390 `reorderEntities` / `reorderCategories` / `reorderMods` / `shareTemplate`. Share leftover is hubPreview `ShareModal` fail-closed (not leftover-18 A-03 live invites). Distinct from New entity / entity Duplicate / entity Delete / category Delete, leftover-18 Space CSV / PDF Pages, and from U-03 template create/rename/delete. Product: `mutateTpl` no-op no longer dirties. Receipt `fix-logs/templates-reorder-share-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates New entity / entity Duplicate / entity Delete / category Delete):** U-03 leftover (not a new UL row). Live desktop + 390 `addEntity` / `duplicateEntities` / `deleteEntities` / `deleteCategories`. New entity was still cluster-only (U-03 create/rename/delete was the template list). Duplicate leftover is **entity**, not template-list / module / category. Entity + category Delete have **no confirm** (immediate). Distinct from template-list Duplicate, leftover-18 Space CSV / PDF Pages, and from U-03 template create/rename/delete. No product bug. Receipt `fix-logs/templates-entity-dup-category-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates template-list Duplicate):** U-03 leftover (not a new UL row). Live desktop + 390 `duplicateTemplates` / `{name} copy` on the list Select. Duplicate leftover is **template-list**, not module or category. Auto-persists; dirty Cancel discards a later New-category edit. Distinct from New category / category Duplicate / module Delete, leftover-18 Space CSV / PDF Pages, and from U-03 create/rename/delete. No product bug. Receipt `fix-logs/templates-list-duplicate-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates New category / category Duplicate / module Delete):** U-03 leftover (not a new UL row). Live desktop + 390 `addCategory` / `duplicateCategories` / `deleteModules`. Duplicate leftover is **category**, not template-list. Module Delete has **no confirm** (immediate). Distinct from Add module / module Duplicate / Add checklist item, leftover-18 Space CSV / PDF Pages, and from U-03 create/rename/delete. No product bug. Receipt `fix-logs/templates-category-module-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates Add module / module Duplicate / Add checklist item):** U-03 leftover (not a new UL row). Live desktop + 390 `addModule` / `duplicateModules` / `addItem`. Duplicate leftover is **module**, not template-list. Distinct from entity color, leftover-18 Space CSV / PDF Pages, and from U-03 create/rename/delete. No product bug. Receipt `fix-logs/templates-module-dup-checklist-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Templates entity color):** U-03 leftover (not a new UL row). Live desktop + 390 `aria-label="Edit color"` / `setEntityColor` / CompactColorPicker. Distinct from viewer every-swatch, leftover-18 Space CSV / PDF Pages, and from Spaces space-card Delete. Product: dirty-bar Cancel/Save passthrough. Receipt `fix-logs/templates-entity-color-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces space-card Delete):** U-02 leftover (not a new UL row). Live desktop + 390 `space-card-delete-button` + confirm / `handleDelete` / `onSpaceDelete`. Cluster / Edit-region last-space delete was contrast only. Distinct from region-row Delete, leftover-18 Space CSV / PDF Pages, and from Create space. Receipt `fix-logs/spaces-card-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces Create space):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Create space"` / `handleCreateSpace` / `handleSpaceCreate`. Cluster / context-menu only minted Space 1/2 after isolated clicks. Distinct from space-name rename, leftover-18 Space CSV / PDF Pages, and from space-card Delete. Receipt `fix-logs/spaces-create-space-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces space-name rename):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label={`Rename ${space.name}`}` / `commitSpaceName`. Catalog completeness only typed Hunt Space. Distinct from region-row Click to rename, leftover-18 Space CSV / PDF Pages, and from Create / space-card Delete. Receipt `fix-logs/spaces-space-name-rename-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces Add pages):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Add pages"` / `handleAssignPages` / `handleSpaceAssignPages`. Catalog completeness only clicked page `1` / rejected `99`. Distinct from leftover-18 Space CSV / PDF Pages and from Create / space-name rename / space-card Delete. Receipt `fix-logs/spaces-add-pages-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces card Turn on/off):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Turn on space"` / `"Turn off space"` / `onToggleSpace` / `handleToggleSpace`. Distinct from Expand/Collapse and leftover-18 Space CSV / PDF Pages. Last-space off/on was Edit-region contrast only. Receipt `fix-logs/spaces-card-turn-on-off-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces card Expand/Collapse):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Expand"` / `"Collapse"` / `onToggleExpand`. Distinct from Turn on/off and leftover-18 Space CSV / PDF Pages. Receipt `fix-logs/spaces-card-expand-collapse-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces region-row Go to page):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Go to page N"` / `onNavigateToPage` / `handleNavigateToSpacePage`. Distinct from thumbnail click and the page-number input. Space CSV / PDF Pages stay leftover-18. Receipt `fix-logs/spaces-region-goto-page-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces region-row Hide/Show survey annotations):** U-02 leftover (not a new UL row). Live desktop `aria-label="Hide survey annotations"` / `onToggleSurveyAnnotations`. Survey-context only. Sibling of already-proven canvas Hide/Show. Space CSV / PDF Pages stay leftover-18. Receipt `fix-logs/spaces-survey-annotation-visibility-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces space-card reorder):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Drag to rearrange"` / `onReorderSpaces` / `SortableRearrangeList`. Distinct from survey-rail category/item reorder and from region-row Delete. Hide/Show survey annotations not this pass. Receipt `fix-logs/spaces-card-reorder-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces region-row Delete):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Delete"` / `region-delete-button` / `onRemovePage`. Distinct from last-space card delete. Space-card reorder not this pass. Receipt `fix-logs/spaces-region-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces region-row Hide/Show canvas annotations):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Hide canvas annotations"` / `region-visibility-button`. Distinct from overlay Hide/Show. Region-row Delete not this pass. Receipt `fix-logs/spaces-region-visibility-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces region-row Click to rename):** U-02 leftover (not a new UL row). Live desktop + 390 `aria-label="Click to rename"` / `commitRegionRename`. Distinct from space-name rename and from Edit region areas. 390 page-row / Edit after Create also live this session (`mobileEdit: 1`, toolbar + DOM Cancel). Receipt `fix-logs/spaces-region-rename-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Spaces Edit region areas + overlay + last space):** U-02 leftover (not a new UL row). Live desktop `aria-label="Edit region areas on the page"` / Region Selection Tool + overlay switch + last space. Distinct from Create / rename / add-pages. Notes Photo/Video / 390 switcher / template re-pick / Excel fail-closed / Copy-space not replayed as the GAP. Receipt `fix-logs/spaces-edit-region-areas-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 390 checklist parked + notes Photo/Video attach):** U-01 leftover (not a new UL row). 390 checklist Y/N/N-A parked — no compiled-in / `surveyTransitionE2E` items; no DEV seed hook. Next leftover is notes Photo/Video attach (desktop + 390). Distinct from text notes. Receipt `fix-logs/survey-checklist-or-next-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 390 Choose Survey Marker sibling switcher):** U-01 leftover (not a new UL row). Live 390 `aria-label="Choose Survey Marker"` / listbox `Survey Markers in this category`. Distinct from Entity (`Choose Survey Marker entity`). Choose survey template re-pick / checklist Y/N/N-A not replayed as the GAP. Receipt `fix-logs/survey-390-choose-marker-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Choose survey template re-pick):** U-01 leftover (not a new UL row). Live desktop + 390 `aria-label="Choose survey template"` after already in a template. Distinct from first-entry KAL-436 pick. Excel fail-closed / item Copy → space not replayed as the GAP. Receipt `fix-logs/survey-choose-template-repick-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Excel actions fail-closed):** U-01 leftover (not a new UL row). Live desktop `aria-label="Excel actions"` → Open linked / Update existing toast fail-closed without `linkedExcelPath`. Distinct from leftover-18 X-06 writeback and from EXPORT download. Item Copy → space not replayed as the GAP. Receipt `fix-logs/survey-excel-actions-failclosed-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail item Copy → space):** U-01 leftover (not a new UL row). Live item toolbar Copy → `setShowSpaceSelection` → dest clone. Distinct from dead `setCopyModeActive(true)` (zero callers). Item reorder / category reorder / empty-module Create template / place-time Entity / rail Entity / Jump / Set location / Create category plus / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-copy-space-or-next-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail item reorder):** U-01 leftover (not a new UL row). Live desktop `DragRearrangeHandle` → `reorderSurveyMarkersInCategory`. Category reorder / empty-module Create template / place-time Entity / rail Entity / Jump / Set location / Create category plus / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-item-reorder-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail category reorder):** U-01 leftover (not a new UL row). Live desktop `DragRearrangeHandle` → `handleReorderSurveyCategories`. Empty-module Create template / place-time Entity / rail Entity / Jump / Set location / Create category plus / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-category-reorder-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 empty-module Create template):** U-01 leftover (not a new UL row). Live empty-state `Create category for empty module` → CreateCategoryModal start-adding. Place-time Entity / rail Entity / Jump / Set location / Create category plus / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-empty-create-template-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 place-time Entity dialog):** U-01 leftover (not a new UL row). Live `pendingEntitySelection` after a Walls draw when the template has entities. Rail Entity picker / Jump / Set location / Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-place-entity-dialog-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Entity):** U-01 leftover (not a new UL row). Live rail `survey-marker-entity-trigger` / `aria-label="Entity"` → `applyEntitySelectionForMarker`. Jump / Set location / Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-entity-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Jump / Set location):** U-01 leftover (not a new UL row). Live rail `Jump to this Survey Marker` / `Set location on PDF` → `handleLocateItemOnPDF` / pending draw. Create category / category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-jump-set-location-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Create category):** U-01 leftover (not a new UL row). Live rail `Create category` → `CreateCategoryModal` → `addCategoryToCurrentTemplate`. Category Delete / Rename / item Delete / overlay Delete not replayed as the GAP. Receipt `fix-logs/survey-rail-create-category-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Delete selected categories):** U-01 leftover (not a new UL row). Live rail `Delete selected categories` + confirm → `deleteCategory` + marker wipe. Rename / item Delete / overlay Delete not replayed. Receipt `fix-logs/survey-rail-delete-categories-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Rename):** U-01 leftover (not a new UL row). Live rail `Rename ${name}` → `commitSurveyMarkerName`. Rail Delete / overlay Delete not replayed. Receipt `fix-logs/survey-rail-rename-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-rail Delete selected items):** U-01 leftover (not a new UL row). Live rail `Delete selected items` + confirm. Overlay Delete not replayed. Receipt `fix-logs/survey-rail-delete-selected-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-marker delete chrome):** U-01 / E-04 leftover (not a new UL row). Live overlay `Delete Survey Marker` + Select Backspace/Delete. Rail `Delete selected items` not this pass. Receipt `fix-logs/survey-marker-delete-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 survey-marker handle drag):** U-01 / E-01 / E-02 / E-03 leftover (not a new UL row). Live placed-marker body + 8 resize + `mtr`. 390 same overlay (no bbox strip). Receipt `fix-logs/survey-marker-handle-drag-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 counter nubbin / Shift-orbit):** S-05 / E-02 leftover (not a new UL row). Live nubbin + Shift-orbit + place-time Shift. 390 uses the same SVG handle (no pause-orbit). Receipt `fix-logs/counter-nubbin-orbit-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 bbox edit mode):** not a new UL row. Double-click / 390 **Resize and rotate** leftover after vertex-N (not E-01 rect bbox; not `vertex-N`; not line `p1`/`p2`/`midpoint`). Receipt `fix-logs/bbox-edit-mode-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 polygon/polyline vertex handles):** X-04 leftover (not a new UL row; not E-01 bbox; not S-03/S-04 line chrome). Live imported `vertex-N`. Ellipse radii / ink vertices / stamp edit omitted. Receipt `fix-logs/poly-vertex-handles-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 line/arrow endpoint + midpoint handles):** S-03/S-04 leftover (not a new UL row; not E-01 bbox). Live `p1`/`p2`/`midpoint` + snap-to-straight. Callout mid-edge omitted in source. Receipt `fix-logs/line-endpoint-midpoint-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout text-box flip + knee-rollback leftovers):** T-02 leftovers (not a new UL row). Live flip past opposite + resize-into-knee rollback. Receipt `fix-logs/callout-textbox-resize-leftovers-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout text-box corner resize):** T-02 `textBox-tl/tr/bl/br` (not a new UL row; not E-01 shape handles). Receipt `fix-logs/callout-textbox-resize-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 callout knee / leader / arrowTip drag):** T-02 edit handles (not a new UL row). Not clipboard paste (T-02 / thin leftovers). Receipt `fix-logs/callout-knee-drag-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Keep active / notes / page-ctx):** Keep active is U-01 chrome (not a new UL row). Survey notes is marker chrome (not create-Note). UL-32 execute leftovers: Mirror V / Reset / Cut / Copy / Paste. Extract **missing-handler**. Receipt `fix-logs/survey-keep-notes-page-ctx-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Survey Previous/Next module):** U-01 live module **Next/Prev** (not a new UL row). Walls stays the category **stamp**. Receipt `fix-logs/survey-module-nav-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 thumbnail click):** V-06 live thumb **left-click** (not a new UL row). UL-07 stays the page-number **input**. Receipt `fix-logs/thumbnail-click-2026-08-22.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-22 Fit height):** UL-05 was cluster-level (menu open / Fit page + Fit width). Fit height is its own mode. Receipt `fix-logs/fit-height-2026-08-22.md`. Exhausted “GAP = 0” **falsified**. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 mobile Bookmarks):** V-07 mobile sheet (not a new UL row). Create / up-down / Open page 3 / 0+999 clamp. Hub tabs now `aria-label`. Receipt `fix-logs/mobile-bookmarks-2026-08-21.md`. Unblocked catalog exhausted: `fix-logs/unblocked-catalog-exhausted-2026-08-21.md` (later falsified). Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Eraser Size every preset):** D-04 Size catalog every discrete **1…100** + custom 40 (default 20). Not a new UL row; not D-05 Width and not UL-35 Counter Size. Receipt `fix-logs/eraser-size-presets-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 Counter Size + Start):** UL-35 Size catalog every preset 5…64 + clamp 4–76; Start number intended/break/edge (lock after second pin). Not D-05 Width. Receipt `fix-logs/counter-size-start-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 F3 / counter Delete / cloud bump):** UL-34 every integer 1–20 live on the local Bump field (not leftover-18 persist). UL-35 series-list Delete execute + confirm; pin Delete is keyboard-only (pin menu stays Continue pin). F3/Ctrl+G are unlisted find aliases (not new UL rows). Receipt `fix-logs/f3-counter-delete-bump-2026-08-21.md`. Leftover **18** stay parked. Goal stays open.

**Prior-pass (2026-08-21 leftover-18 unblock):** UL-03 web `/` Auth-modal gate live; UL-13/16 previewBlocked save/wipe live; UL-20 trial not clicked; UL-21/22 Connect fail-closed; UL-24 Send fail-closed; UL-45 still needs a second-account tuple. Space CSV / PDF Pages added as save/export inventory (not new UL rows). Receipt `fix-logs/leftover18-unblock-2026-08-21.md`. Goal stays open.

**Date:** 2026-08-21  
**Worktree:** `nifty-elion-773074`  
**Matrix:** `FEATURE-MATRIX.md` / `E2E-STATUS.md` (59 rows)  
**This file:** every user-facing control found in toolbars, context menus, AccountSettings, ShareModal, PDFSidebar, AppShell chrome, mobile chrome, KeyboardShortcutsOverlay, color/font pickers that is **not already its own matrix row**.

Vite `http://localhost:5173/` was reused (not killed). Live checks used `?testPdf=clickable-link-test.pdf` and `?testPdf=spike-120-pages.pdf`. PDFViewer touch this wave is the tiny Continue-pin action pass only.

**Status legend:** `untested` · `pass` · `fail` · `blocked`

**Counts:** **46** unlisted controls · **0** still untested · **46** proved (Node and/or live) · live-blocked leftovers now: UL-45 two-client roster, UL-15 captcha completion, UL-16 wipe, UL-20 Stripe click, UL-21/22 live OAuth, UL-46 native · UL-24 mint + UL-44 Retry flush now live · **4** issues (3 wave 1 + Continue pin stub, all closed) · **0** open issues this wave

The **59-row matrix is not claimed complete** from this file. This file only covers the extra 46 controls.

Unblocked catalog follow-up (2026-08-21, not new UL rows): `fix-logs/e2e-unblocked-followup.md` / `e2e-unblocked-followup.spec.mjs` 6/6 — T-04/T-06/C-03/C-04/S-04/P-04 C/V-01 narrow. Leftover edges: `fix-logs/e2e-unblocked-followup-2.md` / `e2e-unblocked-followup-2.spec.mjs` 5/5. Completeness hunt: `fix-logs/e2e-catalog-completeness.md` / `e2e-catalog-completeness.spec.mjs` 5/5 — hub docs/projects/archive empty + U-02 rename/pages + UL-33 Dashed/Dotted. Host-gated UL leftovers unchanged. Remaining unblocked-unproven **0**.

## Proved

| How | What |
|---|---|
| Node `tests/e2eUnlistedControls.test.mjs` | **17 / 0 fail** — overlay, B helpers, Share parse+roles+block copy, AccountSettings catalog + password/unlink, sidebar tabs + close-panel contract, context/pages menus, print range + copies/rotate/markups, forms/style/fit, zoom/page clamp, sync/presence hide, Create space without `documentId` |
| Live `scripts/e2e-unlisted-live.mjs` | Overlay Close; **B** width; Fit; Forms hidden; History; **zoom %** 200 / 0→min / 9999→4000 / 50→min; **page #** 0+99 stay 1 on 1-page, jump 3 on 120-page; collapse panel; Search tab; Spaces tab; pages-thumb Duplicate menu; Style Solid+Cloud bump; counter series; Edit text disabled; print panel **not** opened (flag off); sync/presence hidden |
| Live `debug/scenarios/e2e-context-menu-spaces.spec.mjs` | **UL-27–31** 3/3 on reused Vite 5173 + `?testPdf=clickable-link-test.pdf`. Chrome right-click suppressed; empty page Paste-only (gray `#5a6473`); owned rect Cut/Copy/Paste + Bring to front / Send to back; Continue pin re-arms Counter; **U-02** Create space → Space 1 / Space 2, no `file.id` |
| Fixes | Print Clear `0` (wave 1); Share email dedupe (wave 1); overlay Close name (wave 1); copies/rotate helpers; this wave: Continue pin was a stub — now switches series + `setActiveTool('counter')` |

## Unlisted control table

| ID | Surface | Control | Intended | Break / edge | Status |
|---|---|---|---|---|---|
| UL-01 | Shortcuts overlay | Close (X / backdrop / Esc) | Dismiss overlay; focus trap owns Esc | Close had no accessible name | **pass** (live + Node; Close now `aria-label="Close"`) |
| UL-02 | Shortcuts overlay | **B** — toggle sidebar | Open/close left rail | Ignore in INPUT/TEXTAREA/contenteditable; modifiers | **pass** (Node helpers + live width change) |
| UL-03 | Shortcuts overlay | Ctrl/⌘O Open document | Open file | Web vs Electron File→Open | **pass** (IPC). Native chooser **opened** on 5175; pick/cancel **blocked** (AX + loginwindow). `fix-logs/electron-desktop.md` |
| UL-04 | Shortcuts overlay | Ctrl+0 Fit page | Fit page (not 100%) | Conflicts with zoom field focus | **pass** (listed + live: 50% then Ctrl+0 left 50%) |
| UL-05 | AppShell rail | Fit options menu | Fit page / width / **height** / manual | Narrow shell; Fit height ≠ Fit page on 390 | **pass** (this pass: Fit height intended/break/edge — `e2e-fit-height.spec.mjs`; prior live click was page+width only) |
| UL-06 | AppShell rail | Zoom % edit field | Type a percent; clamp 1–4000 | `0` / 50% lift to engine dynamic min (~100% here); 9999→4000; failed select-all appends | **pass** (live fill: 200%, 0→100%, 9999→4000%, 50→100%; Node clampScale) |
| UL-07 | AppShell rail | Page number edit | Jump by typing | 0 / >numPages revert; 1-page PDF | **pass** (live: 0+99 stay 1; jump 3 on 120-page; Node `coercePageNumber`). This pass: type 8 vs thumb 3; type 121 reverts — thumb click is V-06, not this row |
| UL-08 | PDFSidebar | Version history button | Open RevisionsPanel | Guest / no `file.id`; `?testPdf=` uses local key | **pass** (live visible; A-07 is the panel) |
| UL-09 | PDFSidebar | Search text tab | Focus find field | Mobile label is `Search` | **pass** (Node + live tab click) |
| UL-10 | PDFSidebar | Spaces tab | Spaces overlay list | Hidden when spaces entitlement off | **pass** (Node + live tab present on `?testPdf=`) |
| UL-11 | PDFSidebar | Close document panel | Collapse / close hub | Mobile sheet vs desktop chevron | **pass** (live width 48↔272; Node: mobile backdrop `aria-label="Close document panel"`) |
| UL-12 | AccountSettings | Tabs: General / Connected services / Subscription | Always land on General | Do not persist last tab (KAL-68) | **pass** (live + Node). `e2e-account-settings-general.spec.mjs`: reopen after Subscription still General. |
| UL-13 | AccountSettings | Edit profile — first/last name | Save via `updateProfile` | Empty / partial save | **pass** (live + Node). `e2e-account-settings-general.spec.mjs`: Cancel restores; empty/partial `required`; noop + name Save fail-closed. Cloud persist leftover-18. |
| UL-14 | AccountSettings | Email (read-only) | Display only | Input disabled + hint | **pass** (live + Node). Display + disabled input + hint on hubPreview and testPdf Home. |
| UL-15 | AccountSettings | Password set/change + reset-link + Turnstile | Google-only = Set; else Change | Captcha fail; mismatch; last Google method | **pass** (live mismatch + Node). Set-a-password; weak + mismatch; reset-link fail-closed. Live Turnstile leftover-18. |
| UL-16 | AccountSettings | Delete account + type `DELETE` | Block if still owns shared docs | Wrong confirm string; collaborator rows | **pass** (live confirm + Node). `delete` stays disabled; `DELETE` enables; Cancel. Live wipe leftover-18. |
| UL-17 | AccountSettings | Sign out | `signOut` + close | Mid-save | **pass** (live fail-closed). Settings Sign out shows `Preview cannot sign out` and **keeps** the modal. Distinct from A-04 menu Sign out confirm. Live hub session teardown leftover-18. |
| UL-18 | AccountSettings | Usage sub-tab | `<UsageIndicator/>` | Load fail | **pass** (live local empty chrome). `e2e-account-settings-usage.spec.mjs`: `Projects 0 / ∞` / `Documents 0 / ∞` / `Storage 0 B / 100.0 GB` + DEVELOPER; Manage hides; guest 0; `?testPdf=` Home + 390. Live billing-API counts still uninvented. |
| UL-19 | AccountSettings | Monthly / Annual billing toggle | Free users only; 17% save copy | Paid/developer hide toggle | **pass** (Node) |
| UL-20 | AccountSettings | Start trial / Manage billing / Contact sales | Stripe checkout; portal `returnUrl`; mailto | CORS `*` stays; no fake IDs | **pass** (live catalog). Start trial visible, not clicked. Contact sales present. Live Stripe Checkout still blocked. |
| UL-21 | AccountSettings | Microsoft Connect / Reconnect / Disconnect | MSAL; hidden on Capacitor | Session expired | **pass** (live Connect fail-closed). Live MSAL still blocked. |
| UL-22 | AccountSettings | Google Connect / Disconnect | Last sign-in method blocked | Unlink without password | **pass** (live Connect fail-closed + Node). Live OAuth still blocked. |
| UL-23 | ShareModal | Permission select Viewer \| Editor \| Owner | One role for link + email. **No Commenter** (locked KAL-31) | Matrix A-03 lists Commenter — Access Mgmt, not this dialog | **pass** (Node) |
| UL-24 | ShareModal | Copy link | Mint link-only invite; clipboard | Free-tier block; no target id; clipboard fail | **pass** (live mint). Signed-in owner Invite → Copy link minted (`e2e-signed-in-leftovers.spec.mjs`). HubPreview still fail-closed. Email Send not clicked. |
| UL-25 | ShareModal | Invite-by-email + Send | Parse comma/space/semicolon; lowercase | Invalid skip; **dupes now deduped** | **pass** (Node parse) |
| UL-26 | ShareModal | Cancel / Close + free-tier banner | Focus trap; no fake URL before mint | Placeholder only until Copy | **pass** (Node) |
| UL-27 | Context menu | Cut | Own marks only; clipboard mode=cut | Foreign author; readonly body | **pass** (live). Owned rect cut then empty-page paste restored a clone |
| UL-28 | Context menu | Copy | Stash shape / callout | Empty target | **pass** (live). Copy left the original; empty-page Paste added a new id |
| UL-29 | Context menu | Paste | Empty page = Paste only; gray if empty clipboard | Callout vs shape clipboard | **pass** (live). Empty page is Paste-only; desktop grays via `#5a6473` + `cursor:default` (not opacity). Chrome right-click shows no menu |
| UL-30 | Context menu | Bring to front / forward / backward / back | Overlap-aware z-order | **Omitted on callouts** (own SVG layer) | **pass** (live). Bring to front moved id to last SVG sibling; Send to back to first |
| UL-31 | Context menu | Continue pin (counter) | Keep series + re-arm Counter | Missing series | **pass** (live). Was a log-only stub; now switches series and leaves `[data-counter-overlay]` armed |
| UL-32 | Pages panel menu | Cut / Copy / Paste / Duplicate / Rotate / Mirror H+V / Reset / Delete | Page ops live on thumbs, not canvas | 1-page delete; empty clipboard | **pass** (this pass: **Mirror V / Reset / Cut / Copy / Paste execute** — `fix-logs/survey-keep-notes-page-ctx-2026-08-22.md`; prior Duplicate execute). **Extract missing-handler** |
| UL-33 | AppShell toolbar | Style picker Solid / Dashed / Dotted / Cloud | Cloud only on rect | Ellipse has no Cloud | **pass** (Node + live Solid/Cloud/Dashed/Dotted). Completeness: armed Dashed `6,4` + Dotted `2,4`; ellipse omits Cloud (`e2e-catalog-completeness.spec.mjs`) |
| UL-34 | AppShell toolbar | Cloud bump size 1–20 | Rect + cloud only | Letters / 0 / 99 | **pass** (every integer 1–20 live + 0→1 / 99→20 / letters rejected / empty→1; `e2e-cloud-bump-1-20.spec.mjs`) |
| UL-35 | AppShell toolbar | Counter series: New Count / Continue / start # / Size / delete series | Series list + context menu | Permission toast on delete; Size 3/77 | **pass** (this pass: Size every preset 5…64 + clamp 4–76; Start 10 / letters/0/empty→1 / lock after 2 pins — `e2e-counter-size-start.spec.mjs`; prior: series-list Delete + pin Delete **renumbers**) |
| UL-36 | AppShell toolbar | Edit text (Aa) | Enter overlay on selected text/callout | Disabled with no selection | **pass** (wired + live disabled) |
| UL-37 | AppShell toolbar | Forms category + 4 tools | Text field / Checkbox / Radio / Signature | **`{false && (` hidden for first release** | **pass** (hidden live). Tools Node-pass |
| UL-38 | Form properties | Name / default / tooltip / required / read-only / Delete field | Value hidden for checkbox/radio/signature | Id-less field | **pass** (Node) |
| UL-39 | Print panel | Pages to print + All / Current view / Clear | Empty = all; Clear = include none (`0`) | **Clear `0` used to become page 1 on blur** | **pass** (Node; Clear fix) |
| UL-40 | Print panel | Paper (10) + custom W×H + Auto/Portrait/Landscape | Custom 1–200 in | Garbage inches fall back | **pass** (Node + live this pass). 10 papers; empty W → `8.5`; H `999` → `200`. Flag restored. |
| UL-41 | Print panel | Rotate ±90 + Mirror H/V | Scope All/Select/Current | Empty select range | **pass** (Node + live clockwise this pass). Flag restored. |
| UL-42 | Print panel | Copies ± (1–999) / collate / duplex | − floors at 1 | 0 / 1000 | **pass** (Node + live: Fewer@1 stays 1; `0`→1; `1000`→999). Flag restored. |
| UL-43 | Print panel | Markups / color toggles + Save as PDF dest | Flatten path is X-03 | Destination list empty | **pass** (Node + live Markups toggle + dest option). Flag restored. |
| UL-44 | Sync chip | Details popover + Retry now | Retry outbox | Hidden when `synced` / no cloud | **pass** (Node + live Retry flush). Chip hidden on `?testPdf=`. Signed-in offline draw → **Offline · 1 saved locally** + Retry now. Offline Retry does not claim success. Online flush keeps the mark. Receipt `fix-logs/e2e-outbox-retry.md`. |
| UL-45 | Presence | Avatar stack + popover | N viewing | Same-user roster; hidden without collab | **pass** (Node + signed-in self row **just you** + same-user two-tab/two-context still **just you**). Hidden on `?testPdf=`. **blocked live two-client roster** — needs a second account. Receipt `fix-logs/e2e-two-tab-presence.md`. |
| UL-46 | Mobile chrome | Styled selects + color-picker close backdrop | Same style/arrowhead catalogs | touchcancel is E2E-CHROME-04 | **pass** (live 390×844). Eraser-mode select + Text color picker backdrop close. Native Capacitor still blocked. |

## Blocked list (live only — Node/catalog already done)

| IDs | Why blocked |
|---|---|
| UL-03 | Native File→Open opened `Open PDF document` on Vite 5175; pick/cancel unproven (AX menu-bar only; clicks hit loginwindow Login). `fix-logs/electron-desktop.md`. |
| UL-13, UL-15–18, UL-20–22 | **chrome live** on `?hubPreview=1`. Remaining: live Turnstile completion, account wipe, Stripe Checkout, MSAL, Google OAuth. |
| UL-24 | **live mint** on a signed-in owner doc (`e2e-signed-in-leftovers.spec.mjs`). HubPreview remains fail-closed. Email Send still not clicked. |
| UL-27–31 | **closed live** — prior “pdf.js swallow” was a harness miss (right-click at viewer 40,40 is chrome, off-page). |
| UL-40–43 | **closed live this pass** (`e2e-print-panel.spec.mjs` 1/1). Flag **restored false**. Repeat live needs another DEV flip. |
| UL-44 | **closed live** — offline draw on a signed-in UUID doc (`e2e-outbox-retry.spec.mjs`). Chip correctly hidden on `?testPdf=`. |
| UL-45 | Signed-in self row **just you**. Same-user two tabs / two contexts also **just you**. Two-client roster blocked: official lease has no `list`; `assign` needs a human `email\|userId\|tier\|status` (`fix-logs/e2e-host-leftovers.md`). |
| UL-46 | Native Capacitor still untested. Web 390×844 chrome is live (`e2e-helper-only-live.spec.mjs`). |

## Intentionally not rows (covered by an existing ID)

Color swatches / hex / opacity / spectrum / Match Fill = C-01…C-06. Fonts / size / B/I/U/S / align / font color = T-03…T-07. Arrowhead 6 styles = S-04. Undo/Redo = E-05. Export button = X-02. Pan/Select/Draw/Shapes/Text tools = V/D/S/T rows. Bookmarks add/reorder = V-07.

## New issues

### E2E-UL-04 — Continue pin was a log-only stub — **fixed**

- `item('Continue pin', 'continuePin')` had no action, so the menu closed and logged `[AnnotCtxMenu] continuePin`.
- Now calls `handleContinuePin`: switch that pin's series + `setActiveTool('counter')`.
- Proof: live UL-31 — overlay stays armed; no stub log.

Wave-1 issues stay closed:

### E2E-UL-01 — Print **Clear** became page 1 on blur — **fixed**

- Clear writes `pagesToPrint = '0'` (include none). `clampRangeToMax` / `sanitizeRangeInput` rewrote `0` → `1`.
- Helpers moved to `src/components/printRangeUtils.js`. Lone `0` is kept.

### E2E-UL-02 — Share email list minted duplicates — **fixed**

- `a@x.com, a@x.com` would mint twice. `parseEmails` in `src/home/shareInviteParse.js` now lowercases and dedupes.

### E2E-UL-03 — Shortcuts overlay Close had no accessible name — **fixed**

- Icon-only button. Added `aria-label="Close"` + `type="button"` in `KeyboardShortcutsOverlay.jsx`. Live: named button present.

## Observations (not product bugs)

- ShareModal roles are **Viewer / Editor / Owner** only. Commenter lives on Access Management (A-03), not this dialog.
- Forms category is **compile-hidden** (`false &&` in AppShell). Code + `FORM_TOOLS` stay; flip the flag to ship.
- Custom **Print panel** is also compile-gated (`PRINT_PANEL_ENABLED = false`). Cmd+P prints the blob/OS path. Flip the flag to ship the panel UI.
- Zoom field advertises 1–4000, but `zoomController` also applies a **dynamic minimum** (often ~fit-page). On `clickable-link-test.pdf` at 1440×900, `0` / `1` / `50` display as `100%`. `200` and `4000` apply.
- Context-menu Group/Ungroup omitted until the matrix-per-shape rewrite.
- Callout menu has no z-order (own SVG layer + id-sort).
- AccountSettings / ShareModal need hub auth — not faked on `?testPdf=`.
- CORS `Access-Control-Allow-Origin: '*'` stays.

## Hub leftovers wave (2026-08-21)

See `fix-logs/e2e-hub-templates-leftovers.md`. Reused Vite 5173. Not new UL rows.

- Templates editor create/edit/delete proven on `?hubPreview=1` (U-03). Blank rename restore is E2E-HUB-01.
- Hub sidebar **Archive** is document archive (`ArchiveScreen`), not KAL-44 checklist archive. Do not count that button as U-04.
- `kal441-form-fields.pdf` widgets live in `.pdfjsFormLayer` (also class `annotationLayer`). Wait for inputs; a same-tick count can be 0.

## Files touched (no commit)

- `src/hooks/useAnnotationContextMenu.jsx` (Continue pin action)
- `src/PDFViewer.jsx` (tiny: pass `handleContinuePin` into the menu bundle)
- `tests/e2eUnlistedControls.test.mjs` (17 tests)
- `debug/scenarios/e2e-context-menu-spaces.spec.mjs`
- this file
