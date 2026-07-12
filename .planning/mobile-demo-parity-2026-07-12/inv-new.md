# NEW APP Mobile Implementation — Exhaustive Inventory

## 0. ACTIVATION / ARCHITECTURE

- **Two independent mobile switches:**
  - **Viewer chrome**: `isNarrowShell` = `matchMedia('(max-width: 720px)')` (AppShell.jsx:331-346). `isMobileViewer = isNarrowShell && isViewerVisible` (AppShell.jsx:897). No pointer:coarse check — width only.
  - **PDF surface**: `isMobilePdfSurfaceViewport()` = `matchMedia('(max-width: 720px), (pointer: coarse)')` (PdfjsViewerContainer.jsx:86-88) — so a touch laptop gets the mobile PDF surface but desktop chrome.
  - **Home hub nav mode**: `mobileNavModeFromUrl()` — `?mobileNav=rail|tabs` explicit, else `tabs` if `window.Capacitor.isNativePlatform()` else `rail` (HubShell.jsx:127-132). `?nativeShell=expo` → `isExpoNativeShell()` (HubShell.jsx:134-137).
- **Overlay model**: hub stays mounted under the viewer; AppShell stamps `survey-viewer-open` on `<html>` when viewer visible (AppShell.jsx:946-950); hub.css neutralizes hub fixed chrome + page scroll under that class (hub.css:250-267); mobilePdfViewer.css locks html/body/#root to `100dvh`/hidden ≤720px (mobilePdfViewer.css:12-21).
- `--app-chrome-top` CSS var = bottom of top chrome, updated via rAF + MutationObserver (AppShell.jsx:952-1003); used as sheet max-height ceiling (mobilePdfViewer.css:884,1360).
- `--app-sidebar-width` set to 44px in mobileMode (PDFSidebar.jsx:145-148).
- Desktop TabBar hidden when narrow (AppShell.jsx:1042).
- Mobile panel state in AppShell: `mobileSurveyRequestKey/CollapseRequestKey/mobileSurveyPanelOpen/mobileDocumentPanelState{isOpen,activePanel}/mobileAuxPanel` (AppShell.jsx:504-508); `mobileViewerPanelOpen` hides the dock when any sheet is open (AppShell.jsx:898-902, 3325). Panels mutually exclusive: opening doc panel collapses survey (AppShell.jsx:904-907); opening survey closes doc panel (AppShell.jsx:916-926); aux (users) closes both (AppShell.jsx:935-939); all reset when viewer hides (AppShell.jsx:928-933).

## 1. FEATURE INVENTORY — BY SURFACE

### 1A. Home hub, mobile (≤720px; `mobileNav=tabs` is native default)

- **Layout**: desktop sidebar hidden (hub.css:294-296); fixed header `--mobile-header-h:140px` (hub.css:269-271, 309-325); page becomes document-scroll (`survey-hub-mobile-scroll-page/root` classes stamped on html/body/#root, HubShell.jsx:293-305; hub.css:223-242). In `nativeShell=expo` mode instead `survey-hub-native-frame/root` = fixed 100% frame, inner lists scroll (hub.css:208-221, 941-972).
- **Bottom tab bar** `.mobile-home-tabs`: fixed bottom, 3 tabs Documents/Projects/Templates (nav items HubShell.jsx:307-311, rendered 352-354); grid 3-col, 56px + safe-area, active = `#1f2430` bg + `inset 0 2px var(--gold)` (hub.css:828-892). Hidden in rail mode (hub.css:341-343).
- **Rail nav (mobileNav=rail, browser default)**: hamburger trigger 32x30 in header (HubShell.jsx:217-286; hub.css:345-438); opens 208px dropdown panel with the 3 nav items, swipe-left ≥36px closes (HubShell.jsx:234-242); scrim fixed z150.
- **Profile**: `.mobile-profile` 38px avatar button absolute top-right of header (hub.css:793-826); opens same Settings/Sign-out menu w/ confirm step (HubShell.jsx:142-215).
- **Documents tab** (DocumentsLedger.jsx): summary flattened into header (`documents-mobile-summary`, DocumentsLedger.jsx:255); select-mode row with Select/actions buttons (`mobile-header-select-row/-button/-actions`, DocumentsLedger.jsx:257-270; hub.css:559-611); sort/filter button + dropdown menu (`documents-mobile-search-row/-filter/-sort-menu`, DocumentsLedger.jsx:292-317; hub.css:619-672); card list `.documents-mobile-list` of `.mobile-doc-card` (checkbox/… + title/meta + 52px thumbnail; tap = open detail; DocumentsLedger.jsx:370-397, 579-593; hub.css:912-931, 993-1001); **detail bottom-sheet modal** `.documents-mobile-detail-scrim/-modal` (name, meta, live PDF preview `min(32dvh,250px)`, facts grid, owner, action buttons 2-col; DocumentsLedger.jsx:595-626+; hub.css:674-787).
- **Projects tab** (ProjectsFolderTree.jsx): drill navigation `mobileProjectLayout='drill'` (ProjectsFolderTree.jsx:185-189); back-button + search + New Project row (`projects-mobile-search-actions with-back/with-create`, ProjectsFolderTree.jsx:623-649; hub.css:519-552); select rows for projects/files (ProjectsFolderTree.jsx:656-743); CSS supports many variants: folder rows/grids/tiles, rail side-panel `projects-mobile-rail-layer/-scrim/-panel` (hub.css:1378-1414), iteration switcher (hub.css:1027-1054), focus card, project strip, team board, member rows, empty cards, file mini-lists (hub.css:1056-1757, 2494-2550).
- **Templates tab** (TemplatesEditor.jsx): browser list of template sets `.templates-mobile-row` w/ swatches + check (TemplatesEditor.jsx:2307-2368; hub.css:1793-1882); detail editor `.templates-mobile-detail`: title input + Entities button (2390-2410), module tabs strip (2417-2445; hub.css:2092-2118), categories section w/ expandable category rows + item rows + add-line + archived list (2447+; hub.css:2192-2314), save row pinned in header (`templates-mobile-save-row`, TemplatesEditor.jsx:1537-1543; hub.css:1956-1992), **entity modal** bottom sheet (`templates-mobile-modal-scrim/-entity-modal`, hub.css:2336-2423), color panel w/ Fill/Stroke tabs (hub.css:2437-2480). `initialMobileOpen` deep-link via `?mobileState=detail` in HubPreview (HubPreview.jsx:159,202; SurveyHub.jsx:37,118,135).

### 1B. Mobile PDF viewer — top header (`MobilePdfViewerHeader`)

MobilePdfViewerChrome.jsx:166-279, mounted as `#chrome-top-host` replacement (AppShell.jsx:1061-1068). Height 34px + safe-area-top; flat 34px under expo shell (mobilePdfViewer.css:23-41). z-index 5900.
- **Back button** (chevronLeft 21px) → `onBack` (AppShell `handleBack`) (166-184).
- **Document title pill** (max 136px, ellipsis) — tapping toggles the page menu (185-194).
- **Center page pill** `n / N` + chevronDown; opens **page/zoom menu** (197-254): prev/next page buttons, page number input (`pageInputValue/handlePageInputChange/KeyDown/Blur`), "of N", then one button per `ZOOM_MODE_OPTIONS` entry (fit page / fit width / custom — viewerShared.js:1586) calling `handleZoomModeSelect`; closes on outside pointerdown (170-177). Menu 138px, z7200 (css 148-163).
- **Undo / Redo** icon buttons right side, driven by `topToolbarApi.canUndo/canRedo/onUndo/onRedo` (257-276) — which PDFViewer swaps to REGION history stacks during region editing (PDFViewer.jsx:11112-11121).
- NOT in mobile header (desktop has them): zoom % input, fit dropdown pill, export button, tool cluster.

### 1C. Mobile PDF viewer — left tool rail (`MobilePdfViewerToolRail`)

MobilePdfViewerChrome.jsx:853-1152; hosted in 44px-wide `#chrome-left-host` (AppShell.jsx:2735-2759). CSS: 44px column, bg #20242c, z5750, bottom padding reserves dock height + 28px (css 224-236).
- **Pan** and **Select** buttons (926-927) → `setActiveTool`.
- **3 tool groups** (9-41): Draw{pen,highlighter,eraser}, Shapes{rect,ellipse,line,arrow,counter}, Text{text,callout}. Tapping a group selects the last-used tool of that group (`lastDrawTool/lastShapeTool/lastReviewTool`) or its fallback (909-920) and expands an inline **subtool tray** (938-953; css 281-297).
- **Region-editing subtools** when `regionEditing`: rectangular/freehand tool type + add/subtract selection mode (954-985), driven by `regionToolbarApi` published from RegionSelectionTool (RegionSelectionTool.jsx:1810-1836: `{toolType, selectionMode, canSetFullPage, setToolType, setSelectionMode, confirm, cancel, setFullPage}`).
- **Survey categories** vertical list (2-letter glyph circles) when survey panel active (986-1006; glyph fn 74-78; css 299-327) → `surveyToolbar.onSelectCategory`.
- **Survey entities** vertical list (color dot buttons) (1008-1029; css 329-362) → `onSelectEntity`.
- **Footer** (1032-1113): **More popover** (⋯): Export annotated PDF (`exportAnnotatedPdf`), Save log (Capacitor-native only, dispatches `save-log-banner-start` w/ `window.__consoleLogBuffer`, 1083-1101), Zoom out, Zoom in (fixed-position popover left 47px, z7200; css 447-461). **Sync dot** (12px circle colored by `getMobileSyncPresentation`; tap = `cloudSyncOnRetry`; disabled if sync off) (1040-1049). **Version history** button → `onOpenPanel('history')` (disabled without `documentId`) (1050-1059). **Presence avatar** (initials + `+N` badge) toggles Active-users sheet (1060-1067).
- **Active users sheet** (1115-1148): backdrop + `mobile-pdf-users-sheet` (276px + inset; css 1411-1471): header count, rows avatar/name/role/status from `normalizeMobilePresence` (mobilePdfViewerModel.js:23-69: dedup by user_id keeping newest last_seen, self first, initials derivation). Reports open state via `onAuxPanelStateChange('users')` (891-894).

### 1D. Mobile PDF viewer — contextual properties strip (`MobileToolProperties`)

MobilePdfViewerChrome.jsx:281-851; absolutely positioned strip top:0 left:44px, 36px tall, horizontally scrollable, z5700 (css 504-527). Renders one of 4 modes:
1. **Region editing** (`regionEditing && regionToolbarApi`): Confirm (primary blue) / Full Page / Cancel (309-318).
2. **Survey placement** (`showSurveyPanel && surveyToolbar` and tool ∈ survey-marker/pan/select): module `<select>` + "Keep active" checkbox-button (320-352) → `onSelectModule`, `onKeepCategoryActiveChange`.
3. **Rich-text editing** (`api.richTextEditor` truthy): font color swatch (native `<input type=color>`), font family select (Arial/Helvetica/Times New Roman/Courier New/Georgia/Verdana), font size input (1-200), B/I/U/S toggles (preventDefault on pointerdown to keep editor focus), combined vertical|horizontal alignment select (354-411) → `editor.api.setFontColor/setFontFamily/setFontSize/toggleBold/.../setTextAlign/setVerticalAlign`.
4. **Tool defaults** (445-617), gated by tool sets (50-52): eraser mode select (partial/entire); color swatch — dual fill/stroke popover for FILL_TOOLS incl. counter labels "Pin fill/Pin number" (458-506), plain color input otherwise; stroke-width / eraser-size numeric input (508-519, 551-562); **counter series menu**: "+ New Count", continue-count list with color dot/label/count (520-549; css 827-872) → `onNewCounterSeries/onSwitchCounterSeries`; border style select solid/dashed/dotted(+cloud for rect) (563-574); cloud **Bump** intensity input 1-20 (575-588); arrowhead select for arrow/callout using `MOBILE_ARROWHEAD_STYLE_LABELS` (53-60, 589-599); **"Aa" button** — enters text edit if `canEnterTextEdit`/editor active, else opens the Text-defaults sheet (600-616).
- **Text/Callout defaults sheet** (618-848; portal to body; css 877-1270): Shape|Text pill tabs; Text tab = text color card (hex label + big swatch + 9 preset dots from `MOBILE_ANNOTATION_COLORS` 62-72), B/I/U/S + size split card, horizontal + vertical alignment glyph grids (custom SVG glyphs 104-164); Shape tab = Fill/Stroke tab color card, stroke style + width split card, arrowhead card (callout only). Writes via `onTextStyleDefaultsChange` (patch merge, 435) and the same fill/stroke/border/arrowhead handlers. Height variants: text 432px / shape 368px / callout-shape 448px + inset (css 883-901).
- Hidden entirely for pan, and for select with no selection-mapped contextTool (413). `contextTool` = selection-mapped tool when in select mode (PDFViewer.jsx:21488-21509).

### 1E. Mobile PDF viewer — bottom dock (`MobilePdfViewerDock`)

MobilePdfViewerChrome.jsx:1154-1188; rendered only when no panel open (AppShell.jsx:3325-3335). Fixed bottom, z5850, height `--mobile-viewer-dock-height` = 52px + inset; visual surface strip 36px+inset bg #1e1e1e (css 1272-1341).
- **Left round button (layers icon)** → `onOpenPanel('spaces')`; active when `leftRailApi.activeSpaceId` or spaces panel open (AppShell.jsx:3332).
- **Center pill** — labeled Pages/Search/Bookmarks per last hub tab (`hubMode`), chevronDown → `onToggleHub` (opens `PDFSidebar` sheet at remembered tab, AppShell.jsx:909-914).
- **Right round button (survey icon)** → `onOpenSurvey` (expands `SurveySpacesRail` sheet; toggling collapses via `mobileSurveyCollapseRequestKey`, AppShell.jsx:916-926); active when `rightRailApi.showSurveyPanel`.

### 1F. Document hub sheet (PDFSidebar in mobileMode)

PDFSidebar.jsx:137-717 with `mobileMode`/`onPanelStateChange`. Whole sidebar becomes a fixed **bottom sheet** `.mobile-pdf-sheet` (css 1352-1373: fixed, full width, height `--mobile-sheet-height`, `!important` overrides, animate-in 180ms, z6500; backdrop z6400 css 1343-1350). Collapsed = `display:none` (css 1373); backdrop tap closes (265-272); drag handle swipe-down >48px closes (230-239, 288-290).
- **Dynamic sheet heights** (253-261): history 264; spaces `max(238, 106 + 54·spaces + 50·expandedPageRows)` (rows reported by SpacesPanel via `onMobilePanelMetricsChange`, SpacesPanel.jsx:795-803); search 232 w/ results else 292; bookmarks `min(286, max(238, 84+42·bookmarks))`; pages 310 — each + `--mobile-bottom-inset`.
- **Tab strip** `.mobile-pdf-hub-tabs`: Pages / Search / Bookmarks only (Spaces excluded on mobile, 246-247), icon-only 34px pills, active green #28a745 (css 1704-1735), plus round × close (423-432; css 1737-1751). Spaces and History render **standalone** (no tab strip, 241-245).
- **Pages panel mobile** (PagesPanel.jsx): page counter pill `n / N` (769-777; css 1805-1835); **horizontal** thumbnail track w/ scroll-snap (778, css 1837-1845); 130x146 cards, active = blue + green edge bar, white 92x112 preview (816-848, 917; css 1847-1955); **select mode**: multi-select circles (52-53, 609-622, 910-915); bottom actions pill **Add / Paste / Select(Done)** (969-1003); context menu gains **Move up / Move down** on mobile (1025-1047); drag-reorder disabled (`draggable={!mobileMode}`, 819).
- **Search panel mobile** (SearchTextPanel.jsx): restyled bar + input ("Search text" placeholder, 1707), results container, `.mobile-search-empty` empty/none states (1672-1891; css 1757-1803).
- **Bookmarks panel**: no mobile-specific props (PDFSidebar.jsx:500-510) — desktop markup inside the sheet.
- **Spaces panel mobile** (SpacesPanel.jsx): `.mobile-spaces-header` w/ status subtitle "Region active/Space active/No space active" (1258-1281; css 1660-1683); footer **"Exit Spaces / Regions"** button (PDFSidebar.jsx:548-560; css 1685-1702).
- **History panel**: RevisionsPanel embedded + floating × `.mobile-history-close` (323-332; css 1957-1971).
- Collaboration footer (sync chip/presence/history button) suppressed in mobileMode (688) — replaced by rail footer items (1C).
- Save-log tile appended to tabs on Capacitor native (248-252, 594-598).

### 1G. Survey sheet (SurveySpacesRail in mobileMode)

SurveySpacesRail.jsx:328-3571; rendered in `#chrome-right-host` which is 0px wide on mobile (AppShell.jsx:2874-2905). In mobileMode the panel becomes fixed bottom sheet (inline styles 668-694): height `calc(base + --mobile-bottom-inset)`, base = 392 with template else `154 + 48·templates` (345-347); backdrop (651-655); swipe-down ≥48px collapses + `applyLayoutDrivenZoom()` (349-360).
- **Sheet header** `.mobile-survey-sheet-header`: eyebrow "Survey template" + template-name button opening `.mobile-survey-template-menu` dropdown (839-870; css 1480-1565); header actions (export etc., 916+) + round close (css 1588-1600).
- **Module row** restyled `.mobile-survey-module-row` (947; css 1602-1610); category action row hidden on mobile (`mobile-survey-category-actions` display:none, 1220; css 1612-1614); categories heading with hint "Tap category to place marker" (1623-1631; css 1616-1633).
- **Template picker** state header `.mobile-survey-picker-header` + close (2912-2941).
- Footer **"Exit Survey"** (3560-3564; css 1641-1658).

### 1H. Region editing (mobile)

RegionSelectionTool gets `mobileMode` + `onMobileToolbarApiChange` (PDFViewer.jsx:27926-27927); publishes toolbar API (RegionSelectionTool.jsx:1810-1836) consumed by rail subtools (1C) + Confirm/FullPage/Cancel strip (1D-1); desktop floating region toolbar suppressed (`!mobileMode &&`, RegionSelectionTool.jsx:2547).

### 1I. PDF surface mobile behavior (PdfjsViewerContainer)

- Layout metrics: gap 12, padX 14, padTop 52 (clears the properties strip), padBottom 88 (clears dock), `maxPageWidth 390` (PdfjsViewerContainer.jsx:46-50, 90-106).
- Canvas budget 8MP mobile vs desktop (83, 111-116); raster cache bypassed on mobile, renders straight into the mounted canvas (225-226, 249, 272); overscan 1 page (85, 735).
- Live `matchMedia` re-evaluation incl. `(pointer: coarse)` (552-555).
- **Touch contract**: one finger = active tool, two fingers = pinch-zoom/pan; touchstart preventDefault kills Safari native zoom/loupe except on editable/link/text-selection targets (1096-1154); `data-mobile-touch-mode` stamped during gestures (1103-1106).
- Container: class `survey-pdfjs-mobile-surface`, `data-mobile-pdf-surface`, bg `#070A0D` (vs desktop #3a3d42), `touchAction:none`, user-select/callout/drag disabled (1481-1495); different page box-shadow (1565).
- Mobile text/callout creation uses `textStyleDefaults` as creation style (PDFViewer.jsx:10251-10260, 29415; FabricEditCanvas.jsx:1086 `newTextStyle`).

## 2. DESIGN TOKENS (mobile CSS/JSX)

**Zero `var(--...)` theme-token usage in src/mobile/** — every color is hardcoded. The mobile VIEWER accent is **blue #4a90e2**, not the app gold `--accent-primary: #d8a84e` (App.css:32). The HOME hub mobile CSS does use tokens (`--gold/--ink-*/--bone-*`, hub.css:5-23).

- **Hardcoded palette, mobilePdfViewer.css**: surfaces #1e1e1e (header/dock surface 31,1296), #20242c (rail 232, swatch shadow 413), #24272d (sheets/menus 158,888,1364,1473-1484,...), #1b1f25 (cards 1017,1450,...), #181c24 (popovers 453,838), #171a20 (pill/input 133,1771,1822), #12151c (sheet title 1406), #101319/#0f1218/#141820/#15181d/#11141a/#0c0f13 (inputs/wells), #2a2b31/#2a2d34/#2a2a2a (buttons), #444 (property controls 682,774,810), #202126 (properties strip 520), #090a0d (strip border 522). Borders #3a3a3a, #3a4250, #343a45, #333944, #323844, #2f3641, #303744, #2a3140, #444b57, #2e333c, #343b46, #3f4652, #51404a (danger), #3b424e, #353b46, #454b56, #555c68, #657080, #3a4252. Text #f2f2f2, #a8b0bf, #919aa8, #d6d9df, #ddd, #bbb, #99a2af, #e8e2d4 (gold-bone leftovers 203,421,470...), #f1ede4, #6f7785, #535b68, #667080, #8a93a3, #68707a (handle). Accents: blue **#4a90e2** (~25 sites incl. 181,264,325,556,818,869,1104,1225,1254,1322,1471), #2b6fb6 border, #132135/#121b2a/#122238/#132235/#162236/#1d2740/#17281f blue-tint bgs, #315f91/#2f6bb8; green **#28a745**+#1a3328 (hub tab 1731-1732), **#58d976**+#17281f (page select 1874-1937); danger #f08a8a; gold #d8a84e only at 496 (popover avatar) + 977 (focus outline); avatar #2a3b54; page preview #fafaf8/#e5e5de; header text #17120a.
- **Hardcoded in JSX**: `MOBILE_ANNOTATION_COLORS` = #ff0000,#4A90E2,#27C07D,#F4D35E,#ffffff,#1e293b,#C7A7FF,#FF8A3D,#000000 (MobilePdfViewerChrome.jsx:62-72); toHexColor fallback #d8a84e (80); glyph colors #F4F7FB/#D8DEE9/#35BEEA/#A7E1F4 (105,116-159); tool fallbacks #ff0000/#1e293b/#ffffff (438-439,467-475); entity fallback #6f7785 (1024). Sync colors #2bbd7e/#f5a524/#ef4444/#687180 (mobilePdfViewerModel.js:3-7,18-20). AppShell: rail #20242c vs #12151c (2744). PDFSidebar active tab #d8a84e (381,411), bg #12151c/#181c24 throughout.
- **Radii**: 2-4px (inputs/handles), 5px (buttons/pills), 6px (icons/menus), 7px (menus/cards/rows), 8px (cards/subtool trays), 9px (badge), 14px 14px 0 0 (sheets 891,1366), 15-17px (pills), 16px (round closes), 17px (segment tabs 957,1236), 19px (dock center 1338), 21px (pages actions 1913), 50% (circles). Hub mobile: 6-12px.
- **Fonts**: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", sans-serif` (header 33; pill 136; sheet title 1408; template button 1516; pages actions 1928). Sizes 9-16px; weights 650/700/800/900; `font-variant-numeric: tabular-nums` (137,1827,1834). Hub mobile: title 22px, `letter-spacing: 0` guard (hub.css:440-445).
- **Sheet heights**: see 1F/1G/1D lists; all capped `calc(100dvh - var(--app-chrome-top,34px) - 18px)` (884,1360).
- **Z-index ladder**: sub-toolbar 5400 < top toolbar 5500 (desktop) < chrome rails 5600 (AppShell.jsx:2749,2892) < properties 5700 < tool rail 5750 < dock 5850 < header 5900 < backdrop 6400 < sheets/text-defaults 6500 < popovers/menus 7200 < counter menu 7300 (mobilePdfViewer.css:35,236,457,527,842,882,1287,1349,1369). Viewer tab 5000/4000 (AppShell.jsx:2817). Hub: header 90, tabs 100, rail-nav scrim 150/trigger 170, entity modal scrim 230, doc detail scrim 260 (hub.css:314,833,350,375,2339,677).
- **Animation**: `mobilePdfSheetIn` translateY(24px)+fade 180ms (1973-1976); `mobile-rail-menu-in` 140ms (hub.css:435-438).

## 3. SAFE-AREA HANDLING

- **Source of vars**: `--native-safe-area-bottom` and `html[data-native-shell="expo"]` are never set in src/ (grep confirms) — injected by the Expo WebView shell (mobile-expo-go/App.tsx uses `react-native-safe-area-context`, App.tsx:18). Web fallback chain everywhere: `var(--native-safe-area-bottom, env(safe-area-inset-bottom, 0px))`. `viewport-fit=cover` set (index.html:5).
- **Central token**: `--mobile-bottom-inset: max(10px, <chain>)` and `--mobile-viewer-dock-height: calc(52px + inset)` (mobilePdfViewer.css:2-3).
- **Covered**: viewer header top `env(safe-area-inset-top)` (24-25; zeroed to 34px flat under expo shell 38-41); dock + surface (1273,1295); tool-rail bottom padding (227); more-popover offsets (460-461); all sheets via `--mobile-sheet-height` includes inset (PDFSidebar.jsx:274-275; SurveySpacesRail.jsx:670-671); text-defaults + users-sheet bottom padding (885,1413); hub tab bar (hub.css:271,838,848); hub list bottoms (930,1775); doc-detail + entity-modal scrim padding (680,2346).
- **MISSING / gaps**:
  1. `.mobile-survey-exit-footer` / `.mobile-spaces-exit-footer` (mobilePdfViewer.css:1641-1658,1685-1702) — bottom-most 44px rows inside sheets with **no** bottom inset padding of their own; the sheet's height includes the inset but nothing keeps these buttons out of the home-indicator zone.
  2. `.mobile-pdf-header` uses only `env()`, not `var(--native-safe-area-top,...)` — inconsistent with the bottom var pattern (24-25).
  3. Hub fixed header `--mobile-header-h:140px` has **no top safe-area** term (hub.css:270,309-325) — browser PWA/notch overlap risk in non-native web use.
  4. `.mobile-pdf-tools__popover` is fixed but `is-more`'s bottom anchor assumes dock visible; fine, but `left:47px` hardcodes rail width (447-461).
  5. `mobile-pages-actions`, `mobile-pages-counter` rely on the sheet height budget only (no explicit inset) — safe because sheet base heights add inset, same caveat as (1).
- **Landscape/left-right insets**: no `safe-area-inset-left/right` usage anywhere.

## 4. WIRING — MobilePdfViewerChrome ↔ desktop PDFViewer

All three mobile chrome components are pure consumers of the same APIs PDFViewer already publishes for desktop chrome (no separate mobile pipeline):

- **`topToolbarApi`** (PDFViewer.jsx:11112-11121 → AppShell.jsx:306-311 → Header): `{canUndo, canRedo, onUndo, onRedo}` (region-history-aware).
- **`bottomToolbarApi`** (PDFViewer.jsx:21486-21603 → AppShell.jsx:352 → Header/ToolRail/Properties): full object incl. `activeTool/contextTool`, `lastDrawTool/lastShapeTool/lastReviewTool`, `setActiveTool` (logged wrapper), `setActiveCategoryDropdown`, stroke/fill color+opacity handlers, `strokeWidthInputValue`/eraser size + focus/blur handlers, `eraserMode/setEraserMode`, `arrowheadStyle/setArrowheadStyle`, `lineBorderStyle/setLineBorderStyle`, `cloudIntensity/setCloudIntensity`, counter series (`counterSeriesList/activeCounterSeriesId/onNewCounterSeries/onSwitchCounterSeries`), `richTextEditor` (state+api), `textStyleDefaults/onTextStyleDefaultsChange`, `onEnterTextEdit/canEnterTextEdit`, zoom (`zoomIn/zoomOut/resetZoom/zoomMode/handleZoomModeSelect/zoomInputValue...`), page nav (`pageNum/numPages/pageInputValue/goToPreviousPage/goToNextPage/handlePageInput*`), `showSurveyPanel`, **`surveyToolbar`** `{modules,categories,entities,selected*,onSelect*,keepCategoryActive,onKeepCategoryActiveChange}` (mobile-specific block 21447-21481; entity select clears category and vice-versa 21459-21474; marker placement resolves the mobile entity color 25233-25347), **`regionEditing` + `regionToolbarApi`** (21535-21536, fed from RegionSelectionTool 27926-27927), `exportAnnotatedPdf` (21602).
- **`leftRailApi`** (PDFViewer.jsx:27154-27251 → PDFSidebar props + ToolRail footer): `ref` (imperative `openPanel/closePanel/togglePanel`, PDFSidebar.jsx:201-208 — AppShell drives sheets through it, AppShell.jsx:904-914), full pages/search/bookmarks/spaces/history handler set, `cloudSyncStatus/QueueSize/Enabled/OnRetry`, `presence/currentUser*`, `documentId`, `activeSpaceId`. Identity-churn-suppressing setState (27236-27251).
- **`rightRailApi`** (publish at PDFViewer.jsx:27336-27472) → SurveySpacesRail spread props; AppShell overlays `mobileMode`, `expandRequestKey` (+`mobileSurveyRequestKey`), `collapseRequestKey`, wrapped `onCollapseChange` → `setMobileSurveyPanelOpen` (AppShell.jsx:2895-2905).
- **PDFViewer `mobileMode` prop** = `isNarrowShell` (AppShell.jsx:2837); used only for: callout creation text-style defaults (10251-10260), text creation `newTextStyle` (29415), RegionSelectionTool mobile API (27926-27927).
- **Plumbed vs not**: everything above is live on mobile. **Not surfaced on mobile chrome**: bookmarks creation UI beyond desktop panel markup, zoom % input/custom-zoom entry (only fit modes + zoom in/out steps), fit dropdown labels, opacity controls (CSS exists `.mobile-pdf-properties__opacity` 733-765 but no JSX renders it), stroke width for highlighter opacity, print, template creation, share, desktop color-picker popovers (`CompactColorPicker` replaced by native `<input type=color>` — violates the shared-picker rule), collaboration footer chip (replaced by sync dot), keyboard shortcuts overlay (suppressed, AppShell.jsx:3353).

## 5. OTHER MOBILE-CONDITIONAL CODE (misc)

- Icons.jsx:447 — undo2/redo2 lucide icons added specifically for the mobile header.
- utils/logPreamble.js:26,49 — platform detection strings 'mobile'/'mobile-build' for log preambles.
- SaveLogBanner.jsx:184 — comment only (mobile direct-push path removed).
- supabaseClient.js:28 — comment re plain-HTTP mobile dev hosts / secure contexts.
- useDatabase.js:248 — device provenance comment.
- HubShell dev return path preserves `mobileNav: 'rail'` in the dev hub-preview URL (AppShell.jsx:658-668).
- FabricEditCanvas.jsx:1086 — `newTextStyle` param documented as "creation defaults from the mobile text-format panel".