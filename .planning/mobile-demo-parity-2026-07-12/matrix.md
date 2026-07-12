# MOBILE PARITY MATRIX — Old Demo (mobile-expo-go) vs New App Mobile

**Reading rules for this matrix:**
- **Layout/spacing/feature reference = OLD DEMO.** Geometry, heights, radii, touch targets, motion, and feature set should converge on the demo.
- **Color reference = NEW APP GOLD (`#d8a84e` accent).** The demo's blue `#4a90e2` accent is NOT the target. Rows below record blue-vs-gold splits as "unify on gold," never "restore blue." Neutral surface hexes (demo and new already share `#24272d`/`#1b1f25`/`#1e1e1e` family) ARE the reference.
- Status values: **MATCH** (parity or intentional superset), **PARTIAL** (present but degraded/incomplete), **DIFFERENT** (present but behaves/looks differently), **MISSING** (demo feature absent), **NEW-ONLY** (no demo equivalent — see final section).

---

## 1. Viewer canvas & gestures

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Canvas background | Scroll surface bg `#070A0D` | MATCH | — | — | demo styles.ts:816-822 / PdfjsViewerContainer.jsx:1481-1495 |
| Page rendering | Mock white page `#FAFAF8`, 1px `#D8D8D0`, fake floor plan | MATCH (superset) | Real pdf.js pages supersede the stub; keep | Demo pageWidth `min(w-44-18, 390)`; new `maxPageWidth 390`, gap 12, padX 14 — equivalent | demo App.tsx:111-119, FloorPlan.tsx:5-22 / PdfjsViewerContainer.jsx:46-50 |
| Content top/bottom padding | pageOffset y:58; paddingBottom `bottomActionHeight+22` | PARTIAL | New padTop 52 (clears props strip) vs demo 58; padBottom 88 vs demo ~74-84 — verify no dock overlap at min zoom | padTop 58→52; padBottom formula→fixed 88 | demo App.tsx:271,1543-1553 / PdfjsViewerContainer.jsx:46-50 |
| Pinch zoom / two-finger pan | None — fit dropdown only (demo stub) | MATCH (superset) | New one-finger=tool / two-finger=pinch contract is the intended real behavior; preserve | — | demo §18 / PdfjsViewerContainer.jsx:1096-1154 |
| Zoom fit modes | Fit Page / Fit Width / **Fit Height** | PARTIAL | Fit Height option absent (new has fit page / fit width / custom) | — | demo constants.tsx:92-96 / viewerShared.js:1586, MobilePdfViewerChrome.jsx:197-254 |
| Tap-to-place survey marker (numbered pin) | Tap places 26px numbered round pin, entity-color fill, 2px ink border, id text 12/900 | DIFFERENT | New = drag-drawn rectangle highlight via FabricDrawingCanvas; no pin, no number, no tap gesture. Biggest interaction-model gap (matches desktop, not demo) | 26px circle r13 vs free-size rect | demo App.tsx:1132-1162, styles.ts:903-923 / PDFViewer.jsx:17776-17784, 25111 |
| Drawing strokes | Ink = 10px red dot stubs | MATCH (superset) | Real Fabric strokes supersede; keep | — | demo App.tsx:1198-1209, styles.ts:912-918 / FabricDrawingCanvas path |
| Long-press annotation → context menu (320ms) | Cut/Copy/Paste/Delete + z-order menu on ink | MISSING | No mobile long-press annotation context menu exists | Menu 176w radius 9 | demo App.tsx:1579-1601, 866-895 / — (no equivalent) |
| Long-press canvas → paste menu (360ms) | Paste-at-point when annotation clipboard present | MISSING | No mobile canvas long-press menu | Menu 154w | demo App.tsx:1555-1563, 897-915 / — |
| Long-press region → delete menu (420ms) | Region name title + destructive Delete | MISSING | No mobile region long-press; region delete only via Spaces panel | Menu 154w | demo App.tsx:1566-1577, 679-699 / — |
| Region overlay visuals | 2px solid accent border, 13% tint fill; editing = dashed + 20%; name label 11/800, pad 4 | DIFFERENT | New renders regions through RegionSelectionTool canvases (richer, multi-region). Verify label + dashed-edit visual parity; unify accent on gold | — | demo RegionOverlay.tsx:21-45, styles.ts:840-855 / RegionSelectionTool.jsx:108-109, 861-880 |
| Marker/ink visibility filtering | Markers filtered by survey mode + space pages + region bounds; ink hidden in survey mode | MATCH | Real space/region model covers this; verify hide-canvas-annotations toggle path | — | demo App.tsx:257-270 / SpacesPanel + RegionSelectionTool |
| Select tool tap = no-op | Select does nothing on empty tap | MATCH | — | — | demo App.tsx:1128-1213 / PDFViewer select behavior |

## 2. Bottom action bar / toolbars

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Bottom bar structure | h `52+inset`, surface strip `36+inset` bg `#1E1E1E` border `#3A3A3A`, buttons overhang +4 | MATCH | — | Identical: dock 52px+inset, strip 36px+inset `#1e1e1e` | demo BottomActionBar.tsx:31, styles.ts:924-935 / mobilePdfViewer.css:1272-1341 |
| Left Spaces button | 44px circle `#181A1F`/`#2E333C`, Layers 22px; active = blue tint | MATCH (recolor) | Active state should use gold treatment, not demo blue `#162236/#315F91` | 44px circle both | demo styles.ts:948-961 / MobilePdfViewerChrome.jsx:1154-1188, AppShell.jsx:3332 |
| Center hub pill | minW124 h38 radius 19, current-tab icon 19 + label 12/900 + chevron; open = accent | MATCH (recolor) | Remembers last hub tab — parity; active accent → gold | radius 19 both | demo styles.ts:962-987 / css 1338, AppShell.jsx:909-914 |
| Right survey button | 44px circle, compass SurveyIcon 23; active while surveyMode | MATCH | Toggle collapse via collapseRequestKey — parity | — | demo BottomActionBar.tsx:51-58 / MobilePdfViewerChrome.jsx:1178-1185, AppShell.jsx:916-926 |
| Bar hidden when panel open | Hidden while tray/drawer/sheet/edit panel open | MATCH | — | — | demo App.tsx:1666-1706 / AppShell.jsx:3325-3335, 898-902 |
| Rail: shell | 44w, bg `#20242C`, right border, pt7, gap 5, paddingBottom dock+28 | MATCH | — | Identical incl. bottom padding reserve | demo styles.ts:599-607 / css 224-236, AppShell.jsx:2735-2759 |
| Rail: Pan/Select | 34x34 radius 6, icon 20; active bg `#111820` + accent border/icon | MATCH (recolor) | Active accent blue → gold | — | demo constants.tsx:64-67, styles.ts:608-620 / MobilePdfViewerChrome.jsx:926-927 |
| Rail: category buttons + last-tool memory | Draw/Shapes/Text; press = activate last-used tool of group | MATCH | Same groups, same fallbacks (pen/rect/text) | — | demo App.tsx:1084-1094 / MobilePdfViewerChrome.jsx:9-41, 909-920 |
| Rail: subtool tray | Pill 34w radius 8 `#1A1E25`/`#323844`, 28x28 buttons; draw=pen/hl/eraser, shape=rect/ellipse/line/arrow/counter, text=text/callout | MATCH | Same tool sets; verify pill metrics | radius 8 tray both | demo constants.tsx:116-133, styles.ts:640-662 / MobilePdfViewerChrome.jsx:938-953, css 281-297 |
| Rail: region-edit subtools | Rect/Freehand + mini divider + Add/Subtract | MATCH | 'move' toolType exists internally, not exposed — acceptable | — | demo App.tsx:1401-1456 / MobilePdfViewerChrome.jsx:954-985, RegionSelectionTool.jsx:1810-1836 |
| Rail: survey category glyph chips | 28px circles, 2-letter glyph 10/900, active = solid accent | MATCH (recolor) | Pixel-close copy; active blue `#4a90e2` → gold | — | demo App.tsx:1457-1482, styles.ts:663-697 / MobilePdfViewerChrome.jsx:986-1006, css 299-327 |
| Rail: survey entity swatches | 28x24 buttons, 15px color dot, active border accent | MATCH (recolor) | Entity colors preserved; active border → gold | — | demo App.tsx:1483-1499, styles.ts:698-727 / MobilePdfViewerChrome.jsx:1008-1029, css 329-362 |
| Rail footer: More (⋯) | Inert stub | MATCH (superset) | New: real popover (Export PDF / Save log / Zoom ±) — keep | Popover hardcodes `left:47px` (rail width coupling) | demo App.tsx:1504 / MobilePdfViewerChrome.jsx:1032-1113, css 447-461 |
| Rail footer: sync dot | 12px dot, synced `#2bbd7e` / syncing `#f5a524` / offline `#ef4444`; tap = manual sync | MATCH | New adds disabled `#687180` state + real retry — keep | — | demo constants.tsx:98-102, App.tsx:291-298 / mobilePdfViewerModel.js:3-20, MobilePdfViewerChrome.jsx:1040-1049 |
| Rail footer: version history button | 34x34 clock-arrow SVG | MATCH | Disabled without documentId — sensible addition | — | demo constants.tsx:54-62 / MobilePdfViewerChrome.jsx:1050-1059 |
| Rail footer: presence avatar + `+N` badge | 28px circle `#2A3B54`/blue border, initials 10/900, blue badge | MATCH (recolor) | Badge/border accent → gold review (avatar bg `#2a3b54` retained) | — | demo App.tsx:1524-1538, styles.ts:773-815 / MobilePdfViewerChrome.jsx:1060-1067 |
| Rail divider 26x1 `#4A4F59` | Between primary tools and categories | PARTIAL | Not confirmed in new rail markup — cosmetic check | — | demo styles.ts:621-626 / unverified |

## 3. Hub tray (pages / search / bookmarks)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Sheet chrome | Bottom sheet radius 14 top, bg panel, top border `#444B57`, px16 | MATCH | — | Identical; new animates in 180ms | demo styles.ts:988-1002 / css 1352-1373 |
| Per-mode heights | pages 310 / search 232-292 / bookmarks `min(286, 84+max(n,1)·42)` (+inset) | PARTIAL | New bookmarks adds a 238 floor: `min(286, max(238, 84+42n))` — single-bookmark sheet taller than demo | Bookmarks floor 126→238 | demo App.tsx:230-251 / PDFSidebar.jsx:253-261 |
| Grabber | 34x4 visual only | MATCH (superset) | New handle adds swipe-down >48px dismiss — keep, but see §10 drag-physics row | — | demo styles.ts:1003-1010 / PDFSidebar.jsx:230-239 |
| Tab strip | 3 icon tabs 34px, active bg `#1A3328` icon green `#28A745`; X close 32px `#353A43` | MATCH | Hub identity green preserved (intentional, distinct from accent) | — | demo HubTab.tsx:20-25, styles.ts:1011-1039 / css 1704-1751, PDFSidebar.jsx:423-432 |
| Pages: counter pill | minW58 h30 radius 15 `#171A20`/`#353B46`, `n / N pages` tabular | MATCH | — | — | demo styles.ts:1040-1069 / PagesPanel.jsx:769-777, css 1805-1835 |
| Pages: thumbnail cards | 130x146 radius 8 `#20242B`/`#2F3641`; active blue bg + green edge rail 5w; paper 92x112 white; number badge 22px | MATCH (recolor) | New adds scroll-snap — keep; active-blue `#2f6bb8/#1d2740` → gold per palette (green select edge `#58d976` retained) | Identical card/paper dims | demo PageThumb.tsx, styles.ts:1079-1160 / PagesPanel.jsx:816-848, css 1837-1955 |
| Pages: clipboard badge (copy/cut indicator) | 22px green-bordered Copy icon top-left | PARTIAL | Not confirmed in new mobile cards — verify page-clipboard state is surfaced | — | demo styles.ts:1174-1187 / unverified |
| Pages: long-press drag-reorder (88px steps) | 320ms long-press → horizontal drag with green handle | DIFFERENT | New disables drag (`draggable={!mobileMode}`); replaced by Move up / Move down context-menu items — functional but slower for long reorders | — | demo PageThumb.tsx:44-107 / PagesPanel.jsx:819, 1025-1047 |
| Pages: ⋯ per-thumb menu | Opens page context menu (see §7) | MATCH | Plus mobile-only Move up/down — keep | — | demo PageThumb.tsx:108-119 / PagesPanel.jsx:1025-1047 |
| Pages: action pill Add / Copy Paste / Select | Stubs, no handlers | MATCH (superset) | New has real Add/Paste/Select(Done) + multi-select circles — keep | Pill h42 radius 21 both | demo HubTray.tsx:103-118, styles.ts:1213-1243 / PagesPanel.jsx:609-622, 969-1003, css 1913 |
| Search: input + results | Box h42 radius 7, results rows minH44, `Page N · excerpt`, tap jumps; big green empty states | MATCH (superset) | Real PDF text search supersedes 5 hardcoded matches — keep; verify empty-state type scale (20/800 title) | — | demo HubTray.tsx:122-158, styles.ts:1244-1305 / SearchTextPanel.jsx:1672-1891, css 1757-1803 |
| Bookmarks: mobile row design | minH38 rows, depth·14 indent, grip drag-reorder (38px), icon bubbles, up/down move buttons, markerId→survey jump | PARTIAL | New passes **no mobile props** — desktop markup rendered raw inside the sheet; demo's touch-sized rows, reorder, and marker-jump wiring unported | Row 38px + 22px controls spec unapplied | demo BookmarkRow.tsx, styles.ts:1306-1391 / PDFSidebar.jsx:500-510 |
| Bookmarks: empty state | minH76 icon + "No bookmarks yet" | PARTIAL | Same caveat — desktop markup | — | demo HubTray.tsx:161-189 / PDFSidebar.jsx:500-510 |

## 4. Spaces drawer

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Drawer height formula | `max(238, 106 + 54·spaces + 50·pageRows)` + inset | MATCH | Identical formula, rows reported live | — | demo App.tsx:238-240 / PDFSidebar.jsx:253-261, SpacesPanel.jsx:795-803 |
| Header: title + status subtitle | "Spaces" 16/800 + 'Region active'/'Space active'/'No space active' 11/700 | MATCH | — | — | demo SpacesDrawer.tsx:79-107 / SpacesPanel.jsx:1258-1281, css 1660-1683 |
| Header: + create space / Export menu (CSV, PDF Pages) | 32x32 buttons; export dropdown 116w (demo stub) | PARTIAL | Presence of create/export controls in mobile sheet unverified — mobile pass documented as partial | Menu 116w, rows h30 | demo SpacesDrawer.tsx:79-107, styles.ts:2187-2230 / SpacesPanel mobile pass (partial) |
| SpaceRow card | radius 8 `#1B1F25`/`#343A45` pad 10; grip drag-reorder 58px; count badge; expand chevron; **editable name input**; 40x24 activate toggle; delete X `#F08A8A` | PARTIAL | Desktop SpacesPanel rows inside sheet; touch sizing, drag-reorder step, and 40x24 toggle metrics unverified against demo spec | Toggle 40x24 knob 18; card pad 10 gap 10 | demo SpaceRow.tsx:55-127, styles.ts:2063-2301 / SpacesPanel.jsx (desktop markup) |
| Page-assign row + range parser | Input "Add pages (e.g. 3, 6-9, 12)" + `+` commit + red error text | PARTIAL | Exists in desktop panel; mobile input height (28px) below touch minimum; error styling unverified | Input h28 radius 5 | demo SpacesDrawer.tsx:131-147, pageUtils.ts:26-53 / SpacesPanel (desktop markup) |
| SpacePageRegionRow | minH38 row: page pill (jump), mini 28x16 region toggle, editable region name, region-area edit btn, survey/canvas visibility toggles, remove X | PARTIAL | Row set exists in SpacesPanel; mobile touch metrics + active/editing border states (accent, dashed) need audit; accent → gold | Row minH38; mini toggle 28x16 knob 10 | demo SpacePageRegionRow.tsx, styles.ts:2388-2513 / SpacesPanel (desktop markup) |
| Empty state "No spaces yet" | minH92 centered | PARTIAL | Unverified in mobile sheet | — | demo styles.ts:2553-2567 / unverified |
| Exit Spaces / Regions footer | Full-width h36 radius 7 border `#51404A`, clears space/region state | MATCH | **Safe-area gap**: footer has no bottom-inset padding of its own (relies on sheet height only) — home-indicator overlap risk | h36 vs new 44px row | demo SpacesDrawer.tsx:149-151, styles.ts:2568-2576 / PDFSidebar.jsx:548-560, css 1685-1702 |
| Spaces opens from region tool selection | Selecting region tool auto-opens drawer | PARTIAL | Demo wiring (openSpacesPanel on region tool) unverified in new mobile flow | — | demo App.tsx:381-387, 1063-1072 / unverified |

## 5. Survey mode (setup + active)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Entry (dock survey button → sheet + survey mode) | Opens sheet, sets surveyMode | MATCH | New adds Pro-gate toast — keep | — | demo BottomActionBar.tsx:53-57, App.tsx:389-393 / AppShell.jsx:916-926, PDFViewer.jsx:4658-4668 |
| Sheet heights | 392 w/ template else `154 + 48·templates` | MATCH | Identical formula | — | demo App.tsx:234-237 / SurveySpacesRail.jsx:345-347 |
| Sheet chrome | bg `#24272D`, radius 14, border `#444B57`, handle 42x4 | PARTIAL | Handle 34x4 vs 42x4; otherwise parity | Handle width 42→34 | demo styles.ts:2577-2633 / css 1352-1390 |
| Drag-to-dismiss physics | PanResponder live finger-follow, dismiss dy>82 or vy>0.65, spring-back (damping 24/stiff 260/mass .75) | DIFFERENT | New = touchend delta>48px only; no finger tracking, no velocity, no spring-back, no exit animation — degraded feel | Threshold 82px+velocity → 48px flat | demo SurveySetupSheet.tsx:51-96 / SurveySpacesRail.jsx:349-360, css 1373 |
| Eyebrow + template-name dropdown | "SURVEY TEMPLATE" 11/700 + title 17/900 + menu 236w `#181B20`/`#3C424D` | MATCH | Menu `min(286px,100vw-82px)` vs 236w — minor | Menu 236→~286 | demo SurveySetupSheet.tsx:120-147 / SurveySpacesRail.jsx:843-875, css 1506-1565 |
| Round close (collapse-only) | 34x34 `#353A43` circle; hides sheet, doesn't exit survey | MATCH | 32px vs 34px | 34→32 | demo SurveySetupSheet.tsx:149-151 / SurveySpacesRail.jsx:918-925, css 1588-1600 |
| Template picker rows | minH42, 26px blue doc tile, name 13/800, "N modules" meta, chevron | PARTIAL | Rows 58px vs 42; **hover-only** affordance (onMouseEnter) — dead on touch, needs pressed states | Row 42→58 | demo SurveySetupSheet.tsx:249-276, styles.ts:2687-2730 / SurveySpacesRail.jsx:2975-3029 |
| Module navigator | 30px round prev/next arrows + h32 radius-16 center pill dropdown, neutral border `#343A45` | PARTIAL | Gold border pill is palette-correct (target gold), but radius forced to 15 by css vs 16, and arrows hover-styled; verify disabled opacity .45 | Pill radius 16→15 | demo SurveySetupSheet.tsx:155-183, styles.ts:2782-2823 / SurveySpacesRail.jsx:947-1108, css 1602-1610 |
| Category heading + hint | "SELECT CATEGORY TO HIGHLIGHT" + "Tap category to place marker" | MATCH | Heading text wording check ("highlight" vs Survey Marker vocabulary) | — | demo SurveySetupSheet.tsx:189-192 / SurveySpacesRail.jsx:1623-1632, css 1616-1633 |
| Category cards | radius 8 `#1B1F25`/`#343A45`; rows minH38; count tabular; 36x38 expand chevron | DIFFERENT | New reuses desktop card: radius 5, 1px `#2a3140`, padding 2/5, **24px min-height buttons**, 24x24 drag handle, 14px chevron — geometry regression; gold active state is palette-correct, keep gold | Row 38→24; radius 8→5; chevron 36x38→14px | demo styles.ts:3102-3147 / SurveySpacesRail.jsx:1699-1802, styles.css:1049-1102 |
| Tap category → place mode + sheet closes | Select + close + tool `survey` | MATCH | — | — | demo App.tsx:1021-1024 / SurveySpacesRail.jsx:1741-1745 |
| Category expand → marker item rows | 30px rows, 10px entity dot, tap opens marker; empty copy | PARTIAL | New rows are richer (rename/entity/notes/locate/checklist inline) but desktop-scaled; empty-state copy unverified | Row 30px spec vs desktop-sized | demo SurveySetupSheet.tsx:221-243, styles.ts:3148-3182 / SurveySpacesRail.jsx:1806-2560 |
| Placement → auto-open marker detail sheet | Pin drop immediately opens SurveySheet | MISSING | New shows **desktop 500px centered blur modals** (entity picker / name prompt / "Categorize highlight", z10001-10003); mobile sheet stays collapsed. #1 ranked UX gap | 500px modal vs bottom sheet | demo App.tsx:1155 / PDFViewer.jsx:31320-31810 |
| Marker detail sheet (SurveySheet) | 314px + checklist window sheet: category dropdown, entity swatch, inline rename, sibling-marker nav dropdown, locate, notes pen, checklist | MISSING | No mobile marker-detail sheet exists; equivalents scattered in expanded rail rows with 24px controls | Sheet 314+ (36px rows ×≤4, gap 5) | demo SurveySheet.tsx:285-568, pageUtils.ts:1-12 / SurveySpacesRail.jsx:1806-2560 (substitute) |
| Marker-row controls (rename/entity/sibling/locate/notes) | 30px controls inside input row | PARTIAL | Present in rail rows but desktop-scaled; sibling-marker jump dropdown parity unverified | 30px controls spec | demo SurveySheet.tsx:428-513, styles.ts:2877-2991 / SurveySpacesRail.jsx:1966-2280 |
| Checklist Y / N / N-A | minW28 h24 buttons; Y `#2F7D55` N `#8C3A42` NA `#5E6570`; "Court: {entity}" caption; fixed 4-row scroll window | PARTIAL | Present in expanded rail rows but cramped inside 392px sheet; fixed-window scroll behavior + caption unverified | 36px rows/gap 5 window spec | demo SurveySheet.tsx:516-561, styles.ts:3314-3401 / SurveySpacesRail.jsx:2471-2560 |
| Notes editor (full-sheet, photo/video pickers) | In-sheet takeover: multiline input minH88, Photo/Video multi-select, attachment rows, Cancel/Save | DIFFERENT | New = **600px desktop modal** (text/photos/videos); not mobile-adapted | Full-sheet vs 600px modal | demo SurveySheet.tsx:191-283, styles.ts:3183-3313 / PDFViewer.jsx:32328-32377 |
| Export menu (Export Excel / Sync M365) | 34px header button + 218w menu, rows minH48 | MISSING | Export UI gated `!mobileMode`; `.mobile-survey-sheet-export` CSS is dead (no JSX) — unfinished port | Menu 218w rows 48 | demo SurveySheet.tsx:324-348, styles.ts:2731-2775 / SurveySpacesRail.jsx:3088, css 1573-1586 |
| Module navigator re-assigns marker module (per-module category memory) | SurveySheet arrows re-home the marker | MISSING | No marker-detail sheet → no mobile surface for this | — | demo SurveySheet.tsx:77-90 / — |
| Keep-active-off → revert to pan | After drop, tool reverts to pan | DIFFERENT | New clears category/entity but leaves `survey-marker` armed; next tap raises Categorize modal | — | demo App.tsx:1156-1161 / PDFViewer.jsx:25325-25345 |
| "Keep active" checkbox + module picker strip | Custom pill checkbox + custom dropdown minW138 | MATCH | Module control is a native OS `<select>` vs styled dropdown — visual drift | Checkbox pill h30 spec | demo AnnotationFormattingBar.tsx:224-255, styles.ts:201-237 / MobilePdfViewerChrome.jsx:320-352, css 533-586 |
| Tap placed marker → open its sheet | Opens SurveySheet for that marker | DIFFERENT (broken-ish) | Expands rail row + `setShowSurveyPanel(true)`, but mobile collapse state is separate; expand effect fires only on showSurveyPanel *transition* — sheet can stay hidden | — | demo App.tsx:1621-1624 / PDFViewer.jsx:24359-24398, SurveySpacesRail.jsx:398-408 |
| Full Page region confirm | Inline toolbar confirm step ("Make region full page?" + Confirm/Cancel) | DIFFERENT | New uses `window.confirm()` browser dialog | Inline strip state vs native dialog | demo App.tsx:652-677, 1644-1658 / RegionSelectionTool.jsx:1801 |
| Exit Survey footer | Full-width h32 red `#F08A8A` on `#1B1F25`/`#51404A` | MATCH | 44px row vs 32; **no bottom-inset padding** (see §10 safe-area row) | h32→44 | demo SurveySetupSheet.tsx:278-282, styles.ts:2607-2625 / SurveySpacesRail.jsx:3560-3564, css 1641-1658 |
| Vocabulary | "Survey Marker" everywhere | DIFFERENT | New modal says "Categorize highlight" — violates product vocabulary rule | — | demo throughout / PDFViewer.jsx:31394 |
| Desktop admin leftovers in sheet | N/A in demo | DIFFERENT | Category drag-reorder handles, select/copy-mode toolbars, archived-checklist admin crowd the 392px sheet; only create/select strip is hidden (`display:none`) | — | — / SurveySpacesRail.jsx:1152-1618, 2747-2760, css 1612-1614 |

## 6. Annotation formatting (bar + edit panel)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Formatting strip shell | h36 at (railWidth, topBarHeight), bg `#202126`, border `#090A0D`, centered gap 8 | MATCH | New is horizontally scrollable — good touch adaptation | Identical 36px/left 44 | demo styles.ts:178-200 / MobilePdfViewerChrome.jsx:281-851, css 504-527 |
| Visibility rules | Tool active OR survey toolbar OR region edit; hidden otherwise | MATCH | Hidden for pan + selection-less select — parity | — | demo App.tsx:253-256 / MobilePdfViewerChrome.jsx:413, PDFViewer.jsx:21488-21509 |
| Region strip: Confirm / Full Page / Cancel | h30 radius 7 buttons, primary solid accent | MATCH (recolor) | Primary blue → gold; inline full-page confirm state missing (see §5) | h30 radius 7 spec | demo AnnotationFormattingBar.tsx:195-223 / MobilePdfViewerChrome.jsx:309-318 |
| Eraser: mode + size | Partial/Full Stroke dropdown minW104 + size input (default 16) | MATCH | Native select vs styled dropdown | — | demo AFB:257-272 / MobilePdfViewerChrome.jsx:445-519 |
| Stroke color swatch (pen/hl/arrow/line) | Swatch opens **edit panel focused on stroke** (gradient picker) | DIFFERENT | New = native `<input type=color>` — OS picker; no presets, no opacity, violates one-shared-color-picker rule | — | demo AFB:274-397 / MobilePdfViewerChrome.jsx:458-506 |
| Fill+border swatch (rect/ellipse/text/callout) | 24x24 round swatch, 2px stroke ring, checkerboard under fill → panel | PARTIAL | New dual fill/stroke popover exists; checkerboard/ring rendering + preset row unverified | 24x24 swatch spec | demo FormatPrimitives.tsx:9-38, styles.ts:302-333 / MobilePdfViewerChrome.jsx:458-506 |
| Counter swatch + series menu | Fill circle + "1" digit; menu: "+ New Count", series rows (dot/label/count), color cycling | MATCH | "Pin fill/Pin number" labels preserved; series behavior wired | Menu minW160 spec vs css 827-872 | demo AFB:293-336, styles.ts:446-510 / MobilePdfViewerChrome.jsx:520-549 |
| Width input | 36x24 bg `#444` text `#DDD` 12/700 tabular, digits-only w/ fallback restore | MATCH | Fallback-restore-on-blank behavior unverified | — | demo styles.ts:341-353, FormatPrimitives.tsx:40-88 / MobilePdfViewerChrome.jsx:508-519 |
| Line style (Solid/Dashed/Dotted/+Cloud rect) | Dropdown minW82 | MATCH | Native select | — | demo AFB:349-362 / MobilePdfViewerChrome.jsx:563-574 |
| Cloud Bump input | Label 11/700 + input (default 2) | MATCH | Range clamped 1-20 in new | — | demo AFB:363-368, styles.ts:531-540 / MobilePdfViewerChrome.jsx:575-588 |
| Arrowhead dropdown (6 styles) | None/Solid Tri/V/Open Circle/Open Tri/H-Line, minW124 | MATCH | Native select w/ same label set | — | demo types.ts:111-118 / MobilePdfViewerChrome.jsx:53-60, 589-599 |
| `Aa` button | 34x24 → opens edit panel focus 'text' | MATCH | New enters live text edit when possible, else opens defaults sheet — superset | — | demo AFB:383-396, styles.ts:516-530 / MobilePdfViewerChrome.jsx:600-616 |
| Rich-text live editing strip | N/A (demo had no live editor) | NEW-ONLY | Font color, family (6 single-name fonts), size, B/I/U/S, alignment — preserve; pointerdown preventDefault keeps focus | — | — / MobilePdfViewerChrome.jsx:354-411 |
| Edit panel: text/callout | Full bottom sheet: Shape/Text tabs, color card + presets, B/I/U/S + size split card, alignment grids, arrowhead | PARTIAL | Text-defaults sheet covers most; heights 432/368/448px are new-derived (demo self-sized from card composition); active-letter tint is gold — palette-correct, keep | Segmented pill 224x34 radius 17 both | demo AnnotationEditPanel.tsx:66-115, 546-828 / MobilePdfViewerChrome.jsx:618-848, css 877-1270 |
| Edit panel: pen/shape/counter/eraser tools | Same full sheet for every tool (color card, split stroke card, arrowhead) | MISSING | No edit sheet for non-text tools — strip + native color input only | — | demo AnnotationEditPanel.tsx (all tools) / — |
| Gradient/HSV color picker | In-panel takeover: SB square h176, hue track, opacity slider, hex input 18/900, Done | MISSING | Replaced by native OS `<input type=color>`; no hex entry, no opacity | — | demo AEP:314-461, styles.ts:1631-1783 / — |
| Opacity controls | Opacity slider + % input in picker | MISSING | CSS exists (`.mobile-pdf-properties__opacity` 733-765) but **no JSX renders it** — unfinished | — | demo AEP opacity row / css 733-765 (dead) |
| Preset color row | Single row of 9 choices, 30px cells, 20px dots | PARTIAL | `MOBILE_ANNOTATION_COLORS` (same 9 hexes) rendered in text-defaults sheet only, not for shapes/pen | 30px cell / 20px dot spec | demo constants.tsx:163-167, AEP:463-537 / MobilePdfViewerChrome.jsx:62-72 |
| Panel drag-to-dismiss + spring | dy>82 / vy>0.65, spring-back | DIFFERENT | Text-defaults sheet has no drag physics (portal sheet, tap-out close) | — | demo AEP:141-199 / css 877-901 |
| Two-way live sync panel↔bar | Panel writes through config setters | MATCH | Patch-merge via `onTextStyleDefaultsChange` | — | demo AEP:all / MobilePdfViewerChrome.jsx:435 |
| Mobile creation uses text defaults | N/A | NEW-ONLY | textStyleDefaults feed text/callout creation — preserve | — | — / PDFViewer.jsx:10251-10260, 29415; FabricEditCanvas.jsx:1086 |

## 7. Context menu

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Menu chrome | 154w (var), radius 9, `#181B20`/`#3C424D`, pad 6, title row + divider, actions h34 13/800, destructive `#F08A8A` | PARTIAL | New page menu exists (desktop styling); demo mobile chrome spec (34px rows, near-invisible scrim) not audited | 154/176/188w variants | demo FloatingContextMenu.tsx, styles.ts:856-902 / PagesPanel.jsx:1025-1047 |
| Page menu (Cut/Copy/Paste/Duplicate/Rotate/Mirror H/V/Reset/Delete) | 188w; Paste disabled w/o clipboard; Delete disabled if last page | PARTIAL | New menu exists + adds Move up/down; full demo action list + disable logic unverified on mobile | 188w | demo App.tsx:817-838, 701-815 / PagesPanel.jsx:1025-1047 |
| Annotation menu (Cut/Copy/Paste/Delete + 4 z-order actions) | 176w, long-press 320ms on annotation | MISSING | No mobile long-press annotation menu | 176w | demo App.tsx:866-895 / — |
| Canvas paste menu | 154w, long-press 360ms, paste at tap point | MISSING | — | 154w | demo App.tsx:897-915 / — |
| Region menu (Delete) | 154w, long-press 420ms | MISSING | Region delete only via Spaces panel | 154w | demo App.tsx:679-699 / — |
| Dismiss layer | `rgba(0,0,0,0.01)` full-screen, zIndex 84 — no dim | PARTIAL | New menus use outside-pointerdown; sheet backdrops exist — confirm backdrops stay near-invisible (demo never dims) | — | demo styles.ts:2591-2598 / MobilePdfViewerChrome.jsx:170-177, css 1343-1350 |

## 8. Collaboration (active users, version history)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Active users sheet | Drawer h276: 34px avatars (owner green, others blue), name 13/900, `role - status`, green presence dot | MATCH | Real presence w/ dedup + self-first supersedes stub; owner-green vs member-blue distinction unverified | 276px both | demo ActiveUsersDrawer.tsx, styles.ts:2026-2062 / MobilePdfViewerChrome.jsx:1115-1148, mobilePdfViewerModel.js:23-69, css 1411-1471 |
| Version history sheet | Drawer h264: rows minH50 radius 8, 9px green dot, title 13/900 | PARTIAL | New embeds desktop RevisionsPanel + floating × — real data (superset) but row styling is desktop, not demo's mobile rows | 264px height matches | demo VersionHistoryDrawer.tsx, styles.ts:1994-2025 / PDFSidebar.jsx:323-332, css 1957-1971 |
| Sync status model | synced/syncing/offline, manual sync w/ 1200ms syncing pulse | MATCH (superset) | Real queue/retry + disabled state — keep | — | demo constants.tsx:98-102, App.tsx:291-298 / mobilePdfViewerModel.js:3-20 |
| Collaboration footer chip | N/A (demo used rail footer) | MATCH | Desktop footer correctly suppressed in mobileMode, replaced by rail footer items | — | demo §2 rail footer / PDFSidebar.jsx:688 |

## 9. Global chrome (top bar, navigation, home)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Top bar shell | h `insets.top+34`, bg `#1E1E1E`, 1px `#3A3A3A` bottom border | MATCH | Flat 34px under expo shell — correct | Identical | demo styles.ts:10-39 / MobilePdfViewerChrome.jsx:166-279, css 23-41 |
| Back button | 30x30 chevron 22px (inert stub) | MATCH (superset) | Real navigation | Icon 22→21px | demo App.tsx:1292-1294 / MobilePdfViewerChrome.jsx:166-184 |
| Title pill | h25 maxW136 radius 5 `#2A2B31`, 13/700; tap opens page control; **marquee reveal** for >18-char titles (900ms/-52px) | PARTIAL | Marquee reveal missing — long titles just ellipsize | maxW136 both | demo App.tsx:441-460, 1295-1319, styles.ts:52-67 / MobilePdfViewerChrome.jsx:185-194 |
| Page nav pill | 68x24 pill `n / N` tabular + chevron; **tap → inline number input in place**; active border accent | DIFFERENT | New opens a combined page/zoom menu (prev/next + input + fit modes) instead of inline-in-pill input; prev/next buttons are a superset. Decide: inline input parity vs menu | Pill 68x24 spec; menu 138w matches demo dropdown | demo App.tsx:1215-1239, 462-475, styles.ts:107-146 / MobilePdfViewerChrome.jsx:197-254, css 148-163 |
| Zoom-fit dropdown | 138w, items h30, active accent + check; anim 150ms in/130ms out (fade+translate+scale) | PARTIAL | Fit Height missing; open/close animation unverified; active accent → gold | 138w matches | demo constants.tsx:92-96, App.tsx:410-428, styles.ts:147-177 / viewerShared.js:1586, MobilePdfViewerChrome.jsx:197-254 |
| Undo/Redo | 26x26 radius 5, icons 17; disabled opacity .56 | MATCH (superset) | Region-history-aware swap during region edit — keep | — | demo App.tsx:1324-1343, styles.ts:86-106 / MobilePdfViewerChrome.jsx:257-276, PDFViewer.jsx:11112-11121 |
| Panel mutual exclusivity | Each open closes all others + dismisses keyboard/popover | MATCH | Doc panel ↔ survey ↔ users exclusivity + reset on viewer hide — parity | — | demo App.tsx:322-439 / AppShell.jsx:904-939 |
| Panel open/close motion | LayoutAnimation 170ms easeInEaseOut (drawers); sheets slide 210/170ms | PARTIAL | New: single 180ms slide-in, **no exit animation** (display:none collapse) — global feel gap | 210/170ms → 180ms/none | demo App.tsx:300-307, §17 / css 1973-1976, 1373 |
| z-index layering | Documented ladder topBar 90 … contextMenu 85 | MATCH | New ladder coherent (5400-7300); no conflicts noted | — | demo §0 / §2 z-index ladder |
| Home hub (documents/projects/templates, tab bar, rail nav, profile) | N/A — demo is single-document shell | NEW-ONLY | Entire home hub is new — protect in parity pass (see final section) | — | — / HubShell.jsx, hub.css |
| Mobile activation model | N/A (native app) | NEW-ONLY | Width-only chrome switch vs width-or-coarse PDF surface switch — intentional, document | — | — / AppShell.jsx:331-346, PdfjsViewerContainer.jsx:86-88 |

## 10. Cross-cutting (safe areas, theming, typography)

| Feature/Surface | Demo behavior | Status | What's wrong or missing | Layout deltas | Evidence |
|---|---|---|---|---|---|
| Bottom safe-area propagation | `bottomInset = max(insets.bottom,10)` added to every sheet/drawer + panel-height math | PARTIAL | Central `--mobile-bottom-inset` token exists and covers most surfaces, **but**: exit footers (survey + spaces) have no own inset padding; pages actions/counter rely on sheet budget only | — | demo App.tsx:111-119, pageUtils.ts:14-16 / css 2-3, 1641-1658, 1685-1702 |
| Top safe-area | `insets.top` → top bar paddingTop | PARTIAL | Viewer header uses raw `env()` not the `var(--native-safe-area-top,...)` chain (inconsistent); **hub fixed header 140px has no top safe-area term** — notch overlap risk in web/PWA | — | demo App.tsx:1290 / css 24-25, hub.css:269-325 |
| Landscape left/right insets | N/A (demo portrait) | MISSING | No `safe-area-inset-left/right` usage anywhere | — | — / §3 grep |
| Accent color | Demo blue `#4A90E2` app-wide | DIFFERENT (deliberate direction) | **Target = gold `#d8a84e`.** Mobile viewer chrome hardcodes blue at ~25 sites (rail actives, keep-active, page-select tints, menus); sheet internals already gold → unify everything on gold, remove the blue/gold split inside single flows (survey worst case) | — | demo constants.tsx:11-27 / css ~25 blue sites (181,264,325,556,818,869,1104,...), styles.css:1057-1060 |
| Theme tokens | N/A (RN constants) | DIFFERENT | **Zero `var(--...)` usage in src/mobile/** — every color hardcoded; hub mobile CSS uses tokens properly. Tokenize viewer chrome against App.css palette | — | — / §2 tokens note, App.css:32 |
| Stray palette leftovers | — | DIFFERENT | Gold-bone text hexes `#e8e2d4`/`#f1ede4` inside dark viewer chrome (203,421,470); header text `#17120a` — audit | — | — / css 203, 421, 470 |
| Status/semantic colors | sync `#2bbd7e/#f5a524/#ef4444`; checklist `#2F7D55/#8C3A42/#5E6570`; destructive `#F08A8A`; hub green `#28A745/#1A3328`; presence `#58D976` | MATCH | All carried over — keep as-is (semantic, not accent) | — | demo constants.tsx:98-102, §16 / mobilePdfViewerModel.js:3-7, css 1731-1937 |
| Typography | System font, weights 700-900, tabular-nums on all numerals, UPPERCASE 10-11/800 field labels | MATCH | New SF Pro stack + 650-900 weights; tabular-nums present at key sites — spot-check numerals coverage | — | demo §16 / css 33, 137, 1827, 1834 |
| Radii scale | Sheets 14 / cards 8 / menus 8-9 / inputs 5-7 / pills full-round | MATCH | Close (new cards sometimes 7, survey cards 5 — see §5 row) | Survey card 8→5 | demo §16 / §2 radii |
| Shadows | **None anywhere** — borders + fills only | PARTIAL | New has a swatch shadow + page box-shadow — audit against no-shadow rule (page shadow may be intentional for real PDF) | — | demo §16 / css 413, PdfjsViewerContainer.jsx:1565 |
| Sheet motion system | 210ms out-cubic in / 170ms in-cubic out / finger-follow drag / spring-back | DIFFERENT | Global: 180ms in only, no exit anim, flat 48px thresholds — single biggest "feel" delta across every sheet | — | demo §17 / css 1973-1976, SurveySpacesRail.jsx:349-360, PDFSidebar.jsx:230-239 |
| Drag-reorder steppers | pages 88 / spaces 58 / regions 48 / bookmarks 38px steps | MISSING | No mobile drag-reorder anywhere (pages → menu items; spaces/bookmarks desktop markup) | — | demo §17 / PagesPanel.jsx:819 |
| Toggle switch metrics | 40x24 (space) / 34x21 (region) / 28x16 (mini); track `#3A3F49`→active | PARTIAL | Active track `#28598D` is demo-blue — recolor to gold family; mobile metrics unverified in SpacesPanel | — | demo styles.ts:2104-2123, 2429-2450 / SpacesPanel (unverified) |
| Sheet max-height ceiling | `maxBottomPanelHeight = min(473+inset, screenH - topBar - 18)` | MATCH | New `calc(100dvh - var(--app-chrome-top,34px) - 18px)` — same intent, live-updated | — | demo App.tsx:230-251 / css 884, 1360, AppShell.jsx:952-1003 |
| Shared color picker rule | N/A | DIFFERENT | Native `<input type=color>` on mobile violates the app-wide CompactColorPicker rule (memory: one shared picker) | — | — / §4 "not surfaced" note |

---

## NEW-APP-ONLY FEATURES — DO NOT DESTROY IN THE PARITY PASS

These have no demo equivalent. The parity pass must treat them as protected functionality; demo parity applies to layout/spacing/feel, not to removing capability.

**Rendering & input**
- Real pdf.js rendering: 8MP mobile canvas budget, raster-cache bypass, 1-page overscan, live matchMedia re-eval (PdfjsViewerContainer.jsx:83-116, 225-272, 552-555, 735).
- Full touch contract: one-finger tool / two-finger pinch-zoom+pan, Safari native-zoom/loupe suppression, `data-mobile-touch-mode` stamping (PdfjsViewerContainer.jsx:1096-1154).
- Real annotation engine: pen/highlighter/eraser strokes, shapes, counter series (new/continue), callouts, live rich-text editor with font family/size/color/alignment (MobilePdfViewerChrome.jsx:354-411, 520-549).
- Region system: real multi-region geometry, freehand shapes, add/subtract ops, region-aware undo/redo history swap (RegionSelectionTool.jsx:1810-1836; PDFViewer.jsx:11112-11121).

**Viewer chrome**
- More popover: Export annotated PDF, Save log (Capacitor, `save-log-banner-start` + `__consoleLogBuffer`), Zoom in/out steps (MobilePdfViewerChrome.jsx:1032-1113).
- Page prev/next buttons in the page menu; region-history-aware undo/redo (MobilePdfViewerChrome.jsx:197-276).
- Pages panel: multi-select mode, real Add/Paste/Select(Done) operations, Move up/down menu items, scroll-snap track (PagesPanel.jsx:609-622, 969-1047).
- Real full-text PDF search (SearchTextPanel.jsx:1672-1891).
- Save-log tile in hub tabs on Capacitor native (PDFSidebar.jsx:248-252, 594-598).

**Survey & data**
- Inline marker richness in rail rows: rename, entity dropdown, notes, locate, per-item checklist, archived-checklist admin, auto-"Complete" entity (SurveySpacesRail.jsx:1806-2560) — re-house in mobile-scaled UI, don't delete.
- Pro-gating toast on survey entry (PDFViewer.jsx:4658-4668).
- Real cloud sync (queue size, retry, disabled state), real presence (dedup by user_id, self-first), real version history data (mobilePdfViewerModel.js:3-69; RevisionsPanel).
- Entity color resolution during marker placement (PDFViewer.jsx:25233-25347).

**Home hub (entire surface is new)**
- Documents ledger: summary header, select mode, sort/filter menu, card list, detail bottom-sheet with live PDF preview (DocumentsLedger.jsx:255-626+).
- Projects: drill navigation, search + New Project, select rows, folder/grid/tile variants, team board (ProjectsFolderTree.jsx:185-743; hub.css:1027-1757).
- Templates editor: browser rows, detail editor, module tabs, category/item editing, entity modal, color panel, pinned save row, `?mobileState=detail` deep link (TemplatesEditor.jsx:1537-2445+).
- Bottom tab bar vs rail-nav dual nav modes, profile menu with sign-out confirm (HubShell.jsx:127-354).

**Platform plumbing**
- `?mobileNav=rail|tabs`, `?nativeShell=expo`, Capacitor detection (HubShell.jsx:127-137).
- Expo shell safe-area var injection contract (`--native-safe-area-*`, `html[data-native-shell="expo"]`) with web `env()` fallback chain (§3).
- `--app-chrome-top` rAF/MutationObserver ceiling system; `--app-sidebar-width`; overlay model keeping hub mounted under viewer (AppShell.jsx:946-1003; hub.css:250-267).
- Identity-churn-suppressing API publish (AppShell/PDFViewer rail API setState guards, PDFViewer.jsx:27236-27251).
- Dual activation: width-only chrome (`isNarrowShell`) vs width-or-coarse PDF surface (`isMobilePdfSurfaceViewport`) — a touch laptop intentionally gets mobile PDF surface with desktop chrome.

**Known dead/unfinished stubs to finish rather than delete**
- `.mobile-pdf-properties__opacity` CSS (opacity control, no JSX) — css 733-765.
- `.mobile-survey-sheet-export` CSS (mobile export menu, no JSX) — css 1573-1586.