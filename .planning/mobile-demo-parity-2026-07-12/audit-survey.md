# SURVEY MODE — Old Demo (mobile-expo-go) vs New Mobile App — Deep Comparison

## A. Demo survey-mode UX (reference behavior)

**Entry**: bottom bar survey icon (`mobile-expo-go/src/components/BottomActionBar.tsx:53-57`) → `openSelectedSurveyPanel()` clears selected marker, sets surveyMode, opens sheet (`mobile-expo-go/App.tsx:389-393`). Two sheets: `SurveySetupSheet` when no marker selected (`App.tsx:1793-1810`), `SurveySheet` (marker detail) when one is (`App.tsx:1764-1791`).

**Sheet geometry/motion**: height 392px w/ template else 154+48·nTemplates (`App.tsx:234-237`); bg `#24272D`, top radius 14, top border `#444B57`, padding 16 (`src/styles.ts:2577-2590`); handle 42×4 (`styles.ts:2626-2633`); slide-in 210ms cubic-out, slide-out 170ms cubic-in, PanResponder drag with **live finger-follow + spring-back**, dismiss at dy>82 or vy>0.65 (`SurveySetupSheet.tsx:51-96`, same in `SurveySheet.tsx:120-164`).

**Setup sheet**: eyebrow "SURVEY TEMPLATE" + template-name dropdown (menu 236px, `#181B20`/`#3C424D`) (`SurveySetupSheet.tsx:120-147`, `styles.ts:2674-2686`); 34px round close (`styles.ts:2731-2740`); module navigator = 30px round prev/next arrows + 32px pill-radius-16 center dropdown (`SurveySetupSheet.tsx:155-183`, `styles.ts:2782-2823`); no-template state = "Available Templates" rows 42px, FileText icon in 26px blue box, "N modules" meta (`SurveySetupSheet.tsx:249-276`, `styles.ts:2687-2730`); category cards radius 8 `#1B1F25`/`#343A45`, **active = blue** `#142236`+`#2B6FB6`, name→blue, 38px row height, count tabular-nums, 36×38 expand chevron, expanded marker rows (30px, 10px entity dot) tap→opens marker sheet (`SurveySetupSheet.tsx:194-247`, `styles.ts:3102-3182`); tap category name → select+close sheet+tool `survey` (`App.tsx:1011-1024`); footer full-width "Exit Survey" 32px red `#F08A8A` on `#1B1F25`/`#51404A` (`SurveySetupSheet.tsx:278-282`, `styles.ts:2607-2625`).

**Placement**: single **tap** places a **26px numbered round pin** (entity color fill, default `colors.yellow #D8A84E`, 2px ink border / blue when selected, marker id inside) at the tap point, auto-name, undo entry, **immediately opens the marker SurveySheet**; if "Keep active" off → tool reverts to **pan** (`App.tsx:1132-1162`, marker render `App.tsx:1602-1629`, `styles.ts:903-923`).

**Marker detail sheet (SurveySheet)** — fixed 314px + checklist window (36px rows ×≤4, gap 5) (`src/utils/pageUtils.ts:1-12`, `App.tsx:230-234`):
- header adds **export button** (34px circle) w/ menu 218px: "Export Excel" / "Sync Microsoft 365" (`SurveySheet.tsx:324-348`, `styles.ts:2745-2775`)
- module navigator **re-assigns marker's module** w/ per-module last-category memory (`SurveySheet.tsx:77-90`)
- "Category" compact dropdown (options show checklist-count meta) (`SurveySheet.tsx:396-425`)
- "Category Item" row: entity swatch button→entity menu (`428-440,500-513`), inline rename TextInput w/ fallback name on blur (`443-458`), sibling-marker dropdown (`459-491`), locate button (Search, blue) (`493-495`), notes pen (blue if notes) (`496-498`)
- **full-sheet notes editor**: multiline input, Photo/Video pickers (expo-image-picker multi-select), attachment rows w/ remove, Cancel/Save footer (`SurveySheet.tsx:191-283`)
- **checklist**: label + "Court: {entityName}", rows w/ Y / N / N-A segmented buttons (min 28×24; active Y `#2F7D55`, N `#8C3A42`, NA `#5E6570`, white 9px/900 text) (`SurveySheet.tsx:516-556`, `styles.ts:3371-3401`); empty "Choose category first" (`557-561`)

**Left-rail while placing**: vertical category-glyph toolbar (34px wide, 28px circles, 2-letter glyph, active=solid blue) + entity swatch toolbar (28×24, 15px dot, active border blue) (`App.tsx:1457-1499`, `styles.ts:663-727`, glyph util `src/utils/surveyUtils.ts:3-10`).

**Top format bar while placing**: custom module dropdown pill + "Keep active" checkbox (`src/components/format/AnnotationFormattingBar.tsx:224-255`).

**Regions**: overlay = pressable rect, 2px solid blue, 13% blue fill; editing = dashed + 20%; name label 11px/800 blue; tap activates/edits, long-press 420ms context menu (`src/components/RegionOverlay.tsx:21-45`, `styles.ts:840-855`, wiring `App.tsx:1566-1578`). Edit subtools on left rail: rectangular/freehand + add/subtract (blue active) (`App.tsx:1401-1455`); Full Page w/ inline confirm flow (`App.tsx:652-677,1644-1658`); regions managed in SpacesDrawer rows (rename, "Page N · Survey-bound" meta, locate/edit/toggle, drag reorder, move/delete) (`src/components/spaces/RegionRow.tsx:62-100`), "Exit Spaces / Regions" footer (`SpacesDrawer.tsx:149-151`).

## B. New app mobile survey implementation

**Entry**: dock survey button (`src/mobile/MobilePdfViewerChrome.jsx:1178-1185`) → `openMobileSurveyPanel` (`src/AppShell.jsx:916-926`) → expands `SurveySpacesRail` rendered as bottom sheet with `mobileMode` (`AppShell.jsx:2896-2905`); auto-enters survey mode via `handleSurveyToggle` (Pro-gated toast) (`src/PDFViewer.jsx:4658-4668`). Sheet = whole desktop right rail restyled: `.mobile-pdf-sheet` fixed bottom, height `392px+inset` or `154+48n` (`src/SurveySpacesRail.jsx:345-347`), bg `#24272d`, radius 14, top border `#444b57`, slide-in 180ms, collapse = `display:none` (`src/mobile/mobilePdfViewer.css:1352-1373`). Handle 34×4; swipe-dismiss = touchstart/touchend delta>48px only, no finger-follow (`SurveySpacesRail.jsx:349-360`, css `1375-1397`).

**Template picker**: header "Choose survey template" + eyebrow + 32px round close (`SurveySpacesRail.jsx:2912-2948`, css `1588-1600`); rows min 58px, icon, name + "N modules" (`2975-3029`). **Template selected**: template dropdown button 15px/900 + menu `min(286px,100vw-82px)` (`844-875`, css `1506-1565`); module navigator 30px arrows + gold-bordered `#d8a84e` center pill (radius forced 15px by css `1606-1610`) (`947-1108`); categories heading + "Tap category to place marker" (`1623-1632`, css `1616-1633`); category cards = desktop `.survey-marker-category-card` — 1px `#2a3140`, radius 5, padding 2/5, **active = gold** `#d8a84e` + 3.5% gold tint, buttons min-height **24px**, leading 24×24 drag-handle, 14px expand chevron (`SurveySpacesRail.jsx:1699-1802`, `src/styles.css:1049-1102`); tap category → select + collapse sheet + tool `survey-marker` (`1741-1745`). Expanded marker rows carry rename input, entity indicator/dropdown, notes pen (gold), locate, per-item checklist Y/N/N-A, archived-checklist section, auto-"Complete" entity (`1806-2560`; checklist `2471-2560`). Exit footer 44px red "Exit Survey" (`3560-3564`, css `1641-1658`).

**Left rail strips**: category glyphs + entity swatches, metrics/colors copied from demo, active blue `#4a90e2` (`MobilePdfViewerChrome.jsx:986-1029`, css `299-362`). **Top properties strip**: native `<select>` module + "Keep active" check-button (`MobilePdfViewerChrome.jsx:320-352`, css `533-586`). **Region editing**: rail subtools rect/freehand/add/subtract (`954-985`) + Confirm / Full Page / Cancel strip (`309-318`), backed by `RegionSelectionTool` mobile API (`src/RegionSelectionTool.jsx:1811-1836`; desktop toolbar hidden `2547`; publishes via `PDFViewer.jsx:27923-27942`).

**Placement**: `survey-marker` = **drag-drawn rectangle** through FabricDrawingCanvas, rendered by SVGAnnotationLayer as a translucent color highlight (`PDFViewer.jsx:17776-17784`, preview `25111`, entity color+opacity `25236-25240`); post-placement flow = **desktop 500px centered modals** (blur backdrop, zIndex 10001-10003): entity picker (`31520+`, width 500 at offset), name prompt (`31713+`, width 500), or "Categorize highlight" modal when no category selected (`31320-31395`). Keep-active-off clears category+entity but tool stays `survey-marker` (`25325-25328`); next tap w/ panel visible → categorize modal (`25330-25345`). Notes = **600px desktop modal** w/ text/photos/videos (`32328-32377`, state `6804-6805`). Tapping/double-clicking a placed marker expands the rail's category+marker row and requests rail expand (`24359-24398`, wired `28541,28856`).

## C. Control-by-control comparison

| Demo control/behavior | Demo loc | New mobile | New loc | Verdict |
|---|---|---|---|---|
| Survey entry button (bottom bar/dock) | BottomActionBar.tsx:53-57 | dock right survey button | MobilePdfViewerChrome.jsx:1178-1185 | HAS — parity |
| Bottom-sheet heights (392 / 154+48n) | App.tsx:234-237 | identical formula | SurveySpacesRail.jsx:345-347 | HAS — parity |
| Sheet chrome (bg/radius/border/handle) | styles.ts:2577-2633 | same colors; handle 34px vs 42px | mobilePdfViewer.css:1352-1390 | HAS — near parity |
| Drag-to-dismiss w/ finger-follow + spring-back + velocity | SurveySetupSheet.tsx:62-96 | end-delta-only (>48px), no follow, no animation | SurveySpacesRail.jsx:349-360 | DIFFERENT — degraded feel |
| Close (X) exits nothing / just hides sheet | SurveySetupSheet.tsx:149-151 | collapse-only too (parity), 32px `#353a43` circle | SurveySpacesRail.jsx:918-925, css 1588-1600 | HAS — parity |
| Eyebrow + template dropdown title | SurveySetupSheet.tsx:120-147 | present | SurveySpacesRail.jsx:843-875 | HAS — parity |
| Template picker rows (icon, name, module count) | SurveySetupSheet.tsx:249-276 | present, 58px rows, hover-only affordance | SurveySpacesRail.jsx:2975-3029 | HAS — minor (mouse hover styles on touch) |
| Module navigator (arrows + center dropdown) | SurveySetupSheet.tsx:155-183 | present; center pill has gold border vs demo neutral `#343A45` | SurveySpacesRail.jsx:963-1106 | DIFFERENT — accent/border color |
| Category card active state **blue** (`#142236`/`#2B6FB6`) | styles.ts:3109-3134 | active **gold** `#d8a84e` (desktop theme) | styles.css:1057-1060, SurveySpacesRail.jsx:1657 | DIFFERENT — accent color |
| Category row tap target 38px min | styles.ts:3113-3126 | 24px min-height buttons, padding 2/5 | styles.css:1049-1102 | DIFFERENT — sub-44px touch targets |
| Tap category → place mode + sheet closes | App.tsx:1021-1024 | same | SurveySpacesRail.jsx:1741-1745 | HAS — parity |
| Marker count per category (tabular) | SurveySetupSheet.tsx:210 | present | SurveySpacesRail.jsx:1755-1760 | HAS |
| Category expand → marker item rows | SurveySetupSheet.tsx:221-243 | present, richer (rename/notes/locate/entity/checklist inline) | SurveySpacesRail.jsx:1806-2560 | HAS — different structure |
| Tap-to-place numbered pin marker | App.tsx:1132-1162, styles.ts:903-923 | drag-draw rectangle highlight, no pin/number | PDFViewer.jsx:17776-17784, 25111 | DIFFERENT — different annotation model (matches desktop, not demo) |
| Auto-open marker detail sheet after placement | App.tsx:1155 | desktop 500px name/entity modals instead; mobile sheet stays collapsed | PDFViewer.jsx:31320-31810, 25280-25329 | LACKS mobile-styled flow |
| Keep-active-off → revert tool to pan | App.tsx:1156-1161 | clears selection but stays on survey-marker tool | PDFViewer.jsx:25325-25328 | DIFFERENT — flow |
| "Keep active" checkbox + module picker strip | AnnotationFormattingBar.tsx:224-255 | present; module is a native OS `<select>` | MobilePdfViewerChrome.jsx:329-349 | HAS — different control style |
| Rail category glyph + entity swatch toolbars | App.tsx:1457-1499, styles.ts:663-727 | pixel-close copy, blue active | MobilePdfViewerChrome.jsx:986-1029, css 299-362 | HAS — parity |
| Marker sheet: category re-assign dropdown | SurveySheet.tsx:396-425 | no marker-detail sheet; edits only via rail rows / desktop modals | — | LACKS |
| Marker sheet: entity swatch + rename + sibling dropdown + locate + notes | SurveySheet.tsx:428-513 | equivalents exist inside expanded rail rows (desktop-sized) | SurveySpacesRail.jsx:1966-2280 (rename ~2141, notes ~2202, locate ~2244) | HAS — but desktop-scaled UI |
| Checklist Y/N/N-A segmented buttons | SurveySheet.tsx:522-556, styles.ts:3371-3401 | present in expanded marker rows | SurveySpacesRail.jsx:2471-2560 | HAS — inside 392px sheet, cramped |
| Notes editor as full mobile sheet w/ photo/video | SurveySheet.tsx:191-283 | 600px desktop modal (text/photos/videos) | PDFViewer.jsx:32328-32377 | DIFFERENT — not mobile-adapted |
| Export menu in survey sheet (Excel / M365) | SurveySheet.tsx:324-348 | **absent on mobile** — desktop export bar gated `!mobileMode`; `.mobile-survey-sheet-export` CSS is dead (no JSX use) | SurveySpacesRail.jsx:3088, css 1573-1586 | LACKS |
| Exit Survey footer (red, full-width) | SurveySetupSheet.tsx:278-282, styles.ts:2612-2625 | pixel parity | SurveySpacesRail.jsx:3560-3564, css 1641-1658 | HAS — parity |
| Tap placed marker → opens its detail sheet | App.tsx:1621-1624 | expands rail row + `setShowSurveyPanel(true)`, but mobile sheet collapse state is separate → sheet may stay hidden (expand effect only fires on showSurveyPanel **transition**, SurveySpacesRail.jsx:398-402) | PDFViewer.jsx:24359-24398 | DIFFERENT/BROKEN-ish on mobile |
| Region overlay visuals (blue 2px, 13% fill, dashed edit, label) | RegionOverlay.tsx:21-45, styles.ts:840-855 | real region rendering via RegionSelectionTool canvases (drag-draw, multi-region) | RegionSelectionTool.jsx:108-109,861-880 | HAS — richer, different visual system |
| Region subtools rect/freehand/add/subtract | App.tsx:1401-1455 | present in rail | MobilePdfViewerChrome.jsx:954-985 | HAS — parity ('move' toolType not exposed, RegionSelectionTool.jsx:108) |
| Full Page w/ inline confirm | App.tsx:652-677 | `window.confirm()` browser dialog | RegionSelectionTool.jsx:1801 | DIFFERENT — native confirm on mobile |
| Region long-press context menu (delete) | App.tsx:679-696 | no mobile long-press region menu found | — | LACKS |
| Spaces drawer w/ region rows, exit footer | SpacesDrawer.tsx:72-152, RegionRow.tsx | SpacesPanel mobileMode + exit footer | src/sidebar/SpacesPanel.jsx:1251-1281, PDFSidebar.jsx:549 | HAS — partial pass done |

## D. Concrete divergences (ranked)

1. **Post-placement flow is desktop modals, not sheets** — entity picker / name prompt / "Categorize highlight" are 500px centered blur modals (`PDFViewer.jsx:31373`, `~31556`, `~31788`) vs demo's immediate marker bottom-sheet (`App.tsx:1155`, `SurveySheet.tsx`). Biggest UX gap.
2. **No mobile marker-detail sheet** — demo's SurveySheet (category dropdown, entity swatch, rename, sibling nav, locate, notes, checklist in one 314px+ sheet, `SurveySheet.tsx:285-568`) has no equivalent; the new app reuses desktop rail rows inside the 392px sheet (`SurveySpacesRail.jsx:1806-2560`) with 24px-high controls (`styles.css:1078-1080`).
3. **Placement gesture mismatch** — demo: tap → numbered 26px pin (`App.tsx:1137-1151`); new: drag-rectangle highlight (`PDFViewer.jsx:17779-17782`). Tap-to-place doesn't exist.
4. **Accent color split inside one flow** — sheet internals use desktop gold `#d8a84e` (category active `styles.css:1057-1059`, module pill border `SurveySpacesRail.jsx:997`, notes/locate icons `2202/2244` area, marker flash `PDFViewer.jsx:24392`) while rail strips + keep-active use demo blue `#4a90e2` (`mobilePdfViewer.css:323-326,576-586`). Demo is uniformly blue.
5. **No Excel export/M365 sync on mobile** — export UI gated `!mobileMode` (`SurveySpacesRail.jsx:3088`); demo exposes it in sheet header (`SurveySheet.tsx:336-347`). Dead CSS `.mobile-survey-sheet-export` (`mobilePdfViewer.css:1573-1586`) suggests an unfinished port.
6. **Sheet drag feel** — 48px touchend threshold, no finger tracking, no spring/exit animation (`SurveySpacesRail.jsx:349-360`, `css:1373`) vs demo's PanResponder w/ velocity + spring (`SurveySetupSheet.tsx:62-96`).
7. **Keep-active-off leaves survey-marker tool armed** (`PDFViewer.jsx:25325-25328`) — next tap raises the categorize modal (`25330-25345`); demo reverts to pan (`App.tsx:1156-1161`).
8. **Marker tap doesn't re-open the mobile sheet** — `handleSurveyMarkerClicked` expands rail state (`PDFViewer.jsx:24380-24383`) but mobile expansion needs `expandRequestKey`/`showSurveyPanel` transition (`SurveySpacesRail.jsx:398-408`); already-true `showSurveyPanel` means no sheet.
9. **Notes = 600px modal** (`PDFViewer.jsx:32355`) vs demo full-sheet editor with native photo/video pickers (`SurveySheet.tsx:191-283`).
10. **Full Page uses `window.confirm`** (`RegionSelectionTool.jsx:1801`); demo has an in-toolbar confirm step (`App.tsx:652-677`, `App.tsx:1644-1658`).
11. **Touch-target regressions in sheet** — category rows 24px (`styles.css:1080`), drag handles 24×24 (`SurveySpacesRail.jsx:1723`), module menu options 28px (`SurveySpacesRail.jsx:1076`) vs demo 34-42px (`styles.ts:3051,3114,2695`).
12. **Hover-only affordances on touch** — template rows, module arrows, create-category rely on `onMouseEnter` styling (`SurveySpacesRail.jsx:3002-3009,2880-2886`); demo used pressed/active states.
13. **Desktop leftovers reachable on mobile** — category drag-reorder handles, select-mode toolbars, copy-mode, archived-checklist admin (`SurveySpacesRail.jsx:1152-1618,2747-2760`) have no demo equivalent and crowd the 392px sheet; `.mobile-survey-category-actions{display:none}` hides only the create/select strip (`mobilePdfViewer.css:1612-1614`).
14. **No region long-press context menu / delete-from-plan** on mobile (demo `App.tsx:679-696`); region management only via Spaces panel.
15. **Vocabulary drift**: new modal says "Categorize highlight" (`PDFViewer.jsx:31394`) — legacy "highlight" wording vs product vocabulary "Survey Marker" used everywhere in demo.