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
2. **Run the §5 checklist on the iPhone** — open 🏗️ → AnnotatablePdf, then on a floor-plan PDF:
   - (a) zoom to 4–8×, stop → does the page become **crisp within ~200–300 ms**?
   - (b) does the **ink stay glued** to the page through the whole gesture (no drift)?
   - (c) does it **NOT crash** at `sc=8` (the old bitmap-scale crash should be gone)?
   - (d) does the **2-finger pinch feel jump-free** (the §4 fix) on a 1↔2-finger handoff?
   - Measure `rasterizePage` latency at scale 1/2/4/8 in Instruments. If a full-page raster >~300 ms on survey-class sheets → escalate to **Phase-3 tiling**.
3. THEN port the real tools (shapes → text → eraser → Survey Marker → highlighter) and wire strokes to `@survey/shared` + Supabase/Yjs (annotations live in the DB over the PDF, NOT baked in).

**Watch out / deliberate deviations from the architecture doc**:
- **Page image is React state, not a shared value.** The doc's `useSharedValue<SkImage>` + `runOnUI` swap is for per-frame UI-thread updates; here the image only changes on *settle* (a JS event), so plain `setPageImage` swaps cleanly and dodges the doc's flagged "SkImage-in-shared-value unverified for 2.2.12" risk. The per-frame zoom/pan animation is still 100% UI-thread (the `<Group transform>` reads `sc/tx/ty` shared values — same mechanism the foundation already proved with `livePath`).
- **`rasterizePage` returns `Data` directly, not `{bytes,width,height}`.** A heterogeneous `[String:Any]`-with-`Data` return is NOT covered by Expo's conversion tests; a declared `Data` return IS. The PNG self-describes its size to Skia, and JS knows pts×scale, so dims aren't needed (raw-RGBA Phase-4 path would re-add them).
- **No manual SkImage/SkData dispose.** PNG decode is lazy; premature dispose risks use-after-free. GC handles it. If a device shows real memory growth, add the §3.5 two-slot cap (dispose prev after 2 frames) — a Phase-4 opt, not a spike blocker.
- **Honest cap headroom**: 4096 px on a 612 pt page = raster scale 6.7 / DPR 3 ≈ **2.2× display zoom before softening**. Fine to prove crisp+smooth+synced+no-crash; true floor-plan deep zoom needs **Phase-3 tiling** (~3–4 days).
- Rasterization latency at survey-class zoom/sheet size is the open MEDIUM-confidence question — **only the device test settles it.** Build+typecheck gates answer none of (a)–(d).
- Don't touch the root `HANDOFF.md` (Excel work, stale trap). This branch also carries `main`'s latest Excel/kal309 work (merged in cleanly; disjoint dirs).
