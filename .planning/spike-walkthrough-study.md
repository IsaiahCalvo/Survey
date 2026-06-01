# Spike: "Walkthrough" repo study — renderer + annotation-import

_Date: 2026-05-31. Read-only study. No changes made to our app._

## TL;DR — the named repo does not exist

`https://github.com/IsaiahCalvo/Walkthrough` returns **HTTP 404** in every casing
(`Walkthrough`, `walkthrough`, `WalkThrough`). The user `IsaiahCalvo` exists and has
exactly **4 public repos** — none named Walkthrough:

| Repo | Description | Size | Created | Relevance |
|------|-------------|------|---------|-----------|
| `Clip` | Windows clipboard app | — | — | none |
| `hermes-agent` | fork | — | — | none |
| **`Survey`** | "PDF Annotator" | ~120 MB | 2025-11-25 | **the full app — does annotation import** |
| **`takeoff`** | (no desc) "Takeoff — Plan Measurement Tool" | ~1 MB | 2026-05-27 | **the throwaway renderer prototype** |

Verification:
```
IsaiahCalvo/Walkthrough -> HTTP 404
IsaiahCalvo/walkthrough -> HTTP 404
IsaiahCalvo/WalkThrough -> HTTP 404
GET /users/IsaiahCalvo -> public_repos: 4  (Clip, hermes-agent, Survey, takeoff)
```

So "Walkthrough" is either private, renamed, or a mis-remembered name. The task's two
claimed capabilities are actually split across **two different repos**:

- **Multi-orientation / multi-size PDF rendering** with zoom-pinned overlay → lives in
  **`takeoff`** (the lightweight PDF.js prototype). This is the "throwaway renderer
  prototype" the task describes.
- **Importing the PDF's embedded annotations as interactive (selectable/editable)** →
  lives in **`Survey`** (the full Syncfusion/Fabric.js React app — i.e. the parent of
  *this* project). `takeoff` has **zero** embedded-annotation import.

Both findings are documented below since together they answer the brief.

---

## PART A — `takeoff`: rendering + rotation + mixed-size + zoom pinning

Plain ES modules under `src/app/*.js` (browser globals, see `docs/adr/0001-browser-global-modules.md`),
bundled by Vite. Only devDependency is `vite` — **no PDF lib in package.json**.

### A1. PDF engine: PDF.js 3.11.174 via CDN

`index.html`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
```
`src/main.js`:
```js
const pdfjsLib = window.pdfjsLib;
if (!pdfjsLib) throw new Error('PDF.js failed to load.');
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
```
Document load:
```js
await pdfjsLib.getDocument({ data: buf }).promise   // src/main.js ~L585
```

### A2. Per-page ROTATION (`/Rotate 90/180/270`) — handled implicitly by PDF.js

This is the crux and it is *deliberately simple*. `renderPageToCanvas` calls
`page.getViewport({ scale })` **without** passing a `rotation` option:

`src/main.js` `renderPageToCanvas` (~L639):
```js
async function renderPageToCanvas(pageNum, requestedScale = state.minPdfRenderScale) {
  const page = await state.pdf.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });          // rotation NOT passed
  const maxScaleForPage = Math.min(
    state.maxPdfRenderScale,
    state.maxPdfBitmapEdge / Math.max(baseViewport.width, baseViewport.height)
  );
  const renderScale = Math.max(state.minPdfRenderScale, Math.min(requestedScale, maxScaleForPage));
  const viewport_ = page.getViewport({ scale: renderScale });   // rotation still implicit
  const c = document.createElement('canvas');
  c.width  = Math.max(1, Math.ceil(viewport_.width));
  c.height = Math.max(1, Math.ceil(viewport_.height));
  await page.render({ canvasContext: c.getContext('2d'), viewport: viewport_ }).promise;
  return {
    canvas: c,
    cssWidth:  baseViewport.width,   // already rotation-corrected by PDF.js
    cssHeight: baseViewport.height,  // already rotation-corrected by PDF.js
    renderScale,
  };
}
```

Why this "just works":
- PDF.js `getViewport()` defaults `rotation` to the **page's own `/Rotate`** value. The
  returned `viewport.width/height` are *already swapped* for 90/270 pages and the
  viewport's internal transform rotates the rendered content. The canvas is sized from
  `viewport_.width/height`, so a landscape-rotated page produces a landscape canvas with
  upright content — no manual matrix math anywhere in the prototype.
- The CSS layout size (`cssWidth/cssHeight`) is taken from the **scale:1** viewport, again
  rotation-corrected, so DOM layout matches orientation automatically.

There is a *separate, user-facing* "Rotate" tool in the UI (`index.html` rotation pill /
`data-action="rotate"`, and `state.rotateModeId` / `createRotationFrame` in `main.js`),
but that rotates an individual **measurement annotation**, NOT the PDF page. Page `/Rotate`
is purely PDF.js-driven.

### A3. MIXED PAGE SIZES — per-page measured size, never `pageSize * scale`

Each page is rendered independently and its true rotated dimensions are read from its own
viewport (`baseViewport.width/height` above). For multi-page continuous view, a layout is
built that **center-aligns each page at its own width** and stacks with a gap:

`src/app/continuous-renderer.js` `buildContinuousPageLayout`:
```js
function buildContinuousPageLayout(entries, { pageGap = DEFAULT_PAGE_GAP } = {}) {
  const pages = [];
  const width = Math.max(...entries.map(e => e.cssWidth), 1);   // widest page sets stack width
  let y = 0;
  for (const entry of entries) {
    const x = (width - entry.cssWidth) / 2;                     // center each page horizontally
    pages.push({ page: entry.page, x, y, width: entry.cssWidth, height: entry.cssHeight });
    y += entry.cssHeight + pageGap;                             // stack by each page's own height
  }
  return { width, height: Math.max(1, y - pageGap), pageGap, pages };
}
```
So a doc mixing Letter-portrait, Letter-landscape, and 11×17 stacks correctly because every
`pageBox` carries that page's individual `width/height/x/y`. Hit-testing and measurement
placement use `stackPointToPagePoint` / `pagePointToStackPoint` against these per-page boxes.

### A4. ZOOM PINNING — single CSS transform on a `viewport` element + SVG `viewBox`

There is **no per-point rescaling** of annotations on zoom. The architecture:

1. One `#viewport` DOM element is sized to the page (or the continuous stack) in **CSS px**
   equal to the unscaled page size. Zoom/pan is applied as a single CSS transform on it:
   `src/main.js` `applyTransform`:
   ```js
   viewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
   ```
2. The annotation overlay is an **SVG whose `viewBox` equals the page size**, sized to the
   same CSS px as the page. Because it lives inside `#viewport`, it inherits the same
   `scale(zoom)` transform — annotations stay pinned for free:
   `src/main.js` `configureDrawCanvas`:
   ```js
   configureViewportCssSize(state.baseW, state.baseH);
   drawSvg.setAttribute('width', state.baseW);
   drawSvg.setAttribute('height', state.baseH);
   drawSvg.setAttribute('viewBox', `0 0 ${state.baseW} ${state.baseH}`);   // 1 SVG unit == 1 page px
   configureCanvasCssSize(drawSvg, state.baseW, state.baseH);
   ```
   Annotations are stored in **page-space coordinates** and drawn with those raw numbers
   (`svg-renderer.js` writes `x`/`y`/`d` directly). They scale with the page because the
   container scales. (This is the same "SVG viewBox owns all zoom scaling, zero JS zoom
   coordination" invariant our own CLAUDE.md enforces for `SVGAnnotationLayer.jsx`.)
3. Chrome that must stay a constant *screen* size (labels, dots, handle radii, stroke
   widths) is the only thing that compensates for zoom, via `overlayPageSize`:
   ```js
   function overlayScreenScale() {
     return Math.min(1.55, Math.max(0.38, Math.pow(Math.max(state.zoom, 0.05), 0.42)));
   }
   function overlayPageSize(screenPx) {              // screen px -> page units
     return (screenPx * overlayScreenScale()) / Math.max(state.zoom, 0.05);
   }
   ```
   Every dimension in `svg-renderer.js` (font size, padding, dot radius, stroke width) is
   wrapped in `overlayPageSize(...)` so it reads the same on screen at any zoom, while the
   *geometry* itself is plain page-space coordinates that scale with the viewBox.
4. Screen↔page mapping is **measured from the live rect, not computed from scale** — the
   same container-aware lesson in our CLAUDE.md:
   `src/app/viewer.js`:
   ```js
   function screenToImagePoint({ clientX, clientY, viewportRect, baseWidth, baseHeight }) {
     return {
       x: ((clientX - viewportRect.left) / viewportRect.width)  * baseWidth,
       y: ((clientY - viewportRect.top)  / viewportRect.height) * baseHeight,
     };
   }
   ```
   It divides by the *measured* `viewportRect.width/height` (a `getBoundingClientRect()`),
   so any DPR / browser-zoom mismatch cancels out.

### A5. Render-resolution strategy (bonus, relevant to "near-zero-lag zoom" north star)
- `pdf-page-cache.js` keeps an LRU of rendered page canvases keyed by page; `desiredRenderScale`
  targets `zoom * min(devicePixelRatio, 2)` capped by `maxBitmapEdge`. Zoom uses the cached
  bitmap immediately (CSS scale) and re-renders crisper in the background; pages are
  pre-rendered around the current page (`planPreRenderPages`).
- A `navToken` guards against stale async renders when the user navigates mid-render.

**Net for our prototype:** to render multi-orientation/multi-size pages correctly you do
*nothing special* — let PDF.js `getViewport()` apply `/Rotate`, size the canvas + CSS box +
SVG `viewBox` from that viewport, stack per-page boxes by their own measured width/height,
and pin annotations with a single CSS `scale()` on the container while compensating only the
constant-screen-size chrome via an `overlayPageSize`-style helper.

---

## PART B — `Survey`: importing embedded PDF annotations as interactive

`Survey` is the full app (React + Syncfusion + Fabric.js). Relevant deps:
`pdfjs-dist@3.11.174`, `pdf-lib@1.17.1`, `annotpdf`, `fabric@5.5.2`,
`@syncfusion/ej2-react-pdfviewer`. Import pipeline files:
`src/utils/pdfAnnotationImporter.js`, `src/utils/pdfAnnotationsPdfLib.js`,
`src/utils/pdfAnnotations.js`, plus the SVG/Fabric overlay layers
(`src/components/SVGAnnotationLayer.jsx`, `src/PageAnnotationLayer.jsx`).

### B1. Reading native annotations — pdf.js `getAnnotations()` (+ pdf-lib for raw dict fields)

`src/utils/pdfAnnotationImporter.js`:
```js
export async function extractAnnotationsFromPage(page) {
  try {
    const annotations = await page.getAnnotations();   // pdf.js high-level API
    return annotations;
  } catch (error) {
    console.error('Error extracting annotations from page:', error);
    return [];
  }
}
```
For raw dictionary fields pdf.js doesn't surface (interior color, fill opacity `ca`,
border-effect cloud intensity `/BE /I`, `/AP /N /Matrix`, app-owned metadata), it ALSO opens
the bytes with **pdf-lib** low-level API and walks `rawPdfDoc.getPages()` reading `PDFName`
keys (e.g. `dict.get(PDFName.of('FillOpacity'))`, dash arrays, border-effect dict). So:
**pdf.js for the annotation list + geometry, pdf-lib for raw dictionary recovery.**

Each annotation is then turned into a **Fabric.js object spec** by
`convertPdfAnnotationToFabric` and mounted on the per-page Fabric/SVG overlay, which makes
them selectable/movable/editable. Supported → editable subtypes:
```
Ink → Fabric Path | Highlight → Rect(fill) | FreeText → Textbox |
Square → Rect | Circle → Circle | Line/PolyLine/Polygon → Line/Polyline/Polygon |
Text/Underline/StrikeOut/Squiggly/Caret
```
Unsupported (Stamp, Link, Widget, Popup, FileAttachment, 3D, Redact, RichMedia…) are
**preserved but not imported** as editable (shown via `UnsupportedAnnotationsNotice.jsx`).

### B2. Coordinate mapping — PDF bottom-left origin → top-left overlay, rotation-aware

The importer prefers the **pdf.js viewport's own converters** (which bake in page rotation
AND the y-flip), with a manual `pageHeight - y` fallback:

`src/utils/pdfAnnotationImporter.js` (~L1655):
```js
// PDF coordinates have origin at bottom-left, Fabric.js at top-left
function convertPdfPointToViewport(x, y, viewport, scale = 1) {
  if (viewport && typeof viewport.convertToViewportPoint === 'function') {
    const [viewportX, viewportY] = viewport.convertToViewportPoint(x, y);  // rotation + flip baked in
    return { x: viewportX * scale, y: viewportY * scale };
  }
  const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 0;
  return { x: x * scale, y: (pageHeight - y) * scale };          // manual y-flip fallback
}

function convertPdfRectToViewportRect(rect, viewport, scale = 1) {
  let x1, y1, x2, y2;
  if (viewport && typeof viewport.convertToViewportRectangle === 'function') {
    [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);      // /Rect -> viewport rect
  } else {
    const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 0;
    x1 = rect[0]; y1 = pageHeight - rect[3];                           // flip top/bottom
    x2 = rect[2]; y2 = pageHeight - rect[1];
  }
  const left = Math.min(x1, x2) * scale, right = Math.max(x1, x2) * scale;
  const top  = Math.min(y1, y2) * scale, bottom = Math.max(y1, y2) * scale;
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}
```
Note the `* scale` and `Math.min/Math.max` normalization — `/Rect` corner order isn't
guaranteed, so it normalizes to top-left + width/height for Fabric placement.

### B3. Annotation-level rotation (rotated shapes/text) — recovered from `/AP /N /Matrix`

Beyond *page* rotation, individual shapes can be rotated by the authoring tool (Drawboard
etc.) by baking a rotation into the appearance-stream matrix while `/Rect` stays the
axis-aligned bounding box. `computeAppearanceRotationTransform` reads that matrix, converts
PDF's CCW-in-y-up angle into the on-screen (y-flipped) angle that matches Fabric's `angle`,
and emits the **un-rotated** `/BBox` width/height + a center-pivot placement:

`src/utils/pdfAnnotationImporter.js` (~L2486+):
```js
// θ in /AP /N /Matrix encodes a CCW rotation in PDF y-up space. Screen y is
// flipped, so on-screen rotation is the negative of that — matches Fabric's angle.
function computeAppearanceRotationTransform(annotation, scale = 1) { ... }
// callers:
const rotationTransform = computeAppearanceRotationTransform(annotation, scale);
const useRotation = !!rotationTransform;
const outWidth  = useRotation ? rotationTransform.bboxWidth  : viewportRect.width;
const outHeight = useRotation ? rotationTransform.bboxHeight : viewportRect.height;
// ... fabric spec gets { angle: rotationTransform.angleDeg } and a center-pivot left/top
```
If the matrix is identity/near-identity it falls back to the plain `/Rect` viewport rect.

### B4. Making them interactive + provenance, parity with internally-drawn shapes

- Each imported object is tagged with provenance metadata only — `isPdfImported: true`,
  `pdfAnnotationId`, `pdfAnnotationType` — which **must not gate rendering/editing behavior**.
- Imported Ink is normalized to be *field-for-field identical* to an internally-drawn pen
  stroke (`makeInternalPenPathSpec`), including intentionally **omitting `strokeUniform`**,
  because a mismatch there made the SVG renderer emit `vectorEffect="non-scaling-stroke"`
  on imports only, producing a visible hairline split at 200% zoom. (Mirrors our own
  CLAUDE.md gotchas about SVG vs canvas stroke behavior.)
- `left/top/width/height` are written explicitly onto the Fabric spec so Fabric's resize
  handler doesn't re-derive `left` from path bounds and double-apply the offset.
- The objects are mounted on the per-page Fabric/SVG overlay → selectable, movable,
  editable, erasable like any user-drawn annotation. Export back to PDF goes through
  `pdfAnnotationsPdfLib.js` (pdf-lib low-level, PDF 1.7 spec) — edited imported copies are
  re-exported and the original native copy removed to avoid duplicates.

### B5. Pinning through zoom in Survey (same contract as `takeoff`)
Survey's `SVGAnnotationLayer.jsx` uses `viewBox="0 0 pageWidth pageHeight"` and lets the SVG
viewBox own all zoom scaling (no JS zoom coordination) — identical philosophy to `takeoff`.
Canvas-based tools (pen/eraser/edit, Fabric) use a `zoomGeneration` signal to auto-commit
before the container resizes. (These are documented invariants in this project's CLAUDE.md.)

---

## What to replicate in our throwaway renderer prototype

1. **Engine:** PDF.js (`pdfjs-dist`, or CDN global). `getDocument` → `getPage` → `getViewport`.
2. **Rotation:** do nothing manual — call `page.getViewport({ scale })` and let it apply
   `/Rotate`. Size canvas + CSS box + SVG `viewBox` from `viewport.width/height`.
3. **Mixed sizes:** render each page independently; build a per-page layout where every
   page box stores its own measured width/height/x/y; center-align by widest page; stack
   by each page's own height + a gap.
4. **Pinning:** one container element, page-space coordinates for annotations, a single CSS
   `transform: scale(zoom)` on the container, SVG `viewBox` == page size. Compensate only
   constant-screen-size chrome via an `overlayPageSize(screenPx)` helper.
   Screen↔page mapping divides by the **measured** `getBoundingClientRect()`, never `pageSize*scale`.
5. **Annotation import (if needed):** `page.getAnnotations()` for the list + geometry;
   `viewport.convertToViewportPoint` / `convertToViewportRectangle` to map PDF bottom-left
   `/Rect` and points into top-left overlay space (rotation + flip free); pdf-lib low-level
   to recover raw dict fields (fill opacity, `/AP /N /Matrix`, border effects); read shape
   rotation from `/AP /N /Matrix` and convert to a y-flipped Fabric-style `angle` with the
   un-rotated `/BBox` size; mount as Fabric/SVG objects tagged `isPdfImported` (provenance
   only — never gate behavior on it).

## Source links (raw)
- takeoff index.html: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/index.html
- takeoff main.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/main.js
- takeoff continuous-renderer.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/app/continuous-renderer.js
- takeoff svg-renderer.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/app/svg-renderer.js
- takeoff viewer.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/app/viewer.js
- takeoff pdf-page-cache.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/app/pdf-page-cache.js
- takeoff document-adapters.js: https://raw.githubusercontent.com/IsaiahCalvo/takeoff/main/src/app/document-adapters.js
- Survey pdfAnnotationImporter.js: https://raw.githubusercontent.com/IsaiahCalvo/Survey/main/src/utils/pdfAnnotationImporter.js
- Survey pdfAnnotationsPdfLib.js: https://raw.githubusercontent.com/IsaiahCalvo/Survey/main/src/utils/pdfAnnotationsPdfLib.js
- Survey package.json: https://raw.githubusercontent.com/IsaiahCalvo/Survey/main/package.json
