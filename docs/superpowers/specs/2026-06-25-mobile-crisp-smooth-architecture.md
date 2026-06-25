# Crisp + Smooth + Synced PDF Annotations on React Native — the desktop pdf.js model on mobile

**Date:** 2026-06-25
**Status:** DECISION + BUILD SPEC
**Scope:** `mobile-expo-go/annotation/AnnotatablePdf.tsx` and a new native Expo module
**Installed stack (verified):** `@shopify/react-native-skia@2.2.12`, `react-native-reanimated@~4.1.1`, `react-native-gesture-handler@~2.28.0`, `react-native-pdf@^7.0.4`, Expo SDK ~54, RN 0.81

---

## 1. TL;DR — the recommended architecture and the honest effort

**Render the PDF page INTO Skia (Approach C), then re-rasterize on zoom-settle.** A custom Swift/Kotlin Expo module rasterizes one PDF page to a bitmap at the target scale; JS hands those bytes to Skia as an `SkImage`; the page image AND the vector ink are drawn as children of **one Skia `<Canvas>` under one shared `<Group transform>`** — the exact mobile analog of the desktop pdf.js pipeline (`page.render(viewport at scale×DPR)` → canvas bitmap, annotations co-rendered in the same coordinate space). During a pinch the existing bitmap is GPU-scaled (cheap, slightly soft); on `pinch.onEnd` the module re-rasterizes at the new scale and swaps in a crisp `SkImage`. The native `react-native-pdf` view is removed entirely, which is what eliminates the deep-zoom crash. **Honest effort: ~1–2 days to a feelable iOS spike (the safe PNG/Uint8Array path), plus ~1 day for the Android Kotlin module, plus several more days to add scale-cap/tiling and harden the gesture — call it ~1–2 weeks to production-grade crisp+smooth+synced+no-crash on both platforms. There is no off-the-shelf implementation; the module must be written from scratch. Confidence is HIGH on the architecture, MEDIUM on rasterization latency at extreme zoom — only a device test settles that.**

A **lower-risk intermediate spike** (Approach B+: drive `react-native-pdf`'s `scale` prop on settle) exists and is ~1 day, but it does NOT make the page crisp during gesture and carries an unverified PDFKit `autoScales=YES` risk. We treat it as an optional "is crisp-on-settle even enough?" probe, not the destination.

---

## 2. Why the current approaches fail, and how Approach C fixes crisp+smooth+synced together

### Current Approach B (one container: native `<Pdf>` + Skia `<Canvas>` inside one Reanimated `Animated.View`)

The whole container is bitmap-scaled by a single Reanimated `transform: [{translateX},{translateY},{scale}]`.

- **Blur.** A CSS-style transform magnifies an already-rasterized surface. Neither PDFKit nor Skia re-renders at the new DPI mid-gesture, so the page and ink both soften as you zoom. (`react-native-pdf`'s native `scale` prop is hardcoded to `1` in the current file — PDFKit never even sees the user's zoom; the blur is pure bitmap upscale.)
- **Lag + crash at deep zoom.** Bitmap-scaling a native view is bounded by GPU texture limits. The Metal max 2D texture dimension is **16,384 px** on all modern Apple GPUs (apple3+, incl. A16). A letter page at high zoom × 3× DPR blows past this: 8× zoom ≈ 439 MB texture (lag/stall), 14× ≈ **1.1 GB → terminate**. The `MAX_S = 8` cap (file comment: "14x was crashing on the bitmap-scaled page") is the live evidence. **Correction vs early drafts: the crash culprit is the Reanimated container's GPU texture at extreme scale, not PDFKit tile allocation — PDFKit is pinned at 1× in the current code.**

### The separate-pipeline attempt (native PDF + an independently-transformed Skia overlay)

- **Spatial desync.** Two render pipelines (CoreAnimation compositor for the native PDF, Skia/Metal for ink) land in different render passes and sit up to one frame apart — ink visibly drifts from the page. This is structural and not tunable away (it is the same class as Reanimated #5341's native↔Skia 1-frame skew).

### How Approach C fixes all three at once

| Axis | Mechanism |
|------|-----------|
| **Crisp** | On settle, the page is re-rasterized at `pageWidthPts × scale × DPR` and uploaded as a fresh `SkImage` — exactly pdf.js's "new viewport, full re-render" behavior. Ink is Skia **vector**, re-rasterized by the GPU every frame, so it is crisp at any scale. |
| **Smooth** | During the pinch only Reanimated shared values change and Skia GPU-scales the existing `SkImage`. No bridge calls, no native-view relayout per frame → 60/120 fps. |
| **Synced** | The page image and every ink path are children of **one `<Group transform>` in one `<Canvas>`**. They are composited in the same draw call under the same matrix. Spatial desync is **physically impossible** — there is only one pipeline. |
| **No crash** | The native `<Pdf>` view is gone, so no native GPU surface explodes. The only GPU object is the `SkImage`, whose pixel size we **cap** (see §3 memory strategy). Beyond the cap, deeper zoom softens gracefully instead of crashing. |

This is the faithful translation of desktop pdf.js: `PDFKit drawPDFPage at scale×DPR → SkImage` maps 1:1 to `page.render(viewport) → canvas bitmap`, and "ink paths in the same Skia canvas" maps 1:1 to "annotation div in the same CSS-pixel space" — and is in fact *easier* on mobile because Skia already merges both layers.

---

## 3. The concrete BUILD

### 3.1 Native rasterizer — Swift Expo Module (iOS, the spike target)

`modules/pdf-rasterizer/ios/PdfRasterizerModule.swift`. Renders **into a `CGBitmapContext` with `CGContextDrawPDFPage`** (the low-level CoreGraphics call — it does NOT apply its own page-to-context transform, so our manual CTM is correct; `PDFPage.draw(with:to:)` double-transforms and must NOT be combined with a manual CTM). Returns PNG bytes; Expo maps Swift `Data → Uint8Array` (verified for SDK 50+, present in SDK 54 `DynamicDataType`).

```swift
import ExpoModulesCore
import PDFKit

public class PdfRasterizerModule: Module {
  private var docs: [String: PDFDocument] = [:]

  public func definition() -> ModuleDefinition {
    Name("PdfRasterizer")

    AsyncFunction("openDocument") { (uri: String) -> Int in
      guard let url = URL(string: uri) ?? URL(fileURLWithPath: uri) as URL?,
            let doc = PDFDocument(url: url) else {
        throw Exception(name: "LOAD_FAILED", description: "Cannot open \(uri)")
      }
      self.docs[uri] = doc
      return doc.pageCount
    }

    // AsyncFunction runs on Expo's userInitiated background queue — main thread never blocks.
    AsyncFunction("rasterizePage") { (uri: String, pageIndex: Int, scale: Double) -> [String: Any] in
      guard let doc = self.docs[uri], let page = doc.page(at: pageIndex),
            let cgPage = page.pageRef else {
        throw Exception(name: "PAGE_NOT_FOUND", description: "page \(pageIndex)")
      }
      let box = page.bounds(for: .mediaBox)
      let w = Int((box.width  * scale).rounded(.up))
      let h = Int((box.height * scale).rounded(.up))

      let cs = CGColorSpaceCreateDeviceRGB()
      guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                  | CGBitmapInfo.byteOrder32Little.rawValue   // → BGRA_8888 for Skia
      ) else { throw Exception(name: "CTX_FAILED", description: "ctx") }

      ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
      // PDF origin is bottom-left → flip; scale into device pixels.
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
      ctx.drawPDFPage(cgPage)   // CoreGraphics: applies NO transform of its own

      guard let cg = ctx.makeImage() else {
        throw Exception(name: "IMG_FAILED", description: "cgimage")
      }
      let png = UIImage(cgImage: cg).pngData()!     // Data → Uint8Array in JS
      return ["bytes": png, "width": w, "height": h]
    }
  }
}
```

Notes:
- `scale` passed from JS = `displayScale × PixelRatio.get()` (the effective device-pixel scale), **clamped** by §3.4.
- PNG is **smaller than raw RGBA** (DEFLATE), so the `Data`/`Uint8Array` path is bridge-efficient — earlier "PNG is 2–4× larger than raw" claim was backwards. A raw-RGBA path (`MakeImage`) is a later micro-opt that skips the PNG codec (~15 ms) but copies more bytes; not needed for the spike.
- Realistic module size with registration, error handling, and `expo-module.config.json` is ~100–150 lines, not "~60."

### 3.2 JS side — consume bytes, swap on settle

```ts
import { Skia, AlphaType, ColorType, FilterMode, MipmapMode, type SkImage } from '@shopify/react-native-skia';
import { useSharedValue, runOnUI } from 'react-native-reanimated'; // NOT from skia
import { PixelRatio } from 'react-native';

const pageImage = useSharedValue<SkImage | null>(null);
const prevImage = useSharedValue<SkImage | null>(null);   // GC keep-alive guard

async function rasterizeAtScale(uri: string, pageIndex: number, displayScale: number) {
  const dpr = PixelRatio.get();
  const raster = clampRasterScale(displayScale * dpr);            // §3.4
  const { bytes, width, height } = await PdfRasterizer.rasterizePage(uri, pageIndex, raster);

  const data = Skia.Data.fromBytes(bytes);                       // Uint8Array → SkData
  const img =
    Skia.Image.MakeImageFromEncoded(data)                        // PNG path (spike)
    ?? Skia.Image.MakeImage(                                      // raw-RGBA fallback
         { width, height, alphaType: AlphaType.Premul, colorType: ColorType.BGRA_8888 },
         data, width * 4);

  runOnUI(() => { 'worklet'; prevImage.value = pageImage.value; pageImage.value = img; })();
  requestAnimationFrame(() => requestAnimationFrame(() =>
    runOnUI(() => { 'worklet'; prevImage.value = null; })()));   // release after 2 frames
}
```

### 3.3 Skia render — ONE canvas, ONE transform

The outer wrapper is a **plain `<View>`** (no more `Animated.View`); the zoom transform now lives inside Skia's draw tree. `sc/tx/ty` are the existing `SharedValue<number>`s and may be passed straight into Skia props (`AnimatedProp<T> = T | {value:T}`).

```tsx
<Canvas style={StyleSheet.absoluteFill}>
  <Group transform={[{ translateX: tx }, { translateY: ty }, { scale: sc }]}>
    <Image
      image={pageImage} x={0} y={0} width={pageWidthPts} height={pageHeightPts}
      sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}  // see note
    />
    {strokes.map(s => <Path key={s.id} path={toSkiaPath(s)} style="stroke"
                            strokeWidth={s.width} color={s.color} />)}
    <Path path={livePath} style="stroke" strokeWidth={3} color="#2B6FB6" />
  </Group>
</Canvas>
```

Component is **`<Image>`** (there is no `<SkiaImage>` export). Use **`MipmapMode.None`**: `MakeImageFromEncoded` output has no mipmaps and `makeCopyWithDefaultMipmaps` is absent from the 2.2.12 TS types, so `MipmapMode.Linear` silently degrades to `None` anyway. `FilterMode.Linear` does soften the live-pinch frame meaningfully (the "no sampling option helps" claim is too strong) but re-raster-on-settle is still mandatory for true crispness.

### 3.4 Coordinate math

- **PDF/page space → device pixels:** `devicePx = pagePts × displayScale × DPR`. The rasterizer is asked for exactly this so the `SkImage` is pixel-perfect at the settled zoom (the pdf.js `outputScale = DPR` invariant).
- **Page space → screen (gesture):** the `<Group transform>` applies `screen = pagePt × sc + t`. Ink strokes are stored in **page points** and drawn unscaled inside the same Group, so they inherit the identical matrix — zero drift.
- **Focal pinch invariant (the no-jump core):** the page-space point under the fingers must stay under the fingers. Capture `oLocal = (focal − t) / sc` at gesture start; each frame set `t = focal − oLocal × sc`. This is exactly the existing file's intent; §4 hardens it.

### 3.5 Deep-zoom memory strategy (stop the crash)

The crash is unbounded `SkImage` pixel area (`w×h×4`). Three layered defenses:

1. **Cap rasterization scale (required, ship in spike).** Never request a bitmap wider/taller than a safe ceiling. `SAFE = 4096` px/side (≈ 67 MB RGBA for a square page) is comfortable on A14+ (real kill thresholds are ~1.5–3 GB on iPhone 12+, not the conservative 200–400 MB of older devices). Decouple **display** scale (gesture, free, GPU-cheap) from **raster** scale (capped):
   ```ts
   const SAFE = 4096;
   const clampRasterScale = (s: number) =>
     Math.min(s, SAFE / pageWidthPts, SAFE / pageHeightPts);
   ```
   Beyond the cap the capped `SkImage` simply upscales (soft) — **no crash**. Honest headroom: a 612 pt letter page capped at 4096 px = raster scale 6.7; divided by DPR 3 that is only ≈ 2.2× *display* zoom before softening begins. (Earlier "6–8× useful zoom at a 2048 cap" was off by 4–7×.) For floor-plan deep zoom this cap alone is **not enough** → tiling.
2. **Two-slot image cache (required).** Hold at most `pageImage` + `prevImage`; null `prev` after 2 frames (§3.2). Bounds live native image memory and dodges the repeated-`MakeImage` leak pattern (RN-Skia #2909; fix presence in 2.2.12 is **UNVERIFIED** — assume the bound is needed).
3. **Tiling (phase 3, for true deep zoom).** Rasterize only the visible region as `tileSize`-square tiles at the current DPI, keyed `${page}-${tx}-${ty}-${zoomBucket}`, quantizing zoom to power-of-two buckets to avoid per-delta re-raster. Draw visible tiles + ink in the same Canvas. This is the CATiledLayer idea (O(visible tiles) memory ≈ constant ~16 MB regardless of zoom) re-expressed inside the one-pipeline Skia model so sync is preserved. The Swift tile call uses `CGContextClipToRect` + translated CTM + `CGContextDrawPDFPage` — **not** `thumbnail(of:for:)`, which takes only a `CGSize`+`PDFDisplayBox` and has **no `CGRect` crop**.

> **Zero-copy note (deferred, do NOT use in spike):** the `MakeImageFromNativeBuffer(bigint)` CVPixelBuffer path skips PNG encode but requires a JSI/C++ shim — Expo's high-level Swift bridges `UInt64` through `castToJS` as a JS **Number** (53-bit mantissa), silently truncating a 64-bit pointer. Returning the pointer as a **String** then `BigInt(str)` is the only safe form, and lifetime/retain management is hard. Treat as a latency optimization to revisit only if the PNG path is too slow on device.

---

## 4. The 2-finger gesture JUMP fix

Three distinct causes, one robust pattern.

- **Cause 1 — focal teleport on 2nd-finger landing.** iOS coalesces touches; `Pinch.onBegin` can fire on one finger, then `onUpdate` snaps the focal to the true 2-finger centroid → a 20–100 px lurch. The current `FOCAL_JUMP = 60` guard catches it but currently just `return`s, leaving the origin stale.
- **Cause 2 — focal snaps to the remaining finger when one lifts** (RNGH #1214). Stop trusting the focal once pointer count < 2.
- **Cause 3 — `ssc` base captured in `onBegin` is wrong if `onBegin` re-fires mid-gesture** during a pan↔pinch handoff.

**Robust pattern — recapture the local origin on teleport instead of returning:**

```ts
const pinch = Gesture.Pinch()
  .onBegin((e) => { 'worklet';
    ssc.value = sc.value;
    oLocalX.value = (e.focalX - tx.value) / sc.value;   // page-space point under fingers
    oLocalY.value = (e.focalY - ty.value) / sc.value;
    lastFx.value = e.focalX; lastFy.value = e.focalY;
  })
  .onUpdate((e) => { 'worklet';
    const dfx = e.focalX - lastFx.value, dfy = e.focalY - lastFy.value;
    if (Math.abs(dfx) > FOCAL_JUMP || Math.abs(dfy) > FOCAL_JUMP) {
      // Re-pin the origin at the NEW focal; page does NOT move this frame.
      oLocalX.value = (e.focalX - tx.value) / sc.value;
      oLocalY.value = (e.focalY - ty.value) / sc.value;
      ssc.value = sc.value;
      lastFx.value = e.focalX; lastFy.value = e.focalY;
      return;
    }
    lastFx.value = e.focalX; lastFy.value = e.focalY;
    const ns = Math.max(MIN_S, Math.min(MAX_S, ssc.value * e.scale));
    sc.value = ns;
    tx.value = e.focalX - oLocalX.value * ns;   // keep local point under focal
    ty.value = e.focalY - oLocalY.value * ns;
  })
  .onEnd(() => { 'worklet'; runOnJS(triggerRasterize)(sc.value); })  // debounce 50–180ms
  .onFinalize(() => { 'worklet'; ssc.value = sc.value; });           // clean base for next pinch
```

Supporting rules (all confirmed against the installed RNGH 2.28):
- Keep `Gesture.Simultaneous(selectTap, oneFinger, pinch)`. `oneFinger` already has `maxPointers(1)` so it auto-cancels when the 2nd finger lands; its `onFinalize` must **not** touch `tx/ty` (current code only clears live strokes — correct), so `pinch.onBegin` captures a clean base.
- Add `.averageTouches(true)` to the **pan** gesture so its reported position uses the pointer centroid across a 1↔2 finger transition.
- **`maxPointers(1)` does NOT exist on `Gesture.Tap()`** in RNGH 2.28 — do not add it. Simultaneous composition already cancels multi-touch taps; if a guard is wanted use `.minPointers(1)`.
- Consider raising `FOCAL_JUMP` to ~80; a fast legitimate pan can move ~40–50 px/frame and shouldn't be discarded.

---

## 5. Phased plan + the SINGLE next feelable spike

**Phase 0 — feelable iOS spike (next, ~1–2 days).** Build `PdfRasterizerModule.swift` (PNG path) under a dev build (`npx expo run:ios`, **not Expo Go** — custom native module). In `AnnotatablePdf.tsx`: remove `<Pdf>`, render one `<Canvas>` with `<Image>` + ink under one `<Group transform>` reusing the existing `sc/tx/ty`. Rasterize at mount (`scale=1`), and on `pinch.onEnd` (debounced). Apply the §3.4 cap. Draw a static reference stroke to eyeball sync.
**Phase 1 — gesture hardening (~0.5 day, can land with Phase 0).** Apply the §4 pinch pattern + `averageTouches` to the existing handlers.
**Phase 2 — Android parity (~1 day).** Kotlin module via `PdfRenderer.Page.render(bitmap, …, RENDER_MODE_FOR_DISPLAY)` at the capped pixel size; same JS contract.
**Phase 3 — tiling for true deep zoom (~3–4 days).** Visible-rect tiles + zoom-bucket cache (§3.5.3). Only if Phase 0 shows the 4096 cap is too soft for floor plans.
**Phase 4 — polish.** Optional freeze/soften overlay during the settle window; raw-RGBA or CVPixelBuffer latency opt if measured necessary.

> **The single next spike to validate on the iPhone:** *one Swift file + the `AnnotatablePdf` render swap* — PDF page rasterized into a single Skia `<Canvas>` with vector ink under one `<Group transform>`, re-rasterized on `pinch.onEnd`, capped at 4096 px. On a real iPhone, zoom a floor-plan PDF to 4–8×, stop, and check: (a) does it become crisp within ~200–300 ms, (b) does the ink stay glued to the page through the whole gesture, (c) does it NOT crash at `sc = 8`? Measure `rasterizePage` latency at scale 1/2/4/8 in Instruments.

---

## 6. Honest risks, Android notes, and what only a device test settles

**Risks (device-resolved):**
- **Rasterization latency at extreme zoom / large sheets.** `CGContextDrawPDFPage` is **CPU** rasterization (multi-threaded, but NOT documented GPU-accelerated — drop any "Metal-backed" claim). Estimated ~80–200 ms for an A4 page at moderate zoom is **UNVERIFIED**; A0/A1 floor plans at 8× could be far worse. If a full-page raster exceeds ~300 ms, escalate to Phase-3 tiling. **Only a device test settles this.**
- **`SkImage` across the JS→UI worklet boundary.** Storing/swapping a Skia host object in a shared value via `runOnUI` is the advertised Skia+Reanimated pattern (their Textures guide) and is high-confidence, but not byte-verified for 2.2.12 — confirm in the spike.
- **Image memory-leak (#2909) fix presence in 2.2.12 — UNVERIFIED.** The two-slot cap is the mitigation regardless.
- **PNG bytes swap frame-drop.** `MakeImageFromEncoded` defers decode to first GPU draw (Skia render thread, not JS) so a JS-thread stall is unlikely, but a one-frame hitch on swap is possible; measure. If real, move to raw-RGBA, then CVPixelBuffer.
- **120 fps on ProMotion.** Reanimated worklets fire at the display link rate; reliable 120 fps may need `CADisableMinimumFrameDuration = YES` in `Info.plist`. Add it if 120 fps doesn't engage.

**Android notes:**
- Use `android.graphics.pdf.PdfRenderer` (`PdfRenderer.Page.render(bitmap, dest, clip, RENDER_MODE_FOR_DISPLAY)`) for both full-page and tile (`clip` rect) rasterization at the capped pixel size; return PNG/`ByteArray` → `Uint8Array`, identical JS contract.
- The native↔Skia 1-frame desync that plagues separate-pipeline approaches is **worse on Android** — another reason the one-pipeline Skia model (no native PDF view at all) is the right call cross-platform.
- `PdfRenderer` cannot open password-protected PDFs and serializes page access (one page open at a time) — fine for single-page survey use, relevant if multi-page lands later.

**What ONLY a device test settles:** real rasterization latency at survey-class zoom/sheet sizes; whether crisp-on-settle *feels* good enough vs. soft-during-gesture; the exact safe `SAFE` cap per target device; whether the PNG swap hitches; whether 120 fps engages; and the true pinch feel after the §4 fix. Build+typecheck gates do not answer any of these — drive it on the iPhone.

---

### Decision log (for future-me)
- **Architecture chosen:** Approach C (PDF→Skia, one pipeline, re-raster-on-settle). Rejected: bitmap-scaled one-container (blur+crash), separate-pipeline (spatial desync), scale-prop-on-`react-native-pdf` (no in-gesture crispness + `autoScales=YES` risk; keep only as an optional probe).
- **Crash root cause (corrected):** Reanimated container GPU texture at extreme scale, NOT PDFKit tiles (PDFKit was pinned at scale=1 in the current file).
- **No off-the-shelf solution exists** — the rasterizer module is net-new; the pattern is proven by react-native-vision-camera's camera-frame→Skia path.
