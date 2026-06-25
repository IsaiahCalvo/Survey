# Mobile PDF Render + Ink + Selection — OSS Stack Recommendation

**Date:** 2026-06-24
**Context:** Survey BetaSafeS2 Expo / React Native app (Expo SDK 54, RN 0.81, New Architecture on, currently Expo Go). iPhone-first, Android second. Existing prototype = hand-rolled `react-native-svg` + RN `Animated` annotation layer on the JS thread — pen is latent, pan-after-zoom feels off.
**Question:** Is there an OSS solution (lib, combo, or forkable GitHub project) that does PDF rendering + ink/shapes + selection at low latency that we can adopt or fork, rather than build from scratch?

---

## 1. TL;DR Recommendation

**Adopt a two-layer native stack in a custom dev build: `react-native-pdf` (native PDFKit on iOS / Pdfium on Android) for the render layer, with a `@shopify/react-native-skia` GPU canvas overlay for ink + shapes + selection — gesture-driven via the `react-native-gesture-handler` you already ship.** There is **no single OSS library that does render + ink + select together**; every option covers at most two of the three. The forcing function is the renderer: **no OSS PDF renderer runs in Expo Go**, so you must leave Expo Go and move to a custom dev build (EAS Build / `expo prebuild`). Skia itself *is* bundled in Expo Go, but the moment you add a real PDF renderer you need the dev build anyway — so commit to it. Fork `react-native-pdf-painter` (MIT, PencilKit + androidx.ink) and `mathnotes-app/mobile-ink` (Apache-2.0) as **reference code** for the native-ink wiring and selection/transform, not as drop-in deps.

---

## 2. The decision that actually matters: Expo Go vs custom dev build

### Verdict: **Leave Expo Go. Move to a custom dev build now.**

The two pillars of this app land on opposite sides of the Expo Go boundary:

| Capability | In Expo Go SDK 54? | Why |
|---|---|---|
| GPU ink canvas (`@shopify/react-native-skia`) | **Yes** — bundled at **2.2.12** | Skia ships inside the Expo Go binary |
| Gestures (`react-native-gesture-handler` `~2.28.0`) | **Yes** — exact match to your version | bundled |
| SVG (`react-native-svg` `15.12.1`) | **Yes** — exact match to your version | bundled |
| Reanimated (`~4.1.1`) + `react-native-worklets` (`0.5.1`) | **Yes** — bundled | worklets must be an **explicit** dep even though bundled |
| WebView (`react-native-webview` `13.15.0`) + pdf.js | **Yes** | bundled; pdf.js is pure JS/Apache-2.0 |
| `expo-gl` (`~16.0.10`) | **Yes** | bundled |
| **Native PDF render** (PDFKit/Pdfium via `react-native-pdf`, `-light`, `-jsi`, `-painter`) | **No** | native modules absent from Expo Go binary |
| **Apple PencilKit** (`react-native-pencil-kit`, `expo-pencilkit-ui`) | **No** | native Swift modules absent from Expo Go |

*(Bundled versions verified against `expo/expo@sdk-54/packages/expo/bundledNativeModules.json`, 2026-06-24.)*

**You cannot render a real PDF in Expo Go.** That single fact ends the debate — any production stack here needs a dev build.

### The honest cost of leaving Expo Go (2026)

- **One-time setup:** ~2–3h to wire EAS, run `npx expo prebuild`, trigger the first iOS build, install on device.
- **Per-native-dep rebuild:** a new native dependency requires one rebuild; a teammate can install the shared build artifact so not everyone rebuilds.
- **Daily loop is unchanged:** a dev build is "your own Expo Go" — QR scan, Fast Refresh, and `eas update` OTA for JS-only changes all still work. You only lose the *zero-install* convenience, which you regain after installing the custom client once.
- **Build times / free-tier counts:** [UNVERIFIED] — exact EAS runner timing and monthly free-build counts were not confirmed for this report; check <https://expo.dev/pricing> before planning around them.
- **Strategic tailwind:** Expo now positions Expo Go as "first and foremost an educational tool" and recommends dev builds for production ([Expo changelog, May 2026](https://expo.dev/changelog/expo-go-and-app-store-may-2026)). Expo Go SDK 55 was delayed on the App Store and Expo shipped `eas go` as a personal-build alternative — the Expo Go distribution path is less stable than it was, which further de-risks committing to dev builds. (The "de-risks" read is editorial, not a hard fact.)

---

## 3. Comparison matrix

Stars / dates / versions verified June 2026 (npm registry + GitHub). "Copy-ability": **use-as-dep** / **fork** / **reference-only** / **avoid**.

| Candidate | Render | Draw / ink latency | Select / transform | Expo Go? | iOS | Android | License | Maintenance (stars · latest · commit) | Copy-ability |
|---|---|---|---|---|---|---|---|---|---|
| **react-native-pdf** (wonday) [^rnpdf] | Native PDFKit/Pdfium — **excellent**; tiles big floor plans | None | None (renders *baked-in* annots only) | **No** (config plugin exists) | ✓ (best) | ✓ (scroll-lag, OOM-on-zoom reports) | MIT | ~1,800★ · **v7.0.4 (2026-03-19)** · commit 2026-05-23 · ~392 open issues | **use-as-dep** (render only) |
| **react-native-pdf-light** (alpha0010) [^rnpl] | Native CGPDFDocument/Android PdfRenderer — lighter, lower-fidelity than Pdfium | None (renders pre-existing PAS-format annots) | None | **No** | ✓ | ✓ | MIT | 95★ · **v3.2.1 (2026-05-14)** · 1 open issue · **v3.x = New Arch line** | **use-as-dep** (render only) |
| **react-native-pdf-renderer** (douglasjunior) [^rnr] | Native PdfRenderer/PDFKit; full-image pages (no text select), zoom-crash risk on Android | None | None | **No** | ✓ | ✓ | MIT | 293★ · v2.3.0 (2025-08-12) · **New Arch supported (v2.0+)** | use-as-dep (render only) |
| **react-native-pdf-jsi** (126punith) [^jsi] | JSI Pdfium/PDFKit; "80×"/"2 MB" are **[UNVERIFIED] marketing claims** | None | None | **No** (plugin) | ✓ | ✓ | MIT | 53★ · v4.4.1 (2026-03-19) · TurboModule = **[UNVERIFIED]** self-report | use-as-dep (render only) |
| **@kishannareshpal/expo-pdf** [^kexpo] | Pdfium-fork/PDFKit, Expo module | None | None | **No** ([UNVERIFIED inference]) | ✓ | ✓ | MIT | 13★ · v0.3.2 (2026-03-24) · early-stage | reference-only |
| **@shopify/react-native-skia** [^skia] | **None** (no PDF decode) | **Excellent** — GPU (Metal/Vulkan), gesture worklets on UI thread, 60fps confirmed | DIY (hit-test + matrix primitives; no built-in UI) | **Yes** — bundled **2.2.12** (SDK-54 `SkiaViewApi` import-order bug existed, since patched) | ✓ | ✓ | MIT | 8.4k★ · **v2.6.7 (2026-06-24)** · ~81 open issues (count [UNVERIFIED]) | **use-as-dep** + fork examples |
| **react-native-pdf-painter** (mbpictures) [^painter] | PDFKit (iOS) + Android PdfRenderer | **Yes** — iOS **PencilKit** (gold-standard), Android **androidx.ink**; modes: marker, pressure-pen, highlighter, eraser, link | **No** (undo/redo/clear only) | **No** (Fabric-only) | ✓ (iOS 16+ for draw) | ✓ | MIT | 26★ · v0.10.2 (2026-04-07) · 56 releases | **fork** (proprietary non-PDF-embedded annot format) |
| **mathnotes-app/mobile-ink** [^ink] | "PDF backgrounds" **Android-only in capability snapshot; iOS [UNVERIFIED/likely absent]** | **Excellent** — native Skia/Metal (iOS), Skia/Ganesh (Android); pen/highlighter/crayon/calligraphy/eraser + shape recognition | **Yes** — selection, stroke grouping, transform | **No** | ✓ (first) | ✓ (V1) | Apache-2.0 | 30★ · v0.3.1 (2026-05-20) · **12 open issues**; npm `@mathnotes/mobile-ink` | **fork** (PDF depth unverified) |
| **react-native-pencil-kit** (mym0404) [^pk] | None | **Excellent** — native PencilKit, pressure/tilt, tool picker | Native PencilKit selection (lasso) | **No** (Fabric, iOS 14+) | ✓ only | ✗ | MIT | 68★ · **v1.2.3 (2025-10-11)** · 3 issues · **maintainer on military service to ~Sep 2026** | fork / use-as-dep (iOS ink) |
| **expo-pencilkit-ui** (tarikfp) [^epk] | None | **Excellent** — native PencilKit (Expo Modules API) | None | **No** | ✓ only | ✗ | MIT | 50★ · **v1.0.4 (2025-06-07) — ~12 mo stale, low-maintenance** | reference-only |
| **react-native-free-canvas** (doublelam) [^free] | None | Skia freehand + zoom/pan | None | Likely (Skia bundled) | ✓ | ✓ | MIT | 31★ · v2.0.0 (2025-11-11) · Expo example | **fork** (ink starter) |
| **ammarahm-ed/drawing-board** [^db] | None | Skia 60fps **demo** (5 commits, no releases) | None | Likely | ✓ | ✓ | MIT | ~74★ · unmaintained since 2022 | reference-only (demo) |
| **pdf.js in react-native-webview** [^pdfjs] | **Full** multi-page canvas render | Built-in ink/text/highlight/stamp/signature; **no shapes, no select/move**; bridge round-trip kills RN-coordinated ink | Built-in: none for drawn annots | **Yes** (webview bundled) | ✓ | ✓ | Apache-2.0 / MIT | pdfjs-dist 53.5k★ · **v6.0.227 (2026-05-30)** | reference / desktop-parity fallback |
| **PDFJsAnnotations** (RavishaHesh) [^pdfjsannot] | pdf.js render | Fabric overlay: pencil, rect, arrow, text (no ellipse) | Fabric controls (select/resize/delete) | **Web-only — not RN** | n/a | n/a | MIT | 381★ · last commit **2020 (5+ yr stale)** | reference (architecture mirror of desktop Fabric layer) |
| **react-native-pdf-annotation** (senthalan2) [^mupdf] | MuPDF | draw/highlight/underline/strikeout | unclear | **No** | partial | ✓ | wrapper MIT — **MuPDF is AGPL-3.0** | 1★ · dormant | **AVOID (AGPL contamination)** |
| **PSPDFKit / Nutrient** [^nutrient] | Full | Full (custom engine, **not** PencilKit) | Full (selection/move/resize/rotate) | **No** | ✓ | ✓ | **Commercial** (no free tier) | ~206★ wrapper · v4.3.3 (2026-05-30) · New Arch since v4.0.0 (Nov 2025) | **reference-only** (Instant JSON overlay model) |
| **Apryse / PDFTron** [^apryse] | Full | Full + **optional iOS PencilKit** (SDK 7.0.2+; RN-wrapper exposure **very likely needs native code**) | Full (move/resize, freeform rotate, `e_no_zoom`) | **No** | ✓ | ✓ | **Commercial** (no free tier) | ~130★ wrapper · v3.0.4-29 (~Apr 2026) · New Arch **[UNVERIFIED]** | **reference-only** (PencilKit-delegation pattern) |
| **ComPDFKit** RN [^compdf] | Full | Full | Full | **No** | ✓ | ✓ | **Commercial** (30-day trial) | 110★ · v2.6.8 (2026-05-29) | reference-only |

---

## 4. Recommended architecture: the overlay stack

Three layers, composited in a plain RN `<View>` stack, one Skia overlay sized per visible PDF page:

```
┌──────────────────────────────────────────────────────────┐
│  Selection layer  — Skia handles + hit-test (RNGH worklets)│  ← move/resize/rotate
├──────────────────────────────────────────────────────────┤
│  Ink layer  — dual Skia canvas:                            │
│     • live stroke (imperative, updated in Pan worklet)     │  ← low-latency pen/shapes
│     • committed strokes (retained <Canvas>, repaint on     │
│       commit only — never setState mid-stroke)             │
├──────────────────────────────────────────────────────────┤
│  Render layer  — <Pdf/> native page (PDFKit / Pdfium)      │  ← zoom/pan/multipage
└──────────────────────────────────────────────────────────┘
```

**Why this beats the current DIY layer (root cause of the latency):**
- The prototype's pen routes every touch through the JS thread: `setState`-per-sample → React reconcile → `react-native-svg` re-serializes the growing `d` path across the view system each frame. SVG stroking is CPU-side (Core Graphics / Android Canvas). It also only sees the *final coalesced* touch, discarding iOS's intermediate + predicted samples, so the trail lags the finger.
- Skia dispatches `SkPath` mutations inside a **UI-thread worklet** (`Gesture.Pan` + Reanimated), repaints on the GPU, and never touches the React reconciler during a stroke. The latency difference is **architectural, not tunable**.

**Mapping to existing assets:**
- **`react-native-gesture-handler` 2.28.0** (already shipped, bundled in Expo Go) owns all gestures. Use `simultaneousHandlers` / `waitFor` to negotiate with the renderer; note native PDFKit consumes pinch/scroll before RN handlers, so tool-mode switching (pan ↔ draw) must gate gesture ownership explicitly.
- **Zoom coordination:** drive the Skia canvas transform matrix from a Reanimated shared value so annotations scale/pan in sync on the UI thread. Size the overlay from a `ResizeObserver`-equivalent on the page host, not a stale React `scale` prop (same lesson the desktop pdf.js overlay learned).
- **Desktop parity via `@survey/shared`:** define the annotation schema (stroke points in PDF user-space, 0,0 bottom-left, zoom-independent) in `@survey/shared` so mobile Skia annotations round-trip with the desktop owned-pdf.js renderer. Borrow two patterns from the commercial SDKs (reference-only): Nutrient's **Instant-JSON overlay model** (compact lossless changeset separate from PDF binary) and an **`e_no_zoom` flag** (stamps/counters don't scale; ink does).
- **pdf.js-in-WebView is the desktop-parity *fallback*, not the mobile drawing path** — it shares the renderer with desktop and runs in Expo Go, but WebView ink latency is structurally worse than Skia/PencilKit and the `postMessage` bridge makes RN-coordinated drawing unusable. Use it only as an MVP shortcut if the dev-build migration must be deferred.

---

## 5. COPY-FROM shortlist (what to lift, and from where)

1. **`react-native-pdf-painter`** — <https://github.com/mbpictures/react-native-pdf-painter> (MIT, 26★, v0.10.2)
   **Take:** the Swift wiring of **PencilKit over a PDFKit page** on iOS, and the **androidx.ink** wiring on Android — the single best OSS reference for "native ink on top of a PDF page." **Leave:** its proprietary non-PDF-embedded annotation format; it has no selection/move/resize.

2. **`mathnotes-app/mobile-ink`** — <https://github.com/mathnotes-app/mobile-ink> (npm `@mathnotes/mobile-ink`, Apache-2.0, 30★, v0.3.1, **12 open issues**)
   **Take:** the most complete OSS ink engine with **selection, stroke grouping, transform, page pooling, and zoom** on native Skia/Metal. **Leave / verify first:** PDF-background support appears **Android-only**; iOS (priority #1) is unverified/likely absent — treat as a draw-engine reference, wire your own PDF render underneath.

3. **`@shopify/react-native-skia` examples** — dual-canvas pattern from the [Notesnook 60fps post](https://blog.notesnook.com/drawing-app-with-react-native-skia) (March 2022) and discussions [#1989](https://github.com/Shopify/react-native-skia/discussions/1989) / [#2191](https://github.com/Shopify/react-native-skia/discussions/2191).
   **Take:** imperative live-stroke + retained committed-stroke architecture; RNGH-Pan-as-worklet wiring. Note: the live stroke uses a `PictureRecorder` inside `useDerivedValue` (snapshot), not raw `canvas.drawPath()` per event.

4. **`react-native-free-canvas`** — <https://github.com/doublelam/react-native-free-canvas> (MIT, 31★, v2.0.0, Expo example included)
   **Take:** a working Skia freehand component with zoom/pan + path recording/undo as a starting skeleton for the ink layer. Ink-only, no selection.

5. **`react-native-pencil-kit`** — <https://github.com/mym0404/react-native-pencil-kit> (MIT, 68★, v1.2.3, Fabric, iOS 14+)
   **Take:** clean `PKCanvasView` Fabric bridge if you decide to add a PencilKit *enhancement layer* on iOS (pressure/tilt) over Skia. **Caveat:** solo maintainer **on military service to ~Sep 2026** — fork, don't depend on upstream velocity. iOS-only.

6. **`PDFJsAnnotations`** (RavishaHesh) — <https://github.com/RavishaHesh/PDFJsAnnotations> (MIT, 381★, **2020, web-only**)
   **Take:** architecture reference only — it's the closest mirror of the desktop Fabric annotation layer (pdf.js + Fabric overlay, JSON serialization). Useful for the `@survey/shared` schema design, not for RN code.

**Commercial blueprints (cite, don't adopt):** Nutrient/PSPDFKit ([Instant JSON guide](https://www.nutrient.io/guides/web/json/)) for the overlay + zoom-aware projection model; Apryse ([iOS 7.0.2 PencilKit](https://apryse.com/blog/ios/ios-7.0.2)) for the PencilKit-delegation-to-PDF-ink pattern.

---

## 6. Migration / build-order + spikes to run first

**Build order:**
1. Stand up the **EAS dev build** (`expo prebuild` → `eas build --profile development --platform ios`). This is the prerequisite for everything native. Add `react-native-worklets` as an explicit dep (Reanimated 4.1 requires it).
2. Land the **render layer**: `react-native-pdf` + `@config-plugins/react-native-pdf` + `react-native-blob-util` (also needs its plugin). **Gate on the SDK-54 New-Arch iOS blank-view issues** (see Risks) — verify a real 50-page floor plan renders on a physical iPhone with `newArchEnabled: true` before building on top.
3. Land the **Skia ink overlay** (dual-canvas, RNGH Pan worklets) sized to one page; get freehand feeling right on device.
4. Add **shapes** (rect/ellipse/line/arrow/highlighter) as Skia primitives, then **selection/transform** (hit-test + handles), then text/callout/counter.
5. Wire the **`@survey/shared` annotation schema** so mobile annotations round-trip with desktop.

**Spikes (de-risk before committing the architecture):**
- **SPIKE 1 — renderer New-Arch sanity: ✅ PASSED (2026-06-24).** Built `react-native-pdf@7.0.4` into an EAS-less local dev build (`expo run:ios`, Debug) on Expo SDK 54 / RN 0.81 / New Architecture (Fabric ON) and confirmed in the iOS Simulator: a 14-page PDF **loaded AND rendered** (status `loaded ✓ 14 pages`, pages visibly drawn). **The blank-view bug #942/#969 does NOT manifest on this stack** — no fallback to `react-native-pdf-light`/`react-native-pdf-renderer` needed. (Build gotcha recorded: CocoaPods 1.16.2 crashes on Homebrew Ruby 4.0.5 with `Encoding::CompatibilityError`; fix = `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before `pod install`/`expo run:ios`.)
- **SPIKE 2 — gesture negotiation:** Skia draw overlay above the native `<Pdf/>` page — confirm pinch-zoom (PDFKit) and draw (RNGH worklet) coexist without the renderer stealing touches; prove tool-mode switching.
- **SPIKE 3 — pen feel on device:** dual-canvas Skia stroke at 120 Hz ProMotion; subjectively compare to the SVG prototype. (Synthetic input can't validate pen feel — needs a human finger/Pencil, per the team's own Playwright-zoom lesson.)
- **SPIKE 4 — painter fork read:** stand up `react-native-pdf-painter` in the dev build to study the PencilKit-over-PDFKit wiring; decide whether iOS gets a PencilKit enhancement layer over Skia or stays pure-Skia cross-platform.

---

## 7. Risks, licensing caveats, and unverified items

**Highest-risk technical gaps:**
- **`react-native-pdf` New-Architecture iOS rendering.** v7.0.0 shipped a fix attempt ("Fixed: not rendering on iOS" + RN 0.81 Fabric example), but residual blank-view reports persist: [#942](https://github.com/wonday/react-native-pdf/issues/942) (New-Arch blank view, open), [#969](https://github.com/wonday/react-native-pdf/issues/969) (iOS invisible after SDK 53→54, open), [#1021](https://github.com/wonday/react-native-pdf/issues/1021) (`requiresMainQueueSetup` warning, open). **Not universally resolved** — this is the single biggest adoption risk for an RN 0.81 / New-Arch project. SPIKE 1 must clear it.
- **No OSS lib does render + ink + select** — expect real integration work (selection/transform UI is DIY on Skia regardless of which renderer wins).
- **PencilKit + PDF zoom sync is unsolved even in native iOS** (Apple Dev Forums, through 2025); no RN wrapper attempts it. If you go the PencilKit route, you own this in Swift.
- **Skia SDK-54 caveat:** Skia is bundled in Expo Go SDK 54 at 2.2.12, but a `SkiaViewApi` import-ordering bug affected some SDK-54 builds (since patched); pin a known-good patch and verify on device.
- **Android is second-class for ink:** PencilKit gives Android nothing; `mobile-ink`/painter Android paths (Ganesh / androidx.ink) are newer. Skia is the only cross-platform low-latency ink engine here — which is why it anchors the recommendation.

**Licensing:**
- **AVOID `react-native-pdf-annotation`** — MuPDF is **AGPL-3.0**; shipping it forces your whole app to AGPL absent an Artifex commercial license. Hard disqualifier.
- All recommended OSS (`react-native-pdf`, Skia, `mobile-ink`, painter, free-canvas, pencil-kit) are **MIT or Apache-2.0** — clean to fork.
- PSPDFKit/Nutrient, Apryse/PDFTron, ComPDFKit are **commercial, no free tier** — reference-only, not adoptable per the brief.

**Unverified / flagged (do not plan around without confirming):**
- EAS build times and free-tier monthly build counts — **[UNVERIFIED]**; check <https://expo.dev/pricing>.
- `react-native-pdf-jsi` "80× faster" and "constant 2 MB memory" — **[UNVERIFIED]** maintainer marketing; TurboModule support is self-reported metadata, no codegen spec found.
- `mathnotes-app/mobile-ink` **iOS PDF-background support** — capability snapshot lists Android only; treat iOS support as **absent until proven**.
- Skia open-issue count (~81) and react-native-skia-gesture's value as a selection scaffold (no release since Aug 2024, ~22 mo stale) — **[UNVERIFIED]/stale**; build selection on raw Skia rather than depending on it.
- Commercial-SDK latency specifics (e.g., Nutrient's "2-stage point reduction") were **hallucinated in source drafts and removed**; Nutrient's 90% annotation-selection speedup is **Android-only** (16.5ms→1.73ms), iOS mount was 52ms→35ms.
- `@kishannareshpal/expo-pdf` dev-build requirement is an **inference**, not documented.

---

### Footnotes (verified URLs)

[^rnpdf]: <https://github.com/wonday/react-native-pdf> · <https://www.npmjs.com/package/react-native-pdf> (v7.0.4, 2026-03-19, npm registry) · <https://github.com/expo/config-plugins/tree/main/packages/react-native-pdf>
[^rnpl]: <https://github.com/alpha0010/react-native-pdf-viewer> · npm `react-native-pdf-light` v3.2.1 (2026-05-14)
[^rnr]: <https://github.com/douglasjunior/react-native-pdf-renderer>
[^jsi]: <https://github.com/126punith/react-native-pdf-jsi>
[^kexpo]: <https://github.com/kishannareshpal/expo-pdf>
[^skia]: <https://github.com/Shopify/react-native-skia> · v2.6.7 (2026-06-24) · Expo Go bundled 2.2.12 (SDK-54 `bundledNativeModules.json`)
[^painter]: <https://github.com/mbpictures/react-native-pdf-painter>
[^ink]: <https://github.com/mathnotes-app/mobile-ink>
[^pk]: <https://github.com/mym0404/react-native-pencil-kit> · v1.2.3 (2025-10-11, npm registry)
[^epk]: <https://github.com/tarikfp/expo-pencilkit-ui> · v1.0.4 (2025-06-07, npm registry — ~12 mo stale)
[^free]: <https://github.com/doublelam/react-native-free-canvas>
[^db]: <https://github.com/ammarahm-ed/drawing-board>
[^pdfjs]: <https://github.com/mozilla/pdf.js> · <https://www.npmjs.com/package/pdfjs-dist> (v6.0.227, 2026-05-30) · <https://github.com/react-native-webview/react-native-webview>
[^pdfjsannot]: <https://github.com/RavishaHesh/PDFJsAnnotations>
[^mupdf]: <https://github.com/senthalan2/react-native-pdf-annotation>
[^nutrient]: <https://github.com/PSPDFKit/react-native> · <https://www.npmjs.com/package/@nutrient-sdk/react-native> · <https://www.nutrient.io/guides/web/json/>
[^apryse]: <https://github.com/ApryseSDK/pdftron-react-native> · <https://apryse.com/blog/ios/ios-7.0.2>
[^compdf]: <https://github.com/ComPDFKit/compdfkit-pdf-sdk-react-native>
