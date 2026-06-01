# Handoff: Renderer spike — pdf.js chosen; tiling + imported annotations done

**Generated**: 2026-05-31 23:57 (updated 2026-06-01 afternoon)
**Branch**: `main` (local-only; direct-to-main, nothing committed or pushed; user tests on the symlinked dev server)
**Status**: pdf.js arm (Arm A) is the chosen renderer and is in a good, user-approved state.

## WHERE WE ARE NOW (read this first)

Verdict locked: **own the renderer on pdf.js**, EmbedPDF dropped (its rotation/fidelity/
zoom-anchor rough edges, detailed below). On the pdf.js arm (`src/prototype/PdfjsArm.jsx`),
all verified in-browser on the real 36-page file and user-approved ("really good"):
- **Deep-zoom tiling** — `DetailTile` renders only the visible viewport slice at full DPR
  over a cheap full-page backdrop. Above `BASE_MAX_SCALE` (2.5) the backdrop renders ONCE
  and freezes (keys on `baseScale`), so deep zoom/pan only pays for the small tile. Settle
  110ms, tile scroll-debounce 70ms.
- **Imported annotations (read-only)** — rendered via pdf.js's OWN appearance streams
  (base canvas + DetailTile render WITH annotations; do NOT disable annotationMode). This
  gives real smooth pen strokes + semi-transparent fills, kept crisp by the tile. An
  earlier vector-reconstruction approach (extract inkLists → SVG polyline) looked jagged/
  opaque and was removed — see CORRECTION in today's session-moments. Walkthrough (private
  repo; local clone at `/Users/isaiahcalvo/Projects/Walkthru`) does the same: bakes the
  appearance for display, polyline overlay is edit-mode-only.
- Synthetic test shapes removed (`ensureSeed` is a no-op in `RendererSpike.jsx`).
- `npm test` 840/0/6 throughout. Nothing committed.

**Perf ceiling found (next-session target):** the remaining cost is the full-page raster
re-executing the page's ~400 ink appearance streams on each zoom-settle (~130–180ms on the
marked-up sheets) — it is RESOLUTION-INDEPENDENT, so lowering the backdrop cap doesn't help
(tested 2.5→1.5, reverted). The real lever is a **separate annotation layer** so page
content renders fast and the marks render/cache independently of zoom. This pairs naturally
with the next feature.

## NEXT PART (start fresh)

1. **Make imported annotations editable** (user chose read-only first; now go interactive,
   the Walkthrough way: a selectable/movable overlay with hit-targets + selection box).
2. **Separate page vs annotation layers** (the perf lever above) — do alongside #1 since
   editing needs the marks as their own addressable layer anyway.

---

## UPDATE 2026-06-01 (revised after live testing) — pinning fixed; orientation kept; EmbedPDF's rotated-page gap, fidelity, and zoom-anchor are unsolved limitations

Reproduced and measured Arm B live (port 5199 — note Desktop path is a symlink to this
repo, so the user's dev server runs these exact files). This supersedes the optimistic
"pinning VERIFIED" notes further down.

1. **Annotation pinning was genuinely broken** (user was right). EmbedPDF zooms by
   resizing the page box and passes NO `scale` to `renderPage`, so the overlay's
   `pointW = width` rode the zoom — at 16% the shapes ballooned ~3× and floated off the
   page. **Fix (kept):** `PageContent` reads live zoom via `useZoom` and uses
   `pointW = width / currentZoomLevel`. Verified pinned, identical page-fractions 16%→800%.
2. **Orientation — DO NOT switch to normalizeRotation:true.** A mid-session attempt to fix
   the gap by using `normalizeRotation:true` + rendering at `rotatedWidth/rotatedHeight`
   BROKE orientation: in true-mode the base raster is PORTRAIT (measured natural
   1527×2360), so it got stretched sideways into a landscape box with portrait tiles
   overlaid → the user's "double image" (rotated+unrotated). Reverted to
   `normalizeRotation:false` (forces FPDF_LoadPage → true upright landscape raster,
   measured natural 2360×1527) + render at `width/height`. Verified upright, no double image.
3. **Rotated-page spacing gap is UNSOLVED (EmbedPDF limitation).** In false-mode the
   Scroller sizes the page slot from `rotatedSize = transformSize(size, rotation)`, which
   double-rotates the /Rotate-270 pages to a PORTRAIT slot — so the upright landscape page
   sits in a too-tall slot ("pages 6–11 spaced weird / offset"). Fixing it cleanly needs
   the scroller to see rotation=0 for those pages (engine/metadata surgery) — not attempted.
4. **Deep-zoom fidelity is weak.** The base RenderLayer is low-res (≈930px natural for a
   1224pt page) and tiles only cover the visible region with latency, so anything not yet
   tiled looks blurry on zoom-in. Inherent to this tiling setup.
5. **Zoom sometimes jumps to the bottom** on the ctrl/⌘+wheel gesture (EmbedPDF's
   ZoomGestureWrapper anchoring). Not reproducible via the requestZoom API; couldn't fix.

Net: EmbedPDF needs escalating workarounds (rotation, fidelity, anchoring) where Arm A
(pdf.js, owned) handles all three cleanly — a strong signal for the "own the renderer"
verdict. Only `src/prototype/EmbedpdfArm.jsx` changed. `npm test` 840/0/6.

### UPDATE 2026-06-01 (later) — VERDICT: own pdf.js; built tiling + imported annotations

Decision made: go with the pdf.js arm, drop EmbedPDF. Built three things on `PdfjsArm.jsx`,
all verified in-browser on the real file:
1. **Deep-zoom tiling** — `DetailTile` renders only the visible viewport slice of a page at
   full DPR over the clamped base canvas (pixel count bounded by the viewport, so it never
   clamps). Active only when the full-page raster would clamp; re-renders on settle + scroll.
   Verified crisp (2× oversample) at 800% and after panning. Fixes the "80MP CLAMPED → blur".
2. **Removed the synthetic test shapes** — `ensureSeed` is now a no-op in `RendererSpike.jsx`.
3. **Imported annotations (read-only, crisp)** — `ImportedAnnotationLayer` reads the PDF's real
   markups via `page.getAnnotations()` and draws them as page-locked SVG vectors (Ink→polyline,
   Square/Circle, Line, FreeText), mapped through the scale:1 rotated viewport's
   `convertToViewportPoint`. The base canvas now renders with `annotationMode: DISABLE` so
   markups aren't baked into the raster (no doubling, infinitely crisp). `npm test` 840/0/6.

Next requested step: make the imported annotations selectable/editable (interactive import).

## Goal

Throwaway two-arm renderer bake-off (`?spike=renderer`): decide whether to own the
renderer on **pdf.js** or adopt **EmbedPDF** (PDFium-WASM + tiling) — the own-the-zoom
north star. This session's job was to get the **EmbedPDF arm (Arm B)** working correctly
so the head-to-head is fair. It now renders, bakes annotations, shows correct page
orientation, and keeps overlays pinned on zoom.

## Completed (this session, all verified in-browser on the real 36-page file)

- [x] **pdf.js arm orientation** — let pdf.js bake each page's intrinsic `/Rotate` (`PdfjsArm.jsx`): measure `getViewport({scale:1})` (no `rotation:0`) and raster with `rotation: page.rotate + userRotation`.
- [x] **EmbedPDF worker hang FIXED** — the off-thread engine hung at "Opening document…". Root cause: the worker is an inline **blob** module worker, so a root-relative wasm path can't resolve inside it. Fix: pass an **absolute** wasm URL (`new URL('/pdfium.wasm', window.location.origin).href`). Also a separate latent crash fixed: passing raw `console` as the logger → `serializeLogger(console)` returns undefined → worker throws; now uses `new LevelLogger(new ConsoleLogger(), LogLevel.Warn)`.
- [x] **EmbedPDF annotations now show** — render plugin defaults `withAnnotations:false`; set `createPluginRegistration(RenderPluginPackage, { withAnnotations: true })`. The render plugin's config is shared by the tiling layer (tiling calls the render plugin's `renderPageRect`), so this bakes the 3049 ink / 6 square / 1 freetext into base + tiles.
- [x] **EmbedPDF page orientation FIXED** — the 6 `/Rotate 270` pages rendered sideways (portrait). Root cause: `@embedpdf/plugin-document-manager` v2.14.3 (latest) **hardcodes `normalizeRotation: true`** in all 3 engine-open paths, flattening pages to 0° and dropping intrinsic rotation; `renderPage` reports `rotation: undefined`. Fix: override `engine.openDocumentBuffer` (the URL path delegates to it) to force `normalizeRotation: false` before EmbedPDF uses the engine. See `patchedEngine` in `EmbedpdfArm.jsx`.
- [x] **Interactive overlay pinning VERIFIED** — measured SVG overlay vs page image through a full cursor zoom (rest → mid-gesture → settle) on both normal and rotated pages: offset stays `dx=0 dy=0`, sizes match exactly. It was always pinned; the apparent drift was the orientation bug.
- [x] **Logs save into project `Logs/`** — dev-only Vite middleware `POST /__save-spike-log` writes `Logs/PDF render comparison <timestamp>.log` (filename-validated). The Save-log button + **Cmd/Ctrl+Shift+L** both use it; falls back to a browser download if the endpoint is absent.
- [x] Build clean, `npm test` 840 pass / 0 fail / 6 skip (baseline) after every change.

## Not Yet Done

- [ ] **Isaiah tests all of the above** on his dev server (the immediate next step) — orientation, annotations, and pinning on the EmbedPDF arm with the real file, then a fair re-match.
- [ ] **EmbedPDF raster time is uninstrumented** — Arm B shows `raster —ms / avg 0ms`. The deciding perf number is unmeasured for one arm. `MetricsBridge` (`EmbedpdfArm.jsx`) emits only zoom%/page/mounted. Need to time the render/tile round-trips and surface it in `RendererSpike.jsx`'s EmbedPDF branch before declaring a perf winner.
- [ ] **Deep-zoom crispness** — at ~964% the EmbedPDF base looked blurry before tiles caught up. The audit recommends capping the base `RenderLayer` to a fixed low scale (`scale={1.0}`) so the base is a cheap backdrop and tiles own crispness. Not done.
- [ ] **Secondary EmbedPDF tuning** (from the audit) — `defaultBufferSize 2 → 1`, add `encoderPoolSize: 2–4` to `usePdfiumEngine`. Not done; treat as low priority.
- [ ] **Editable annotation import** (original task 3) — not built. We BAKE the real annotations into the page image (they show + pin) rather than importing them as editable overlay objects. Only the synthetic seed shapes are interactive.
- [ ] **Commit** — all work is uncommitted. Direct-to-main; commit/push only after Isaiah approves.

## Failed Approaches (Don't Repeat These)

- **EmbedPDF worker hang ≠ headers.** First hypothesis was the worker needs cross-origin-isolation headers (COOP/COEP) that conflict with MSAL. **Wrong** — EmbedPDF's `pdfium.wasm` is single-threaded (no SharedArrayBuffer), so no COI is needed. Do NOT touch the Vite headers or MSAL for this. The real cause was the relative wasm URL in the blob worker.
- **`logger: console` was a red herring for the hang.** It IS a real bug (crashes the worker), and it's fixed, but fixing it did NOT resolve the hang. Don't stop at the logger.
- **Orientation: the Rotate plugin / `renderPage` rotation does NOT help.** `@embedpdf/plugin-rotate` is for *document-level user rotation*, not intrinsic `/Rotate`; it isn't even installed. With `normalizeRotation:true`, intrinsic rotation is stripped and `renderPage` gives `rotation: undefined`, and the Scroller reserves portrait slots — so CSS-rotating inside `renderPage` would overflow the slot. The ONLY clean fix is `normalizeRotation:false` at the engine (done). There is no public document-manager config to set it, and the latest published version is the installed one (2.14.3), so don't go looking for a config flag.
- **pdf.js raster is NOT off-thread.** Only parsing/operator-list generation runs in the worker; canvas rasterization runs on the main thread. pdf.js's smoothness comes from render-on-settle + a CSS-transform preview, not thread offload. Don't repeat the "raster runs in the worker" claim.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Override `engine.openDocumentBuffer` to force `normalizeRotation:false` | Only way to get correct page orientation; doc-manager hardcodes `true` with no public config. We own the engine instance, so this is a clean boundary override. |
| Bake annotations via `withAnnotations:true` (not editable import) | Matches pdf.js (which bakes markups into the canvas), makes them show + pin for free. Editable import (task 3) is a bigger, separate effort. |
| Warn-level logger, not full `ConsoleLogger` | Full debug logging fires per tile during zoom and would taint the perf meters. |
| Keep pdf.js arm untouched as the control | Need a stable baseline for the fair re-match. |

## Current State

**Working**: Both arms load the real file. pdf.js: correct orientation + baked markups + pinned overlays. EmbedPDF: off-thread engine, correct orientation (all pages upright), baked markups, pinned overlays, smooth cursor zoom (last log: worst frame ~58–82ms vs the old 358ms).

**Broken / open**: EmbedPDF raster time unmeasured; deep-zoom base can look blurry until tiles render. Neither blocks testing.

**Uncommitted Changes**: `EmbedpdfArm.jsx` (worker fix + annotations + orientation override), `PdfjsArm.jsx` (orientation), `RendererSpike.jsx` + `spikeLogger.js` + `vite.config.js` (Logs-folder save + Cmd+Shift+L). New audit doc `docs/audits/EMBEDPDF-WORKER-FIX-AND-PERF.md`.

## Files to Know

| File | Why It Matters |
|------|----------------|
| `src/prototype/EmbedpdfArm.jsx` | Arm B. All three EmbedPDF fixes live here: `WASM_URL` (absolute), `SPIKE_LOGGER`, `patchedEngine` (normalizeRotation override), `withAnnotations:true`. |
| `src/prototype/PdfjsArm.jsx` | Arm A control. Orientation fix (bake intrinsic `/Rotate`). |
| `src/prototype/RendererSpike.jsx` | Shell: arm switch, fixtures, meters, `saveLog` (server-then-download) + Cmd+Shift+L. |
| `src/prototype/spikeLogger.js` | `saveToServer()` POSTs the log to the dev endpoint; `save()` is the download fallback. |
| `vite.config.js` | `spikeLogSavePlugin()` dev middleware that writes `Logs/<name>`. |
| `docs/audits/EMBEDPDF-WORKER-FIX-AND-PERF.md` | The deep multi-agent EmbedPDF analysis (worker, perf, setup, what's misconfigured). |

## Code Context

**The orientation fix (the non-obvious one) — `EmbedpdfArm.jsx`:**
```jsx
// EmbedPDF's doc-manager hardcodes normalizeRotation:true (flattens pages to 0°,
// drops intrinsic /Rotate). We own the engine, so force false before EmbedPDF opens.
const patchedEngine = useMemo(() => {
  if (engine && !engine.__forceNoNormalize) {
    const orig = engine.openDocumentBuffer?.bind(engine);
    if (orig) engine.openDocumentBuffer = (file, options) =>
      orig(file, { ...(options || {}), normalizeRotation: false });
    engine.__forceNoNormalize = true;
  }
  return engine;
}, [engine]);
// ...
<EmbedPDF key={fileKey} engine={patchedEngine} plugins={plugins}>
```

**Real-file geometry (so you can verify the orientation fix held):**
- Pages 0–1: portrait 612×792 → box ~590×763. Pages 2–4, 11–35: landscape 1224×792 → box ~1180×763.
- Pages 5–10: `/Rotate 270`, mediabox 792×1224. **Before fix:** box 763×1180 (sideways). **After fix:** box 1180×763 (landscape, correct). All 3056 annotations live on pages 5–10.

**Overlay-pinning check (paste into the page console on Arm B to re-verify):** compare any page wrapper's `<img>` `getBoundingClientRect()` vs its sibling `<svg>` rect before and after a ctrl/⌘+wheel zoom — offset should stay `dx≈0 dy≈0` and widths/heights should match.

## Resume Instructions

1. Dev server is already configured. Open `…:5173/?spike=renderer` (Isaiah's) — no build step needed; Vite serves the changes.
2. Click **Arm B — EmbedPDF**, then the **Real package (36pg)** fixture (or Load PDF… → the real file).
3. Scroll to pages 6–11 (the marked-up ones).
   - Expected: pages are **upright/landscape**, red ink notes read **horizontally**, page number reads "6/36"… "11/36".
   - If sideways: the `normalizeRotation:false` override didn't take — check `patchedEngine` is passed to `<EmbedPDF>` and the engine actually re-opened (hard-reload, don't rely on HMR for engine changes).
4. Ctrl/⌘+scroll to zoom on a marked-up page.
   - Expected: markups + the colored test shapes stay locked to the page; deep zoom stays (mostly) crisp via tiling.
5. Press **Cmd/Ctrl+Shift+L** (or the 💾 Save log button).
   - Expected: a status line "saved → Logs/PDF render comparison …" and the file appears in `Logs/`.
6. Then pick up the open items: instrument EmbedPDF raster time, cap the base RenderLayer scale, run a fair re-match, record the verdict in `src/prototype/NOTES.md`.

## Warnings

- **Throwaway spike.** Everything is under `src/prototype/` + the `?spike=renderer` block in `src/main.jsx`. Do NOT touch the real viewer (`PDFViewer.jsx`) or v2.0 invariants.
- **`patchedEngine` mutates the engine instance** (a deliberate monkeypatch over a hardcoded library default). It's guarded by `__forceNoNormalize`. Fine for a spike; not a pattern for production.
- **`normalizeRotation:false` means annotation coords are now in rotated (display) space, not 0°.** That's fine here because we BAKE annotations (PDFium handles their coords) and never map raw coords ourselves. If you later add editable annotation import, revisit this.
- **The Logs save only works on the dev server** (Vite middleware). In a built/Electron context it falls back to a normal download.
- Don't trust pre-this-session logs for the perf verdict — EmbedPDF was hobbled (worker off) until this session. Re-match after instrumenting raster.
