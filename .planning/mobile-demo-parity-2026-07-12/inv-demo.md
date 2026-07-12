# OLD DEMO (mobile-expo-go) — EXHAUSTIVE PARITY REFERENCE INVENTORY

All paths relative to `/Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2/mobile-expo-go/`. Key files: `App.tsx` (1816 ln), `src/styles.ts` (3404 ln), `src/constants.tsx`, `src/types.ts`, `src/utils/pageUtils.ts`, `src/data/surveyData.ts`, 24 components.

---

## 0. GLOBAL SHELL / LAYOUT CONSTANTS

- Root: full-screen `View` bg `colors.bg` `#101114` (styles.ts:6-9), light StatusBar (App.tsx:1289).
- Shell metrics (App.tsx:111-119): `railWidth = 44`; `topBarHeight = insets.top + 34`; `subBarHeight = 0`; `bottomInset = Math.max(insets.bottom, 10)`; `bottomActionHeight = 52 + bottomInset`; `pageWidth = min(width - railWidth - 18, 390)`; `pageHeight = round(pageWidth * 1.42)`.
- Safe-area: `SafeAreaProvider` wraps shell (App.tsx:102-108); `useSafeAreaInsets` (App.tsx:112). `insets.top` → topBar paddingTop (App.tsx:1290); `insets.bottom` (floored at 10) → every sheet/drawer as `paddingBottom: bottomInset + N` (N=14 drawers, 12 spaces, 10 sheets, 4 bottom bar) and added into panel-height math via `capBottomPanelHeight` (pageUtils.ts:14-16).
- Panel height system (App.tsx:230-251): all bottom surfaces are **content-driven fixed heights capped** at `maxBottomPanelHeight = min(314 + 159 + bottomInset, screenH - topBar - 18)`. Per-panel: survey = `314 + checklistWindowHeight` (SURVEY_SHEET_FIXED_HEIGHT=314, pageUtils.ts:4); surveySetup = `392` w/ template else `154 + templates*48`; spaces = `max(238, 106 + spaces*54 + pageRows*50)`; versionHistory = `264`; activeUsers = `276`; hub = `310` (pages) / `232|292` (search w/&w/o query) / `min(286, 84 + max(bookmarks,1)*42)` (bookmarks).
- Checklist window (pageUtils.ts:1-12): item height 36, gap 5, max 4 visible → window height `visible*36 + (visible-1)*5`.
- Panel open/close transition: `LayoutAnimation` 170ms easeInEaseOut opacity (App.tsx:300-307). Panels are mutually exclusive — each `openXPanel()` closes all others + dismisses keyboard/page control (App.tsx:322-439).
- Dismiss layer: opening any panel/popover renders a full-screen `Pressable` (`rgba(0,0,0,0.01)`, zIndex 25; zIndex 65 when page-control popover) that closes everything on tap (App.tsx:1662-1664; styles.ts:2591-2598). **No dark backdrop dim — near-invisible scrim.**
- z-index layers: topBar 90, topCenter 95, historyTools 96, pageZoom 80, formatBar layer 58, bottomActionBar 45, hubTray 60, drawer 65, annotationEditSheet 68, sheet 70, contextMenu 84/85, dismiss 25/65.

---

## 1. TOP BAR

Anatomy: height `insets.top + 34`, bg `#1E1E1E` (colors.chrome), 1px bottom border `#3A3A3A`, children absolutely positioned to bottom edge (styles.ts:10-39, App.tsx:1290).

- **Back button** (left, 30x30, chevron-left 22px, no bg) — App.tsx:1292-1294; styles.ts:46-51.
- **Title pill**: h25, maxWidth 136, px12, radius 5, bg `#2A2B31`, text 13/700 `#F2F2F2`, single line (styles.ts:52-67). Tap = opens page control AND if title >18 chars plays a marquee reveal (translateX to -52 over 900ms in, 260ms back) (App.tsx:441-460, 1295-1319).
- **Page navigation control** (top-center, absolutely at left 50% translateX -34): pill 68x24, radius 5, border `#343B46`, bg `#171A20`; shows `{ordinal} / {total}` 11/800 tabular-nums + 13px chevron-down (App.tsx:1215-1239; styles.ts:107-146). Active state border `#2B6FB6` bg `#121B2A`. Tap → inline `TextInput` (number-pad, autofocus, selectTextOnFocus, max 3 digits) replaces ordinal; submit jumps page (App.tsx:1223-1236, 462-475).
  - **Zoom-fit dropdown** under it: 138w, radius 8, bg `#24272D` (panel), border `#3A4250`, pad 5, gap 3; items h30 radius 6; active bg `#132135`, text `#4A90E2` + check 15px. Options: Fit Page / Fit Width / Fit Height (constants.tsx:92-96; App.tsx:1240-1283; styles.ts:147-177). Animates 150ms out-cubic, opacity + translateY(-4→0) + scale(0.97→1) (App.tsx:410-428); dismiss = applies page draft, 130ms out (App.tsx:309-320).
- **Undo/Redo** (right, absolute right 8 bottom 6, gap 5): 26x26 radius 5 buttons, icons 17px; disabled = opacity .56 + `#6F7785` icon (App.tsx:1324-1343; styles.ts:86-106). Undo/redo pops last add-marker/add-ink entry (App.tsx:1096-1126).

---

## 2. LEFT TOOL RAIL (vertical, width 44)

bg `#20242C` (colors.rail), right border `#3A3A3A`, paddingTop 7, px4, items centered gap 5; paddingBottom `bottomActionHeight + 28` (App.tsx:1347; styles.ts:599-607).

- **Primary tools**: Pan (Hand), Select (MousePointer2) — 34x34 radius-6 buttons, icon 20/2.2; active = bg `#111820` + border `#2B6FB6`, icon `#4A90E2` (constants.tsx:64-67; App.tsx:1348-1362; styles.ts:608-620).
- **Divider** 26x1 `#4A4F59` (styles.ts:621-626).
- **Category buttons** (constants.tsx:69-73): Draw (Pencil, default pen), Shapes (RectangleHorizontal, default rect), Text (Type, default text). Pressing a category activates its last-used tool (`lastToolByCategory`, App.tsx:1084-1090, init pen/rect/text at 123-127). Category considered active if activeCategory matches OR active tool belongs to it (App.tsx:1092-1094).
- **Sub-toolbar** (shown when a category is active): pill container 34w radius 8 bg `#1A1E25` border `#323844` py4 gap 4; 28x28 radius-5 buttons, icon 18/2.15, same active treatment (App.tsx:1379-1400; styles.ts:640-662). Subtools (constants.tsx:116-133): draw = Pen/Highlighter/Eraser; shape = Rectangle/Ellipse/Line/Arrow/Counter(Hash); review(Text) = Text/Callout.
- **Region edit sub-toolbar** (replaces when `regionEditActive` && shown alongside): same pill; buttons Rectangular(RectangleHorizontal) / Freehand(PenLine), mini divider 18x1 `#3C424C`, Add(Plus) / Subtract(Minus) — sets `regionDrawTool` / `regionOperation`, forces tool 'region' (App.tsx:1401-1456; styles.ts:634-639).
- **Survey category toolbar** (when surveyMode + template + not region edit): pill container; per-category circular chips 28x28 radius 14 bg `#2A2D34` border `#555C68`, glyph text (initials via `getSurveyCategoryGlyphLabel`) 10/900 tabular, adjustsFontSizeToFit; active = full blue bg/border, white text (App.tsx:1457-1482; styles.ts:663-697). Tap = commit category placement mode + close survey sheet (App.tsx:1026-1030).
- **Survey entity toolbar**: pill container; 28x24 radius-6 buttons each holding a 15x15 radius-8 color swatch (border `#0C0F13`); active = bg `#111820` border blue (App.tsx:1483-1499; styles.ts:698-727). Tap = entity placement mode (App.tsx:1032-1040). Entity colors (surveyData.ts:4-9): My Company `#CBDCFF`, Subcontractor `#FFF5C3`, GC `#E3D1FB`, 100% Complete `#B2FFB2`.
- **Rail footer** (bottom, translateY 34 stack, styles.ts:731-760): More(⋯ 20px, 34x18 hit area); **sync status button** 34x34 with 12px dot — synced `#2bbd7e` / syncing `#f5a524` / offline `#ef4444` (constants.tsx:98-102); tap = manual sync, shows 'syncing' 1200ms then 'synced' (App.tsx:291-298, 1508-1515). **Version history button** 34x34 (custom clock-arrow SVG icon, constants.tsx:54-62). **Active users button**: 28x28 avatar circle bg `#2A3B54` border `#4A90E2`, initials 10/900; `+N` badge top-right minW18 h18 radius 9 blue bg, white 9/900 (App.tsx:1524-1538; styles.ts:773-815).

---

## 3. DOCUMENT CANVAS

- ScrollView bg `#070A0D` (styles.ts:816-822); content padding left/top from `pageOffset = {x: centered, y: 58}` (App.tsx:271, 1543-1553); paddingBottom `bottomActionHeight + 22`.
- **Page**: white `#FAFAF8` (colors.page), 1px border `#D8D8D0`, overflow hidden, no radius (styles.ts:823-828). `FloorPlan` = mock walls (3px `#303640` bars) + room labels 10/800 `#68707A` (FloorPlan.tsx:5-22; styles.ts:829-839).
- **Gestures on page** (App.tsx:1555-1563): tap = `handlePagePress`; long-press 360ms in pan/select = canvas context menu (paste, only if annotation clipboard).
- **Tap behavior by tool** (App.tsx:1128-1213): `survey` → if no template open setup sheet; else place Marker at clamped (0.05-0.95) normalized coords, name auto `Camera C-1xx`, push undo, open survey sheet; unless "Keep active" checked, revert to pan (App.tsx:1156-1161). `region` → add-mode repositions active region bounds centered on tap (freehand shrinks 0.82x); subtract-mode shrinks bounds (0.72x rect / 0.84x freehand) (App.tsx:1164-1196). Draw/shape/text tools → drop an `InkMark` dot (clamp 0.04-0.96) + undo entry (App.tsx:1198-1209). `select` → no-op.
- **Ink dots**: 10x10 radius-5 red `#DC3545` dots (styles.ts:912-918); long-press 320ms = annotation context menu (App.tsx:1579-1601).
- **Survey markers**: 26x26 circle, radius 13, borderWidth 2, bg = entity color (fallback `#D8A84E` yellow), border blue when selected else `#252A31` ink; id text 12/900 `#111` (App.tsx:1602-1629; styles.ts:903-923). Tap = open survey sheet for that marker. Visibility filtered by surveyMode + active space pages + active region bounds if `showSurveyAnnotations` (App.tsx:257-269). Ink marks hidden in survey mode (App.tsx:270).
- **Zoom/pan**: demo has NO pinch-zoom implementation — vertical ScrollView only; zoom is represented by the fit-mode dropdown; pan tool is a rail state.

---

## 4. REGION OVERLAY (on-page)

- Positioned rect from normalized bounds*pageSize; borderWidth 2 blue, fill `rgba(74,144,226,0.13)`; editing = dashed border + fill `rgba(74,144,226,0.2)`; label = first `-`-segment of name, 11/800 blue, padding 4 (RegionOverlay.tsx:21-45; styles.ts:840-855). Tap = activate (and if select tool, enter edit); long-press 420ms = region context menu (title = region name, single destructive Delete) (App.tsx:1566-1577, 679-699).

---

## 5. FLOATING CONTEXT MENU (FloatingContextMenu.tsx)

- Near-invisible dismiss layer (`rgba(0,0,0,0.01)`, zIndex 84) + panel: default width 154 (overridable), radius 9, border `#3C424D`, bg `#181B20`, pad 6, gap 3, zIndex 85 (styles.ts:856-871). Title row 11/800 muted; 1px divider `#343A45`; actions h34 radius 6 text 13/800; destructive `#F08A8A`; disabled opacity .45 / text faint (styles.ts:872-902).
- **Menu variants**:
  - Page menu (from hub page card ⋯; width 188): Cut, Copy, Paste (disabled w/o clipboard), Duplicate, Rotate (+90°), Mirror Horizontally, Mirror Vertically, Reset, Delete (destructive, disabled if last page) (App.tsx:817-838; ops 701-815).
  - Annotation menu (long-press ink; width 176): Cut, Copy, Paste (offset +0.04), Delete (destructive), Bring to Front / Bring Forward / Send Backward / Send to Back (App.tsx:866-895; z-order 840-850).
  - Canvas menu (long-press page; width 154): Paste at tap point (App.tsx:897-915).
  - Region menu (width 154): Delete only (App.tsx:679-699).

---

## 6. ANNOTATION FORMATTING BAR (AnnotationFormattingBar.tsx) — the 36px strip under the top bar

- Layer absolutely at `{left: railWidth, top: topBarHeight}`, right 0, zIndex 58 (styles.ts:178-182; App.tsx:1639-1660). Bar h36 bg `#202126`, bottom border `#090A0D`, contents centered row gap 8 (styles.ts:183-200).
- Visible when: any annotation tool active, OR survey toolbar (surveyMode+template+tool∈{survey,pan,select}), OR region edit toolbar (App.tsx:253-256).
- **Region edit mode** (AnnotationFormattingBar.tsx:195-223): buttons h30 radius 7 border `#3F4652` bg `#2A2D34` text 12/800; primary = solid blue + white 12/900. Normal: `✓ Confirm` (primary) / `□ Full Page` / `✕ Cancel`. Full-page confirm state: "Make region full page?" (12/900, maxW 146) + Confirm(primary)/Cancel. Full-page action replaces region bounds with 0..1 and removes other regions on the page (App.tsx:657-677).
- **Survey mode** (:224-256): module dropdown (`FormatDropdownButton`, minWidth 138) listing all template modules; plus **"Keep active" checkbox pill** h30 radius 7 (checkbox 14x14 radius 3 border `#8A93A3`; checked = blue box + white check; active pill border `#2B6FB6` bg `#132235`) toggling `surveyKeepCategoryActive` (styles.ts:201-237).
- **Eraser** (:257-272): mode dropdown (Partial Erase / Full Stroke, types.ts:120-123, minW 104) + eraser-size number input (default '16').
- **Generic tools** (:274-397), controls appear per capability flags (:75-82):
  - strokeOnly (pen/highlighter/arrow/line): 1 color swatch → opens edit panel focus 'stroke'.
  - counter: counter swatch (fill circle + "1" digit in stroke color) → focus 'fill'; **counter-series menu** (`FormatMenuButton` minW 94): dropdown minW 160 bg `#1E1E1E` with uppercase 10/800 `#888` headers "Counter Series"/"Continue Count", `+ New Count` row, series rows (10px color dot, label 12/700, count 10/800), new series colors cycle `counterSeriesColors` (constants.tsx:166) (:293-336; styles.ts:446-510).
  - fillAndBorder (rect/ellipse/text/callout): swatch 24x24 round w/ 2px stroke-color ring + checkerboard under fill (FormatPrimitives.tsx:9-38; styles.ts:302-333) → focus 'fill'.
  - width (all except—counter included, plus eraser): number input 36x24 bg `#444` text `#DDD` 12/700 tabular radius 5 (styles.ts:341-353; FormatNumberInput digits-only w/ fallback restore, FormatPrimitives.tsx:40-88). Defaults: stroke '3', eraser '16' (:57-58).
  - style (arrow/line/rect/ellipse/text/callout): line-style dropdown minW 82 — Solid/Dashed/Dotted (+Cloud only rect) (:349-362; types.ts:104-109).
  - rect+cloud: "Bump" label 11/700 `#BBB` + number input (default '2') (:363-368; styles.ts:531-540).
  - arrow/callout: arrowhead dropdown minW 124 — None / Solid Triangle / V-Shape / Open Circle / Open Triangle / Horizontal Line (types.ts:111-118).
  - text/callout: `Aa` button 34x24 bg `#444` (active border blue bg `#132135`) → opens edit panel focus 'text' (:383-396; styles.ts:516-530).
- Dropdown menu primitive: anchored below (top 30), radius 6 border `#333` bg `#1E1E1E`, maxHeight 166 scroll, rows minH30 radius 4, active bg `#132135` blue text + check (FormatPrimitives.tsx:99-154; styles.ts:371-410).
- Defaults: strokeColor/fillColor `#ff0000`, fontColor `#1e293b`, fontSize '16', bold true, others false, alignmentIndex 0, arrowhead 'solidTriangle', lineStyle 'solid' (:54-73).

---

## 7. ANNOTATION EDIT PANEL (AnnotationEditPanel.tsx) — bottom sheet for full formatting

- Sheet: absolute bottom full-width, top radius 14, top border 1 `#444B57`, bg `#24272D`, px16 pt10, zIndex 68 (styles.ts:1407-1420). **Self-sizing height** computed from card composition, capped to `maxBottomPanelHeight` (:66-115).
- Animation: slide-up 210ms out-cubic on mount; slide-down 170ms in-cubic on close; drag-to-dismiss PanResponder on header (dy>8, release dy>82 or vy>0.65 closes, else spring back damping24/stiffness260/mass0.75) (:141-199). External dismiss via `dismissRequest` counter (App.tsx:142, 331-333).
- Header: grabber 34x4 radius 2 `#6D7380`; title `{Tool} settings` 16/800 + subtitle `Focused on {panel}` 11/700; X close 18px (:546-557).
- **Shape/Text segmented tabs** (text & callout only): 224x34 radius-17 pill, border `#343A45`, bg `#1B1F25`, 1px divider, active segment bg `#132135`; labels 12/900 (:559-593; styles.ts:1428-1452).
- **Color card** (:463-537): radius 8 border `#343A45` bg `#1B1F25` pad 11 gap 10. Optional Fill/Stroke tabs (h34 pill w/ 11px swatch dots, active bg `#132135`). Header: `{Section} color` 13/900 + hex value 11/700; right = large swatch 42x42 (compact 30x30) circle bordered w/ stroke color (fill section) or `#454B56` → opens gradient picker. Preset row: single non-wrap row, space-between, of `annotationColorChoices` (dedup of `['#ff0000','#4A90E2','#27C07D','#F4D35E','#ffffff','#1e293b']` + counter colors + '#000000', constants.tsx:163-167) — 30x30 radius-15 cells bg `#15181D` border `#3B424E` (active blue border bg `#122238`) each with 20px color dot. Section labels: counter → "Pin Fill"/"Pin Number"; else Fill/Stroke/Text (FormatPrimitives.tsx:256-262).
- **Gradient color picker** (in-panel takeover, :314-461): optional fill/stroke tabs; saturation/brightness square h176 radius 6 (SVG dual gradient) with 20px white-ring thumb; HUE row (label 12/900, 16px rainbow track radius 8, 22px white-ring thumb, degree readout 13/900 tabular); OPACITY row (6px track `#444B57`, blue fill + 30px blue thumb, % readout); divider; input row = 52x42 preview swatch + hex TextInput h42 18/900 + opacity % input 86x42; full-width blue `Done` h42 radius 8 (styles.ts:1631-1783). Hex normalize/commit on blur (:269-285); HSV utils from colorUtils.
- **Split control card** (stroke style | stroke width): one card row split by 1px vertical divider; each pane centered pad 11: "Stroke style" dropdown (opens **upward** popover bottom:42, maxH 174, styles.ts:1845-1857) w/ Solid/Dashed/Dotted(/Cloud rect); cloud → "Cloud bump" number input; "Stroke width" (or "Eraser size") number input 52x32 radius 6 bg `#242A33` (:612-711; styles.ts:1548-1572,1798-1811). Eraser also gets mode chips (Partial Erase / Full Stroke) — minH30 radius-15 chips (:686-707; styles.ts:1887-1908).
- **Arrowhead card** (arrow, or callout-on-shape-tab): label + upward dropdown of 6 arrowhead styles (:713-755).
- **Text tab cards** (text/callout): split card "Text formatting" B/I/U/S toggles 31x31 radius 8 (active chipActive: border `#2B6FB6` bg `#132135`; letters styled bold/italic/underline/strike, active letter color `#D8A84E`) | "Text size" number input (:757-796; styles.ts:1909-1925,549-571). "Text alignment" card: two rows of 3 SVG `TextAlignmentOption` buttons (flex-1 h43 radius 8; active border blue bg `#132135`) for horizontal L/C/R and vertical T/C/B; stored as single index `v*3+h` (:798-828, 237-254; FormatPrimitives.tsx:156-253 — SVG bars in `#35BEEA`/`#A7E1F4`).
- All changes write BOTH local state and back through config setters to the formatting bar's state (live two-way).

---

## 8. BOTTOM ACTION BAR (BottomActionBar.tsx)

- Absolute bottom full-width, h `52 + bottomInset`, px20 pt2 paddingBottom 4, row space-between, zIndex 45 (styles.ts:924-935; :31). Behind it a `bottomBarSurface` bg `#1E1E1E` top border `#3A3A3A` height `36 + bottomInset` (buttons intentionally overhang above the surface, nudged +4 translateY).
- **Left: Spaces button** — 44x44 circle bg `#181A1F` border `#2E333C`, Layers icon 22; active (space or region active) bg `#162236` border `#315F91` icon blue (:33-40; styles.ts:948-961).
- **Center: Hub button** — pill minW124 h38 radius 19 bg `#20242C` border `#3A4250`, shows current hub tab icon 19 + label 12/900 (maxW 82) + chevron-down 13; open state = blue treatment (:41-50; styles.ts:962-987).
- **Right: Survey button** — 44x44 circle, custom SurveyIcon 23 (compass-like SVG, constants.tsx:29-42); active while surveyMode (:51-58).
- Hidden while hub tray or any drawer/sheet/edit panel is open (App.tsx:1666-1706).

---

## 9. HUB TRAY (HubTray.tsx)

- Bottom sheet: top radius 14, bg panel, top border `#444B57`, px16 pt10 gap 8, zIndex 60; height per-mode (see §0), paddingBottom `bottomInset+14` (styles.ts:988-1002; :62).
- Grabber 34x4 radius 2 `#6D7380` (styles.ts:1003-1010) — visual only (no drag responder).
- **Tab row** (centered gap 14): 3 icon tabs 34x32 radius 16 — Pages(FileText)/Search/Bookmarks(Bookmark); active = bg `#1A3328`, icon **green** `#28A745` (HubTab.tsx:20-25; styles.ts:1011-1028) — hub identity color is GREEN vs blue elsewhere. Absolute right X close 32x32 circle bg `#353A43` (:68-70; styles.ts:1029-1039).
- **Pages mode** (:73-119):
  - Page counter row h34 centered: pill minW58 h30 radius 15 bg `#171A20` border `#353B46` with ordinal 13/800 tabular + `/ N pages` meta 13/700 muted (styles.ts:1040-1069).
  - Horizontal thumb scroller, track gap 16 (styles.ts:1070-1078). **PageThumb** (PageThumb.tsx): card 130x146 radius 8 bg `#20242B` border `#2F3641`; active = bg `#1D2740` border `#2F6BB8` + left green rail 5w radius 3 `#58D976` (top/bottom 40); dragging = green border bg `#1A2D25` (styles.ts:1079-1103,1152-1160). Inner paper 92x112 radius 5 white w/ `MiniPagePreview` SVG (mini floor plan, red ink dots r1.9, entity-colored marker circles r4.4; page 2 = "FLOOR 2" variant) and rotation/mirror transforms applied (PageThumb.tsx:83-96; MiniPagePreview.tsx:14-51). Number badge top-right minW22 h22 radius 11 white bg ink text 12/900 (styles.ts:1131-1150). Clipboard badge top-left 22x22 green-bordered w/ Copy icon (styles.ts:1174-1187). `⋯`(rotated) actions button 26x28 bottom-right → page context menu (PageThumb.tsx:108-119; styles.ts:1161-1173). **Reorder gesture**: long-press 320ms enables drag → horizontal PanResponder steps of 88px call `onMove(page, ±1)`; drag handle (rotated GripVertical, green) shows bottom-center (PageThumb.tsx:44-107).
  - Action pill (self-center h42 radius 21 bg `#1B1F25` border `#343A45`): `+ Add` | divider 1x18 | `Copy Paste` | divider | `✓ Select` — h34 minW72 radius 17 buttons, 13/700 text (:103-118; styles.ts:1213-1243). (Demo stubs — no handlers.)
- **Search mode** (:122-158): search box h42 radius 7 bg `#171A20` border `#333944` w/ 17px icon + input 14 (styles.ts:1244-1260); results list maxH112, rows minH44 radius 6 bg `#1B1F25` border `#333944` title 13/800 + meta `Page N · excerpt` 11/700; tap jumps page (searches `pdfTextMatches` stub data, constants.tsx:81-87). Empty states: big green Search icon 54/44, title 20/800, meta 12/600 center (styles.ts:1285-1305).
- **Bookmarks mode** (:161-189): scroll maxH166 gap 7; **BookmarkRow** (BookmarkRow.tsx): row minH38 radius 6 bg `#1B1F25` border `#333944`, indented `depth*14`; grip handle (drag-reorder PanResponder, 38px row step); icon bubble 22x22 round (folder=Layers `#8FB7FF`, bookmark=Bookmark muted); title 13/800 + meta `Page N · PDF outline`; up/down move buttons 22x24 radius 5 bg `#242A33`, disabled opacity .36 (styles.ts:1306-1391). Tap: markerId → open survey; else jump page. Empty state minH76 w/ icon + "No bookmarks yet".

---

## 10. SPACES DRAWER (SpacesDrawer.tsx)

- Uses shared `drawer` style + overrides: gap 9 pt10, height = spacesPanelHeight, paddingBottom `bottomInset+12` (:73; styles.ts:1392-1406,2171-2174). Opens via bottom-bar Spaces button (toggle) or selecting the region tool (App.tsx:381-387,1063-1072).
- Header: title "Spaces" 16/800 + subtitle state text ('Region active'/'Space active'/'No space active') 11/700; actions right: `+` create-space 32x32 radius 8 (styles.ts:2187-2196) and Export button (same 32x32; active blue) with dropdown menu width 116 (CSV / PDF Pages rows h30) anchored top 36 right 0 (:79-107; styles.ts:2204-2230).
- **SpaceRow** (SpaceRow.tsx): card radius 8 bg `#1B1F25` border `#343A45` pad 10 gap 10; active card = borderless bg `#2B2B2B` (styles.ts:2063-2070,2238-2241). Whole card is vertical drag-reorder (PanResponder step 58px, :55-77).
  - Header row: grip 20x26; region-count badge minW20 h20 radius 10 bg `#1F1F1F` border `#3A3A3A` 10/900; expand chevron (rotates -90° collapsed); **editable space-name TextInput** 14/900 flex (blur restores default name); right: toggle switch 40x24 radius 12 (`#3A3F49` → active `#28598D`, knob 18 translateX16) = activate space; delete X 25x25 `#F08A8A` (:84-113; styles.ts:2104-2123,2242-2301).
  - Collapsed: meta row (paddingLeft 52) `Pages 1-2 · N regions` + up/down move buttons (:115-127).
  - Expanded body (top border `#3A3A3A` pt9 gap 8): **page-assign row** h30 = flex TextInput h28 radius 5 bg `#1F1F1F` placeholder "Add pages (e.g. 3, 6-9, 12)" 11/800 + `+` commit button 28x28; error text 11/800 `#F08A8A` (parse via `parsePageRangeDraft`, pageUtils.ts:26-53) (:131-147; styles.ts:2322-2370).
  - **SpacePageRegionRow** per assigned page (SpacePageRegionRow.tsx): row minH38 radius 6 bg `#1F1F1F` border `#333333`; active = border `#2B6FB6` bg `#17263A`; editing = dashed border (styles.ts:2388-2406). Left: page pill minW26 h24 (tap = jump page) + mini region-overlay toggle 28x16 (knob 10, translateX 12) enabling region (:46-59; styles.ts:2412-2450). Middle: editable region-name input 12/800 + meta `N regions`/`No region defined` 10 (:62-79). Right actions (26x26 radius-6 buttons): SquareDashed = edit region area (creates one if none, enters region tool); SurveyIcon (survey mode) / Lightbulb (canvas mode) = toggle showSurveyAnnotations/showCanvasAnnotations; X `#F08A8A` = remove page from space (:81-118; styles.ts:2497-2513).
  - Expanded footer: right-aligned up/down space move buttons (:184-191).
- Empty state minH92 "No spaces yet" (:141-146; styles.ts:2553-2567).
- Footer: full-width `Exit Spaces / Regions` h36 radius 7 border `#51404A` bg `#1B1F25` muted text (:149-151; styles.ts:2568-2576) → clears space/region/editing state (App.tsx:484-492).
- Note: standalone `RegionRow.tsx` (region cards w/ locate/edit/toggle/move/delete, drag step 48px) exists and styles remain (styles.ts:2085-2543) but the drawer path used is SpacePageRegionRow; RegionRow isn't rendered by SpacesDrawer (imported only in App.tsx:94, unused in JSX).

---

## 11. SURVEY SETUP SHEET (SurveySetupSheet.tsx) — survey panel with no marker selected

- Sheet style: bottom, top radius 14 border `#444B57`, px16 pt6, zIndex 70, height=surveySetupPanelHeight, paddingBottom `bottomInset+10` (styles.ts:2577-2590; :117). Same slide-up/down + drag-dismiss physics as edit panel (210ms in / 170ms out / dy>82 or vy>0.65) (:51-96); drag responder on `sheetFixedTop` only.
- Handle 42x4 radius 2 `#68707A` (styles.ts:2626-2633).
- Header: eyebrow "SURVEY TEMPLATE" 11/700 uppercase; **template title button** = title 17/900 + chevron; dropdown menu 236w bg `#181B20` border `#3C424D` radius 8 (:120-148; styles.ts:2652-2686). Close X in 34x34 round `#353A43` exportButton style (:149-151).
- With template: **module navigator** row = 30x30 round arrow buttons (disabled opacity .45) + center pill h32 radius 16 bg `#181B20` w/ module name 13/900 + chevron → module dropdown (:155-184; styles.ts:2782-2823).
- Category section: header "SELECT CATEGORY TO HIGHLIGHT" (compactFieldLabel 10/800 uppercase) + right hint "Tap category to place marker" 11 faint (:189-192; styles.ts:3087-3093).
- **Category cards** scroll list: card radius 8 border `#343A45` bg `#1B1F25`; active = border `#2B6FB6` bg `#142236`; row minH38 = tappable main (name 13/900, count 12/900 tabular; active text blue) + 36x38 expand chevron (rotates 180°) (:194-220; styles.ts:3102-3147). Tap name = enter placement mode + auto-hide sheet (App.tsx:1021-1024). Expanded shows category items: rows minH30 radius 6 bg `#171B22` border `#303743` w/ 10px entity dot + name 12/800 (tap = open that marker), or empty text "No category items yet. Hide panel, then tap plan to add one." (:221-243; styles.ts:3148-3182).
- Without template: "AVAILABLE TEMPLATES" list — items minH42 radius 8 w/ 26x26 blue doc icon tile, name 13/800, `N modules` meta 10/700, chevron-right (:249-276; styles.ts:2687-2730).
- Footer (h38 pt6): full-width `Exit Survey` h32 radius 7 border `#51404A`, text `#F08A8A` 13/900 (:278-282; styles.ts:2607-2625) → exits survey mode (App.tsx:477-482).

---

## 12. SURVEY SHEET (SurveySheet.tsx) — marker detail

- Same sheet chrome/animation/drag as setup (:117-164,285-288). Height = `314 + checklistWindowHeight` capped (App.tsx:234).
- Header: template dropdown title (same as setup) + **Export button** (34x34 round; active blue) w/ menu 218w: "Export Excel — Create workbook from survey data" / "Sync Microsoft 365 — Update the shared workbook location" (rows minH48, title 13/900, meta 10/700) (:324-348; styles.ts:2731-2775).
- Module navigator row (identical to setup, updates the marker's module + remembered category) (:351-393).
- **Category field**: label "CATEGORY"; compact dropdown h30 radius 7 bg `#1B1F25` (empty style bg `#20242C` border `#4A5361`, placeholder muted); menu rows show name + checklist-count meta (:396-425; styles.ts:2999-3072).
- **Category Item row** (:427-514): entity swatch button 30x30 radius 7 (14px dot, empty transparent) → entity dropdown 230w with color dots; **marker name inline TextInput** inside h30 bordered input-row with right 30x30 chevron dropdown of sibling category items (jump between markers); Locate button 30x30 (Search icon blue) → jump page + close sheet; Notes pencil button (PenLine, blue if notes exist else `#999`) → notes editor (styles.ts:2877-2991).
- Checklist header: "CHECKLIST" + right `Court: {entityName}` 11 faint (:516-519).
- **Checklist** (:522-561): fixed-height scroll window (36px rows, gap 5, max 4 visible then scrolls); each row = item text 12/700 + Y/N/N/A buttons minW28 h24 radius 5 bg `#2A2F38` border `#3A4250`, 9/900 text; selected: Y bg `#2F7D55`, N bg `#8C3A42`, N/A bg `#5E6570`, white text (styles.ts:3314-3401). No category → empty box "Choose category first".
- Footer: `Exit Survey` (same as setup) (:563-567).
- **Notes editor** (in-place replacement view, :207-283): header "SURVEY MARKER"/marker name; card w/ multiline TextInput minH88 bg `#15181D` placeholder "Add details..."; Attachments card: header + `Photo`/`Video` upload buttons (maxW112 minH30 radius 7) using `expo-image-picker` multi-select (:191-205); attachment rows minH40 radius 7 bg `#242A33` w/ 28x28 blue-bordered thumb icon, filename 12/800, remove X; empty "No attachments."; footer Cancel (outline) / Save (solid blue) h36 radius 7 (styles.ts:3183-3313).

---

## 13. VERSION HISTORY DRAWER (VersionHistoryDrawer.tsx)

- Shared `drawer` chrome (bottom sheet radius 14, bg panel, px16 pt12 gap 12, zIndex 65), height 264 capped, paddingBottom `bottomInset+14` (:17). Header: "Version History" 16/800 + "Online status and recent document activity" 11/700; X 18 close (:18-26). Rows: minH50 radius 8 bg `#1B1F25` border `#343A45` w/ 9px green dot `#58D976`, title 13/900, meta 11/700 (:28-36; styles.ts:1994-2025). Data stub: sync active / marker updated / region filter (constants.tsx:110-114). Opens from rail footer clock button.

## 14. ACTIVE USERS DRAWER (ActiveUsersDrawer.tsx)

- Same drawer chrome, height 276. Header "Active Users" + "N people currently in this document". Rows minH54: avatar 34x34 round (owner = green `#263A2D`/`#58D976`, others blue `#2A3B54`/`#4A90E2`), initials 11/900; name 13/900 + `role - status` 11/700; right green presence dot 9px (:17-40; styles.ts:2026-2062). Opens from rail avatar button.

---

## 15. MODES & STATE MODEL (App.tsx)

- Tools (`ToolId`, types.ts:3-17): pan, select, survey, region, pen, highlighter, eraser, rect, ellipse, line, arrow, counter, text, callout. Categories: draw/shape/review. Tool switch resets format panel + closes edit panel (App.tsx:286-289).
- Survey mode: `surveyMode` boolean + `selectedSurveyTemplateId`; placement mode 'category' | 'entity' (App.tsx:128-131). Survey toolbar in rail shows only in survey mode w/ template. Placing marker infers template if none (App.tsx:944-964). "Keep active" persists placement tool after drop.
- Region mode: `activeSpaceId`/`activeRegionId`/`editingRegionId` + `regionDrawTool` (rectangular/freehand) + `regionOperation` (add/subtract) + full-page confirm flag (App.tsx:160-165). Confirm/cancel edits return tool to select (App.tsx:638-650).
- History: undo/redo stacks of `{type:'marker'|'ink', item}` only for additions (types.ts:89-91).
- Clipboards: page (`copy|cut`) and annotation (`copy|cut`) (types.ts:73-81).
- Page model: `pageOrder` array of page ids; ordinal = index+1; transforms per page `{rotation, mirrorH, mirrorV}` (App.tsx:152-157; types.ts:83-87).

---

## 16. DESIGN TOKENS

**Core palette** (constants.tsx:11-27): bg `#101114`; chrome `#1E1E1E`; rail `#20242C`; panel `#24272D`; panel2 `#2D2D2D`; line `#3A3A3A`; text `#F2F2F2`; muted `#A8B0BF`; faint `#6F7785`; blue `#4A90E2` (**demo accent — the primary accent everywhere**); green `#28A745`; yellow `#D8A84E` (matches new app's gold `--accent-primary`; used only for marker fallback + text-format active letters + align-grid active dot, styles.ts:558,593); red `#DC3545`; page `#FAFAF8`; ink `#252A31`.

**Recurring surface hexes** (inline throughout styles.ts): card bg `#1B1F25`; card border `#343A45`; input bg `#171A20`/`#15181D`/`#242A33`; menu bg `#181B20` border `#3C424D`; dropdown dark bg `#1E1E1E` border `#333`; active-blue pair border `#2B6FB6` + bg `#132135` (variants `#142236`,`#17263A`,`#121B2A`,`#122238`,`#162236` w/ border `#315F91`); destructive text `#F08A8A`; success/presence green `#58D976` (rail/dots) & `#2bbd7e` (sync); hub-tab active bg `#1A3328` w/ icon `#28A745`; formatting-bar neutrals `#444` bg / `#DDD` text / `#202126` bar / `#090A0D` bar border; gold active tint `rgba(216,168,78,0.12/0.18)` (styles.ts:439,550).

**Status colors**: synced `#2bbd7e`, syncing `#f5a524`, offline `#ef4444` (constants.tsx:98-102). Checklist Y `#2F7D55` / N `#8C3A42` / N/A `#5E6570`.

**Annotation preset colors**: desktop presets `#ff0000 #4A90E2 #27C07D #F4D35E #ffffff #1e293b`; counter series adds `#C7A7FF #FF8A3D`; plus `#000000` (constants.tsx:163-167). Font sizes list 8-72 (constants.tsx:165). Entity colors §2.

**Radii by component**: sheets/drawers/hub tray top 14; cards 8; menus 8-9 (context 9); dropdown rows 4-6; inputs 5-7; rail buttons 6 (sub 5); chips/pills fully rounded (15-22); circular buttons 44→22, 34→17, 32→16, 30→15, 28→14; toggles 12/11/8; page cards 8, paper 5.

**Type scale**: titles 16-17/800-900; drawer title 16/800; sheet title 17/900; body/labels 13/800-900; secondary 12/700-800; meta 10-11/700-800; micro 9-10/900; field labels 10-11/800 UPPERCASE; numerals always `fontVariant: ['tabular-nums']`; hex input 18/900; search-empty title 20/800. Weights skew heavy (700-900) app-wide. No custom font family (system).

**Spacing**: sheets px16; cards pad 9-11 gap 8-10; list gaps 6-8; rail gaps 4-5; bar content gap 8; drawer gap 12.

**Shadows**: none anywhere — elevation communicated purely with borders + darker/lighter fills.

**Toggles**: large 40x24/knob 18 (space), region 34x21/knob 15, mini 28x16/knob 10; track `#3A3F49`→active `#28598D`; knob muted→text (styles.ts:2104-2123,2429-2450,2514-2530).

---

## 17. ANIMATION SUMMARY

- Sheets (survey/setup/edit-panel): mount slide-up 210ms `Easing.out(cubic)`; close 170ms `Easing.in(cubic)`; drag-dismiss threshold dy>82 or vy>0.65; spring-back damping 24 / stiffness 260 / mass 0.75 (SurveySheet.tsx:120-164; SurveySetupSheet.tsx:51-96; AnnotationEditPanel.tsx:141-199).
- Panel swaps (hub/spaces/drawers): `LayoutAnimation` 170ms easeInEaseOut (App.tsx:300-307) — these drawers do NOT slide, they appear via layout animation; only the 3 sheets + page-control popover use Animated.
- Page-control popover: 150ms in / 130ms out, opacity+translateY(-4)+scale(0.97) (App.tsx:410-428,313-319).
- Title marquee: 900ms in / 260ms out, translateX -52 (App.tsx:446-459).
- Drag-reorder steppers: pages 88px, spaces 58px, regions 48px, bookmarks 38px per step (PageThumb.tsx:52, SpaceRow.tsx:63, RegionRow.tsx:43, BookmarkRow.tsx:29).

---

## 18. GAPS / DEMO-ONLY STUBS (for parity planning)

- No real PDF, pinch zoom, or drawing strokes — ink = dots, zoom = fit dropdown only (App.tsx:1198-1209,1215-1284).
- Hub "Add/Paste/Select" pill buttons have no handlers (HubTray.tsx:104-117); spaces/survey export menus just close (SpacesDrawer.tsx:98-103; SurveySheet.tsx:338-345); back button inert (App.tsx:1292); rail `⋯` inert (App.tsx:1504).
- Search runs over 5 hardcoded matches (constants.tsx:81-87); version history/active users are static arrays (constants.tsx:104-114).
- `formatPanelMode`/`setMode` ('presets'|'text') vestigial — edit panel supersedes it (types.ts:21; App.tsx:122,1131).