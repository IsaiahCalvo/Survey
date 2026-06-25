# Mobile Gesture Adaptation Design Spec — Survey Expo App

> **STATUS: DRAFT — pending a hands-on sandbox test and user sign-off.**
> Every row marked **PENDING LIVE-TEST** has a recommendation but no final winner; those
> are to be decided on a physical device in the gesture sandbox. Items not so marked are
> design-locked subject only to the sign-off above.

---

## 0. Purpose & locked decisions

**Purpose.** For every desktop annotation tool (14) and every desktop input gesture (~27),
this document specifies the mobile (touch) equivalent: the recommended mapping, the
alternatives considered, the best-in-class app that sets the standard, and the risk. The
design is phone-first and must scale up cleanly to tablet (tablet = desktop visual UI + these
same touch gestures) and later to stylus. The target Expo app lives at `mobile-expo-go/`
(`App.tsx` is the current mockup). It already declares `react-native-gesture-handler ~2.28.0`
and `react-native-svg 15.12.1` in `mobile-expo-go/package.json`, but **App.tsx currently uses
only `PanResponder`** — RNGH is declared but unused. Adopting RNGH (declarative Gesture API)
is the foundational migration that all gestures below depend on.

### CORE LAW (locked)

**One finger performs the ACTIVE TOOL'S action. Two fingers ALWAYS navigate (pan +
pinch-zoom), in EVERY mode.** This fixes the current "every tool scrolls" bug — the Pan tool
is simply "the tool whose one-finger action is scrolling".

### Three modes (locked) — set by the active tool

1. **Navigate** (pan tool): 1 finger pans; 2 fingers pan/zoom.
2. **Draw / Create** (any annotation tool): 1 finger draws/creates; 2 fingers pan/zoom (works
   mid-draw without abandoning the stroke).
3. **Select** (select tool): 1-finger tap = select, drag-empty = lasso, drag-object = move,
   drag-handle = resize/rotate; 2 fingers pan/zoom.

### Universal gestures (locked, all modes)

| Gesture | Action |
|---|---|
| Two-finger drag | Pan |
| Two-finger pinch | Zoom (works mid-draw) |
| Two-finger **single** tap | Undo (short safety delay + hold-to-repeat; visible button fallback; Settings toggle to disable) |
| Three-finger **single** tap | Redo |
| Double-tap empty page | Zoom-to-fit (toggle fit-width ↔ fit-page) |
| Double-tap an annotation | Edit it |
| Long-press an annotation | Open context menu (the right-click replacement) |
| Long-press empty canvas | Paste / page actions |

Also locked: **no radial menus**; tool switching is the **left rail** only (no hotkeys, no
radial); **no shake-to-undo**; rotation handle **tap = numeric degree input** / **drag = 15°
snap** (snap toggleable off in Settings); chrome stays at four surfaces (left rail, top bar,
contextual formatting bar, bottom panel) but **denser**, not more surfaces; desktop
spacebar-pan has **no** mobile equivalent (two-finger pan covers it); hardware-keyboard
shortcuts are a deferred tablet-era nice-to-have; stylus is finger-only for now but the
architecture must leave room for "stylus draws / one finger scrolls" later.

### PREREQUISITES (apply to every RNGH row below)

> **All gesture rows assume RNGH is installed and the app root is wrapped in
> `GestureHandlerRootView`** (it must be an ancestor of every `GestureDetector`; it does NOT
> need to be outside `SafeAreaProvider`). This wrapping is a Day-1 task (build order P0).
> **RNGH gesture detectors wrap React Native `View`s, not `react-native-svg` elements.** Two
> hit-testing strategies are available and must be chosen per interaction:
> (a) an invisible RN `View` overlay grid sized to each annotation's bounding box, wired to
> `GestureDetector`; or (b) `react-native-svg`'s built-in `onPress` / `onPressIn` responders on
> each SVG element for simple taps, with a full-page RNGH gesture group for multi-touch
> navigation. **Recommendation: use (a) overlay `View`s for anything that needs drag/resize
> handles or precise hit-slop, and (b) SVG-native `onPress` only for flat tap-to-select on
> dense imported marks.** Every row that says "RNGH gesture on annotation" inherits this rule.
> Native DOM concepts (`localStorage`, `data-readonly` attribute, `createPortal`,
> `IntersectionObserver`, `pointerEvents` web semantics, hover/cursor) have **no** RN
> equivalent and their mobile substitutes are called out where they appear (`AsyncStorage`, an
> `isReadOnly` prop/context, RN `Modal`/portal, `FlatList` viewability, no hover layer).

---

## 0.6 Live-test verdicts — RESOLVED 2026-06-24 (these SUPERSEDE the cells noted)

After a hands-on sandbox test on a physical iPhone, these previously-pending items are now **LOCKED**:

1. **Multi-select** → ship **BOTH** tap-to-select/toggle **AND** lasso, with **add & subtract**
   (the user explicitly liked having lasso + click-select + subtract). The lasso must be
   **FREEFORM** (draw a loop around objects), **not** a rectangular marquee — optionally offer a
   freeform↔rectangle choice, with **freeform as the default**. *Supersedes the "leans V1
   rectangular" recommendation in §11 and the rectangular-marquee implication in §1's
   "drag-empty = lasso" cell.*
2. **Context menu** → **long-press only** (the ~350 ms timing is confirmed good). **DROP the
   floating tap-select Quick-Bar entirely.** Every per-object action lives in the long-press
   menu. *Supersedes §7.2 (Quick-Bar) and every "ship both Quick-Bar + long-press" line in §7,
   §5, §10.*
3. **Resize constrain** → **lock-aspect-ratio is a toggle item INSIDE the long-press context
   menu**, not a formatting-bar toggle and not a floating bar. Draw-time **hold-to-snap is CUT**
   (de-prioritized) unless revisited later. *Supersedes the formatting-bar lock-aspect toggle +
   hold-to-snap recommendations in §4.2 and §6.2.*
4. **Rotation 15° snap** → toggled in **mobile Settings ONLY**; it is **not** interactable inside
   the PDF editing viewer (no formatting-bar toggle). Tap-handle = numeric degree input and
   drag = 15° snap behaviors remain. *Supersedes the "formatting-bar toggle, default ON"
   recommendation in §6.3 and §9.3.*

**Open feel issues** observed in the sandbox are being resolved by the **renderer-stack choice**,
not by polishing the DIY sandbox: (a) pan feels off after zoom (pinch focal-anchoring); (b) the
**pen is latent** (react-native-svg on the JS thread can't hit sub-frame ink — fundamental, not
tunable); (c) a pinch sometimes "clears what was drawn" (the two-finger-tap undo misfiring on
pinch-release — the `Exclusive(pan,tap)` + `maxDuration` fix in §1/§8.1). See
`2026-06-24-mobile-pdf-renderer-research.md` for the OSS render+ink+select stack evaluation.

---

## 1. Gesture Conflict Matrix (the spine)

This proves no two gestures collide. Rows = every distinct touch gesture. Columns = the three
modes, split by whether the gesture lands **on an annotation** vs **on empty canvas**. Each
cell states the single resulting action. "—" means the gesture cannot meaningfully occur in
that cell. RNGH disambiguation notes follow the table.

| Gesture | Navigate · on annotation | Navigate · empty | Draw/Create · on annotation | Draw/Create · empty | Select · on annotation | Select · empty |
|---|---|---|---|---|---|---|
| **1-finger tap** | Pan tool: no-op (tap does not select in Navigate) | no-op | Place/commit a point of the tool's action at that spot (e.g. counter drop, text place) | Begin tool action / place | **Select** the annotation | **Deselect** all |
| **1-finger drag** | Pan the document | Pan the document | Draw the tool's stroke/shape starting on top of the annotation | Draw the tool's stroke/shape | On body → **move**; on handle → **resize/rotate**; on connector/line → callout whole-move | **Lasso** select |
| **1-finger double-tap** | **Edit** the annotation (auto-switch to its edit surface) | **Zoom-to-fit** toggle | **Edit** the annotation | **Zoom-to-fit** toggle | **Edit** the annotation | **Zoom-to-fit** toggle |
| **1-finger long-press** | **Context menu** for the annotation | **Paste / page actions** menu | **Suppressed** (in-progress stroke guard; see §7.6) | **Suppressed** in Draw mode | **Context menu** for the annotation | **Paste / page actions** menu |
| **2-finger drag** | **Pan** | **Pan** | **Pan** (mid-draw, auto-commits stroke) | **Pan** | **Pan** | **Pan** |
| **2-finger pinch** | **Zoom** (focal = centroid) | **Zoom** | **Zoom** (mid-draw, auto-commits stroke) | **Zoom** | **Zoom** | **Zoom** |
| **2-finger single tap** | **Undo** | **Undo** | **Undo** | **Undo** | **Undo** | **Undo** |
| **3-finger single tap** | **Redo** | **Redo** | **Redo** | **Redo** | **Redo** | **Redo** |
| **Handle drag** (1 finger on a selection handle) | — (no handles in Navigate) | — | — (handles not shown in Draw) | — | **Resize** (corner/mid), **rotate** (mtr handle), endpoint/knee/midpoint drag | — |

### Conflict-resolution wiring (RNGH)

- **Pointer-count is the primary discriminator.** The one-finger tool gesture
  (`Gesture.Pan().minPointers(1).maxPointers(1)` — note `maxPointers(1)` is **deliberately
  avoided** for the draw stroke, see next bullet) and the two-finger navigation group sit in
  `Gesture.Simultaneous(drawGesture, Gesture.Simultaneous(twoFingerPan, twoFingerPinch))`.
  **NOT `Gesture.Race`** — a Race winner blocks the others, which would kill mid-draw pan/zoom.
  Simultaneous composition is mandatory so a second finger can land mid-stroke.
- **Mid-draw second finger does NOT use `maxPointers`.** `maxPointers` makes RNGH *fail* the
  gesture (not cleanly end it) when a second finger lands, dropping the stroke silently with
  no `onEnd`. Instead the draw gesture has no max; when the two-finger nav group activates, its
  `onStart` explicitly flush-commits the in-progress stroke (the mobile `zoomGeneration`
  equivalent, §2/§9.6) before the nav transform applies.
- **2-finger tap (undo) vs 2-finger pan.** Compose as `Gesture.Exclusive(twoFingerPan,
  twoFingerTap)` — if the pan activates (movement past `minDistance`), the tap fails; do NOT
  rely on a hand-tuned 8 dp distance check. Recommend `Gesture.Tap().numberOfPointers(2)` with
  `maxDuration(400)` so a held pan never reads as a tap; let RNGH's recognizer competition (not
  manual spread math) decide tap-vs-pinch.
- **3-finger tap (redo) vs OS gestures.** iOS three-finger system gestures (copy/paste edit
  menu) fire only inside text fields → no conflict on the canvas. Android: the three-finger
  screenshot is a **Samsung/OEM** addition (not AOSP), present only on some devices. Mitigation
  is `View.setSystemGestureExclusionRects` (API 29+) over the canvas, **not** `FLAG_SECURE`
  (which only blanks screenshots, it does not reroute the gesture). **PENDING LIVE-TEST on a
  Samsung device.**
- **Double-tap empty (fit) vs double-tap annotation (edit).** Two `Gesture.Tap().numberOfTaps(2)`
  detectors: the **annotation** detector is primary; the **page-background** detector is
  `requireExternalGestureToFail(annotationDoubleTapRef)`, so background-fit only wins when no
  annotation was hit. A hit-test alone is insufficient — the `waitFor`/`requireToFail` ordering
  is mandatory, otherwise the two race.
- **Single-tap select vs double-tap edit.** The select tap (`numberOfTaps(1)`) must
  `requireExternalGestureToFail` the edit tap (`numberOfTaps(2)`), accepting a small latency on
  single-tap. A `justTappedAtRef` cooldown (mirroring desktop's `justDraggedAtRef`) prevents a
  select→reselect race from swallowing the double-tap-to-edit.
- **Handle drag vs page pinch.** A per-handle `Gesture.Pan()` must call
  `.blocksExternalGesture(pagePinchRef)` (or be composed `Gesture.Race(handlePan, pagePinch)`)
  so the first finger landing on a handle wins and the page pinch cannot hijack a resize.
- **Handle drag vs Navigate-mode one-finger pan.** Handles are only shown in Select mode;
  the per-handle pan is `enabled={activeMode === 'select'}` so it never competes with the
  Navigate-mode one-finger page pan.

---

## 2. Navigation & Zoom

Mode 1 architecture **DECISION**: the document container uses **full RNGH ownership of pan in
all modes** (not a hybrid where `ScrollView` scrolls in Mode 1). The page host is a plain
`View` with an `Animated.ValueXY` translate + scale transform driven by RNGH. Rationale:
toggling `scrollEnabled` between modes plus owning pan in Modes 2/3 anyway makes a hybrid
strictly more complex with two code paths for the same offset. The cost — momentum fling,
elastic bounce, and scroll indicators that a native `ScrollView` gives for free — must be
re-implemented (`Animated.decay()` for fling V1; Reanimated `withDecay` later). **This is a
real risk item, not a detail.** A badly tuned decay makes the whole app feel wrong.

Zoom-preference persistence: `src/utils/zoomController.js` calls `window.localStorage` directly
and no-ops under `typeof window === 'undefined'`, so on mobile it silently persists nothing. A
**mobile storage adapter** (inject an `AsyncStorage`-backed interface, or fork the module) is
required before fit-mode persistence works. `viewerShared.js` exports `coerceScrollMode`
(`'single' | 'continuous'`); the mobile app must own its own `scrollMode` state atom
independently of desktop `PDFViewer.jsx:869`.

| Desktop behavior (file:line) | Recommended mobile gesture | Alternatives considered | Best-in-class app | Risk / notes | Pending live-test? |
|---|---|---|---|---|---|
| Pan tool (H) + left-drag scroll — `PDFViewer.jsx:4616-4693` | **Mode 1: one-finger drag pans.** RNGH `Pan().minPointers(1)` mutates an `Animated.ValueXY` driving the page transform. | Native `ScrollView` scroll; RNGH-wrapped `ScrollView`. Rejected — cannot block 1-finger scroll when a draw tool is active. | PDF Expert, Notability | Full RNGH ownership means momentum fling / bounce / indicators are manual (`Animated.decay`). Badly-tuned decay = whole app feels wrong. In Modes 2/3 this 1-finger handler is disabled by mode gate. | No |
| Two-finger trackpad scroll — `viewerShared.js` wheel path | **Two-finger drag pans in ALL modes.** RNGH `Pan().minPointers(2).maxPointers(2)`, in `Gesture.Simultaneous` with the pinch and the tool gesture. | Let native scroll handle it — breaks in Mode 2. | Notability, PDF Expert | Shares pointer stream with pinch; Simultaneous wiring per §1. | No |
| Ctrl/Cmd+wheel cursor-anchored zoom — `PDFViewer.jsx:4904-4916`; `viewerShared.js` `getSmoothPdfjsWheelZoom` | **Two-finger pinch zooms in ALL modes**, focal = centroid (`event.focalX/focalY`). Mid-draw pinch auto-commits the stroke first. | Native `pinchGestureEnabled`; Reanimated worklet path (later). | GoodNotes, PDF Expert | JS-thread `Animated` may lag at high annotation density; acceptable V1, flagged for Reanimated. Offset + scale must update atomically to avoid pop. | No |
| Ctrl/Cmd +/- step zoom — `PDFViewer.jsx:21384-21393` | **No gesture needed.** Top-bar +/- buttons cover discrete steps. | — | — | — | No |
| Cmd+0/1/2 fit modes — `PDFViewer.jsx:21369-21382`; `zoomController.js:11-16` | **Top-bar zoom-mode picker** (`App.tsx:1792-1862`, Fit Page / Width / Height) **plus** double-tap empty page = toggle Fit Width ↔ Fit Page. | Long-press top bar; swipe down; per-mode buttons. | GoodNotes, PDF Expert | Double-tap branch on background vs annotation per §1 (`requireToFail` ordering). | No |
| Double-tap empty page = fit toggle (locked) | RNGH `Tap().numberOfTaps(2)` firing only on page background; toggles `fitPage` ↔ `fitWidth`, animated via `Animated.timing`. | Single double-tap anywhere (collides with edit). | GoodNotes, PDF Expert | Tight `maxDistance` (~10 pt) so an aborted pan isn't read as double-tap. | **PENDING LIVE-TEST** (toggle animation feel; background-vs-annotation disambiguation) |
| Spacebar pan — `PDFViewer.jsx:4616-4693` | **No equivalent needed.** Two-finger drag covers pan from any tool, any mode. | — | — | Explicit non-port (locked). | No |
| Plain wheel scroll | One-finger drag (Mode 1) / two-finger drag (Modes 2–3). | — | — | Touch unifies scroll and pan. | No |
| Scroll mode `'continuous'` vs `'single'` — `PDFViewer.jsx:869`; `viewerShared.js` `coerceScrollMode` | **Continuous is the mobile default.** Single-page deferred. Mobile owns its own `scrollMode` atom. | Paginated swipe. | PDF Expert (continuous), Notability (paginated option) | RNGH-owned pan ⇒ explicit fling (`Animated.decay`). | **PENDING LIVE-TEST** (fling/momentum feel; continuous vs paginated for field users) |
| Page-number input — `PDFViewer.jsx:20899-20930` | Tap page pill → numeric keyboard → confirm. Already in mock (`App.tsx:1792-1816`, `keyboardType="number-pad"`). | Swipe-up; scrubber. | PDF Expert | Commit on blur and `onSubmitEditing` (already wired). | No |
| Prev/Next page — `goToPage()` `PDFViewer.jsx:17557-17700` | Prev/Next buttons in top bar (present); horizontal swipe only if paginated mode ships. | Hardware arrows (tablet). | GoodNotes, PDF Expert | Follows `pageOrder` filtered by active space. | No |
| Current-page tracking (IntersectionObserver) — `PDFViewer.jsx:19596-19662` | `FlatList` `onViewableItemsChanged`, or scroll-offset math in the pan handler; debounced. | IntersectionObserver (unavailable in RN). | — | `FlatList` recommended for >5-page docs (virtualization). | **PENDING LIVE-TEST** (`FlatList` vs `ScrollView` perf on a 50-page plan) |
| Zoom modes FIT_PAGE/WIDTH/HEIGHT/MANUAL — `zoomController.js:11-16` | All via the top-bar picker (mock has them). MANUAL = any pinch/step out of a fit mode. Persist to `AsyncStorage` via the storage adapter. | Drop Fit Height on phone. | PDF Expert | Mock's `pageWidth/Height` is a static ratio; real fit-scale must come from container dims × natural page size. | No |
| Cursor-anchored zoom — `viewerShared.js` `getSmoothPdfjsWheelZoom` | Pinch focal point = centroid = anchor (`focalX/focalY`). | Fixed-center zoom (disorienting). | GoodNotes, PDF Expert | Offset+scale atomic; Reanimated upgrade for UI-thread. | No |
| Zoom clamp 10–500% — `zoomController.js:23-25` | `clamp(baseScale * event.scale, 0.1, 5.0)`; soft rubber-band near limits. | Hard stop. | PDF Expert, GoodNotes | Rubber-band formula `limit + excess*0.2` is **iOS-HIG convention, not sourced from code** — tune live. | No |

**Discoverability (whole section).** Two-finger pan, pinch, two-/three-finger-tap undo/redo,
double-tap fit, and long-press menus have **no visible affordance**. A **first-launch gesture
tour / coach marks** and a **gesture reference sheet in Settings** are required, not optional,
for a field app whose users are not annotation power-users.

---

## 3. Drawing tools — pen, highlighter, eraser

Desktop pen/highlighter route through `FabricDrawingCanvas` (`PencilBrush`,
`isDrawingMode=true`); each stroke fires `path:created`, serializes to Fabric JSON, commits via
`flushSync`. **Default pen color is `#ff0000`** (`PDFViewer.jsx:3121`) — not `#DC3545`. Width
default 3; opacity is separate `strokeOpacity` state. The serialized highlighter path's
discriminator is **`pathJSON.tool === 'highlighter'`** (Fabric's `type` stays `'path'`); do not
key off `type`.

**Zoom-flush has TWO desktop paths:** the `zoomGeneration` useEffect
(`FabricDrawingCanvas.jsx:~900-912`) AND a `ResizeObserver` on the container that flushes
mid-draw strokes directly on resize (`~835-857`). On mobile a pinch arrives as a **container
resize**, so the mobile equivalent of the flush is a **size-change listener on the page host
that flushes the active RNGH gesture accumulator** — not just a React prop signal. Wire the
flush in the two-finger nav group's `onStart` and on container `onLayout` size change.

### 3.1 Pen

| Desktop behavior (file:line) | Recommended mobile gesture | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Left-drag draws; `PencilBrush` captures every point | **One-finger drag** (RNGH `Pan`, no `maxPointers` — see §1) feeds points into the path accumulator | `PanResponder` (current stub); direct SVG `d` build | Notability, PDF Expert | Map screen→viewBox via `effectiveScale` exactly as desktop. A second finger mid-stroke triggers nav `onStart` flush, **not** a `maxPointers` fail. | No |
| Commit on `path:created` | Commit on RNGH `onEnd` | 100 ms debounce (misses quick strokes) | Notability | RNGH end == mouseup. | No |
| Zoom-start flush (`zoomGeneration` + ResizeObserver) | Mid-pinch flush via container-resize listener + nav-group `onStart` | Discard stroke (bad) | GoodNotes | The ResizeObserver path fires first on real resize — this is the correct mobile mechanism, not the prop signal. | No |
| Hotkey `P` | Left-rail pen button | — | any | — | No |
| Color / opacity / width (`PDFViewer.jsx:3121-3125`) | Formatting bar: color swatch (picker modal), opacity slider 0–100%, size stepper | full-screen picker; pinch-resize width (conflicts) | Procreate, PDF Expert | Persist per-tool via `AsyncStorage` (mirror `useDocumentToolPreferences`). Stepper safer than slider on phone. | No |

### 3.2 Highlighter

| Desktop behavior (file:line) | Recommended mobile gesture | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Same `PencilBrush`, `width = Math.max(strokeWidth, 8)` (`FabricDrawingCanvas.jsx:328`); discriminator `tool === 'highlighter'` | **One-finger drag**, same recognizer as pen, branched on active tool | per-tool recognizer (needless) | Notability | Replicate `Math.max(size, 8)` in page-space before `effectiveScale`. | No |
| Opacity 30% baked into `rgba(255,193,7,0.3)` | Apply the rgba alpha to the SVG path **`stroke`** (or `strokeOpacity`), **never** the SVG element `opacity` (which dims handles too) | element `opacity` (wrong) | PDF Expert | Validate blend visually vs desktop. | **PENDING LIVE-TEST** (blend/opacity match) |
| Color hardcoded yellow | Formatting bar: 5-color preset tray; opacity 10–60% clamp | full picker (dull over text) | GoodNotes | Restricted palette prevents no-contrast picks. | No |
| Hotkey `H` | Left-rail highlighter button | — | — | — | No |
| Pen↔highlighter hot-swap without remount (`FabricDrawingCanvas.jsx:865-875`) | Mobile canvas reacts to `activeTool` prop in `useEffect`; no teardown | remount (flicker, lost stroke) | — | — | No |

### 3.3 Eraser

Modes `'partial'` (boolean path subtraction; shapes/callouts whole-only) and `'entire'`
(full-stroke), persisted to `localStorage` (`PDFViewer.jsx:4610`) → `AsyncStorage` on mobile.
Commit gate is **stricter than a count**: it fires only if
`finalDeletedAnnotationIds.length > 0 || finalChangedAnnotationIds.length > 0`, where *changed*
means the serialized JSON actually differs (`FabricEraserCanvas.jsx:637-641`). Replicate the
**JSON-diff guard**, not a simple count, or grazing a stroke triggers spurious saves. Hit-test:
`eraserStrokeTouchesObject` (`eraserHitTest.js:~88`) passes `eraserRadius` as `tolerance` into
`isPointOnObject`, which internally adds `strokeWidth/2`. There is an **`isLoading`/hydration
state** (`enlivenObjects`) that drops erase gestures until annotations are loaded into the
buffer.

| Desktop behavior (file:line) | Recommended mobile gesture | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Left-drag erases; accumulates points | **One-finger drag**; commit on `onEnd` | — | Notability, PDF Expert | — | No |
| Two modes (`partial`/`entire`) (`PDFViewer.jsx:30700-30726`) | Formatting bar two-segment toggle "Partial \| Full Stroke" + **mode badge ("P"/"S") on the eraser rail button** so the idle mode is visible before opening the bar | long-press picker; hide in Settings | Notability | Badge fixes discoverability (Notability shows mode sub-icon on the rail button). | No |
| Eraser size (default 20, page-space) | Formatting bar `−/+` stepper, 5 stops 8/14/20/30/48 (page-space). **Visual ring + hit radius scale with `eraserSize * effectiveScale`**; clamp on-screen ring ≥ ~28 dp so it never goes sub-finger at low zoom | continuous slider | Procreate, PDF Expert | At `effectiveScale < 1` page-space radii shrink below finger width — the dp clamp is mandatory. | No |
| Visual cursor ring (`PDFViewer.jsx:27245-27262`) | Touch-follow ring (`Animated.View`) on touch-start, hidden on touch-end | static crosshair; none | Procreate | `Animated.ValueXY` has ~1 JS-frame (~16 ms) lag — **acceptable V1 because the ring is cosmetic; upgrade to Reanimated `useSharedValue` in the Reanimated pass.** | **PENDING LIVE-TEST** (ring feel) |
| Commit gate (`:637-641`) | Replicate the **JSON-diff** guard (changed = serialized JSON differs), not a count | always commit (save churn) | — | — | No |
| Partial erase `booleanErasePath` (`:366-398`) | Same shared geometry module. **Default mobile eraser larger** (finger ≫ cursor). **Performance risk:** boolean polygon ops run synchronously on the JS thread; on stroke-dense pages (12k+ imported strokes, `FabricEraserCanvas.jsx:~928`) one swipe can block tens–hundreds of ms. Mitigation: bounding-box pre-filter to the nearest N strokes, or offload via JSI/NativeModule | full-stroke only (loses parity) | Notability | First-class perf concern, not just finger precision. Zoom-aware effective radius is critical. | **PENDING LIVE-TEST** (precision + frame drops) |
| Survey Marker delete via eraser → `onSurveyMarkerDeleted` (`PageAnnotationLayer.jsx:3196`) | Same callback; center-distance hit-test `(radius + eraserSize)` | — | — | — | No |
| Hydration `isLoading` gate | Show a spinner on the eraser ring / disable the tool until hydration completes; never silently drop the first swipe | — | — | UX decision required. | No |
| Zoom-start flush | Container-resize listener flush (as §3 preamble) | discard | — | — | No |

### 3.4 Eraser ergonomics

| Desktop behavior | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| No auto-return after erasing | **Notability-style auto-return toggle** in Settings (deferred screen), **off by default** for parity | always / never auto-return | Notability, GoodNotes | Store previous-tool ref; ship when Settings exists. | No |
| No erase-on-the-fly hotkey | No equivalent; two-finger undo covers quick mistakes. **Note:** undo granularity is per-commit, so a *partial* carve-out may not be individually undoable — relevant if auto-return ships | second-finger scrub (conflicts with CORE LAW) | — | — | No |

**Post-erase double-tap caveat.** After erasing, invalidate the SVG bounding box before the
double-tap recognizer re-arms, so a double-tap on a now-empty region resolves to zoom-to-fit
(not a stale "edit annotation" hit).

---

## 4. Shape & vector tools — rect, ellipse, line, arrow

**Corrections baked in:** (1) the ellipse tool **draws a circle** during creation —
`radius = Math.max(abs(dx), abs(dy)) / 2` (`PageAnnotationLayer.jsx:6845`) — a **free ellipse
is only produced by non-uniform resize after creation**. (2) Rect/ellipse **double-tap is a
no-op** on desktop (`PDFViewer.jsx:~28310` early-returns for rect/circle/ellipse); their handles
appear from **single-tap selection** (`SVGSelectionOverlay` renders when `selectedIds.size===1`),
not from any "bbox edit mode". Only line/arrow enter `editType='bbox'` via double-click. (3)
**There is no rect/ellipse keyboard hotkey** — Q = callout (`PDFViewer.jsx:21310`), L = line, A
= arrow. (4) Desktop has **no Shift-constrain during draw** — `shiftKey` is not read in the
shape `handleMouseMove`; constrain exists only on resize (Cmd/Ctrl → `uniformScaling`). Freehand
shape recognition is **OUT**.

Post-v2.0, the **SVG annotation layer** renders endpoint/midpoint handles on single-select
(`SVGAnnotationLayer.jsx` `isLineType && !lineInBboxMode` branch); the mobile spec maps to the
**SVG handle system**, not Fabric `Control` objects.

### 4.1 Drag-to-create

| Desktop behavior (file:line) | Recommended mobile gesture | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| `mouse:down` seeds shape, `mouse:move` expands (`PAL:6683-6848`) | One-finger drag seeds→expands→commits; two-finger pinch mid-draw pans/zooms (Simultaneous) | tap-corner/tap-corner (Xodo) | PDF Expert, Drawboard | Min committed size (~12 pt); auto-select with handles after create. | No |
| Ellipse: `radius = max(abs(dx),abs(dy))/2` → **draws a circle** | One-finger drag **creates a circle**; the **ellipse comes from non-uniform resize afterward** | — | PDF Expert | Serialize rx/ry as desktop does (scaleX/scaleY × radius). | No |
| Line/arrow draw identical; arrowhead built at `mouse:up` (`PAL:7185-7219`) | One-finger drag; arrowhead style chosen in formatting bar | — | Drawboard | Show a distance/angle pill during draw. Arrow = `Group(Line+head)`; confirm round-trip of `data.type:'arrow'` + `arrowheadStyle`. | No |
| 1×1 shapes possible | Min committed size; sub-min drag snaps to minimum (silent) | "too small" toast | GoodNotes | — | No |

### 4.2 Constrain (PENDING LIVE-TEST)

Desktop has **no draw-time Shift-constrain**; this is a net-new mobile affordance. **Ship
BOTH:** (A) **hold-to-snap during draw** — pause the drag ~300–400 ms (threshold to be
calibrated; the existing GestureSandbox prototype uses **300 ms** and implements it on
**resize-end**, not draw-time, so the draw-time timer version is unprototyped) → rect snaps to
square, circle stays circle, line/arrow snap to nearest 0/45/90/135°; (B) a persistent
**lock-aspect / lock-angle toggle** in the formatting bar (per-tool, persists). Implementation:
arm a `setTimeout` on each `onUpdate` when velocity drops below a threshold; **clear it on
finger-lift** (else a post-release snap fires); compute velocity per-frame to reject Bluetooth
input jitter. **Two-finger-on-object resize is DROPPED** — it contradicts the CORE LAW
(two fingers always navigate); proportional resize comes from the formatting-bar toggle (B) and
the draw-time hold-to-snap (A), never from a two-finger object gesture.

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| No draw-time Shift-constrain (`shiftKey` absent in `PAL:6833-6854`) | Ship **A (hold-to-snap)** + **B (formatting-bar toggle)** | tap-before-draw mode (extra tap) | Drawboard (toggle), Procreate (hold-to-snap) | Threshold needs live calibration; line/arrow show a blue dashed axis guide on snap. Timer cleared on lift. | **YES** |
| Resize constrain: Cmd/Ctrl → `uniformScaling` (`PAL:5741-5744`) | **Formatting-bar lock-aspect toggle** for resize. **No two-finger-on-object gesture.** | two-finger object resize (CORE LAW violation — rejected) | Drawboard | — | No |

### 4.3 Line/arrow endpoint & midpoint editing

Endpoint/midpoint handles come from the **SVG layer** on single-select. Midpoint drag converts
`Line`→bezier `Path`; dragging midpoint back within the snap zone reconverts to `Line`.

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Drag start/end handle (SVG handles on single-select) | One-finger drag on the handle (≥44 pt touch target via overlay `View`/`hitSlop`) | precision-cursor mode | Drawboard | Scale handle hit area up for touch; highlight on press. | No |
| Drag midpoint → curve; snap-back zone (`PAL:~1424-1429`) | One-finger drag on midpoint; **scale 8 px snap zone → ~16 pt** for touch | long-press to enter curve mode | Drawboard | Surface the threshold as a tunable constant. | No |
| Arrowhead follows endpoint (`Group(Line+head)`) | Automatic; no new gesture | — | Drawboard | Confirm angle recompute fires on every RNGH `onUpdate`. | No |
| Hover handle glow/tooltip | No hover; handles always visible on select. **Long-press on a handle = handle tooltip; long-press on the object body = context menu** — disambiguate by hit zone; the handle's `LongPress` needs higher `minDuration` than the body's, or `waitFor` chaining, or the tooltip is unreachable | — | GoodNotes | Explicit RNGH ordering required, not just "different zones". | No |

### 4.4 Arrowheads

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| 6 styles `ARROWHEAD_STYLES` (`PAL:238-245`); default solidTriangle | Horizontal 6-icon strip in the formatting bar (arrow tool active); live-applies to selected arrow | dropdown (too small) | Drawboard | 36 pt icons; scrollable strip if tight with rail open. | No |
| Post-draw via `editModal <select>` (`PAL:9840-9862`) | Bottom panel (slide-up) with arrowhead icon buttons; quick-bar shortcut | inline cycle | Drawboard | Replace cursor-anchored modal with the locked bottom panel. | No |
| Start+end heads import-only (UI offers end only) | One head (end) on V1; start-head renders if imported, not editable | — | — | Document as V2. | No |

### 4.5 Stroke/fill

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Stroke color | Formatting-bar swatch → color sheet | — | Drawboard, PDF Expert | Dense bar; 28–32 pt swatch. | No |
| Stroke width | Stepper (`−/value/+`) | slider; segmented | Drawboard | 44 pt targets. | No |
| Fill for rect/ellipse (default transparent `PAL:6684,6686`) | Fill swatch + transparent (checkerboard) chip; **hidden for line/arrow** | — | PDF Expert | Show fill only for rect/ellipse. | No |
| No dashed/cloud UI | None on V1 (parity) | — | — | Future: segmented solid/dashed/dotted. | No |

### 4.6 Selection & edit entry

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Single-click selects; rect/ellipse handles appear from selection (no edit-mode) | **Single tap selects → SVG handles appear.** No double-tap gate for rect/ellipse | — | Drawboard | Select tap `requireToFail` undo? No — different pointer counts; per §1. | No |
| **Rect/ellipse double-click is a no-op** (`PDFViewer.jsx:~28310` early-return); line/arrow double-click → `editType='bbox'` | **Double-tap selected shape → open the formatting/edit bottom panel** (stroke/fill/width, arrowhead for arrow) — this is a *new* mobile convenience, not a desktop port; line/arrow double-tap mirrors desktop bbox entry | double-tap = no-op (handles already shown) | GoodNotes | Must not collide with double-tap-empty=fit; resolved by the §1 `requireToFail` ordering. | No |
| Rotation handle: tap = numeric input; drag = 15° snap (mobile) | See §6.3 | — | Drawboard | Snap value read from Settings. | No |
| 4 corner + 4 mid resize handles | All 8; **hide midpoints when shape < threshold** (threshold itself PLT; for **lines, endpoint handles always show** regardless of length); 44 pt targets | corners-only on phone | GoodNotes | Adaptive suppression per §6.6. | **YES** (small-shape midpoint threshold) |

### 4.7 No-equivalent desktop gestures

| Desktop gesture | Mobile verdict |
|---|---|
| Cmd/Ctrl-click expand group | Via context menu → Ungroup. |
| **No hotkey exists for rect/ellipse**; Q=callout, L=line, A=arrow | Tool switch is the left rail only. |
| Cmd/Ctrl-drag whole callout | N/A to shapes (they move freely). |
| Arrow-key nudge | Low-priority precision control (§6.5). |
| Cmd +/-/0/1/2 | Pinch + double-tap-fit. |
| Spacebar pan mid-draw | Two-finger pan. |

---

## 5. Composite & content tools — counter, callout, text, Survey Marker, native markup

### 5.1 Counter

`pause-to-orbit` is implemented with the **composable Gesture API**, not the deprecated
`LongPressGestureHandler`: `Gesture.Race(Gesture.LongPress().minDuration(150).maxDistance(20),
Gesture.Pan())`, where the pan only begins orbiting after `onLongPressStart` flips a shared
ref. `Gesture.LongPress()` emits no continuous moves, so the Pan supplies the orbit drag; the
orbit angle is computed `atan2(bodyY - tipY, bodyX - tipX)` in page coordinates on each
`onUpdate`, the tip stays fixed, and the body keeps its final angle on release. `maxDistance`
~20 (page-scaled) prevents misfires on small pins at low zoom. **Both "Continue Pin" and the
counter context-menu Delete are desktop stubs** (`useAnnotationContextMenu.jsx:195,199` →
`logStub`); they must be wired on desktop before any mobile path is built.

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Click-to-drop pin; tool stays active (`PAL:6638-6680`) | One-finger tap places a pin; ripple feedback | drag-to-place; long-press | Shottr, Concepts | 44 pt sentinel target at small zoom. | No |
| `pointerAngle` orbit (Shift-drag, `PDFViewer.jsx:23610-23686`) | `Gesture.Race(LongPress(150,maxDist20), Pan)`; orbit via `atan2` page-space | rotation handle; two-phase drag | Drawboard | Composable API only; pause threshold + `maxDistance` need calibration; distinct from 500 ms context-menu long-press. | **PENDING LIVE-TEST** (pause threshold) |
| Number input, editable only when series size = 1 (`PDFViewer.jsx:3806-3815`) | Formatting-bar number stepper + numeric keyboard; greyed when series > 1 with explanatory tooltip | bottom panel; inline SVG edit | — | Preserve the "locked when group > 1" rule. | No |
| Series picker (caret popup, `PDFViewer.jsx:3799-3835`) | Horizontal series-swatch strip in formatting bar, **with a visible chevron/"+" affordance + first-use tooltip** | dropdown | — | Caret popup too small for touch; discoverability fix required. | No |
| Right-click menu | Long-press → bottom-sheet menu (Delete/Duplicate/Color/Series); quick-bar on tap | — | Concepts, Drawboard | "Continue Pin" stub must be wired first. | No |
| Double-click edit (orbit handle WIP, `ANNOTATION-CONTRACT.md:167`) | Double-tap → select/edit (resize + orbit handle) | — | — | Expose move first; orbit via pause-drag until the desktop orbit handle stabilizes. | No |

### 5.2 Callout

Three independently draggable parts (arrowTip, knee, textBox), normalized 0–1 coords,
distance-rule validation on each move; creation is a two-point drag (4 px min), auto-enters text
edit. **Pinch-on-textBox "both fingers inside" is NOT expressible as a coordinate check in
RNGH** — wrap the SVG textBox in its own `View` + `GestureDetector` with a `Gesture.Pinch()`
that `requireExternalGestureToFail`s the page pan; activation is then naturally confined to the
textBox hit area. **Handles appear on single tap (select); the textBox shows a text cursor only
on double-tap** (Drawboard model).

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Two-point click-drag creation, 4 px min (`SVGAnnotationLayer.jsx:948-952`), auto text-edit | One-finger press-drag (arrowTip anchored, textBox follows), **10 px min** for finger; auto-opens keyboard | tap-tap; tap default then drag | PDF Expert | One-finger drag from empty space cannot conflict with two-finger pan. | No |
| arrowTip / knee drag, distance rules (`useSVGInteraction.js:2543-2572`) | Drag the part handle (≥44 pt invisible hit zone); red handle on rule rejection | — | Drawboard, PDF Expert | Inverse-scale handle size so they don't overlap at small zoom. | No |
| textBox move/resize | Drag frame = move; corner handles = resize; **pinch-on-textBox = resize via its own nested `GestureDetector`** | corner-only; pinch-only | GoodNotes, Notability | Nested detector `requireToFail` page pan; both-fingers-inside is the *consequence* of nesting, not a coordinate check. | **PENDING LIVE-TEST** |
| Double-click textBox → text edit (`PDFViewer.jsx:10354`) | **Double-tap** textBox → RN `TextInput` overlay (viewBox→screen mapped); the textBox double-tap detector is a **child `GestureDetector`** that `requireToFail`s the page zoom-to-fit double-tap | single-tap edit (accidental); tap+button | Notability, GoodNotes | Without the child-detector ordering, a near-miss fires zoom-to-fit. Keyboard overlay must not swallow the two-finger undo. | No |
| Whole-callout move ('whole' mode) | One-finger drag on the **connector line** = whole-move (direct port of the `line1`/`line2`→`'whole'` rule); long-press-then-drag any part = whole-move | — | Drawboard, Concepts | Handle zones win; remaining body = move. | No |
| Escape cancels blank new callout (`PDFViewer.jsx:28920-28931`) | Tap outside (or two-finger undo) before commit deletes the blank callout | — | — | Blank-delete rule makes both paths equivalent. | No |

### 5.3 Text tool

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Click places `Fabric.Textbox`, immediate edit (`PAL:6548-6599`) | One-finger tap places + opens keyboard. **Do NOT use `KeyboardAvoidingView`** (it shrinks the canvas, not scrolls it) — listen to the keyboard frame event and **programmatically adjust the page pan offset** (`keyboardTop − textboxScreenY − margin`) via a `useKeyboard` hook | tap+Edit button; long-press dictation | Notability, PDF Expert | Single-name `fontFamily` only (CLAUDE.md 2026-04-08). | No |
| Resize textbox (width-only, `PAL:1070-1072`) | Drag corner handles; width-only preserved | pinch width | — | — | No |
| Click existing textbox edits (`PAL:6573-6576`) | With text tool active: **single tap** edits existing; **double-tap** edits when select tool active | — | — | — | No |
| Single-name font cursor-drift bug | RN `TextInput` overlay, single-name system font | — | — | Enforce in the mobile font picker; test at large sizes. | No |
| Commit on click-outside | **Tap outside commits + dismisses keyboard + does NOT place a new textbox** (commit/dismiss semantics); a **second** tap places the next one (Notability model — this is the correct CORE-LAW behavior, not a conflict) | — | PDF Expert, Notability | Resolved as a DECISION, not pending. | No |

### 5.4 Survey Marker

Rubber-band drag (min 5×5 px desktop) fires `onSurveyMarkerCreated`; content edited in the
bottom panel (template/module/checklist/photos/videos), no in-canvas text edit; double-click →
`handleSurveyMarkerClicked`. **First guard is `if (!annotationId || !selectedTemplate) return`**
— a silent no-op when no template is selected.

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Rubber-band placement, min 5×5 (`PAL:6609-6636`) | One-finger press-drag dashed rect; **min ~20 screen CSS px (post-DPR), not page-space**, so it's zoom-consistent | tap-to-drop default size; two-tap corners | PDF Expert | Specify the threshold in screen px. | No |
| Double-click → bottom/survey panel (`PDFViewer.jsx:23796-23834`) | **Double-tap** → slide-up bottom panel. **If no template selected, open the template picker / show "Select a template first"** instead of a silent no-op | tap + Details button | — | Mobile must not replicate the desktop silent no-op. | No |
| Template/module selectors | Bottom panel: template picker (modal/wheel), module tab strip | — | Apple Maps category picker | 44 pt list items. | No |
| Checklist responses | Scrollable checklist; tap-toggle + expandable notes | — | Google Forms mobile | No truncation at 375 pt. | No |
| Photos/videos | Photo strip + "+" → `expo-image-picker`; tap thumb = full-screen | — | Fieldwire, PlanGrid | Prominent camera button; graceful permission request. | No |
| Move / resize / rotate (`SVGAnnotationLayer.jsx:2255-2300`) | One-finger drag = move; corner/mid handles resize; rotation handle = 15° snap, tap = numeric. **No two-finger rotation** (CORE LAW) | — | Drawboard | 44 pt handles; inverse-scale at small zoom. | **PENDING LIVE-TEST** (resize handle feel) |
| Delete (Delete key / right-click) | Tap-select → quick-bar Delete or long-press → menu; **confirmation alert** if the marker has checklist data (server cascade) | — | Acrobat Mobile | Deliberate desktop→mobile divergence (confirm). | No |

### 5.5 Native PDF text markup & text-select

`NATIVE_TEXT_MARKUP_TOOLS` (`viewerShared.js:47`) are import-only; only text-highlight has a
create path. **Native OS text selection requires native `Text`/`TextInput` elements** — if the
pdf.js text layer is rendered via SVG/WebView/canvas, OS long-press selection will **not** fire
natively. The mobile text-select path therefore needs either (a) native `Text` runs per text
line (as `react-native-pdf`-class libs do), or (b) a custom selection UI built from text-layer
word/line geometry. This feasibility question gates the whole row.

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Select imported markup (`PDFViewer.jsx:24886-24948`) | Tap to select; quick-bar Delete | — | PDF Expert | Inflate tap target ≥20 pt vertical. | No |
| Delete imported markup | Tap-select → Delete; long-press → menu | — | — | Irreversible (native PDF annot); confirm/undo toast. | No |
| Text-highlight create (drag over text, `PDFViewer.jsx:27511-27513`) | **Select-then-mark**: OS text selection → "Highlight" in the selection toolbar (more native than direct drag). **When the text-highlight tool is active, suppress the universal empty-canvas long-press** (paste/page actions) so the long-press cleanly means "select text" | direct drag (desktop port) | PDF Expert, Acrobat (iOS) | Long-press grammar changes only inside this tool mode; suppression resolves the conflict. | **PENDING LIVE-TEST** (native selection feasibility on the chosen renderer) |
| Text-select tool (`PDFViewer.jsx` interaction-mode block, e.g. `:27836-27842`) | Tool active → long-press text → OS selection handles → OS copy. **Gate RNGH off in this mode** (`enabled={activeTool !== 'text-select'}` on the wrapping gesture detectors) so the WebView/native text layer receives the long-press | — | every major iOS/Android reader | Renderer dependency (a/b above) must be resolved. | **PENDING LIVE-TEST** (RNGH↔text-layer routing + renderer choice) |
| Underline/strikeout/squiggly: no create path | Same; select+delete only; rail buttons hidden until a desktop create path exists | — | — | Parity. | No |

---

## 6. Editing handles — resize, rotate, move, nudge

Handles render as SVG circles (`HANDLE_RADIUS = 5.5` page-units, scaled to ~11 screen px,
`handleStyle.js:40`); adaptive tiers cull to corners-only / br-only when crowded
(`selectionHandleVisibility.js:42-77`). On touch every handle needs an invisible **44×44 pt**
hit region. No hover layer. Desktop single-shape rotate is **free by default**, snapping to 45°
**only on Shift** (`useSVGInteraction.js:2279-2281`); group rotate snaps 15° only on Shift
(`:1327-1330`). **Per-object arrow-key nudge does NOT exist on desktop** — nudge is net-new.
The text positive-scale clamp (no flip) is enforced at `useSVGInteraction.js:~2148-2150` (the
`:3211` reference is a comment, not the clamp).

### 6.1 Touch-target sizing

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Corner handle ~11 px, hit = visible (`handleStyle.js:40`) | ~11 pt visual circle + **44×44 pt** transparent `GestureDetector`/`hitSlop` | 44 pt visible (crowds); 32 pt (fails phone) | Apple HIG, Drawboard | Keep adaptive tiers; br-only still usable at 44 pt. | No |
| Mid-edge pill | Same 44 pt region | drop on phone | Concepts | Adaptive suppression on small objects. | No |
| Rotation handle above top edge (`selectionHandleVisibility.js:70`) | 44 pt region; **if computed position is above the viewport, clamp to 8 pt inside the safe area and show a 16×16 pt chevron-up in HANDLE_RING blue at the top inset; tapping it opens the numeric rotation input** | rotation dial widget | Drawboard, PDF Expert | Coordinate-space split: math anchored to shape center, handle clamped to viewport. | **PENDING LIVE-TEST** (clamp behavior) |

### 6.2 Resize

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Corner drag = free; Shift = uniform (`useSVGInteraction.js:2118-2124`) | One-finger corner drag = free; constrain via §4.2 toggle / hold-to-snap. **Two-finger pinch on object NOT used for resize** — enforce with per-handle `Pan().blocksExternalGesture(pagePinchRef)` or `Gesture.Race(handlePan, pagePinch)` so the handle finger wins | second-finger lock (CORE LAW conflict) | Procreate, Notability | Without `blocksExternalGesture`/Race the page pinch hijacks the resize and CORE LAW silently breaks. | No |
| Mid-edge = single-axis (`:1558-1559`) | Same | — | GoodNotes, PDF Expert | Adaptive suppression. | No |
| Shift = constrain aspect (`:2121`) | **Hold-to-snap** (handle paused) + **formatting-bar lock-aspect toggle**; the body `LongPress(600)` and handle `Pan().activateAfterLongPress(0)` sit on **different nodes** so they never race with the context-menu long-press | A-only; B-only | Affinity (toggle), Procreate (hold-snap) | Explicit node separation, not just "long-press the body not the handle". | **PENDING LIVE-TEST** (300 ms feel; prototype tests resize-end, not draw-time) |
| Positive-scale clamp, no flip (`useSVGInteraction.js:~2148-2150`) | Same clamp server-side | — | — | Fires on flip-through too. | No |
| Group resize, rotated frame (`:1470-1676`, axis-aligned at rest `:2965`) | One-finger union-bbox corner drag; same math + constrain | — | Concepts, Drawboard | Test rotate→resize on touch. | **PENDING LIVE-TEST** (rotated group resize) |
| `constrainToPage` (`:2785`) | Same; fire on every tick | — | — | — | No |

### 6.3 Rotate

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Drag handle free; Shift = 45° (`:2279-2281`) | **Drag handle = snap to 15° by default**, but **15° snap is a formatting-bar toggle (default ON), not a gesture-baked behavior with only a Settings escape hatch** — a user rotating to ~22° flips the toggle off without leaving the canvas. Tap rotation handle **only fires in Select mode** (handles aren't shown in Draw) | no snap; 45°-only; configurable interval | Drawboard, Procreate | Single-shape default-free desktop vs locked-15° mobile is a real divergence — the toggle keeps it phone-friendly without overconstraining. | **PENDING LIVE-TEST** (snap granularity) |
| Hover → numeric pill (`RotationInputField.jsx`) | **Tap handle → numeric degree input** in the formatting bar (44 pt `TextInput`, degree suffix), no hover delay | long-press (conflicts); border tap | Drawboard | RN `TextInput`, not an HTML portal. | No |
| Input arrow keys ±1°/±45° | Stepper **−15°/+15°** and **−1°/+1°**; long-press = hold-to-repeat (~2 Hz) | slider; dial | Drawboard | Hold-to-repeat needs a `setInterval` in `LongPress.onStart` cleared in `onEnd`/`onFinalize` (+ `useEffect`/ref cleanup) to avoid phantom increments. | No |
| Group rotate (`:1317-1427`) | Same handle drag + numeric | — | Concepts | Test rotate→move→rotate pivot drift. | **PENDING LIVE-TEST** |
| Counter rotation = nub direction only (`:2284-2301`) | Same handle drag (body fixed); tap = numeric nub angle | — | — | Distinct from §5.1 pause-orbit. | No |

### 6.4 Move

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Drag body = move; 5 px arm / 2 px commit (`:221,:1091`) | Select mode: one-finger body drag = move; **arm ≥8 pt**, commit > 2 pt | long-press-then-drag (slow) | Notability, PDF Expert, GoodNotes | Larger arm prevents fat-finger moves; raise to 12 pt if needed. | **PENDING LIVE-TEST** (threshold) |
| `constrainToPage` | Same + rubber-band spring at edge (don't commit OOB) | hard stop | PDF Expert iOS | Overshoot in `Animated`, snap back on release. | No |
| Group-move (`:1281-1313`) | Drag any selected member = group-move | — | Concepts, Drawboard | Tapping a non-selected member replaces selection → single move. | No |
| **Callout whole-move trigger is Cmd/Ctrl-drag OR connector-line drag** (`useSVGInteraction.js:812-817`; **`altKey` is NOT in the callout path** — the draft's Alt claim was wrong) | Cmd/Ctrl has no touch equivalent; **drag the connector line = whole-move** (the existing `line1`/`line2`→`'whole'` code path); long-press-then-drag any part = whole-move | per-part long-press | Concepts | Part handles (arrowTip/knee/textBox) at full 44 pt; body/connector = whole. | No |
| Persisted group rotation across move (`:247-263`) | Same JS ref persists across touch gestures | — | — | Add to rotate+move integration test. | No |

### 6.5 Nudge (net-new, low priority)

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| **No per-object nudge on desktop** (arrows = page-nav `PDFViewer.jsx:21441-21445`) | Optional 4-direction nudge buttons in the formatting bar (1 pt/tap, 10 pt hold-repeat), behind a **labeled** "position" chip (visible even collapsed, or it's undiscoverable) | hardware arrows (tablet); x/y inputs | Affinity (x/y inputs) | Ship only if live-test flags precision pain. | **PENDING LIVE-TEST** (is nudge needed?) |
| — | Tablet: hardware arrow keys ±1 pt / ±10 pt (Shift) | — | GoodNotes, Notability | Deferred. | No |

### 6.6 Handle appearance

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Handles on hover/select | Handles on select only; no glow. Optional 100 ms scale-up confirm | long-press to reveal | Notability, PDF Expert | Gate `hoveredId`/enter-leave behind `platform==='web'`; dead on mobile. | No |
| Adaptive suppression (`selectionHandleVisibility.js:42-77`) | Recalibrate tier using the 44 pt touch size (triggers sooner); resize math unchanged; **line endpoints always show** | always 8 handles | Concepts | Mobile override into `getAdaptiveSelectionHandleSpec`. | **YES** (small-shape threshold) |
| Rotation hidden when `moveOnly`/`hideRotationHandle` | Same | — | Drawboard | — | No |
| Live red invalid-ring on callout drag (`handleStyle.js:28`) | Same; update color every `onUpdate` tick | — | — | Test at 60 fps. | No |

`justTappedAtRef` cooldown (mirroring desktop `justDraggedAtRef`) is required so a
tap-then-double-tap doesn't de-select-then-reselect and swallow double-tap-to-edit (§1).

---

## 7. Context menu, clipboard & delete

Two desktop surfaces: the **annotation context menu** (`useAnnotationContextMenu.jsx`) and the
**page/canvas context menu** (`PageAnnotationLayer.jsx:9556-9697`). Mobile ships **both** a
floating **Quick-Bar** (tap-select, 3–5 actions) and a fuller **Context Menu** (long-press).
Mobile substitutes for DOM concepts: `data-readonly` → an **`isReadOnly` prop/context** read in
the gesture handler; backdrop → an RN `Modal`/portal (no `createPortal`); `pointerEvents`
`box-only` is valid in RN but the backdrop must live in a `Modal` covering the screen.

**Pre-requisite desktop wiring (these are stubs/gaps, not live features):**
- Annotation context-menu **callout Delete is a stub** (`useAnnotationContextMenu.jsx:195` →
  `logStub`) — wire it (to `handleDeleteSelectedCallouts`, which has the `canModify` gate)
  before any mobile path.
- **"Continue Pin" is a stub** (`:199`) — wire before mobile.
- **`handleCutCallout` lacks a `canModify` guard** (`PDFViewer.jsx:3579-3595`) while
  `handleDeleteSelectedCallouts` has it (`:10240-10254`). Frame as **defense-in-depth
  hardening** (all current callers pass through the `data-readonly`/menu guard first; there is
  no live programmatic bypass today). Mobile calls handlers directly with no menu intermediary,
  so the guard must move **into the handler body**. Prioritize **below** the two live stubs.

### 7.1 Long-press annotation → context menu

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Right-click annotation → menu at cursor (`useAnnotationContextMenu.jsx:47-81`) | **Long-press (≥500 ms) → menu** (bottom-sheet or popover) on `onEnd`; cancel if moved >8 px so a slow drag never opens it. "composed with TapGesture in parallel" = the **single-tap select** gesture, **not** the two-finger undo (different pointer counts) | bottom-sheet; popover; ActionSheet | Concepts, Drawboard | Tunable duration. | **YES** (popover vs sheet) |
| Suppressed on `data-readonly` (`:35,:52`) | Read-only doc → menu shows non-mutating items only (Copy kept), lock badge; gate on the **`isReadOnly` prop/context** | suppress entirely; disable+explain | PDF Expert | Mobile-native guard, not a DOM attribute. | No |
| Outside-click/Esc dismiss | Tap backdrop (RN `Modal`, `pointerEvents="box-only"`) / hardware back | — | standard | Backdrop below menu, above canvas. | No |

### 7.2 Tap-select → Quick-Bar (new mobile surface)

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Selection shows handles; no inline bar | Tap-select → **Quick-Bar** (≤4: Copy, Delete, Edit, ⋯). **Lives in the selection quick-bar, not the per-tool formatting bar.** Dismiss when a drag begins **past ~8–10 pt** (not RNGH's 2 px default, which feels unstable) | no quick-bar; always visible | GoodNotes, Drawboard | Must not overlap the formatting bar; slides to avoid it. | **YES** (placement, item set, dismiss) |
| No quick-delete | Quick-Bar Delete; haptic confirm for simple shapes; **alert** for Survey Marker | menu-only; alert-for-all | Notability | Differentiate dangerous deletions (§7.5). | No |

### 7.3 Per-kind item matrix

| Desktop behavior (file:line) | Recommended mobile | Risk / notes |
|---|---|---|
| textMarkup: Delete only (`:174-185`) | Long-press → Delete only; Quick-Bar Delete + ⋯ | No Copy (not Fabric JSON). |
| callout: Cut/Copy/Paste/Delete, no Group/Ungroup (`:187-196`) | Same; Quick-Bar Copy/Delete/⋯ | **Delete is a desktop stub** — wire first; route to `handleDeleteSelectedCallouts` (has `canModify`). |
| counter: "Continue Pin" (`:197-200`) | Long-press → Continue Pin; Quick-Bar Delete/Continue Pin/⋯; also long-press empty canvas while a counter is selected = place next pin | **Continue Pin is a stub** — wire first. |
| annotation: Cut/Copy/Paste(grayed when empty)/Delete + z-order (`:201-310`) | Long-press full menu; Quick-Bar Copy/Delete/▲▼/⋯ | Paste grayed via `enabled` flag. |
| group: same + batch (`:311-419`) | Long-press inside bbox; Quick-Bar on lasso completion | Batch z-order iterates sorted indices. |

### 7.4 Clipboard

In-memory app store (`clipboardAnnotation`, `clipboardCallout`); cut sets `mode:'cut'`
(clears after one paste). **`Cmd+Shift+V` is NOT paste-to-all-pages** — `Ctrl+Shift+V` toggles
the renderer mode (`PDFViewer.jsx:2835`); paste-to-all-pages **does not exist on desktop**.

| Desktop behavior (file:line) | Recommended mobile | Risk / notes | PLT? |
|---|---|---|---|
| Copy (`useAnnotationContextMenu.jsx:239-248`) | Quick-Bar / menu Copy; light haptic; no hotkey (tablet later) | In-memory; no cross-app pasteboard (future). | No |
| Cut (`:211-234`) | Menu Cut (not Quick-Bar — destructive); confirm if read-only | `handleCutCallout` hardening (above). | No |
| Paste at cursor (`PDFViewer.jsx:21399-21435`) | Menu Paste at long-press point; grayed when clipboard null | — | No |
| Cut-mode clears after paste | Same; Paste auto-grays | — | No |
| Paste-to-all-pages (**does not exist on desktop**) | **New feature** (no desktop hotkey to map): menu "Paste to All Pages" + confirmation sheet | Needs a new backend loop; V1 does not depend on it. | No |

### 7.5 Delete

| Desktop behavior (file:line) | Recommended mobile | Risk / notes | PLT? |
|---|---|---|---|
| Delete/Backspace, focus-guarded (`SVGAnnotationLayer.jsx:643-734`) | Quick-Bar Delete (simple) + menu Delete (all); push undo checkpoint first. **Mobile needs a parallel handler factory** mirroring the desktop undo-checkpoint+save pipeline — the desktop `useCallback`s don't exist in `mobile-expo-go/` | Hide/disable when a text panel is open. | No |
| Same save path via menu (`:263-278`) | Same `onDeleteAnnotation` prop | Single code path. | No |
| `canModify` gate (`PDFViewer.jsx:10240-10254`) | Resolve `canDelete` at **select-time**; pre-emptively disable Delete for non-owners | Carry `canDelete` in selection state. | No |
| Survey Marker delete (immediate on desktop, syncs Supabase) | **Confirmation alert** on mobile | Deliberate divergence (confirm). | No |
| Batch delete, one checkpoint (`:696-723`) | Quick-Bar/menu applies to selection; medium haptic; one undo restores the batch | — | No |

### 7.6 Long-press empty canvas → page actions

**DECISION:** all structural page ops live in the **thumbnail panel**, not on the canvas
long-press. The PAL canvas menu actually has **six** `'page'` items (Paste annotation, Paste
Page, Duplicate Page, **Rotate CW, Rotate CCW, Insert Blank Page** — `PageAnnotationLayer.jsx:9585-9697`). Canvas long-press gets **only annotation Paste**; Duplicate/Paste Page/Rotate
CW/CCW/Insert Blank Page move to the thumbnail panel (GoodNotes precedent; cleaner separation;
honors "tools live in existing chrome"). Desktop canvas menu **omits** empty-clipboard items
from the DOM (not grayed) — mobile canvas long-press should likewise **omit**, not gray (only
the annotation-kind menu grays via `enabled`).

| Desktop behavior (file:line) | Recommended mobile | Risk / notes | PLT? |
|---|---|---|---|
| Right-click empty → Paste (`:427-429`) | Long-press empty (hit-test classifies on/off annotation, same as `PAL:3814`) → Paste at point; **omit** when clipboard empty | RNGH `LongPress` runs the desktop hit-test. | No |
| Right-click empty → Paste Page / Duplicate / Rotate CW/CCW / Insert Blank Page (`:9585-9697`) | **Thumbnail panel only** (DECISION) | Structural ops belong with page management. | No |
| Draw-mode blocks the menu (`PAL:3823`) | In Draw mode, **annotation long-press is also suppressed** (not just empty-canvas) via the `isDrawingShape` guard / `requireToFail` against the draw pan, so a slow stroke-start never opens a menu mid-stroke | Critical: §7.1's "any mode" must exclude an active draw stroke. | No |

### 7.7 z-order

| Desktop behavior (file:line) | Recommended mobile | Risk / notes |
|---|---|---|
| Cmd+]/[ etc. (`SVGAnnotationLayer.jsx:736-814`) | Full menu items; hotkeys deferred (tablet) | — |
| Front/Forward/Backward/Back (`:293-306`) | Menu under "Arrange"; Quick-Bar single ▲▼ expanding inline; consider Front/Back only on phone V1 | Less deep stacks on mobile. |
| Batch sorted-index processing (`:394-415`) | Snapshot indices before mutation (RN async state) | — |

### 7.8 Group/Ungroup

Deferred on desktop (menu items commented pending the matrix rewrite). **Deferred on mobile**;
wire the context-menu Group/Ungroup to **equivalent logic in the mobile component tree** (not to
`SVGAnnotationLayer.jsx`'s keyboard path) once the desktop feature ships.

---

## 8. Undo/redo, history & desktop-only gestures

Desktop undo = Cmd/Ctrl+Z; redo = Cmd+Shift+Z / Ctrl+Shift+Z / Cmd+Y / Ctrl+Y (all live,
`undoRedoHotkeys.js:27-44`). `canUndo`/`canRedo` already drive always-visible top-bar buttons.
50-entry multi-lane history. Desktop hold-Cmd+Z uses **OS key-repeat** (the handler does not
filter `e.repeat`), so the mobile hold-to-repeat is a *new* mechanism, not a port. **Both
Settings toggles below (undo gesture, rotation snap) are blocked on the not-yet-built Settings
screen — track as one dependency.**

### 8.1 Undo / redo

| Desktop behavior (file:line) | Recommended mobile | Alternatives | Best-in-class | Risk / notes | PLT? |
|---|---|---|---|---|---|
| Cmd+Z undo | **Single two-finger tap.** `Gesture.Exclusive(twoFingerPan, twoFingerTap)` so a moved pan fails the tap; `Tap().numberOfPointers(2).maxDuration(400)`. Let RNGH recognizer competition vs `Gesture.Pinch()` settle tap-vs-pinch — **do not** hand-tune an 8 dp spread check (too tight on small phones) | double-two-finger-tap (hated); shake (deprecated); button-only | Procreate, Notability | Safety delay (~120 ms) has **no RNGH primitive** — implement via a short `setTimeout` in `onEnd` or `maxDuration`; unprototyped today. | **YES** (delay 120–250 ms) |
| Redo (`:33-44`) | **Single three-finger tap**, same rules | two-finger swipe (page-turn conflict); long-press button | Procreate, Notability | Android Samsung three-finger screenshot → `setSystemGestureExclusionRects` (API 29+), **not `FLAG_SECURE`**; AOSP has no conflict. | **YES** (Samsung device) |
| Undo/redo buttons (`canUndo/canRedo`, `PDFViewer.jsx:11165-11170`) | Top-bar buttons = **primary**; gesture supplements | — | PDF Expert, GoodNotes | Always present (locked). | No |
| Hold Cmd+Z (OS key-repeat) | **Hold-to-repeat = a separate `Gesture.LongPress(minDuration~600)`** firing a `setInterval` (~4 Hz) in `onStart`, cleared in `onFinalize`; composed `Gesture.Exclusive(longPressUndo, tapUndo)` so single-tap and hold both come from the same two-finger touch. **Not** a "tap then re-touch within 200 ms" state machine (no RNGH primitive) | repeated taps; button speed-loop | Procreate | Interval cleanup via ref/`useEffect` to avoid phantom undos. | **YES** (rate, threshold) |
| (no desktop disable toggle) | **Settings: "Two-finger tap to undo" (default On)**; buttons remain when off | — | (improves on Notability) | Blocked on Settings screen. | No |
| 50-entry multi-lane history (`:~10144`) | Same engine; gesture calls `handleUndo`/`handleRedo`. Tablet hardware Cmd+Z works via the existing capture handler | — | — | — | No |

### 8.2 Tool hotkeys → rail

V/P/H/E/T/Q/L/A/C all map to **left-rail buttons** (Q=**callout**, not rect; there is no
rect/ellipse hotkey). Shift+E (partial eraser) → formatting-bar mode toggle. Hardware-keyboard
tool shortcuts work for free on a paired tablet keyboard. (No table needed — uniform mapping.)

### 8.3 Cmd/Ctrl combos

| Desktop behavior (file:line) | Recommended mobile | Risk / notes |
|---|---|---|
| Undo/redo chords | §8.1 + buttons | Tablet keyboard activates existing handler. |
| **Cmd+A**: the cited `PAL:7321/7420` are `textObj.selectAll()` **inside text edit**, not annotation select-all — **no annotation select-all exists on desktop** | Mobile **"Select All"** = a **new** affordance: long-press empty canvas → menu; respects `canSelectAnnotationByIndex`; excludes import-only markup | Not a hotkey port. |
| Cmd+G / Cmd+Shift+G group/ungroup — handler in **`SVGAnnotationLayer.jsx:858`(group)/`:832-854`(ungroup)**, NOT `PAL:4301` | Context-menu Group/Ungroup (deferred per §7.8) | Correct file:line. |
| Cut/Copy/Paste | Quick-Bar/menu (§7.4) | — |
| Delete/Backspace | Quick-Bar trash + menu | — |
| Cmd+F search | Top-bar search icon | — |
| Cmd+S save | Auto-save on commit; explicit save in overflow | — |
| Cmd+0/1/2 fit | Double-tap fit + top-bar picker | — |
| Cmd+=/- zoom | Pinch + top-bar zoom | — |

### 8.4 Spacebar pan

No equivalent — two-finger drag covers it in all modes (clean deletion).

### 8.5 Wheel / Ctrl+wheel

Plain wheel → one-/two-finger pan. Ctrl/Cmd+wheel cursor-zoom → **pinch, focal = centroid**
(`focalX/focalY`); verify against `reference_pdfjs_overlay_zoom_anchor.md`. **PENDING LIVE-TEST**
(focal anchor accuracy on hardware).

### 8.6 Hover

| Desktop | Mobile | Notes |
|---|---|---|
| Cursor changes | None (no hover in RN); strip cursor refs from mobile paths | — |
| 150 ms hover rotation handle | Handle always visible on select; tap = numeric, drag = 15° | Dense mode keeps ≥44 dp targets. |
| Hover glow (Survey Marker/callout) | Tap-to-select is the affordance | — |
| Tooltips | `accessibilityLabel` only (VoiceOver/TalkBack); no visual tooltip | Every rail/top-bar icon needs a label. |
| Right-click | Long-press → menu + Quick-Bar | — |

### 8.7 Arrow-key nudge

Deferred low-priority; see §6.5. Drag-to-move is primary; tablet hardware arrows work via Fabric
handler.

### 8.8 Native text-select gestures

Text-select tool → one-finger drag / OS long-press selection inside the text layer. **Gate RNGH
off when `activeTool === 'text-select'`** (`enabled={activeTool !== 'text-select'}` on the
wrapping detectors) so the WebView/native text layer receives the long-press; otherwise the
outer RNGH `LongPress` consumes the touch first. Renderer feasibility per §5.5. **PENDING
LIVE-TEST** (RNGH↔text-layer routing + renderer choice).

---

## 9. Cross-cutting — chrome, modes, stylus-future, Settings, tech & build order

### 9.0 Chrome map

| Desktop surface | Mobile surface | File:line |
|---|---|---|
| Left rail | `styles.rail` (44 px, 34×34 buttons) | `App.tsx:690, 6525` |
| Top bar | `styles.topBar` (`insets.top + 34`); undo/redo 26×26 | `App.tsx:691, 1901` |
| Formatting bar | `AnnotationFormattingBar` (36 px, **`position:absolute`** — floats over canvas, `subBarHeight = 0`) | `App.tsx:6095-6101` |
| Bottom panel | Slide-in sheets keyed by `surveyOpen`, `annotationEditConfig` (state at `App.tsx:718`) | `App.tsx:705` |

No new surfaces; no radial menus. Long-press → `FloatingContextMenu` (`App.tsx:2212`).

### 9.1 Per-tool chrome placement

All 14 desktop tools + native markup map into existing chrome; below highlights only what
diverges from a plain rail mapping. **The mobile-only `region` tool** (`App.tsx:73-87`,
`'region'`) is added: it is a space/region label tool with **no desktop equivalent** — one-finger
drag to draw the region rect, bottom panel for its label/space association; two-finger
navigation as everywhere. **Double-tap-edit per tool:** text/callout → inline text edit; Survey
Marker → bottom panel; shapes/counter → formatting/edit panel; this per-tool routing must be
explicit (no generic `onDoublePress` exists in `App.tsx` yet — only `onPress`/`onLongPress`).
The **formatting bar floats over the canvas** (absolute, `subBarHeight=0`): showing it hides
~36 px of canvas, so the first annotation drawn near the top can sit behind it — **DECISION
needed**: either push content down (layout flow) or keep the overlay and auto-scroll the draw
origin clear of the bar; recommend pushing content down on phone.

Counter number input is 36×24 px (`App.tsx:6258`) — enlarge to ≥44 pt. Survey Marker, region,
pen, and the rail are already partially implemented; wire RNGH tap/drag replacing
`PanResponder`.

### 9.2 Density pass

44 pt logical targets via `hitSlop`, never by enlarging visual footprint; shrink gaps/padding
freely.

| Element | Current (file:line) | Target | Rule |
|---|---|---|---|
| Rail width | 44 px (`App.tsx:690`) | keep 44; gap 5→3 (`:6523`) | no widening |
| Rail button | 34×34 (`:6526`) | 34×34 + `hitSlop 5` → 44 pt | HIG |
| Top bar | `insets.top+34` | content 30 px | frees 4 pt |
| Undo/redo | 26×26 (`:6012`) | + `hitSlop 9` → 44 | heavily used |
| Formatting bar | 36 px (`:6101`) | keep; gap 8→6 | (absolute overlay — see §9.1) |
| Bottom panel | `capBottomPanelHeight` (`:616`) | padding 16→12 | width gain |
| Bottom action bar | `52+inset` | padding 20→16 | 44 pt buttons already |
| Page/zoom pill | 68×24 (`:6030-6042`) — **single `Pressable`, no internal arrow buttons** (draft's "increment/decrement arrows" claim was wrong) | keep; `hitSlop` on the outer `Pressable` for the 24 px-tall page `TextInput` | — |

### 9.3 Rotation handle — see §6.3 (15° snap as a formatting-bar toggle, tap = numeric input).

### 9.4 Constrain — see §4.2 (hold-to-snap + formatting-bar toggle; threshold ~300 ms per
prototype but the draw-time timer variant is unprototyped; proportional resize via toggle, never
two-finger-on-object).

### 9.5 New mobile Settings entries

All new; live in the not-yet-built Settings screen. **Discoverability:** each hidden gesture
(two-finger undo, rotation tap-to-type, hold-to-snap) needs a **first-use one-time tooltip /
handle-glow**; the Settings screen carries a **gesture reference sheet**.

| Setting | Default | Controls |
|---|---|---|
| Two-finger-tap undo | On | Enables undo gesture (safety delay + hold-to-repeat); buttons always remain |
| Undo repeat delay | Medium (500 ms) | Hold duration before undo repeats |
| Rotation snap (15°) | On | Whether rotation snaps; **also surfaced as a formatting-bar toggle** |
| Constrain shapes by hold | On | Draw-time hold-to-snap aspect/angle |
| Default proportional resize | On | Corner drag preserves aspect by default |
| Haptic feedback | On | Pulses on snap/undo/redo (respects system) |
| Double-tap empty-page action | Fit Page (cycles to Fit Width) | Configurable fit target |
| Eraser auto-return | Off | Notability-style return to previous tool after one erase |
| **Stylus input mode** (future) | Off (hidden until stylus/coming-soon) | Stylus draws / finger navigates |
| **Finger draw while stylus connected** (future) | Off | Whether a bare finger marks or only navigates |

### 9.6 Stylus future-proof hooks

| Hook | Now | Why |
|---|---|---|
| Input-type discriminator | Gesture dispatch accepts `inputType: 'finger'|'stylus'|'mouse'` (from RNGH `event.pointerType`), always `'finger'` today | flip routing later without rewrite; desktop already reads `pointerType` |
| Two-finger pan always-on | `Pan().minPointers(2)` simultaneous, tool-independent; draw = `minPointers(1)` | additive third input type later |
| `zoomGeneration` equivalent | `useRef<number>` bumped at pinch `onBegin` → drawing canvases flush before relayout (the §3 container-resize flush is the concrete mechanism) | mid-pinch stroke corruption otherwise (CLAUDE.md invariant) |
| `stylusMetadata?: {pressure, tilt}` | reserve field, never serialized | avoid a later migration |

### 9.7 Tech notes

| Item | Requirement | Risk |
|---|---|---|
| `GestureHandlerRootView` | Wrap root (ancestor of every `GestureDetector`; need not be outside `SafeAreaProvider`). **`App.tsx` wraps its own `SafeAreaProvider` at `:681`, so for the production path RNGH root goes inside it; the import + nested-provider handling is more than a one-liner** | Low–Med |
| Declarative Gesture API | `Gesture.Pan/Pinch/Tap/LongPress/Simultaneous/Exclusive/Race`; **not** the deprecated `*GestureHandler` JSX components | Med |
| Pointer-count filtering | two-finger nav `minPointers(2)`; tool `minPointers(1)` **without `maxPointers`** (see §1) wrapped in **`Gesture.Simultaneous`** so mid-draw pan/pinch works. **The existing GestureSandbox uses `Gesture.Race(oneFinger, Simultaneous(pan,pinch))` — that blocks mid-draw nav and must be changed to all-Simultaneous (Lab C already does this correctly)** | Med (Android divergence) |
| Pinch zoom | `Pinch()` in `Simultaneous`; bump `zoomGeneration` at `onBegin` | Med |
| Reanimated | **Not** V1; RN `Animated` suffices; adopt when draw-path profiling shows 16 ms violations | Low now |
| react-native-svg | Already adopted; `<Svg viewBox>` with width/height **from the measured container, not `pageWidth*scale`** (CLAUDE.md 2026-03-22) | High if wrong |
| 44 pt targets | `hitSlop` on small handles | Low |
| Panel drag-to-dismiss currently uses `PanResponder` (`App.tsx:2613-2615`, `dy>7`) | Its RNGH replacement must `simultaneousWithExternalGesture`/`blocksExternalGesture` the inner panel `ScrollView` so they don't fight | Med |
| Android pointer model | Test two-finger-tap-undo on Android (aggressive gesture arena); tune `Tap().maxDuration` | **PENDING LIVE-TEST** |

### 9.8 Build order

| Phase | Work | Done signal |
|---|---|---|
| **P0 RNGH foundation** | `GestureHandlerRootView` (handle nested `SafeAreaProvider`); replace **all** `PanResponder` incl. the panel drag-dismiss; `Gesture.Simultaneous(oneFinger, Simultaneous(twoFingerPan, twoFingerPinch))`; container-resize flush + `zoomGeneration` bump | two-finger pan+pinch work in all tools, before any tool is wired |
| **P1 Universal gestures** | two-finger-tap undo (safety delay + `Exclusive` vs pan + hold-to-repeat `LongPress` + Settings toggle); three-finger-tap redo (Samsung exclusion rects); double-tap empty = fit (`requireToFail` ordering); long-press empty = paste/page menu | undo/redo fire reliably in all modes; double-tap cycles fit |
| **P2 Navigate** | one-finger pan; `Animated.decay` fling; double-tap annotation bridge | native pan feel; no P0 regressions |
| **P3 Select** | tap select (`requireToFail` edit), long-press menu, tap-empty deselect, drag-empty lasso, drag move, handle resize (overlay `View`s); `canDelete` at select-time | select/move/resize/menu/lasso functional |
| **P4 Rotation** | handle drag (15° toggle), tap → numeric input, clamp + chevron affordance | snap + numeric input + toggle |
| **P5 Draw** | pen, highlighter (`tool==='highlighter'`, min-8), eraser (JSON-diff gate, mode badge, zoom-aware ring, bbox pre-filter perf, hydration spinner); mid-pinch flush | ink + erase; mid-stroke pan/pinch safe |
| **P6 Shapes** | rect/**circle-on-draw**/line/arrow/counter; hold-to-snap + toggle; arrowhead strip; counter pause-orbit (composable Race) + number input | all shapes creatable/editable/rotatable |
| **P7 Text & callout** | text (keyboard-frame pan-offset, single-name font); callout three-part drag + nested textBox pinch + child-detector double-tap | text/callout placed + editable |
| **P8 Survey Marker** | tap-place (screen-px min), bottom panel, no-template fallback, `@survey/shared` wire | placeable; panel fillable |
| **P9 Density + Settings** | §9.2 sizing; Settings screen + all §9.5 toggles | toggles affect behavior; ≥44 pt everywhere |
| **P10 Quick-bar + menu polish** | Quick-Bar (8–10 pt dismiss threshold) + long-press full menu; thumbnail-panel page ops | both surfaces, dismiss on tap-away |
| **P11 Stylus hooks** | `inputType` discriminator; `stylusMetadata` field; Settings coming-soon entries | field exists; no functional change |
| **P12 Tablet pass** | ≥744 pt: rail labels, inline top bar, fuller formatting bar; same gestures | renders correct at iPad sizes |

---

## 10. Per-tool quick reference

| Tool | Create | Edit | Tool-specific UI | Formatting bar |
|---|---|---|---|---|
| **Pan** | n/a (Mode 1) | n/a | one-finger pan; two-finger nav | none |
| **Select** | n/a | tap select, drag move, handle resize/rotate, lasso multi | Quick-Bar on select | multi-select add/subtract toggle (PLT) |
| **Pen** | one-finger drag | double-tap → panel | touch-follow nothing | color, opacity, width |
| **Highlighter** | one-finger drag (min-8) | as pen | — | 5-color preset, opacity 10–60, width |
| **Eraser** | one-finger drag | n/a | touch-follow ring; rail mode badge | Partial\|Full toggle, 5-stop size |
| **Rect** | one-finger drag | single-tap handles; double-tap → panel | — | stroke, fill, width |
| **Ellipse** | one-finger drag **draws a circle**; ellipse via non-uniform resize | single-tap handles; double-tap → panel | — | stroke, fill, width |
| **Line** | one-finger drag | endpoint/midpoint drag (SVG handles); double-tap bbox | distance/angle pill | stroke, width |
| **Arrow** | one-finger drag | endpoint drag; double-tap → panel | arrowhead 6-icon strip | stroke, width, arrowhead |
| **Callout** | one-finger press-drag (min 10 px) → keyboard | double-tap textBox = text; drag parts; connector = whole-move | three part handles | font (single-name), size, color |
| **Counter** | one-finger tap drops pin | pause-orbit (Race LongPress+Pan); double-tap select | series swatch strip + chevron | color, number stepper (locked if series>1) |
| **Text** | one-finger tap → keyboard | tap (text tool) / double-tap (select) | keyboard-frame pan offset | font (single-name), size, B/I, color |
| **Survey Marker** | one-finger press-drag (min ~20 screen px) | double-tap → bottom panel (no-template fallback) | bottom panel: template/module/checklist/photos | module selector |
| **Native text markup** | none (import-only) | tap select → Delete | — | none |
| **Text-select** | n/a | OS long-press selection (RNGH gated off) | OS selection handles | none |
| **Region** (mobile-only) | one-finger drag rect | tap select; bottom panel | space/label association | label/space |

---

## 11. Pending live-test items

These are the only items without a final winner; the sandbox + a physical device decide them.

- ~~**Multi-select method**~~ → **RESOLVED (§0.6):** both tap-select + **freeform** lasso, with
  add & subtract. (Freeform lasso default; optional rectangle mode.)
- ~~**Constrain method / hold-to-snap**~~ → **RESOLVED (§0.6):** **lock-aspect toggle in the
  long-press context menu**; draw-time hold-to-snap **cut**.
- ~~**Context-menu feel**~~ → **RESOLVED (§0.6):** **long-press only** (~350 ms), **no Quick-Bar**.
  (Still open only: long-press menu as popover vs bottom-sheet.)
- ~~**Rotation 15° snap granularity**~~ → **RESOLVED (§0.6):** keep 15°, **Settings-toggle only**,
  not interactable in the viewer. (Rotated-group **resize** still pending.)
- **Double-tap empty fit** — toggle animation and background-vs-annotation disambiguation feel.
- **Scroll/fling** — `Animated.decay` momentum feel; continuous vs paginated for field users;
  `FlatList` vs `ScrollView` perf on a 50-page plan.
- **Highlighter blend/opacity** match vs desktop.
- **Eraser** — partial-erase finger precision + JS-thread frame drops on stroke-dense pages;
  touch-follow ring feel.
- **Rotated-group resize** feel (single-shape 15° snap is RESOLVED — §0.6).
- **Move arm threshold** (8 vs 12 pt).
- **Two-finger-tap undo** safety delay (120–250 ms) + hold-to-repeat rate; **Samsung** three-
  finger-redo system-gesture intercept.
- **Pinch focal-anchor** accuracy on hardware.
- **Native text-select** feasibility on the chosen pdf.js renderer + RNGH↔text-layer routing.
- **Small-shape midpoint-handle threshold** (line endpoints always shown).
- **Callout textBox pinch-resize** (nested detector).
- **Rotation-handle viewport clamp** behavior on small screens.
- **Precision nudge** — whether it's needed on phone at all.

---

## 12. Open questions / risks

1. **RNGH composition is the load-bearing risk.** Mid-draw pan/pinch demands all-`Simultaneous`
   (not the prototype's `Race`); the existing GestureSandbox must be reconciled to Lab C's
   pattern before P5.
2. **Pan architecture cost.** Full RNGH ownership means manual fling/bounce/indicators; a poorly
   tuned `Animated.decay` makes the app feel wrong globally.
3. **Settings screen is a hard dependency** for two locked toggles (undo gesture, rotation snap)
   and the auto-return/haptic/constrain toggles — none exist yet.
4. **Desktop pre-requisite fixes** before mobile wiring: callout-Delete stub, Continue-Pin stub
   (both live, affect current users), then `handleCutCallout` `canModify` hardening
   (defense-in-depth, no live bypass).
5. **Storage adapter** for `zoomController` (`localStorage`→`AsyncStorage`) before fit-mode
   persistence works.
6. **pdf.js text-layer renderer** choice gates native text-selection — possibly a separate
   spike.
7. **Mobile handler factory** — the desktop delete/save/undo-checkpoint `useCallback`s don't
   exist in `mobile-expo-go/`; a parallel pipeline must be built.
8. **Reanimated deferral** — JS-thread `Animated` may not hold 60 fps for the eraser ring,
   pinch, and high-density draw; the upgrade trigger is profiling, not a date.
9. **Discoverability debt** — every navigation/edit gesture is invisible; coach marks + a
   reference sheet are required, not optional, for non-power-user field engineers.
10. **Android parity** — pointer arena differences (two-finger tap, three-finger redo) need
    device verification.
