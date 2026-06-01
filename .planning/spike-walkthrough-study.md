# Walkthrough reference repo study — PDF rendering, rotation, overlay pinning, annotation import

Repo (READ-ONLY, cloned): `/tmp/walkthrough-ref` — Isaiah's private "Walkthrough" monorepo.
Studied 2026-05-31. This OVERWRITES the prior (wrong) version that concluded the repo didn't
exist. The repo exists at `/tmp/walkthrough-ref` and was read in full.

Bottom line up front: **the production viewer renders with pdf.js (react-pdf), NOT EmbedPDF.**
EmbedPDF/PDFium exists only as a dev-only prototype under `app/dev/embedpdf/*`. Two
fundamentally different overlay-pinning strategies live in this repo, and both matter for our
two-arm prototype:

- **pdf.js arm (production):** percent-of-page overlays portalled INTO each page wrapper, all
  scaling done by a single outer CSS `transform: scale()` zoom layer. Pages render at their
  natural (intrinsic-rotation-baked) size; no rotation math in the render path.
- **EmbedPDF arm (dev prototype):** PDFium renders each page to a PNG blob `<img>`; overlays
  mount per-page inside `Scroller`'s `renderPage`, sized to EmbedPDF's `rotatedWidth/rotatedHeight`,
  using percent-of-page coords so rotation is handled by the engine's already-rotated layout box.

---

## 1. ENGINE — pdf.js in production, EmbedPDF only in /dev

**Production = pdf.js via `react-pdf`.**
`apps/web/src/components/viewer/pdf-renderer.tsx:14`:
```ts
import { Document, Page, pdfjs } from "react-pdf";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```
Production chain: `walkthrough-viewer.tsx` → `AssetCanvas` (`asset-canvas.tsx`) → `PdfRenderer`
(dynamic import, `ssr:false`, `asset-canvas.tsx:12`). `AssetCanvas` only ever mounts `<PdfRenderer>`
for PDFs and `<ImageRenderer>` for images (`asset-canvas.tsx:90`). `floor-rail.tsx` and
`upload/walkthrough-thumbnail.tsx` also use raw pdf.js (`getDocument`/`getViewport`/`getTextContent`)
for thumbnails + search text. **No EmbedPDF import anywhere in the production viewer path.**

**EmbedPDF = PDFium, dev-only.** `@embedpdf/*` is imported ONLY by
`components/dev/embedpdf-prototype.tsx` (and its harness `embedpdf-tab-cache-harness.tsx`),
reachable ONLY from `app/dev/embedpdf/{sample,[id],asset/[assetId]}/page.tsx`. It spins up a
PDFium WASM engine (`embedpdf-prototype.tsx:177-179`):
```ts
? await import("@embedpdf/engines/pdfium-worker-engine")
: await import("@embedpdf/engines/pdfium-direct-engine");
const nextEngine = await pdfiumModule.createPdfiumEngine(wasmUrl);  // /embedpdf/pdfium.wasm
```
So **EmbedPDF is a throwaway engine spike, not production.** The thing that "correctly renders
multi-orientation/multi-size PDFs and keeps annotations pinned through zoom" in production is the
pdf.js arm. The EmbedPDF prototype is the comparison arm being evaluated (it tracks FPS, worst-frame
spikes, render-cache size — it's an engine bake-off).

---

## 2. ROTATION + MIXED SIZES

### pdf.js arm — rely on pdf.js baking intrinsic /Rotate; per-page natural size from onLoadSuccess

The production renderer does **NOT** pass a rotation to `getViewport`, and applies **NO** CSS
rotation transform for page orientation. It trusts pdf.js to bake the page's intrinsic `/Rotate`
into both the rendered bitmap and the reported page dimensions.

Per-page size is captured per page from `<Page onLoadSuccess>` (`pdf-renderer.tsx:2100-2134`):
```ts
onLoadSuccess={(p) => {
  pdfPageRef.current = p as PdfPageWithAnnotations;
  setNaturalSize((prev) => prev ?? {
    width:  p.originalWidth  * PDF_DPI_FACTOR,   // 96/72 DPI inflation, PDF_DPI_FACTOR = 96/72
    height: p.originalHeight * PDF_DPI_FACTOR,
  });
  setOriginalSize((prev) => prev ?? { width: p.originalWidth, height: p.originalHeight });
  ...
}}
```
`originalWidth/originalHeight` from react-pdf's `PageCallback` are the **rotation-applied** scale=1
dims (pdf.js reports the rotated viewport size), so a landscape or 90°-rotated page reports the
correct (already-swapped) width/height. Mixed sizes "just work" because each `<BaseScalePage>` stores
its OWN `naturalSize` — there is no shared/global page size.

Per-page layout box is computed entirely from that per-page `naturalSize` (`pdf-renderer.tsx:1191-1205`,
rendered wrapper at `:1967-2014`):
```ts
const outerWidth  = (naturalSize?.width  ?? SHIMMER_WIDTH_PX)  * userScale; // userScale = PAGE_LAYOUT_SCALE = 1
const outerHeight = (naturalSize?.height ?? SHIMMER_HEIGHT_PX) * userScale;
// outer wrapper: width/height = outerWidth/outerHeight, position:relative, overflow:hidden, mx-auto
//   inner wrapper: width=naturalW*rasterScale, height=naturalH*rasterScale,
//                  transform: scale(userScale / rasterScale), transform-origin: top left
//     <Page scale={rasterScale * PDF_DPI_FACTOR} .../>   // hi-res bitmap, CSS-downscaled to natural box
```
Pages are stacked in a `flex flex-col items-center gap-6` column (`pdf-renderer.tsx:935`), each
centered with `mx-auto` — mixed orientations/sizes lay out as a centered vertical stack, each at its
own natural box. Layout offset = normal document flow (no manual offset math).

**`getViewport({ scale })` is used only for annotation/text mapping and rasterization, never with a
rotation arg:** `pdf-renderer.tsx:517` `getViewport({ scale: PDF_DPI_FACTOR })`, `:1525`/`:1760` for
tile/full-page raster. None pass `rotation` — pdf.js applies intrinsic page rotation automatically.

The canonical-coords helper (`packages/shared/src/coords.ts`) DOES have full rotation-aware math
(`toCanonical`/`fromCanonical` with a `0|90|180|270` switch + y-flip), but the production render path
deliberately bypasses it (see §3). It's kept "for callers that need rotation-aware math"
(`pin-coords.ts:5`) but isn't on the hot path.

### EmbedPDF arm — engine owns rotation; consumer reads `page.rotatedWidth/rotatedHeight`

PDFium computes the rotated layout box. The prototype page sizes itself from EmbedPDF's
`RenderPageProps.rotatedWidth/rotatedHeight` and never does its own rotation geometry
(`embedpdf-prototype.tsx:2107-2118`):
```tsx
<div style={{ width: page.rotatedWidth, height: page.rotatedHeight,
              contain: "layout paint style", contentVisibility: "auto",
              containIntrinsicSize: `${page.rotatedWidth}px ${page.rotatedHeight}px` }}>
```
Rotation is fed to the renderer as an int and combined with any document-level rotation
(`:2031-2033`):
```ts
const pageRotation     = documentPage?.rotation ?? 0;     // per-page intrinsic, 0..3 quarter-turns
const documentRotation = documentState?.rotation ?? 0;    // user "Rotate" button
const effectiveRotation = (pageRotation + documentRotation) % 4;
```
passed into the raster call (`:1461-1469`):
`renderPage({ pageIndex, options: { scaleFactor, dpr, rotation, withAnnotations } })`. Rotation is part
of the render-cache key (`getRenderCacheKey`, `:294-317`), so rotating re-renders rather than
CSS-rotating. Mixed sizes are inherent — each page's `rotatedWidth/Height` comes from the engine.

---

## 3. OVERLAY PINNING THROUGH ZOOM (production pdf.js arm) — THE KEY TECHNIQUE

This is the part to copy. Contract: **"percent-of-page coords + single outer CSS transform:
scale() owns all zoom; overlays live INSIDE the page wrapper, so they inherit the transform for
free."** No per-point screen math on the hot path, no viewBox tricks for pins.

**(a) One outer zoom layer is the single source of truth for scale + pan**
(`walkthrough-viewer.tsx:1650-1660`):
```tsx
<div ref={zoomLayerRef} style={{
  position: "absolute", top: 0, left: 0,
  transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
  transformOrigin: "0 0",
  willChange: "transform",   // own GPU compositor layer — wheel-zoom/pan are GPU-only, no layout/paint
}}>
```
Pages render at `PAGE_LAYOUT_SCALE = 1` (natural size); the OUTER transform is the only thing that
scales. `walkthrough-viewer.tsx:102-106` is explicit: *"the OUTER zoom layer transform is the single
source of truth for user-visible scale."*

**(b) Both the AssetCanvas (pages) AND the PinLayer are children of that same zoom layer**
(`walkthrough-viewer.tsx:1671` AssetCanvas, `:1690` PinLayer) — so pins scale/pan in lockstep with
pages because they share the one transform.

**(c) PinLayer portals each page's overlay INTO that page's `[data-page-key]` wrapper.**
`PortalToPageWrapper` (`pin-layer.tsx:688-726`) continuously rAF-re-queries
`[data-page-key="${floorId}:${pageIndex}"]` and `createPortal(children, target)` into it. The rAF loop
re-anchors if the renderer swaps the wrapper element during a settle re-rasterize (`:679-687`) — their
fix for "pins disappear after re-rasterize." The `<PdfRenderer>` page wrapper carries
`data-page-key={`${floorId}:${pageIndex}`}` (`pdf-renderer.tsx:1980`); image/HEIC floors carry
`data-page-key={`${floorId}:0`}` (`asset-canvas.tsx:109`) so the same overlay code works across formats.

**(d) Each pin is positioned by pure percent-of-page** (`pinScreenStyle`, `pin-coords.ts:55-57`):
```ts
export function pinScreenStyle(coord) { return { left: `${coord.xPct*100}%`, top: `${coord.yPct*100}%` }; }
```
Because the pin lives inside the page wrapper, `left: xPct*100%` resolves against the wrapper's
PRE-transform width, and the outer `transform: scale()` then scales it visually — pin stays locked to
the same page point at every zoom. Documented in `pin-coords.ts:26-30` as "RESEARCH.md Pattern 1 —
render uses pure percent-of-page."

**(e) Screen→page mapping uses `getBoundingClientRect()`, NOT pageSize*scale.** `tapToCanonical`
(`pin-coords.ts:32-52`):
```ts
const hit = document.elementFromPoint(clientX, clientY);
const wrapper = hit?.closest("[data-page-key]");
const rect = wrapper.getBoundingClientRect();      // already includes the zoom transform
const xPct = clamp01((clientX - rect.left) / rect.width);
const yPct = clamp01((clientY - rect.top)  / rect.height);
```
Comment (`pin-coords.ts:47-48`): *"rect.{width,height} already includes the zoom transform via
getBoundingClientRect."* They never reconstruct `pageSize * scale`; they let the browser's
post-transform rect do it. This sidesteps the "Electron zoom-factor mismatch" class of bugs that
forces the Survey app's container-aware-measurement rule.

**(f) Drag math divides screen delta by zoom** (`pin.tsx:140-151`): pointer dx/dy arrive in screen-px,
but the pin's inline `left/top` are in pre-transform px, so
`left = calc(${xPct*100}% + ${dx/safeZoom}px)`. `dx/zoom` converts screen delta → pre-transform delta
so the pin tracks the cursor 1:1 at any zoom. Persisted coords from rect:
`rawXPct = clamp01(xPct + dx/rect.width)` (`pin.tsx:167-168` — rect is post-transform, no zoom division
needed there).

Net: **no viewBox for pins, no per-point matrix; page-wrapper-relative percent + one shared CSS
transform does all the work.** (SVG `viewBox` IS used — but only for stroke geometry inside an
annotation's own box, see §4/§5: `pdf-renderer.tsx:2558`, `embedpdf-prototype.tsx:1996`.)

---

## 4. EMBEDPDF OVERLAY SPECIFICALLY (dev prototype)

**Where the overlay mounts:** inside `Scroller`'s `renderPage` callback. The page render prop returns
`<PrototypePage>` (`embedpdf-prototype.tsx:2430-2443`):
```tsx
<Scroller documentId={documentId} className="relative"
  renderPage={(page) => (
    <PrototypePage ... page={page as RenderPageProps} key={`${documentId}:${page.pageIndex}`} />
  )} />
```
`<PrototypePage>` (`:2107-2145`) is a `position:relative` box sized to
`page.rotatedWidth × page.rotatedHeight`, containing:
1. `<PrototypeRenderLayer>` — the rendered page as a PNG blob `<img>`, `absolute inset-0 h-full w-full`
   (`:1738-1793`). PDFium → PNG blob via `renderPage({ scaleFactor, dpr, rotation, withAnnotations })` →
   objectURL → `<img>`. (Preview + full-fidelity tiers, render queue, LRU cache — perf scaffolding.)
2. `<PagePointerProvider>` wrapping `<PrototypeAnnotationLayer>` — the editable overlay, gated behind
   zoom/distance/idle conditions (`:2127-2143`).

**Overlay coordinate space = displayed/ROTATED dims** (`page.rotatedWidth/rotatedHeight`), NOT the
unrotated page-point dims. Both the page box (`:2113-2114`) and the `PagePointerProvider` box
(`:2131-2134`) are sized to `rotatedWidth/rotatedHeight`. The custom stroke overlay then uses
percent-of-box coords — identical pattern to production:
```tsx
// embedpdf-prototype.tsx:1994-2011
<svg className="pointer-events-none absolute inset-0 h-full w-full"
     viewBox="0 0 100 100" preserveAspectRatio="none">
  {strokes.map((s) => (
    <polyline points={s.points.map(p => `${p.xPct*100},${p.yPct*100}`).join(" ")}
              vectorEffect="non-scaling-stroke" ... />
  ))}
</svg>
```
Strokes captured as percent via `pointFromEvent` (`:1875-1888`):
```ts
const rect = layer.getBoundingClientRect();
xPct: clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
yPct: clampNumber((event.clientY - rect.top)  / rect.height, 0, 1)
```
Same `getBoundingClientRect()` screen→page trick as production.

**Pinning on ROTATED pages:** because the overlay box is sized to the engine's already-rotated layout
dims, percent-of-box coords are automatically in the rotated visual frame. The overlay is a sibling of
the rendered `<img>` inside the same `rotatedWidth × rotatedHeight` box, so when EmbedPDF re-renders
the page rotated (rotation is in the render-cache key `:294-317`, and the box dims swap to the new
`rotatedWidth/Height`), the overlay box swaps with it and the percent coords still land on the same
visual point. **No manual rotation/y-flip in the overlay for hand-drawn strokes** — the engine's
rotated layout box absorbs it. (Contrast: the production arm's IMPORTED annotations DO need y-flip
handling — §5 — because those come from raw PDF coords, not from pointer events on an already-rotated box.)

**Zoom on the EmbedPDF arm is genuinely different from production:** there is NO single CSS transform.
Zoom is handled by the EmbedPDF ZoomPlugin re-laying-out + re-rendering at the new scale
(`PrototypeSmoothZoomGesture`, `:942-1072`, calls `scope.requestZoomBy(delta, {vx,vy})` on
ctrl/pinch-wheel via rAF; `stabilizePageDuringZoom` holds the "current page" steady for 450ms so
page-number telemetry doesn't thrash). The EmbedPDF overlay stays pinned because the whole page box
(img + overlay) is re-measured/re-rendered together at the new zoom and the overlay's percent coords
are resolution-independent — NOT because of a shared transform.

---

## 5. ANNOTATION IMPORT (embedded PDF annotations)

### pdf.js arm — full Ink/Square/FreeText import with y-flip via convertToViewport* (production)

This is the substantive annotation-import implementation. `loadPdfAnnotations`
(`pdf-renderer.tsx:1208-1245`) calls `page.getAnnotations({ intent: "display" })`, maps each through
`mapPdfAnnotation` (`:510-547`):
```ts
const viewport = page.getViewport({ scale: PDF_DPI_FACTOR });          // NO rotation arg
const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annotation.rect);  // PDF rect → viewport px (y-flip here)
const left = Math.min(x1, x2);  const top = Math.min(y1, y2);
const width = Math.abs(x2 - x1); const height = Math.abs(y2 - y1);
```
**Y-flip + rotation are delegated to pdf.js's `convertToViewportRectangle` / `convertToViewportPoint`.**
PDF user-space has origin bottom-left (Y up); viewport space is top-left (Y down). Converting the raw
`/Rect` (and ink points) through the viewport applies the bottom-left→top-left flip and any intrinsic
page rotation — the consumer never writes a manual `h - y` flip for imported annotations (the manual
flip lives only in `packages/shared/src/coords.ts`, which imported annotations don't use).

**Ink import** (`mapInkPaths`, `:472-508`): reads `annotation.inkLists`, converts each point via
`viewport.convertToViewportPoint(x, y)` (falls back to `[x,y]`), then stores points relative to the
annotation box (`viewportPoint[0] - left`, `viewportPoint[1] - top`). Rendered as an SVG `<polyline>`
in a box-local `viewBox="0 0 width height"` with `vectorEffect="non-scaling-stroke"`
(`pdf-renderer.tsx:2555-2581`). Subtype switch on `annotation.subtype.toLowerCase() === "ink"`.

Imported annotations become editable overlay objects (`PdfImportedAnnotation`, `:151-171`):
`left/top/width/height` in natural-px plus `rotation` (starts 0, user-rotatable). The overlay
(`PdfImportedAnnotationOverlay`, `:2234-2721`) positions each at `left*userScale, top*userScale` inside
the page wrapper and applies `transform: rotate(${rotation}deg)` for USER-applied rotation (`:2550`).
Move/resize/rotate handles convert screen delta → local via `rect.width / width` scale factors
(`localDelta`, `:2289-2308`) — again `getBoundingClientRect`-based. Edit support per subtype
(`importedAnnotationEditSupport`, `:449-459`): FreeText/Text/Popup/Stamp text-editable; all
move/resizable. Color (`:440-447`), border width, flags carried as metadata.

### EmbedPDF arm — engine owns import; prototype PURGES baked annotations from the overlay

The PDFium engine parses embedded annotations natively and bakes them into the rendered page
(`withAnnotations: true`, `:1461-1469`). The prototype does NOT re-map them into a custom overlay.
On the annotation "loaded" event it purges synced (baked) annotations from the editable overlay so they
aren't double-drawn (`embedpdf-prototype.tsx:676-707`):
```ts
const bakedAnnotations = scope.getAnnotations().filter((a) => a.commitState === "synced");
for (const a of bakedAnnotations)
  scope.purgeAnnotation(a.object.pageIndex, String(a.object.id));
// logs "baked-pdf-annotations" { total, purgedFromOverlay }
```
So the EmbedPDF arm has **no manual Ink/y-flip mapping at all** — imported annotations are part of the
rasterized page image; the editable `AnnotationLayer` (`@embedpdf/plugin-annotation`) handles NEW
ink/highlight creation. The only custom overlay strokes are the prototype's own pen/highlight polylines
(§4), which are pointer-captured percent coords, not imported PDF annotations.

---

## What to copy into our two-arm prototype

**pdf.js arm:**
- Render each `<Page>` at a hi-res `rasterScale * (96/72)` bitmap inside an inner wrapper that
  CSS-downscales (`transform: scale(userScale/rasterScale)`) to a natural-size outer box; keep pages at
  `PAGE_LAYOUT_SCALE = 1` and let ONE outer `transform: scale()` zoom layer own all zoom.
- Do NOT pass rotation to `getViewport` for rendering — let pdf.js bake intrinsic `/Rotate`. Capture
  per-page `originalWidth/Height` from `onLoadSuccess` so mixed sizes self-size.
- Pin overlays via percent-of-page `left:${xPct*100}% / top:${yPct*100}%`, portalled INTO each
  `[data-page-key]` wrapper so they inherit the zoom transform. Screen→page via the wrapper's
  `getBoundingClientRect()` (post-transform), never `pageSize*scale`.
- Drag: convert screen dx/dy → pre-transform via `dx/zoom` for inline `left/top`; persist via
  `dx/rect.width` (rect already post-transform).
- Import annotations through `getAnnotations({intent:"display"})` + `viewport.convertToViewportRectangle`
  / `convertToViewportPoint` to get y-flip + rotation for free; render Ink as box-local SVG polylines
  with `vectorEffect="non-scaling-stroke"`.

**EmbedPDF arm:**
- Mount overlays inside `Scroller`'s `renderPage`, sized to `page.rotatedWidth/rotatedHeight` (engine's
  rotated layout box), using percent-of-box coords + `getBoundingClientRect`.
- Combine `documentPage.rotation + documentState.rotation` → `effectiveRotation`, pass into
  `renderPage({ options: { rotation } })`, and key the render cache on rotation.
- Purge engine-"synced" baked annotations from the editable overlay to avoid double-draw; let the engine
  bake imported annotations into the page image.

## File references
- Production renderer: `/tmp/walkthrough-ref/apps/web/src/components/viewer/pdf-renderer.tsx`
- Production viewer (zoom layer + nesting): `/tmp/walkthrough-ref/apps/web/src/components/viewer/walkthrough-viewer.tsx:1650-1706`
- Production renderer mount: `/tmp/walkthrough-ref/apps/web/src/components/viewer/asset-canvas.tsx`
- Pin percent coords + tap mapping: `/tmp/walkthrough-ref/apps/web/src/components/viewer/pin-layer/pin-coords.ts`
- Rotation-aware canonical math (off hot path): `/tmp/walkthrough-ref/packages/shared/src/coords.ts`
- Pin portal-into-wrapper: `/tmp/walkthrough-ref/apps/web/src/components/viewer/pin-layer/pin-layer.tsx:688-726`
- Pin positioning + drag/zoom: `/tmp/walkthrough-ref/apps/web/src/components/viewer/pin-layer/pin.tsx:140-168`
- Pin overlay: `/tmp/walkthrough-ref/apps/web/src/components/viewer/pin-layer/pin-overlay.tsx`
- EmbedPDF prototype (dev only): `/tmp/walkthrough-ref/apps/web/src/components/dev/embedpdf-prototype.tsx`
- EmbedPDF dev routes: `/tmp/walkthrough-ref/apps/web/src/app/dev/embedpdf/{sample,[id],asset/[assetId]}/page.tsx`
- pdf.js thumbnails/search: `/tmp/walkthrough-ref/apps/web/src/components/viewer/floor-rail.tsx:340-409`
