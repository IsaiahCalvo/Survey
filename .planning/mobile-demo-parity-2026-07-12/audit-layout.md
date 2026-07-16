All evidence gathered. Final report follows.

# Mobile Layout / Safe-Area / Sizing Audit — new app (`src/mobile/` + mobile-conditional chrome) vs old demo (`mobile-expo-go/`)

## 0. What the native shell actually provides (ground truth)

- `mobile-expo/App.tsx:62` — only `paddingTop: insets.top` is applied natively. The WebView extends to the **physical screen bottom and both side edges**. Web content must handle bottom (and, in landscape, left/right) itself.
- `mobile-expo/App.tsx:16-27` — shell injects **only** `--native-safe-area-bottom` (= `max(insets.bottom, 10)`) onto `:root` + `data-native-shell="expo"`. **Top/left/right are never injected.**
- iOS WKWebView with `viewport-fit=cover` (`index.html:5`) reports non-zero `env(safe-area-inset-bottom)` because the WebView touches the screen bottom; **Android WebView reports `env()` = 0 always**. So any rule using raw `env()` without the injected var is dead on Android.
- `index.html:29-32` — `#root` gets `padding: env(...)` on **all four sides**. On iOS-in-shell this adds a second bottom inset on top of the injected-var mechanism (see systemic S1).

## 1. Bottom-anchored / fixed element map (new app)

| Element | File:line | Position | Height | Radius | Inset handling |
|---|---|---|---|---|---|
| Dock (bottom bar) `.mobile-pdf-dock` | mobilePdfViewer.css:1272-1288 | fixed L0/R0/B0, z5850 | `--mobile-viewer-dock-height` = 52px + `--mobile-bottom-inset` (css:2-3) | none (children 50%/19px) | YES (var-first, env fallback) |
| Dock surface `.mobile-pdf-dock__surface` | css:1290-1299 | abs B0 in dock | 36px + inset | none | YES |
| Generic sheet `.mobile-pdf-sheet` | css:1352-1371 | fixed B0 `!important`, z6500 | `var(--mobile-sheet-height, 392px+inset)`; max-height `100dvh - var(--app-chrome-top,34px) - 18px` | 14px top only | Height yes; **no internal bottom padding** |
| Sidebar sheet (hub/spaces/history = PDFSidebar) | src/PDFSidebar.jsx:273-285 | gets `.mobile-pdf-sheet` | `--mobile-sheet-height` = `mobilePanelBaseHeight` + inset (253-261, 274-276) | 14 top | **NO bottom padding — defect #1** |
| Survey sheet (SurveySpacesRail) | src/SurveySpacesRail.jsx:667-688 | gets `.mobile-pdf-sheet`, inline fixed | base 392 or 154+48n (345-347) + inset | 14 top | **NO bottom padding — defect #2** |
| Users sheet `.mobile-pdf-users-sheet` | css:1411-1415 | sheet, height 276+inset | — | 14 top | YES — `padding-bottom: calc(12px + inset)` (the correct pattern) |
| Text/callout defaults sheet `.mobile-pdf-text-defaults` | css:877-901 | fixed B0, z6500 | 432/368/448 + inset | 14 top | YES — `padding-bottom: var(--mobile-bottom-inset)` |
| Rail popovers `.mobile-pdf-tools__popover` | css:447-461 | fixed L47, bottom dock+80/+8 | auto | 7 | YES (via dock var) |
| Backdrop `.mobile-pdf-sheet-backdrop` | css:1343-1350 | fixed inset 0, z6400 | — | — | n/a |
| Left tool rail `.mobile-pdf-tools` | css:224-236 | flex child, height 100% of work area | padding-bottom `calc(dock + 28px)` | — | YES (indirect) but see S1 double-count |
| Properties bar `.mobile-pdf-properties` | css:504-527 | abs top0 left44 in `#chrome-left-host` (AppShell.jsx:2735-2750) | 36px | 0 | top OK; width `calc(100vw - 44px)` ignores landscape insets |
| Home tab bar `.mobile-home-tabs` | hub.css:828-845 | fixed B0, z100 | `--mobile-tabs-h` = 56 + inset (hub.css:271) | — | YES (var-first) |

Dock render/unmount: AppShell.jsx:3325-3335 — dock unmounts whenever any sheet is open (`mobileViewerPanelOpen`, AppShell.jsx:897-902).
`--app-chrome-top` writers: AppShell.jsx:952-1003 and PDFViewer.jsx:25363-25394 — both track `#chrome-top-host` bottom (34px in shell); consistent.

## 2. Concrete layout defects

| # | File:line (new app) | Element | What's wrong | What the demo does |
|---|---|---|---|---|
| 1 | src/PDFSidebar.jsx:273-285 + 549-559; css:1685-1702 | **Spaces sheet exit footer** | Sheet has zero bottom padding; content column is `handle+header+flex-1 panel+44px footer`, so the "Exit Spaces / Regions" button sits flush against the **physical screen bottom** — the bottom ~34px is inside the home-indicator zone and clipped by the rounded corners. The flex-1 panel silently absorbs the inset instead. | `SpacesDrawer.tsx:73` — `paddingBottom: bottomInset + 12` inside the drawer, footer fully above the unsafe zone |
| 2 | src/SurveySpacesRail.jsx:667-688 + 3561; css:1641-1658 | **Survey sheet exit footer** | Same missing bottom padding → `.mobile-survey-exit-footer` (44px) sits in the unsafe zone | `SurveySheet.tsx:209` — `paddingBottom: bottomInset + 10` |
| 3 | src/PDFSidebar.jsx:273-285; css:1902-1945 | **Hub (pages/search/bookmarks) sheet** | Same: `.mobile-pages-actions` row (42px) and pages track bottom out flush at the screen edge, under the home indicator | `HubTray.tsx:62` — `paddingBottom: bottomInset + 14` |
| 4 | src/PDFSidebar.jsx:253-261 | **Spaces sheet height model** | `max(238, 106 + spaces*54 + pageRows*50)` copies the demo's RN row metrics, but the new sheet's fixed chrome is 18 (handle, css:1375-1382) + 58 (header, css:1660-1665) + 44 (footer) = **120px vs the 106px the formula budgets**, and the rows are re-styled desktop `SpacesPanel` rows (SpacesPanel.jsx:1258-1262, 329) that don't measure 54/50px. Sheet height never matches content → "mis-sized" spaces sheet; no re-measure after render (only `expandedPageRows` is live, SpacesPanel.jsx:793-803) | Same formula (App.tsx:240-244) but demo rows genuinely measure 54/50 (`SpaceRow`), chrome ≈106 |
| 5 | src/PDFSidebar.jsx:259 | Bookmarks sheet height | `min(286, max(238, 84+42n))` → min height 238 even for 1 bookmark (big empty gap) | `App.tsx:248` — `min(286, 84 + max(n,1)*42)` → 126 for 1 bookmark |
| 6 | index.html:30 + css:2 | **iOS-in-shell bottom double-count** | `#root` is padded by `env(safe-area-inset-bottom)` (≈34px on iPhone, non-zero inside the WebView) while fixed chrome separately adds `--native-safe-area-bottom` (also 34). The in-flow app column (header, work area, tool rail) ends 34px above the physical bottom, then the rail *additionally* pads `dock(52+34)+28` → rail content stops ~148px above the bottom vs the demo's 114px (`App.tsx:1347`). Whole viewer reads "shifted up / spacing off" on iPhone | Single inset owner: `useSafeAreaInsets` passed explicitly; no global root padding |
| 7 | index.html:29 + css:24-25 | **Top double-count outside the shell** | `#root` padding-top `env(top)` AND `.mobile-pdf-header` height `34px + env(top)` — both apply in a standalone/PWA browser context (in the shell the `html[data-native-shell]` override, css:38-41, fixes only the header, not `#root`) | Demo top bar is the only top-inset consumer (`App.tsx:114, 1290`) |
| 8 | hub.css:680, 930, 1775, 2346 | Home-screen modals/scrims + rail-mode lists | Raw `env(safe-area-inset-bottom)` without the `--native-safe-area-bottom` var → **0 on Android WebView** → document detail modal, templates entity modal, and list bottoms sit under the gesture bar / clipped corners. Inconsistent with the var-first pattern used at hub.css:271, 838, 848 | n/a (demo native) |
| 9 | hub.css:912-926 (+ expo override 964-972) | Home documents/projects/templates lists in **tabs nav mode** (the mode the shell URL uses, `?mobileNav=tabs`) | List bottom padding is `0 0 14px`; the fixed `.mobile-home-tabs` bar is 56px+inset tall and overlays the list → last card hidden behind the tab bar and under the home indicator. The `padding-bottom: 14px + env()` variant exists only for the unused `hub-mobile-nav-rail` mode (hub.css:927-931) | n/a |
| 10 | mobile-expo/App.tsx:17-27 + css:1272/1352/224 + css:508 | **Landscape / notch-side insets** | Shell never injects left/right insets and applies none natively; `#root` env L/R padding (index.html:31-32) doesn't move `position:fixed` chrome. Dock, sheets, backdrops span `left:0/right:0`; rail is flush-left; properties bar is `calc(100vw - 44px)` — in landscape the notch overlaps them | Demo runs inside `SafeAreaProvider` and RN lays chrome out inside the window insets |
| 11 | src/hooks/useAnnotationContextMenu.jsx (used PDFViewer.jsx:174); no `.mobile-*context*` rule in mobilePdfViewer.css | **Context menu** | No mobile styling/migration at all — desktop context-menu metrics render on phone | `FloatingContextMenu` + styles.ts:856-901 — 154px panel, radius 9, padding 6, 34px actions, tap-point anchored, 0.01-alpha dismiss layer |
| 12 | css:1384-1390 vs styles.ts:2626-2632 | Sheet grab handle | One 34×4 handle in an 18px strip for every sheet; demo's survey/format sheets use a 42×4 handle with 7px clearance (hub tray uses 34×4). Spaces drawer in the demo has **no** handle row at all — the new spaces sheet spends 18px on one, worsening defect #4's budget | see left |

Parity notes (NOT defects): dock geometry (52+inset height, 2/20/4 padding, translateY(4) nudge, 36+inset surface) matches demo `BottomActionBar.tsx:31-32` + styles.ts:924-985 exactly, including buttons dipping into the inset zone; the rail-footer `translateY(34px)` hack (css:364-396) is a faithful copy of demo styles.ts:731-760; sheet radius 14/border `#444B57`/backdrop alpha 0.01 all match; users sheet (276+inset, padded) and text-defaults sheet are the two correctly-built sheets; height cap `100dvh - chromeTop - 18px` matches demo `height - topBarHeight - 18` (App.tsx:230-233).

## 3. Rounded-corner clipping / home-indicator exposure list

- Spaces exit button (defect 1), survey exit button (defect 2), pages action pill row (defect 3) — all render into the bottom 34px unsafe zone.
- Home-screen list last rows + document/template detail modals on Android (defects 8, 9).
- Scrollable areas that can extend under the indicator: SpacesPanel list (flex-1 above a flush footer, SpacesPanel.jsx:1251-1253), `.mobile-pages-track` (css:1837-1845), hub `documents-mobile-list`/`projects-mobile-layout`/`templates-mobile-layout` (hub.css:912-931, 964-972). Safe by construction: `.mobile-pdf-users-sheet__list` (css:1435-1441), `.mobile-pdf-text-defaults__scroll` (css:987-1008), `.mobile-pdf-tools__main` (padded by css:227).

## 4. Sheet-by-sheet geometry: demo vs new

| Sheet | Demo height | Demo bottom pad | New height | New bottom pad | Verdict |
|---|---|---|---|---|---|
| Spaces | `cap(max(238,106+54s+50r))` (App.tsx:240-244), pad `inset+12` | yes | same base + inset (PDFSidebar.jsx:256) | **none** | height formula stale vs real rows; footer unsafe |
| Survey setup | 392 / 154+48n (App.tsx:235-239), pad `inset+10` | yes | same base (SurveySpacesRail.jsx:345-347) | **none** | footer unsafe; demo's marker-edit sheet (314+checklist, App.tsx:234) has no mobile counterpart |
| Hub pages/search/bookmarks | 310 / 232·292 / min(286,84+42·max(n,1)) (App.tsx:247-251), pad `inset+14` | yes | 310 / 232·292 / min(286,max(238,84+42n)) (PDFSidebar.jsx:258-260) | **none** | bookmarks floor wrong; footer unsafe |
| History | 264 (App.tsx:245), pad `inset+14` | yes | 264 (PDFSidebar.jsx:254) | **none** | footer unsafe |
| Active users | 276 (App.tsx:246), pad `inset+14` | yes | 276 + pad `12px+inset` (css:1411-1414) | yes | OK |
| Text/format defaults | AnnotationEditPanel, scroll pad `max(inset,10)+6` (AnnotationEditPanel.tsx:597) | yes | pad `inset` + scroll pad 16 (css:885, 990) | yes | OK |
| Context menu | 154px floating panel (styles.ts:861-871) | — | not migrated | — | gap |

## 5. Systemic safe-area strategy problems

- **S1 — Three competing inset mechanisms, no single owner.** (a) global `#root` `env()` padding on all sides (index.html:29-32), (b) injected `--native-safe-area-bottom` consumed via `--mobile-bottom-inset` by fixed chrome (css:2), (c) ad-hoc per-element raw `env()` (css:24, hub.css:680/930/1775/2346). On iOS-in-shell (a)+(b) both fire → bottom counted twice for in-flow layout; on Android-in-shell only (b) fires → every raw-`env()` consumer collapses to 0. The demo has exactly one owner (`useSafeAreaInsets` → explicit `bottomInset`/`topBarHeight` props). Fix direction: kill `#root` bottom padding when `data-native-shell` (or in the mobile viewer entirely), and route every bottom-inset consumer through `--mobile-bottom-inset`.
- **S2 — Only the bottom inset crosses the native/web boundary.** Shell injects bottom only (mobile-expo/App.tsx:17-27); top is native padding (App.tsx:62); left/right handled by nobody for fixed elements → landscape notch overlap is guaranteed. Either inject all four insets or add native L/R padding.
- **S3 — `.mobile-pdf-sheet` is half a contract.** It supplies position/height/radius but leaves bottom padding to each consumer; 2 of 5 consumers implement it. Demo bakes `paddingBottom: inset + 10..14` into every sheet. Moving `padding-bottom: calc(12px + var(--mobile-bottom-inset))` (or a `::after` spacer) into `.mobile-pdf-sheet` itself fixes defects 1-3 in one place — but note PDFSidebar/SurveySpacesRail footers are siblings of flex-1 content, so the padding must live on the sheet, not the panels.
- **S4 — Sheet heights are open-loop constants transplanted from RN.** The demo's formulas encode measured RN row heights; the web sheets reuse desktop panels whose real heights differ, and nothing re-measures (except the partial `expandedPageRows` callback, SpacesPanel.jsx:793-803). Any restyling silently breaks the fit — this is the root of "spaces sheet mis-sized". Fix direction: measure content (`scrollHeight`) and clamp to the existing max-height, instead of predicting.
- **S5 — Injection-timing fragility.** `data-native-shell`/`--native-safe-area-bottom` exist only after JS injection (before-content-load + onLoadEnd re-inject, mobile-expo/App.tsx:79, 88); CSS defaults fall back to `env()` which diverges per-platform (see S1). A meta/query-param-driven default (`nativeShell=expo` is already in the URL) would make first paint deterministic.