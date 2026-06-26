# Handoff: Mobile PDF annotator foundation

**Goal**: Build the native mobile (Expo/RN) PDF annotator — render + ink + the real tools — adapting desktop gestures to touch. The render architecture is now **Approach C** (PDF rasterized INTO Skia; one pipeline), replacing the validated-but-blurry `react-native-pdf` overlay stack.

> **STATUS 2026-06-25 (device-tested, branch `claude/eager-antonelli-819afe`):** Approach C is DEVICE-CONFIRMED — **vector ink is crisp at zoom and glued to the page** (the core win). Two follow-ups landed since the first spike: (1) **orientation fix** — page was rendering upside down; the rasterizer now uses `UIGraphicsImageRenderer` (commit be2010b8). (2) **TILING** (commit 76a7c2a7) — replaced the single capped page texture with a fit-to-width **base** + a screen-DPR **detail tile** of the visible region (`rasterizeRegion` in Swift; `visibleLocalRect`/`regionDrawAffine` in pdfAnnotation.ts, crop transform self-checked offline). Bounded memory at any zoom; deep zoom should be crisp + lag-free. **Pending: a device rebuild to confirm tiling feels good.** GOTCHA discovered: the user's Metro+dev-build were pinned to the OLD `nifty-burnell-c66ee5` worktree (Approach B) — always `lsof -i :8081` + check the Metro process cwd; a dev build only Fast-Refreshes JS from the worktree it was `expo run:ios`'d from, and a native-module change needs a cable rebuild.

**Done**:
- 5 spec/decision docs in `docs/superpowers/specs/2026-06-24..25-*` (gesture-adaptation w/ §0.6 live-test verdicts; renderer research; overlay-alignment; native-vs-webview; **crisp-smooth-architecture = Approach C**). Stack validated (Spike 1 render, Spike 2 Skia ink).
- **Foundation v0** (`AnnotatablePdf` on branch `claude/nifty-burnell-c66ee5`): the Approach-B bitmap-scaled version (render + 1-finger draw + tap-select + delete, UI-thread, no flicker). Superseded by the spike below but kept in history.
- **Approach-C Phase-0 spike — CODE-COMPLETE, pending device test** (this branch, `claude/eager-antonelli-819afe`):
  - New local Expo native module **`mobile-expo-go/modules/pdf-rasterizer/`** (`ios/PdfRasterizerModule.swift` + `index.ts` + podspec + `expo-module.config.json`). `CGContextDrawPDFPage` → CGBitmapContext → PNG; returns Swift **`Data` → JS `Uint8Array`** (the *tested* `DataUint8ArrayConvertiblesSpec` path, NOT `[String:Any]`). Funcs: `openDocument`, `getPageSize`, `rasterizePage(uri,page,scale)`. Autolinking-verified (`expo-modules-autolinking search -p apple` lists `PdfRasterizerModule`).
  - **`AnnotatablePdf.tsx` rewired**: native `<Pdf>` REMOVED. One `<Canvas>` → one `<Group transform=[tx,ty,sc]>` containing the page `<Image>` (SkImage) + committed ink + live ink. Page rasterized at mount (after layout) and re-rasterized **debounced on settle** (pinch.onEnd / zoom buttons / reset), stale-guarded + skip-if-scale-unchanged. §3.4 **raster cap `SAFE=4096`** px/side (crash guard; pure `rasterScaleFor` in `pdfAnnotation.ts` with a self-check asserting the cap invariant). §4 **pinch-jump fix** (re-pin local origin on focal teleport instead of `return`; `FOCAL_JUMP=80`) + `.averageTouches(true)` on the pan.
  - PDF fetched once to a local file via `react-native-blob-util` → `file://` path handed to the module.
  - Gates: `npx tsc --noEmit` GREEN (whole program), `pdfAnnotation` self-check GREEN.
  - DevRoot 🏗️ button still launches it; `App.tsx` UNTOUCHED.

**Next** (priority — DEVICE TEST, this is the whole point of a spike):
1. **Rebuild the dev build** — REQUIRED, this adds a brand-new native module (JS-only edits Fast-Refresh over Wi-Fi, but a native module needs a cable rebuild):
   ```
   cd mobile-expo-go
   LANG=en_US.UTF-8 npx expo run:ios --device     # CocoaPods needs the UTF-8 locale
   ```
   (Metro over Wi-Fi: `--lan`, host was `192.168.1.220:8081`.)
2. **Renderer foundation is DONE and device-confirmed** ("this feels good"): crisp glued vector ink, correct orientation, tiling (base + visible-region detail tile, no deep-zoom lag), 2-finger pinch/pan, tap-to-dot vs drag-to-line. Diagnostics stripped (commit 9e3eed55). The pen is the only tool; ink is hardcoded blue `INK_W=3`; the PDF is still the hardcoded tracemonkey URL.
3. **Next — build out the real product:**
   - **Tools**: shapes → text → eraser → Survey Marker → highlighter (the `@survey/shared` annotation contract is the source of truth — callout is the historical odd-one-out). A color + stroke-width picker is needed early since ink is hardcoded.
   - **Real PDF + data**: load an actual survey PDF (Supabase storage) instead of the test URL, and wire strokes to `@survey/shared` + Supabase/Yjs so annotations live in the DB over the PDF (NOT baked in) and round-trip with the desktop owned-pdf.js renderer (strokes are already stored NORMALIZED for this).
   - Gesture/tool dispatch will need a tool palette; the current mode SV (draw/select/pan) is the seed.

**Watch out / deliberate deviations from the architecture doc**:
- **Page image is React state, not a shared value.** The doc's `useSharedValue<SkImage>` + `runOnUI` swap is for per-frame UI-thread updates; here the image only changes on *settle* (a JS event), so plain `setPageImage` swaps cleanly and dodges the doc's flagged "SkImage-in-shared-value unverified for 2.2.12" risk. The per-frame zoom/pan animation is still 100% UI-thread (the `<Group transform>` reads `sc/tx/ty` shared values — same mechanism the foundation already proved with `livePath`).
- **`rasterizePage` returns `Data` directly, not `{bytes,width,height}`.** A heterogeneous `[String:Any]`-with-`Data` return is NOT covered by Expo's conversion tests; a declared `Data` return IS. The PNG self-describes its size to Skia, and JS knows pts×scale, so dims aren't needed (raw-RGBA Phase-4 path would re-add them).
- **No manual SkImage/SkData dispose.** PNG decode is lazy; premature dispose risks use-after-free. GC handles it. If a device shows real memory growth, add the §3.5 two-slot cap (dispose prev after 2 frames) — a Phase-4 opt, not a spike blocker.
- **Honest cap headroom**: 4096 px on a 612 pt page = raster scale 6.7 / DPR 3 ≈ **2.2× display zoom before softening**. Fine to prove crisp+smooth+synced+no-crash; true floor-plan deep zoom needs **Phase-3 tiling** (~3–4 days).
- Rasterization latency at survey-class zoom/sheet size is the open MEDIUM-confidence question — **only the device test settles it.** Build+typecheck gates answer none of (a)–(d).
- Don't touch the root `HANDOFF.md` (Excel work, stale trap). This branch also carries `main`'s latest Excel/kal309 work (merged in cleanly; disjoint dirs).
