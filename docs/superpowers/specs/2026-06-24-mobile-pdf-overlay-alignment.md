# Production architecture: Skia ink/annotation overlay aligned to react-native-pdf under zoom/pan

Date: 2026-06-24
Status: DECISION
Stack: Expo SDK 54 · RN 0.81 · New Architecture ON · iPhone-first
Validated spikes: rn-pdf@7.0.4 renders on New Arch (Spike 1 PASS) · @shopify/react-native-skia@2.2.12 ink Canvas draws over `<Pdf/>`, 1-finger draw + mode toggle work (Spike 2 PASS, but ink is in SCREEN space and does NOT track zoom/pan)

---

## 1. TL;DR — recommended architecture

**Build Architecture B — Fixed-Scale PDF + Container Transform — as the production target. Component: `PdfPageAnnotator`.**

Render `<Pdf/>` at a fixed scale with its own gestures fully disabled (`singlePage`), put the `<Pdf/>` and the Skia ink `<Canvas/>` as siblings inside ONE Reanimated `Animated.View`, and drive that container's pinch+pan with RNGH + Reanimated shared values. Because the PDF bitmap and the ink share one transformed coordinate space, **ink alignment is structurally guaranteed at every frame — zero per-frame coordinate math, zero JS-bridge sync.**

The single deciding fact: **react-native-pdf exposes NO live scroll/pan offset to JS on the iOS PDFKit path — not at any frequency, not coarsely, not at all.** (Verified in the installed native source: the only `UIScrollView` access is to toggle `scrollEnabled`; no `UIScrollViewDelegate`, no `contentOffset` is ever emitted.) That kills Architecture A (observe-native-transform) outright — you can never know where the page is during a pan. The cost of B is PDF bitmap blur *during* the pinch (the container CSS-scales a fixed-resolution bitmap); we hide it with a re-render on zoom-settle via rn-pdf's `scale` prop, which triggers a crisp PDFKit vector re-render. Architecture C (self-render the page into Skia) is the v2 north-star for zero-blur, kept as the documented fallback.

---

## 2. The deciding question, answered: what rn-pdf actually exposes

Source of truth: installed `mobile-expo-go/node_modules/react-native-pdf@7.0.4` — `index.d.ts`, `index.js`, and `ios/RNPDFPdf/RNPDFPdfView.mm` (961 lines, the PDFKit-backed Fabric component that Spike 1 validated). On iOS the default and only relevant path is `usePDFKit: true` (set in `index.js` `defaultProps`; note it is NOT in the TypeScript `PdfProps`, so it is untyped — disabling it gets no IDE help). That path is backed by Apple's `PDFView` (`RNPDFPdfView.mm:272`), a vector renderer.

### The complete transform-observable surface (from `index.d.ts`)

```ts
interface PdfProps {
  scale?: number;            // settable: → _pdfView.scaleFactor = scale * _fixScaleFactor (line 483)
  minScale?: number;
  maxScale?: number;
  fitPolicy?: 0 | 1 | 2;
  scrollEnabled?: boolean;   // toggles the internal UIScrollView.scrollEnabled ONLY
  singlePage?: boolean;      // → _pdfView.userInteractionEnabled = NO  (line 509)
  onScaleChanged?: (scale: number) => void;
  onPageSingleTap?: (page, x, y) => void;     // x,y in SCREEN space, not PDF space
  onLoadComplete?: (numberOfPages, path, size:{height,width}, tableContents?) => void;
}
interface PdfRef { setPage(pageNumber: number): void }   // the ONLY ref method
```

### Resolved contradictions across the per-angle drafts

These were the points the fact-checks disagreed on. Resolved against the installed source:

1. **Scroll / pan offset — NOT EXPOSED, at any frequency.** `RNPDFPdfView.mm:520–536` is the only place the internal `UIScrollView` is touched, and it only sets `scrollView.scrollEnabled = YES/NO`. There is no `UIScrollViewDelegate` conformance, no `scrollViewDidScroll:`, no `contentOffset` ever passed to `notifyOnChangeWithMessage:`. **This is the load-bearing fact that kills Architecture A.** (rn-pdf issues #275 / #869 confirm the gap is unresolved upstream; #869 is actually a "did the user scroll to the end" T&C use case, not a live-offset request — cited for the gap, not the use case.)

2. **`onScaleChanged` DOES fire mid-pinch — but only via rn-pdf's own recognizer, and it's irrelevant to B.** There are two scale paths, and the drafts conflated them:
   - Apple's `PDFViewScaleChangedNotification` (registered `RNPDFPdfView.mm:290`) fires only at **gesture END**, not per frame (Apple Developer Forums thread/99618; some iOS versions even fire it inconsistently). This was the "dealbreaker" claim — half right.
   - rn-pdf *also* installs its OWN `UIPinchGestureRecognizer` on `self` (`bindTap`, lines 900–905) whose handler `handlePinch:` (lines 858–860) calls `onScaleChanged:` on every `.changed` sample — so scale DOES update continuously during a pinch via this path.
   - **But this does not rescue Architecture A**, because (a) there is still no focal point and no scroll offset emitted, and (b) on New Architecture the value still crosses the C++→JS Fabric event boundary on the main thread while your Skia/worklet runs on the UI thread — so even continuous scale cannot anchor an overlay you can't position. The correct rejection reason for A is **missing pan offset + missing focal point**, NOT scale frequency.

3. **`_fixScaleFactor` is opaque to JS.** It is an Obj-C ivar (`RNPDFPdfView.mm:455`, `=frame.width/pdfPageRect.width`) computed from `fitPolicy` at load; it is never emitted. You cannot reconstruct PDF user-space coordinates from the emitted `scale` float alone. (Relevant only to A; B never needs it because B owns the transform.)

4. **`onLoadComplete` `size` is DISPLAY-space, not raw media-box points.** `RNPDFPdfView.mm:627` computes it via `[_pdfView rowSizeForPage:page]` — a `PDFView` method returning the page row's size in the view's current coordinate system, NOT `CGPDFPageGetBoxRect` media-box points. **Do not use `onLoadComplete.size` as the normalization denominator** for coordinate math — it is scale-dependent and will produce wrong normalized coords at non-default fit. Measure the rendered page box with RN `onLayout` instead, OR carry true media-box points from the desktop/`@survey/shared` side. (This corrects the coordinate-math draft, which assumed media-box points.)

5. **`onPageSingleTap` gives SCREEN coords** (`handleSingleTap:` line 838, `locationInView:self`), never converted to PDF space before emission. Not usable for annotation placement without B's own math.

### Therefore — viability per approach

| Approach | Viable on default iOS PDFKit path? | Blocking fact |
|---|---|---|
| A — native zoom + observed transform | **NO** | No pan/scroll offset emitted, ever; no focal point. Would require forking the native module (add a `UIScrollViewDelegate` + emit offset + focal each frame) — and even then, bridge latency on pan would jitter. |
| B — fixed-scale PDF + container transform | **YES** | None. `singlePage` cleanly kills native gestures; we own the transform. Cost = pinch-time blur (mitigable). |
| C — self-render page into Skia | **YES, but high cost** | Needs a custom Expo Module to rasterize PDF→bitmap at arbitrary DPI (no verified New-Arch OSS lib). Best crispness, most engineering. |

---

## 3. Comparison of candidate architectures

| Dimension | A — Observed transform | B — Fixed-scale + container (RECOMMENDED) | C — Self-render into Skia |
|---|---|---|---|
| **Alignment quality** | Broken — no pan offset; ink drifts on every pan, can't anchor on pinch | **Perfect — structural.** PDF + ink in one transformed container; same coord space every frame | Perfect — page image + ink in one Skia canvas |
| **Crispness under zoom** | Crisp (PDFKit re-rasterizes vector live) — the one thing A is good at | Blurry *during* pinch (bitmap CSS-scaled); crisp after settle via `scale`-prop re-render | Configurable; crisp if bitmap re-rendered at `pts × zoom × dpr`; blurry mid-pinch like B |
| **Latency** | Fatal — sync depends on JS-bridge events that don't exist (offset) | Zero overlay-sync latency — transform runs on UI thread (Reanimated worklet) | Zero overlay-sync latency; re-render latency on settle (CoreGraphics rasterize) |
| **Implementation cost** | N/A (would need native fork) | **Low–medium** — all deps already in stack (RNGH 2.28, Reanimated 4.1, Skia 2.2.12); no native code | High — bespoke Expo Module rasterizer + tile/zoom re-render loop; lose `<Pdf/>` pagination/search/text-select |
| **Risk** | Rejected | Medium: pinch-blur UX; multi-page strategy; verify RNGH touches reach through `userInteractionEnabled=NO` view on New Arch | Higher: Skia 2.2.x image-resample bug (#3383/#3464 — *closed/by-design*, tile strategy required), SkData memory retention (#2909 fix likely NOT in 2.2.12), New-Arch native module |

---

## 4. Recommended component design to build NOW — `PdfPageAnnotator`

Single-page-at-a-time annotator (the Survey Marker use case is page-at-a-time). One `<Pdf singlePage>` + one Skia `<Canvas>` per visible page, both inside one transformed container.

### Props

```ts
interface PdfPageAnnotatorProps {
  source: { uri: string };
  pageIndex: number;                  // 0-based
  pageWidthPt: number;                // TRUE media-box width in points (from @survey/shared / desktop, NOT onLoadComplete.size)
  pageHeightPt: number;               // TRUE media-box height in points
  tool: 'pen' | 'pan';                // active tool (CORE LAW gating)
  strokes: InkStroke[];               // existing strokes in PDF user-space (see §4 storage)
  onStrokeCommit: (stroke: InkStroke) => void;
  strokeColor?: string;
  strokeWidthPt?: number;             // stored in points so it scales with the page
  minZoom?: number;                   // default 1
  maxZoom?: number;                   // default 6
}
```

### State / shared values

```ts
// Reanimated shared values — container transform (UI thread)
const scale = useSharedValue(1), savedScale = useSharedValue(1);
const tx = useSharedValue(0), ty = useSharedValue(0);
const savedTx = useSharedValue(0), savedTy = useSharedValue(0);
const focalX = useSharedValue(0), focalY = useSharedValue(0);

// PDF crisp re-render scale — React state, updated on zoom-settle only
const [pdfRenderScale, setPdfRenderScale] = useState(1);

// Rendered page box in LOGICAL px at pdfRenderScale=1 — measured via onLayout (NOT onLoadComplete.size)
const pageBoxPx = useRef<{ w: number; h: number } | null>(null);

// In-progress stroke points (Skia path), captured in container-local space
const livePath = useSharedValue<SkPath | null>(null);
```

### Gesture wiring (RNGH composition — honors the CORE LAW)

CORE LAW: 1 finger = active tool; 2 fingers = ALWAYS pan + pinch. Enforced by pointer count, so the two-finger gesture pre-empts the draw the instant a second finger lands.

```ts
// --- 1 finger: draw, ONLY when tool==='pen' ---
const draw = Gesture.Pan()
  .enabled(tool === 'pen')
  .maxPointers(1)
  .onStart((e) => { livePath.value = newPathAt(toContainer(e.x, e.y)); })
  .onUpdate((e) => { livePath.value = appendTo(livePath.value, toContainer(e.x, e.y)); })
  .onEnd(() => { runOnJS(commitStroke)(livePath.value); livePath.value = null; })
  .onFinalize(() => { livePath.value = null; }); // cancelled when 2nd finger lands

// --- 2 fingers: pan + pinch the whole container (ink tracks for free) ---
const pinch = Gesture.Pinch()
  .onStart((e) => { focalX.value = e.focalX; focalY.value = e.focalY; savedScale.value = scale.value; })
  .onUpdate((e) => {
    scale.value = clamp(savedScale.value * e.scale, minZoom, maxZoom);
    focalX.value = e.focalX; focalY.value = e.focalY;
  })
  .onEnd(() => { savedScale.value = scale.value; runOnJS(onZoomSettle)(scale.value); });

const pan = Gesture.Pan()
  .minPointers(2).maxPointers(2)
  .onUpdate((e) => { tx.value = savedTx.value + e.translationX; ty.value = savedTy.value + e.translationY; })
  .onEnd(() => { savedTx.value = tx.value; savedTy.value = ty.value; });

const twoFinger = Gesture.Simultaneous(pan, pinch);     // RNGH discussion #2844 pattern
const composed  = Gesture.Exclusive(twoFinger, draw);   // 2-finger wins over 1-finger draw
```

### Component tree

```tsx
<GestureDetector gesture={composed}>
  <Animated.View style={[{ width: pageBoxPx.w, height: pageBoxPx.h }, animatedStyle]}>
    <Pdf
      source={source} page={pageIndex + 1}
      singlePage                       // userInteractionEnabled = NO → ALL native gestures off
      scale={pdfRenderScale}
      minScale={pdfRenderScale} maxScale={pdfRenderScale}
      scrollEnabled={false} enableDoubleTapZoom={false}
      onLayout={measurePageBox}        // source of truth for px denominator
      style={{ width: pageBoxPx.w, height: pageBoxPx.h }}
    />
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {strokes.map((s) => <Path key={s.id} path={toContainerPath(s)} style="stroke"
                                strokeWidth={s.widthPt * baseScale} color={s.color} />)}
      <LivePathView path={livePath} />
    </Canvas>
  </Animated.View>
</GestureDetector>
```

`animatedStyle` — the standard 7-step focal transform (translate→focal→scale→un-focal):

```ts
const animatedStyle = useAnimatedStyle(() => ({
  transform: [
    { translateX: tx.value }, { translateY: ty.value },
    { translateX: focalX.value }, { translateY: focalY.value },
    { scale: scale.value },
    { translateX: -focalX.value }, { translateY: -focalY.value },
  ],
}));
```

### Coordinate math — screen ⇄ PDF user-space

Key simplification: because the `draw` `GestureDetector` is **inside** the transformed `Animated.View`, RNGH delivers `e.x/e.y` already in **container-local (pre-transform) space**. The draw handler never needs to know the current scale or translation. So `toContainer()` is the identity on the gesture coords — the only conversion is container-local px ⇄ PDF points.

Let `baseScale = pageBoxPx.w / pageWidthPt` (logical px per PDF point at `pdfRenderScale=1`). PDF user-space is **bottom-left origin, y-up**; container/Skia is **top-left, y-down** — so the store path includes the y-flip.

```
// DRAW (capture): container-local px (cx, cy)  →  PDF user-space (px, py), stored
px = cx / baseScale
py = pageHeightPt - (cy / baseScale)         // y-flip: top-left→bottom-left

// RENDER (Skia): PDF user-space (px, py)  →  container-local px (cx, cy)
cx = px * baseScale
cy = (pageHeightPt - py) * baseScale          // y-flip back
// the Reanimated container transform then applies scale+pan on top — no per-point math
```

### Stroke storage for `@survey/shared` round-trip

Store strokes in **PDF user-space points** (zoom-independent, bottom-left origin) so they round-trip with the desktop owned-pdf.js renderer. Note: `@survey/shared` `RegionBounds`/`Bounds` are **normalized 0..1, top-left origin** (verified: `packages/shared/src/survey.ts:66` "normalized 0..1"; `geometry.ts` `Bounds` = "top-left origin"). Ink is a point list, not a single bbox, so it needs its own shape; align it to the shared *convention* and let the bbox be `RegionBounds`-compatible.

```ts
type InkStroke = {
  id: string;
  pageIndex: number;
  // points in NORMALIZED 0..1, top-left origin — matches @survey/shared + Instant-JSON convention
  points: Array<[number, number]>;   // [x/pageWidthPt, (pageHeightPt - pdfY)/pageHeightPt]
  widthPt: number;                   // stroke width in POINTS (scales with page; NOT NoZoom)
  color: string;
  bbox: RegionBounds;                // normalized 0..1 — drop-in to the shared schema
};
```

Storing normalized top-left (rather than raw bottom-left points) means the desktop pdf.js side needs **no y-flip on read** (`screenX = x*viewport.width`, `screenY = y*viewport.height`) — both sides agree on top-left/y-down normalized, which is also PSPDFKit/Nutrient Instant-JSON's convention. Ink scales with the page (no `NoZoom`/`e_no_zoom` flag — that's reserved for fixed-size stamps/counters, a later UX decision, not a correctness requirement).

---

## 5. Crispness strategy + fallback

### Primary (Architecture B): re-render on zoom-settle

During a pinch the container CSS-scales the fixed-resolution PDF CALayer → blur proportional to `zoom / pdfRenderScale`. On `pinch.onEnd`:

1. `runOnJS(onZoomSettle)(finalZoom)` → `setPdfRenderScale(finalZoom)`.
2. The new `scale` prop drives `_pdfView.scaleFactor = scale * _fixScaleFactor` (`RNPDFPdfView.mm:483`) → PDFKit **re-rasterizes from vector at full quality**. This is a native-only prop update (no React remount).
3. Simultaneously reset the container `scale` shared value back toward 1 and fold the delta into the layout, so the now-higher-res bitmap displays at ~1:1. (Net: the visible page stays put; only its backing resolution changes.)
4. **Hide the swap.** Do NOT key the un-blur on `onScaleChanged` — that fires on the in-memory scale change, BEFORE PDFKit's async tile re-render is visible, so you'd flash a blurry frame. Use a short freeze overlay (a `pointerEvents="none"` absolute-fill snapshot/scrim) dismissed on a calibrated delay (empirically ~200–400 ms; measure on device) or a spring that snaps zoom to discrete steps (1×/1.5×/2×/3×) to mask the latency.

Blur is only visible *during* the active gesture — acceptable for v1 and matches common mobile annotation apps.

### Fallback if B hits a wall → Architecture C (`SkiaPdfPageAnnotator`)

If pinch-time blur tests as unacceptable, or RNGH touches fail to reach through the `userInteractionEnabled=NO` `<Pdf/>` on New Arch (must verify on device), pivot to C:

- **Rasterizer:** ~40-line custom **Expo Module** (Expo Modules API, full New-Arch/JSI) using PDFKit `PDFPage.draw(with:.mediaBox, to:)` into a `UIGraphicsImageRenderer`. Pixel-exact: set `format.scale = 1` and size = `mediaBox.size * zoom * dpr` (fold dpr into the size — do NOT rely on the renderer's default `UIScreen.main.scale`). Returns a `file://` JPEG/PNG. (OSS libs `react-native-pdf-page-image` / `react-native-pdf-to-image` have a `scale`/`dpi` param but New-Arch compat is UNVERIFIED — bespoke module is safer.)
- **Into Skia:** `Skia.Data.fromURI("file://…")` → `Skia.Image.MakeImageFromEncoded(data)` (confirmed in installed `@shopify/react-native-skia` `DataFactory.d.ts` / `ImageFactory.d.ts`).
- **Draw page image + ink in ONE `<Canvas>`** → mathematically perfect alignment, zero overlay sync. Re-rasterize at `pts × zoom × dpr` on zoom-settle for crispness (Skia does NOT resample images on canvas zoom — #3383/#3464 are closed/by-design; the tile-swap IS the fix). Lose `<Pdf/>`'s free pagination/search/text-select — acceptable for page-at-a-time.
- **Watch:** SkData retention (#2909 fix likely not in 2.2.12) — profile memory across many re-renders on device.

`react-native-skia` does NOT expose Skia's own `SkPDF` reader (#1595 open) — do not rely on it for the page layer.

---

## 6. Open risks + what must be tested on a real device

1. **RNGH touch pass-through (BLOCKER to de-risk first).** With `singlePage` → `_pdfView.userInteractionEnabled = NO`, UIKit passes touches up the responder chain — in principle good for an RNGH ancestor. UNVERIFIED that RNGH v2 on Fabric/New Arch receives both 1-finger draw and 2-finger pan/pinch cleanly through/over the disabled native view. Test FIRST; if it fails, put a transparent RN `View` in front for touch capture, or pivot to C.
2. **Pinch-time blur acceptability.** Subjective. Test the freeze-overlay timing on a real device + real PDF; tune the dismiss delay. If unacceptable → C.
3. **Re-render swap visibility.** Confirm there is no blurry/flash frame between overlay dismiss and PDFKit tile-complete. `onScaleChanged` is NOT a reliable tile-complete signal — validate the calibrated-delay approach on device.
4. **Coordinate round-trip fidelity.** Draw at zoom 1× and zoom 4×, store, reload, and render on the desktop pdf.js renderer via `@survey/shared`; assert sub-pixel agreement. Verify the px denominator comes from `onLayout`, not `onLoadComplete.size`.
5. **Crop-box vs media-box.** If PDFs have a non-zero crop-box origin, desktop and mobile must agree which box defines page dimensions. Spike a cropped PDF.
6. **Multi-page UX.** `singlePage` is one page at a time → needs a page-turn flow (one annotator instance per page). If continuous scroll is later required, `singlePage` can't be used; the fallback (`minScale=maxScale, scrollEnabled=false`) leaves PDFKit's pinch recognizer alive and may fight RNGH — would need a native patch to disable it.
7. **120 Hz ProMotion feel.** Confirm the container transform tracks fingers at 120 Hz (Reanimated worklet on UI thread should; verify no jank during simultaneous pan+pinch).

---

### Sources
- Installed: `mobile-expo-go/node_modules/react-native-pdf@7.0.4` — `index.d.ts`, `index.js`, `ios/RNPDFPdf/RNPDFPdfView.mm` (lines cited inline: 272, 290, 455–485, 506–536, 620–631, 735–744, 838, 858–860, 900–905, 925–933), `PdfManager.mm`
- Installed: `@shopify/react-native-skia@2.2.12` — `DataFactory.d.ts`, `ImageFactory.d.ts`
- Installed: `packages/shared/src/survey.ts` (`RegionBounds`, normalized 0..1), `geometry.ts` (`Bounds`, top-left origin)
- Apple Developer Forums thread/99618 — `PDFViewScaleChangedNotification` fires at gesture end
- rn-pdf issues #275, #869 (scroll offset not exposed), #616 (`onPageSingleTap` coords change with scale)
- RNGH gesture-composition docs + discussion #2844 (simultaneous pan+pinch)
- react-native-skia issues #3383 / #3464 (image resample on zoom — closed/by-design), #2909 (SkData memory), #1595 (no PDF reader exposed)
- Nutrient/PSPDFKit Instant-JSON annotation schema (top-left bbox in points; `lineWidth` in pixels) + NoZoom flag (PDF spec bit 4 = value 8); Apryse coordinate guides
- react-native-zoom-toolkit Skia guide (`useTransformationState`; Skia images pixelate faster than RN Image — match canvas size to image resolution)

#### Flagged unverifiable / must-test claims
- Exact freeze-overlay dismiss delay (~200–400 ms) — empirical, device-dependent.
- RNGH-through-`userInteractionEnabled=NO` on New Arch — UNVERIFIED, test first.
- `react-native-pdf-page-image` New-Arch compatibility — UNVERIFIED.
- #2909 SkData fix presence in 2.2.12 — likely absent; profile on device.
