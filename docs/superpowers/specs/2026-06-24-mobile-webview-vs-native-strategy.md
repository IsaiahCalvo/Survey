# Mobile PDF Annotator — Native react-native-skia vs pdf.js-in-WebView

**Date:** 2026-06-24
**Status:** DECISION
**Scope:** How to build the mobile (Expo/RN) annotation surface — annotate Survey Markers + light markup on PDF plans, offline-first field use.
**Options on the table:**
- **A — Native:** `react-native-pdf` render + `@shopify/react-native-skia` + `react-native-reanimated` worklets for the annotation layer.
- **B — WebView:** bundle the desktop web stack (pdf.js + Fabric.js/SVG annotation code) inside a `react-native-webview` (WKWebView) and reuse it.
- **Hybrid:** native shell + native render + native Skia overlay, with WebView reserved as a narrow escape hatch for one specific desktop-only review screen.

---

## 1. TL;DR — Recommendation

**Go with A (native react-native-skia + Reanimated worklets), built on the existing `AnnotatablePdf` foundation.** The deciding factor is **not** pen feel — it is **offline durability plus the discovery that Option B does not actually save the hard work.** WKWeb-stored data on iOS 17+ is subject to LRU eviction under storage pressure (a trust-destroying failure for a field surveyor who loses work with no signal), while native `expo-file-system` + `expo-sqlite` persist like any app file. And the gesture-adaptation work (mouse→touch, right-click→long-press, wheel-zoom→pinch) must be written either way — Option B relocates it into web-JS inside a WKWebView with documented bugs, it does not eliminate it.

**Honest feel tradeoff:** Native Skia with worklets can hit 120fps on ProMotion and feels immediate for tap-to-place and light ink; it does **not** match GoodNotes/PencilKit (~9ms predictive ink) because RN-Skia does not surface predicted/coalesced Apple Pencil touches. For this app's workload (tap-to-place markers, not calligraphy) that ceiling is more than enough — but only a device spike confirms the *feel*, and that uncertainty is real on both paths.

---

## 2. The honest feel reality

### WebView pdf.js / Fabric canvas ink on iOS — what it actually feels like

If drawing stays **entirely inside** the WebView (touch → canvas → render, no RN bridge per point), the RN↔native bridge is *not* in the per-stroke hot path — the common "bridge latency kills it" fear is mislocated. The bridge only bites on save/sync, which can be deferred. But WebKit-internal ceilings are real and unavoidable:

- **Hard 60Hz `requestAnimationFrame` cap in WKWebView, even on 120Hz ProMotion iPads** (Apple FB16411517, Jan 2025, unresolved; Safari 18.3's unlock flag does not apply to WKWebView). So canvas ink is stuck at a 16.7ms cadence regardless of device.
- **No `getCoalescedEvents()` in Safari/WKWebView** — if a frame is slow, sub-frame pointer samples are simply lost. Native uses always-delivered coalesced + predicted touches.
- **`desynchronized: true` canvas hint** is unverified on iOS WKWebView (formal compat = unknown; some Safari reports say it helps — genuinely ambiguous).
- **iOS-15-class canvas regressions** (GPU-process canvas rendering) have broken WKWebView canvas apps before — an OS-update risk outside your control.

Net feel: a **60fps-capped** canvas. For finger tap-to-place and dragging a rectangle, 60fps is *adequate*. For continuous freehand ink it is visibly behind a native path, and there is no ProMotion headroom to grow into.

### Native Skia + Reanimated worklets — what it actually feels like

Wired correctly (gesture → Reanimated `SharedValue` → in-place Skia path mutation → GPU frame, all on the UI thread via RNGH worklets, `runOnJS` default false), the touch-to-pixel loop **never touches the JS thread**. This is the architecture the RN-Skia maintainers recommend (dual canvas: committed paths declarative on the bottom, live stroke imperative on top via `useSharedValue` + `notifyChange()`; naive per-point `useState` is what makes the current foundation lag).

- Runs at **display refresh rate — up to 120fps on ProMotion** (with `CADisableMinimumFrameDurationOnPhone` in Info.plist). This is a real ceiling advantage over WebView's hard 60Hz that the WebView path can never reach.
- **Honest gap:** RN-Skia does **not** expose Apple Pencil predicted/coalesced touch (no public evidence it does). The "ink leads the tip" feel of GoodNotes/Apple Notes is PencilKit territory. RN-Skia feels *smooth and non-laggy*, not *predictive*.
- **Honest caveat on the evidence:** the widely-cited "60fps RN-Skia drawing" demos (Notesnook, drawing-board) are **asserted, not benchmarked**, and use a now-deprecated `useTouchHandler` API. The strongest production inking proof point (`mathnotes/mobile-ink`) is **not pure RN-Skia** — it ships a custom Metal `MTKView` + C++/Swift native code. So "GoodNotes-class on RN-Skia alone" is unproven; "smooth enough for marker placement + light markup on RN-Skia + worklets" is well-supported.

**Bottom line on feel:** native is meaningfully better than a 60fps-capped WebView and has 120fps headroom, but is not PencilKit-class. For *this* app that is the right amount of feel. The exact perceptible delta for finger marker-placement at 60fps-WebView vs 120fps-Skia is the one thing no public benchmark settles — hence the spike.

---

## 3. The code-reuse truth

The pitch for B is "bundle the desktop app, done." Examined honestly, the reuse is **shallow**, and it is the same on both paths for everything that matters.

**Reuses identically in A and B (so confers no advantage to B):**
- `@survey/shared` domain contract (Survey Marker schema, annotation types, serialization) — platform-agnostic TS, the genuinely valuable shared layer.
- Pure-JS business/service logic (sync diff, annotation services) — no DOM deps.

**Reuses *only* in B, but with strings attached:**
- pdf.js rendering — runs in WKWebView, but you must bundle ~33MB of pdf.js + cmaps, version-pin for WebView compatibility, and work around a documented iOS **release-build** local-asset-loading bug (`Operation not permitted` for worker/cross-file refs; blob-inlining workaround inflates payload). And the project already has `react-native-pdf` doing native render more reliably — so reusing pdf.js here is a *regression*, not a win.
- Toolbar/tool-switching HTML/CSS — a modest real win.

**Does NOT meaningfully reuse in B (the load-bearing part):**
- The Fabric.js drawing/gesture layer is **mouse-first** — `mousedown/move/up`, `contextmenu` (right-click), hover, double-click, wheel-zoom, Shift/Ctrl modifiers, spread across ~28 desktop files. Fabric core has **no built-in multi-touch gesture layer**: pan/pinch/long-press must be hand-written. (Fabric v7 *did* ship gestures via `westures` in Dec 2024 — this project is on v6, so adopting them is its own migration + WKWebView-touch verification, not free.) Plus documented WKWebView-specific Fabric bugs: touch events failing to register in RN WebView (#8849), canvas displacement (#4374), Apple-Pencil event dropping (#8465).
- `PDFViewer.jsx` is Electron/Syncfusion-coupled (IPC, `zoomGeneration` contract) — does not run in a WebView at all.
- RNGH-vs-WebView gesture conflicts: pan inside a WebView fights WKWebView's own scroll recognizer and RNGH's outer gestures; the community workaround (`Gesture.Native()` + `simultaneousWithExternalGesture`) only emerged Oct 2025 after a 3-year-open thread.

**The core truth:** the **gesture-adaptation work is not avoided by B — it is relocated** from RNGH (where pan/pinch/long-press are first-class) into web-JS inside WKWebView (fewer tools, more browser quirks, documented open conflicts). Right-click→long-press, hover→tap, wheel→pinch must be built regardless. B's "one codebase" promise collapses the moment touch differs from mouse — which is immediate — leaving you maintaining a divergent mobile-touch fork of the Fabric layer in parallel with the desktop mouse version.

**A's rebuild cost is smaller than the desktop's ~56k annotation LOC implies**, because mobile v1 scope is narrow (marker placement, tap-select, light markup, photos/notes — no callout/counter/collab machinery), prior art exists (`react-native-free-canvas` gives Skia ink + zoom/pan + serialization as a starting point; note: not pressure-sensitive), and `AnnotatablePdf` already renders + inks + tap-selects today. The remaining work is moving `currentPath` into a `useSharedValue<SkPath>` and running the gesture as a worklet.

---

## 4. Comparison table

| Axis | A — Native Skia + Reanimated | B — pdf.js/Fabric in WKWebView |
|---|---|---|
| **Pen feel** | Smooth, up to **120fps ProMotion**; not PencilKit-predictive | Hard **60fps cap**, no ProMotion, no coalesced events; adequate for tap, weak for ink |
| **Zoom/pan feel** | First-class RNGH pinch/pan on UI thread, worklet-driven | WKWebView scroll vs Fabric vs RNGH 3-way conflict; fragile workarounds |
| **Effort to ship** | Scoped rebuild of a *narrow* toolset; worklet migration of existing foundation | Bundle/version-pin pdf.js + patch WKWebView Fabric bugs + rebuild gesture layer in web-JS + maintain a fork |
| **Code reuse** | `@survey/shared` + services (same as B); drawing engine rebuilt | `@survey/shared` + services + pdf.js + toolbar HTML — but pdf.js dup's existing native render; Fabric layer effectively rewritten |
| **Gesture-adaptation fit** | Native home for it — pan/pinch/long-press first-class | Relocated into a worse environment; not avoided |
| **Offline / field** | **expo-file-system + SQLite — durable, no eviction** | **WKWebView LRU eviction risk + iOS release-build asset bug** |
| **Maintenance** | Two renderers of one shared schema (clean, normal desktop/mobile split) | Mobile-touch Fabric fork diverging from desktop mouse version + two pdf.js pipelines |
| **North-star fit** | **Owns the renderer + zoom** (the project's stated goal) | Re-introduces an unowned renderer (WKWebView) on the most latency-sensitive surface |

---

## 5. Recommendation + the single NEXT SPIKE

**Recommendation: Build A (native).** Adopt the hybrid *shape* — native shell, native `react-native-pdf` render, native Skia annotation overlay — and keep WebView only as a possible narrow escape hatch for a future desktop-only "review existing annotations" screen, not for the authoring flow.

**The one spike to build so the user can FEEL it on their phone — a Reanimated-worklet ink spike on `AnnotatablePdf`:**

1. Replace `Animated.Value` zoom/pan with `useSharedValue` + `Gesture.Pinch().Simultaneous(Gesture.Pan())` + `useAnimatedStyle`.
2. Replace per-point `setState` ink with the dual-canvas pattern: committed paths in a bottom `<Canvas>`, live stroke as a `useSharedValue`-backed `SkPath` mutated in `Gesture.Pan().onChange()` (worklet) + `notifyChange()`.
3. Map screen→page coords inside the worklet (`gestureX / scale.value - translateX.value`).
4. Run on a **physical iPhone (not the simulator — the sim hides JS-thread latency)**. Draw a freehand line and tap-place a Survey Marker.

**Pass/fail:** if pinch-zoom and ink both feel native with no JS-thread jank, A is confirmed and the path is clear. Build this *before* committing — it is ~1 day for the wiring (integration-debugging the `react-native-pdf` host under a Reanimated parent transform is the unknown that may add time). Only if Pencil latency is still perceptible after the worklet migration do you evaluate a PencilKit native module (`expo-pencilkit-ui` — existence confirmed, New-Arch/coexistence unverified, so itself a spike) — not before.

*(Optional B counter-spike, only if you don't trust the analysis: drop the existing desktop annotation page into `react-native-webview` on the same iPhone and finger-draw. The 60fps-cap + Fabric touch quirks will be apparent immediately. Running both back-to-back is the most honest decision input — but the offline durability and maintenance-fork arguments already favor A independent of feel.)*

---

## 6. Honest risks + what only a device test settles

**Risks if we pick A:**
- **Feel uncertainty:** no public benchmark measures RN-Skia ink latency vs WebView canvas on a modern iPhone for *this* workload. Only the device spike settles whether worklet ink feels immediate.
- **Effort uncertainty:** "1 day" is the worklet wiring; how tightly `AnnotatablePdf` state is coupled to React renders, and whether `react-native-pdf`'s page host cooperates with a Reanimated parent transform, are device-only unknowns. RN-Skia + Reanimated + gesture composition has had real pan-stutter regressions (Shopify #3426).
- **`react-native-pdf` + Expo SDK 54 iOS visibility bug** (#969) is a known stack-specific gotcha to verify on device before relying on it.
- **PencilKit ceiling:** if the workload ever turns out to be pen-heavy (>~50% freehand), RN-Skia alone won't reach GoodNotes feel — the escape hatch is a PencilKit native module, itself unverified for New Arch.

**Risks if we (wrongly) pick B:**
- WKWebView storage eviction losing field work — the single worst outcome for a field-first app.
- iOS release-build local-asset bug breaking offline pdf.js in production (not just dev).
- A perpetual mobile-touch Fabric fork diverging from desktop.
- A hard 60fps ceiling with no ProMotion path, on the most latency-sensitive surface, against the project's own north-star of owning the renderer.

**What only a device test settles (either path):**
- The actual perceptible feel of worklet ink and pinch-zoom at the device's true refresh rate.
- Whether the `react-native-pdf` host + Reanimated transform compose cleanly without stutter.
- The real surveyor action mix (tap-to-place vs freehand) — which, if measured, is the one finding that could change the feel-ceiling requirement. Assumed tap-dominant per the project brief; unverified.

---

*Direction is well-supported by the research and survives its own fact-checks; the magnitude of the feel delta is the honest open question, and the spike above is designed to close it cheaply before any large commitment.*
