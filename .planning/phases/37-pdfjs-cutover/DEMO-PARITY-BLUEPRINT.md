# Phase 37 — pdf.js Cutover: Demo-Parity Blueprint

> Executable build plan for a fresh Claude Code session. Make the **real app's pdf.js engine** match the **proven demo** feature-by-feature. Each section is concrete enough to implement without re-discovery. All file:line citations are verified against the live tree (2026-06-02).

## Goal

Make the pdf.js engine in the real app reach full parity with the throwaway demo (`?spike=features`): annotations that stay **glued to the page during a live zoom gesture**, working text search / selection / copy, clickable links, interactive form fields, and bookmarks — every layer as smooth as the demo. The headline blocker is glued-during-zoom annotations; once that foundation lands, the other overlay layers (links, forms, text, search highlights) ride it for free.

## Reference map (trust these)

- **Demo renderer** (gold standard): `src/prototype/PdfjsArm.jsx`. Final demo mount: `src/prototype/FeatureSpike.jsx`.
- **App renderer**: `src/components/PdfjsViewerContainer.jsx`. App overlay host + portal loop: `src/PDFViewer.jsx`.
- **Engine selector** (wires both engines to `syncfusionViewerRef`): `src/components/PDFViewerEngineSelector.jsx`.
- **Engine gate** (the ONLY real gate): `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS` from `src/viewerShared.js`.
- App pdf.js layers already exist: `src/components/PdfjsLinkLayer.jsx`, `src/components/PdfjsFormLayer.jsx`. Search panel: `src/sidebar/SearchTextPanel.jsx`. Outline util: `src/utils/bookmarkOutline.js`.

**WHY the demo is glued and the app is not (the entire root cause):** In `PdfjsArm.jsx` the page canvas AND every annotation layer (InteractiveOverlay, SpikeFormLayer, SpikeLinkLayer, SpikeTextLayer) are all children of **one wrapper div** that receives `transform: scale(liveZoom)` with `transformOrigin` at the cursor's content point during a ctrl/meta wheel gesture (`PdfjsArm.jsx` ~628–694). The whole stack scales as one rigid unit per frame, then commits the real scale + re-rasters on settle (~110ms) and resets `liveZoom` to 1. In the **app**, `PdfjsViewerContainer.jsx` transforms only its own `contentRef` div (`PdfjsViewerContainer.jsx:786,790`); the app's per-page annotation overlay portals live in `PDFViewer.jsx`, attached to a stable host **outside** `contentRef`. During a gesture the page scales but the overlay does not — it only re-pins on settle (snap). That is "annotations don't stay glued."

**ALREADY DONE this session:** `performSyncfusionCursorWheelZoom` in `PDFViewer.jsx:4699` early-returns when `getPDFViewerEngine()===pdfjs` BEFORE `preventDefault`/`stopPropagation`, so the engine's own native smooth wheel zoom now fires. This unblocks the "ride the engine live-zoom transform" approach — it previously failed only because the engine's wheel gesture never ran.

---

## Current status matrix

| Feature | Status | One-line gap |
|---|---|---|
| **Glued zoom** (overlay tracks live CSS transform) | partial | Page scales during gesture; overlay portals sit outside `contentRef` and snap only on settle. |
| **Text search + select/copy** | partial | Search panel + navigation work; no selectable text layer exists under pdf.js; highlights don't ride the gesture. |
| **Clickable links** | broken | Portal gate skips clean pages → `PdfjsLinkLayer` often never mounts; also drifts during gesture. |
| **Form fields** (text/checkbox/radio) | partial | Render + persist work; inputs drift away from page during live gesture; pure-form pages may get no portal. |
| **Bookmarks** (outline + jump) | partial | Extraction + jump work end-to-end; a redundant 3200ms fallback timer double-extracts under pdf.js. |
| **Zoom feel / perf** (gain, settle, DetailTile, anchoring) | partial | Math is byte-for-byte at parity; only gap is the overlay not riding the live transform (= glued-zoom). |

> Statuses preserved from the per-feature audit. "Zoom feel" and "Glued zoom" are two faces of the same single defect; fixing glued zoom closes the only remaining zoom-feel gap.

---

## THE headline task — Glued zoom

This is the foundation. Every other overlay layer (links, forms, text layer, search highlights) rides this fix. Implement it first.

### Strategy decision: B (live-transform ride), not A (re-parent)

- **Strategy A (re-parent overlay inside `contentRef`)** is the demo's literal architecture but is **rejected** for the app: it would require PDFViewer to mount React portals into DOM nodes inside the engine's virtualized scroll container. The engine range-gates pages (children come and go); the overlay portal loop in PDFViewer is a separate render cycle with its own page filtering. Re-parenting couples two independent virtualization windows, risks z-order conflicts with the engine's own layers (PdfPageCanvas, DetailTile), and requires structural edits to the per-page overlay portal render loop — a **hard CLAUDE.md invariant forbids** structurally editing that loop.
- **Strategy B (emit a per-frame live-zoom signal; PDFViewer imperatively applies a matching CSS transform to each mounted overlay div, clearing on settle)** keeps the DOM structure entirely intact, adds only a lightweight imperative path, and mirrors the existing `syncfusionOverlayContentRefs` + `zoomOverlayTransformActiveRef` pattern already used for Syncfusion zoom transitions. **Choose B.**

### The emit/consume contract (exact)

**Engine side — `src/components/PdfjsViewerContainer.jsx`:**

The engine already fires `onZoomPhase('gesture-start', { atPct })` once at the first wheel tick (`PdfjsViewerContainer.jsx:546` and `:593`). It does NOT yet fire a per-frame event. Add two emissions:

1. **Per-frame "live"** — in `applyWheelZoom` (`PdfjsViewerContainer.jsx:560`), immediately after `setLiveZoom(liveZoomRef.current)` (line 562):
   ```js
   cb.current.onZoomPhase?.('live', {
     liveZoom: liveZoomRef.current,
     originContentX: gestureRef.current?.originContentX ?? 0,
     originContentY: gestureRef.current?.originContentY ?? 0,
   });
   ```
   This runs inside the rAF callback, once per animation frame during the gesture. `gestureRef.current` is set once at gesture-start (`PdfjsViewerContainer.jsx:585–588`, where `originContentX = el.scrollLeft + cursorX`) and never mutates during the gesture, so the origin is stable.

2. **"settle"** — in `commitGesture` (`PdfjsViewerContainer.jsx:565`), BEFORE `setLiveZoom(1)` (lines 570/572):
   ```js
   cb.current.onZoomPhase?.('settle', {});
   ```

> `onZoomPhase` is already a declared prop (`PdfjsViewerContainer.jsx:274`, destructured at `:330`) and is already wired through `PDFViewerEngineSelector` to `handlePdfjsZoomPhase` (`PDFViewer.jsx:25219`). No new prop plumbing is required — extend the existing channel with the `'live'` and `'settle'` phase names.

**Consumer side — `src/PDFViewer.jsx`, `handlePdfjsZoomPhase` (`PDFViewer.jsx:1819`):**

Current body (verified):
```js
const handlePdfjsZoomPhase = useCallback((phase) => {
  if (getPDFViewerEngine() !== PDF_VIEWER_ENGINE_PDFJS) return;
  if (phase === 'gesture-start') setZoomGeneration((prev) => prev + 1);
}, []);
```
Note: the callback currently receives only `phase`. **Change the signature to `(phase, payload)`** and extend:

- **On `'gesture-start'`** — keep `setZoomGeneration((prev) => prev + 1)` exactly as is. **Do not remove this** (hard invariant: Canvas tools auto-commit on this bump).
- **On `'live'`** — read `overlayDivsRef.current` (the per-page overlay div map, `PDFViewer.jsx:316`). For each connected `overlayDiv`, compute the gesture origin in the **overlay's own coordinate space** (see math below), then imperatively set:
  ```js
  overlayDiv.style.transform = `scale(${liveZoom})`;
  overlayDiv.style.transformOrigin = `${originX_inOverlay}px ${originY_inOverlay}px`;
  overlayDiv.style.willChange = 'transform';
  ```
  **Imperative DOM writes only — no React `setState` in this branch** (it runs at 60fps; any state update doubles render cost per frame).
- **On `'settle'`** — for each `overlayDiv`, clear:
  ```js
  overlayDiv.style.transform = '';
  overlayDiv.style.transformOrigin = '';
  overlayDiv.style.willChange = '';
  ```
  Then re-pin: call `attachOverlayToPageDiv(pageNumber)` for each mounted page (it already re-measures via `getBoundingClientRect` deltas, `PdfjsViewerContainer`-driven `onPageContainersChange` also fires this on the settled layout). The explicit call guarantees a re-pin even if the container map didn't change.

### Coordinate-space handling (the critical part)

The engine applies `transform: scale(liveZoom)` with `transformOrigin: ${originContentX}px ${originContentY}px` on `contentRef` (`PdfjsViewerContainer.jsx:786–790`). `originContentX = scrollerEl.scrollLeft + cursorX`, where `cursorX = event.clientX - scrollerEl.getBoundingClientRect().left` — a point in **content layout space** (pre-transform).

The overlay divs are positioned in the **overlayRoot's** coordinate space (overlayRoot is appended to `stableViewerHost`, the outer `div[data-testid="pdf-container"]`, via `attachOverlayToPageDiv`, `PDFViewer.jsx:5730`; `overlayDiv.style.left/top` are set as `pageRect.left - rootRect.left` / `pageRect.top - rootRect.top`, `PDFViewer.jsx:5798–5810`). What we need: apply `scale(liveZoom)` to each overlayDiv about the **same fixed screen point** the engine uses — the cursor `(event.clientX, event.clientY)`.

In each overlayDiv's coordinate space (relative to overlayRoot, which is `position:absolute; top:0; left:0` inside `stableViewerHost`, a non-scrolling container), the cursor maps to:

```
originX_inOverlay = clientX - overlayRoot.getBoundingClientRect().left
originY_inOverlay = clientY - overlayRoot.getBoundingClientRect().top
```

Because the engine's `originContentX = scrollerEl.scrollLeft + (clientX - scrollerRect.left)`, you can equivalently derive `clientX` from the payload:
```
clientX = originContentX - scrollerEl.scrollLeft + scrollerRect.left
```
But it is simpler and less error-prone to compute `originX_inOverlay` **once at the first `'live'` tick** from the cached `scrollerRect` and `overlayRootRect`, cache it (keyed on the overlayDiv node, e.g. a module-level `WeakMap` or a `useRef`-held `Map`), and reuse the same value every frame for the rest of the gesture (the origin is fixed). Recompute on the next `'gesture-start'`.

> **Layout assumption to verify in-browser (Electron especially):** `overlayRoot.getBoundingClientRect().left` and `scrollerEl.getBoundingClientRect().left` should be identical (both are `position:absolute` inside the same outer container). Measure both independently before trusting the simplification — an off-by-one in which rect is subtracted produces a parallax slip rather than a locked glue. The Electron zoom factor is the known source of such mismatches.

### Settle/clear without a visible jump

The jump risk: clearing the overlay transform before the engine's committed layout is in place would briefly show the overlay at the wrong position. Sequence:

1. `commitGesture` emits `'settle'` → PDFViewer clears the transform. At `liveZoom → 1` the transform is identity, so clearing it is visually a no-op.
2. `commitGesture` then calls `applyAnchoredScale` → `setScale` → React re-render → `useLayoutEffect` scroll anchor → engine's `useEffect` on `[range, numPages, scale]` (`PdfjsViewerContainer.jsx:649–668`) fires `onPageContainersChange` → PDFViewer's handler re-pins overlayDivs to the new committed layout (PDFViewer already calls `attachOverlayToPageDiv` there).
3. To eliminate the one-render-cycle (~16ms) window where the overlay is at `scale(1)` but still at pre-gesture pixel size, **call `attachOverlayToPageDiv(pageNumber)` synchronously inside the `'settle'` branch** rather than waiting for `onPageContainersChange`.

### Files to touch (glued zoom)

| File | Change |
|---|---|
| `src/components/PdfjsViewerContainer.jsx` | In `applyWheelZoom` (~`:562`) after `setLiveZoom`, emit `onZoomPhase('live', {liveZoom, originContentX, originContentY})`. In `commitGesture` (~`:570`) before `setLiveZoom(1)`, emit `onZoomPhase('settle', {})`. |
| `src/PDFViewer.jsx` | Extend `handlePdfjsZoomPhase` (`:1819`) to `(phase, payload)`. Keep `gesture-start` → `zoomGeneration` bump. Add `'live'` branch: iterate `overlayDivsRef.current`, compute cached overlay-space origin, imperatively set transform/transformOrigin/willChange. Add `'settle'` branch: clear those styles and call `attachOverlayToPageDiv(pageNumber)` per mounted page. Gate every new line on `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS`. |

### Risks (glued zoom)

- **Coordinate error:** overlay origin must be relative to `overlayRoot`, not the scroller. Verify both rects' `.left`/`.top` are equal in the real layout (Electron zoom factor may break this).
- **No React state in `'live'`:** any `setState` schedules a 2nd re-render per frame at 60fps. Use only imperative DOM writes (model: `syncfusionOverlayContentRefs`).
- **Settle race:** clear transform first (identity at `liveZoom→1`, no visible jump), then re-pin synchronously via `attachOverlayToPageDiv` so there's no stale-size window.
- **`zoomGeneration` bump preserved:** fires on `'gesture-start'`; that branch is untouched — Canvas tools still auto-commit.
- **Per-frame cost:** the overlay loop typically holds 1–5 connected divs (the portal loop filters to in-window pages). Guard the iteration with `isConnected`. Profile on the 36-page package doc.

---

## Feature: Text search + selection/copy + search highlight

### Current state

Three sub-features, three states under pdf.js:

- **Text selection/copy — MISSING.** The app imports `TextLayer` from `src/TextLayer.jsx` (`PDFViewer.jsx:41`) but it is mounted only in the `else` branch of `useSyncfusionRenderer ? … : …`. `useSyncfusionRenderer` is hard-coded `true` (`PDFViewer.jsx:819`), so that branch is **unreachable dead code** — no selectable text layer ever mounts under pdf.js. Even if reached, `TextLayer.jsx` uses a div-level `transform: scale()` (`TextLayer.jsx:58–60`) and manual point-space span positioning that never calls `pdfjsLib.renderTextLayer`, so glyphs diverge from the canvas raster.
- **Find-in-document panel — PARTIALLY WORKS.** `SearchTextPanel.jsx` is wired; PDFViewer publishes `pdfDoc`, `numPages`, `onNavigateToMatch`, `onFindTextMatches`, etc. to the left-rail API (`PDFViewer.jsx:24285–24377`). It owns its own pdf.js `page.getTextContent()` extraction loop (`SearchTextPanel.jsx:1200–1253`), so it works regardless of engine. `handleFindTextMatches` (`PDFViewer.jsx:18735`) also calls `syncfusionViewerRef?.findTextAsync`, a safe no-op stub under pdf.js (`PdfjsViewerContainer.jsx:748` → `async () => null`). `SearchHighlightLayer` IS mounted under pdf.js (`PDFViewer.jsx:25526`, `fillContainer` at `:25535`, gated on `getPDFViewerEngine()===PDF_VIEWER_ENGINE_PDFJS`) and renders SVG rects via `viewBox`.
- **Match navigation — WORKS.** `navigateToMatch` (`PDFViewer.jsx:18499`) has a pdfjs branch calling `goToPage` + `centerPageBoundsInViewer`. `handleClearTextSearch` (`PDFViewer.jsx:18753`) calls `cancelTextSearch`, a safe no-op stub (`PdfjsViewerContainer.jsx:752`).

### The gaps

- **GAP 1 — No selectable text layer.** Nothing equivalent to the demo's `SpikeTextLayer` (which correctly uses `renderTextLayer` + `--scale-factor`) exists in the production pdf.js path.
- **GAP 2 — Search highlights don't ride the live gesture.** `SearchHighlightLayer` mounts into the stable per-page overlay div (outside `contentRef`), so highlights mis-position by the live-zoom delta until settle. Same root cause as glued zoom; closed by the headline fix.
- **GAP 3 (minor, no action) — Syncfusion-only geometry fallback.** `handleFindTextMatches` tries `findTextAsync` for native bounding boxes; under pdf.js the stub returns null and SearchTextPanel falls back to its own correct pdf.js geometry. Dead path only.

### Ordered implementation steps

1. **Create `src/components/PdfjsTextLayer.jsx`** modeled exactly on `src/prototype/SpikeTextLayer.jsx`. Props `{ pdf, pageNumber, scale, rotation }`. Call `pdf.getPage(pageNumber)` → `page.getTextContent()` → `pdfjsLib.renderTextLayer({ textContentSource, container, viewport, textDivs: [] })`. Set `el.style.setProperty('--scale-factor', String(scale))` **before** `renderTextLayer`. Inject transparent-color + `user-select:text` + `::selection` styles via a `<style>` on mount (exactly as `PdfjsArm.jsx:587–607`). Class name `pdfjsTextLayer`. **Do NOT** use a div-level CSS scale transform — `renderTextLayer` positions via `--scale-factor`. No `searchQuery` prop (production separates highlighting into `SearchHighlightLayer`).
2. **Mount it** in the per-page portal loop in `PDFViewer.jsx`, immediately after the `PdfjsLinkLayer` block (~`:25547`), gated on `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS && pdfDoc`. Pass `pageNumber`, `pdf={pdfDoc}`, `scale={layerScale}`, `rotation={0}`. Import `PdfjsTextLayer` at the top of the file.
3. **Glued zoom for free:** because it mounts inside the same overlayDiv as the other layers, the headline glued-zoom fix carries it through the gesture automatically. No per-component work.
4. **Verify navigation geometry:** confirm `navigateToMatch` (`PDFViewer.jsx:18499`+) calls the pdfjs `goToPage` (`PdfjsViewerContainer.jsx:627`) and that `centerPageBoundsInViewer` resolves the page host via `getPageContainer` and uses committed `layerScale`, not a Syncfusion zoom percent.
5. **Verify `pdfSearchDocumentKey`** resolves under pdf.js — if it derives only from a Syncfusion doc id, add a pdf.js path deriving the key from `pdfDoc.fingerprints` so SearchTextPanel doesn't reset its cache on every re-reference.

### Files to touch

| File | Change |
|---|---|
| `src/components/PdfjsTextLayer.jsx` | **CREATE.** Port `SpikeTextLayer.jsx`: `renderTextLayer` + `--scale-factor` + transparent/selectable styles. Class `pdfjsTextLayer`. |
| `src/PDFViewer.jsx` | Import + mount `PdfjsTextLayer` after the `PdfjsLinkLayer` block (~`:25547`), gated on pdfjs engine + `pdfDoc`. Verify `pdfSearchDocumentKey` derivation. |

### Risks

- Without the glued-zoom fix, text spans lag during a gesture (acceptable — users select only when settled; the headline fix closes it anyway).
- `pdfjs-dist` version must match between `SpikeTextLayer` and `PdfjsTextLayer` (the `renderTextLayer` API shape changed across 3.x — `textDivProperties` WeakMap). Check `package.json`.
- `pdfSearchDocumentKey`: if Syncfusion-only, derive from `pdfDoc.fingerprints` under pdf.js.

---

## Feature: Clickable PDF links

### Current state

`PdfjsLinkLayer.jsx` exists, imported at `PDFViewer.jsx:36`, mounted in the portal loop at `PDFViewer.jsx:25539`, gated on `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS && pdfDoc`. It uses %-based positioning (`PdfjsLinkLayer.jsx:51–57`) — geometrically correct at committed scale. Internal nav → `onInternalNavigate` → `goToPage`; external → `electronAPI.openExternal` with `window.open` fallback.

### The gaps

- **GAP 1 (most severe) — render gap.** The portal loop filter (`PDFViewer.jsx` ~`:25274–25293`) requires a page to have app-layer annotations / Survey Markers / regions / search results before a portal is created. A page with **only PDF link annotations** passes none of these → no portal → `PdfjsLinkLayer` never mounts. Broken for any document opened without pre-existing app annotations. The demo has no such gate — every visible page gets all layers.
- **GAP 2 — zoom alignment.** The overlay div lives outside `contentRef` (appended to `stableViewerHost` via `attachOverlayToPageDiv`, `PDFViewer.jsx:5730`), so link hotspots drift during a gesture and snap on settle. Same root cause; closed by the headline glued-zoom fix.

### Ordered implementation steps

1. **Fix the portal gate.** In the portal loop filter (`PDFViewer.jsx` ~`:25276`), add a short-circuit **before** the annotation-content checks: if `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS` and `syncfusionPageContainers[pageNumber]?.isConnected`, return `true` unconditionally. `syncfusionPageContainers` is populated by `onPageContainersChange` from the engine (`PdfjsViewerContainer.jsx:666`) for every live page host. Place it after the `shouldShowPage` check / region early-return but before `toolNeedsCanvas` and annotation checks.
2. **Glued zoom:** the headline fix makes link hotspots ride the gesture (the overlayDiv they live in gets the live transform). No per-component change.
3. **Verify** with a links-only PDF on a clean page: links render, clicking navigates / opens, zooming does not drift.

> The %-coordinate model means **no coordinate recalculation** is needed: `PdfjsLinkLayer` boxes are % of the overlayDiv's size, which equals the page's CSS size, whether or not the overlayDiv is transformed.

### Files to touch

| File | Change |
|---|---|
| `src/PDFViewer.jsx` | Portal filter (~`:25276`): short-circuit `return true` for pdf.js pages present in `syncfusionPageContainers` before annotation-content checks. |
| `src/components/PdfjsLinkLayer.jsx` | No functional change. Optional clarifying comment that % positioning rides the host overlayDiv transform for free. |

### Risks

- Widening the gate mounts portals on every in-window pdf.js page. The render window is small (2–3 pages each side), so React reconciliation cost is modest; link layers are lightweight.
- Syncfusion path unchanged — the short-circuit checks the engine first.
- If a page is in `syncfusionPageContainers` but the engine re-virtualizes it, `overlayDiv` could detach; the existing `overlayDiv.isConnected` guards in `attachOverlayToPageDiv` cover this — re-verify after the change.
- Do not change the `.e-pv-page-div` className or `data-page-number` attribute the engine emits — `resolveSyncfusionLivePageHost` depends on them.

---

## Feature: Interactive form fields (text / checkbox / radio)

### Current state

`PdfjsFormLayer.jsx` is a solid promotion of `SpikeFormLayer`:

- **Render — WORKS.** Builds pdf.js `AnnotationLayer` with `renderForms: true`, wires `input`/`change`/`focus`/`blur`, seeds `annotationStorage` with `persistedValues`, and a ResizeObserver (`PdfjsFormLayer.jsx:227`) syncs `--scale-factor` from `host.offsetWidth / pageWidthPoints` on resize.
- **Persist — WORKS.** `onFieldChange`/`onFieldBlur` → `handlePdfjsFormFieldChange` → encodes `type:'form-field'` annotations through the Yjs/Supabase pipeline (`PDFViewer.jsx` ~`:21150`). Persisted values return as `pageFormFieldValues` (`PDFViewer.jsx` ~`:25319`) → `persistedValues`; late-hydration handled by `PdfjsFormLayer.jsx:249–262`.
- **Zoom alignment — BROKEN during live gesture.** Same root cause: `PdfjsFormLayer` mounts inside the React portal that writes into `overlayDiv` (`PDFViewer.jsx` ~`:25547`), and `overlayDiv` is a sibling/cousin of `contentRef`, not a descendant — so inputs stay frozen at pre-gesture pixel positions while the page scales. The ResizeObserver recovers width/height on settle but cannot track a per-frame CSS transform on a sibling.
- **Portal visibility issue.** Pure-form-field pages (no user annotations) in pan mode may not pass the portal filter (`PDFViewer.jsx:25274–25294`) and get no `PdfjsFormLayer`.

### The gap

The demo's form layer is INSIDE `contentRef`'s subtree and rides the live transform for free. The app's is OUTSIDE in a separately positioned `overlayDiv` repositioned only on settle.

### Ordered implementation steps

1. **Glued zoom (the headline fix) closes the alignment gap.** Because `PdfjsFormLayer` is `position:absolute; inset:0` inside `overlayDiv`, applying the live transform to `overlayDiv` carries the inputs automatically. **No change to `PdfjsFormLayer` itself.** The ResizeObserver still handles `--scale-factor` re-sync on the committed settle.
2. **Fix portal visibility** for pure-form pages: this is the **same one-line portal-gate short-circuit** as the links fix — include any pdf.js page present in `syncfusionPageContainers` regardless of annotation content. Apply once; it covers links and forms together.
3. **Verify** the ResizeObserver fires after settle (it observes `host.offsetWidth`, which changes when `commitGesture → setScale → reflow`). No change needed.

> The audit's Approach A (per-frame `transform` directly on each overlayDiv) is **exactly the headline glued-zoom fix** — do not implement a second, form-specific mechanism. One imperative transform path serves forms, links, text, and search highlights.

### Files to touch

| File | Change |
|---|---|
| `src/PDFViewer.jsx` | Covered by the headline glued-zoom fix (overlayDiv live transform) + the shared portal-gate short-circuit. No form-specific code. |
| `src/components/PdfjsFormLayer.jsx` | No structural change. Optional comment: live-zoom ride is handled by the overlayDiv transform in PDFViewer; ResizeObserver (`:227`) handles `--scale-factor` on settle. |

### Risks

- Widening the portal filter mounts `PdfjsFormLayer` on every in-window page; harmless (returns early with no widgets if the page has none) but grows the React tree. Gate on form-bearing pages only if profiling shows cost.
- Transform-origin arithmetic must use overlay coordinate space (covered in the glued-zoom math).
- `zoomGeneration` bump on gesture-start must remain (hard invariant).

---

## Feature: Bookmarks (outline extraction + jump-to-page)

### Current state — WORKS end-to-end

`PdfjsViewerContainer.jsx:385–388` calls `extractPdfOutlineBookmarks(pdf)` in the load effect and fires `onPDFBookmarksAvailable(outline)` → `handlePDFBookmarksAvailable` (`PDFViewer.jsx:10909`) stores `pdfBookmarks` → effect (`PDFViewer.jsx:10925`+) calls `importPdfBookmarksIntoSidebar` (`PDFViewer.jsx:10703`) which merges + dedupes by `sourceId`/`outlinePath`. `BookmarksPanel` renders the tree; click → `onNavigateToPage` → `goToPage` → (because `useSyncfusionRenderer===true`) the Syncfusion branch → `syncfusionViewerRef.current.goToPage(page)`, which under pdf.js IS `PdfjsViewerContainer.goToPage` (`PdfjsViewerContainer.jsx:627`, does `el.scrollTop = tops[i] - PAD`). Jump works.

### The gap (minor)

A 3200ms fallback timer (`PDFViewer.jsx:17264–17298`, verified) fires a **second** `extractPdfOutlineBookmarks(pdfDoc)` using the legacy `pdfDoc` state. Under pdf.js the engine callback already populated `pdfBookmarks`, so the timer's `setPdfBookmarks` guard (`if (prev.length > 0) return prev`) usually skips it — but it's redundant work that should be engine-aware.

### Ordered implementation steps

1. At the top of the fallback-timer effect (`PDFViewer.jsx:17264`), add: `if (getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS) return undefined;`. `getPDFViewerEngine` and `PDF_VIEWER_ENGINE_PDFJS` are **already imported** (~`PDFViewer.jsx:198–199`) — no new dependency. Under Syncfusion the fallback remains as-is.
2. No navigation change — already correct.

### Files to touch

| File | Change |
|---|---|
| `src/PDFViewer.jsx` | Fallback-timer effect (`:17264`): early-return under pdf.js to skip the redundant 3200ms extraction. |

### Risks

- Trivial; the guard uses already-imported symbols. Confirm the engine callback path stays the sole extractor under pdf.js.

---

## Feature: Zoom feel / perf (gain, settle, DetailTile, anchoring)

### Current state — at parity except glued zoom

Constants are byte-for-byte identical to the demo (`PdfjsViewerContainer.jsx:51–54`): `BASE_MAX_SCALE=2.5`, `SETTLE_MS=110`, `WHEEL_GAIN=0.01`, `DPR=min(devicePixelRatio,2)`. The wheel handler, rAF throttle, 110ms settle timer, `commitGesture`, `applyAnchoredScale` cursor-anchored scroll correction, `PdfPageCanvas`, and `DetailTile` deep-zoom tiling are all ported faithfully. `onZoomPhase('gesture-start')` correctly bumps `zoomGeneration` (`handlePdfjsZoomPhase`, `PDFViewer.jsx:1819`).

### The gap

The **only** gap is the annotation overlay not riding the live-zoom CSS transform — i.e. the headline glued-zoom defect. (`DetailTile` has no `onRasterEvent` forwarded in the app engine — cosmetic only, no action.)

### Implementation

Closed entirely by **THE headline task — Glued zoom** above. No separate work.

### Files to touch

Same as glued zoom (`PdfjsViewerContainer.jsx`, `PDFViewer.jsx`).

### Risks

Same as glued zoom; plus verify `SVGAnnotationLayer`'s `viewBox` invariant survives the wrapper transform (it uses `viewBox="0 0 pageW pageH"` + CSS width/height, so it scales cleanly — do not add conflicting explicit width/height).

---

## Build order

Do glued zoom first — it is the foundation every overlay layer rides. Then the cheap render-gate / bookmark cleanups, then the new text layer.

| # | Task | Why this order | Effort |
|---|---|---|---|
| 1 | **Glued zoom** (headline live-transform ride) | Foundation: links, forms, text, search highlights all ride the overlayDiv transform once this lands. Closes the zoom-feel gap too. | **M** |
| 2 | **Portal-gate short-circuit** (links + forms render on clean/form-only pages) | One ~3-line change unblocks both links (broken) and form-only-page visibility. Pairs naturally with #1's overlayDiv work. | **S** |
| 3 | **Bookmarks fallback-timer guard** | One-line, already-imported symbols; removes redundant double-extraction. Independent, low-risk. | **S** |
| 4 | **PdfjsTextLayer** (selectable text + copy) | New component + one mount; rides glued zoom from #1 for free. Largest net-new surface. | **M** |
| 5 | **Verification pass** (search nav geometry, `pdfSearchDocumentKey`, in-browser coordinate check) | Confirm parity across all features end-to-end. | **S** |

**Net effort:** glued zoom (M) + text layer (M) are the two real bodies of work; everything else is S. The audit rated each headline feature **M**; the render-gate and bookmark fixes are **S** subtasks.

---

## Hard invariants / do-not-break

These bind regardless of the standing high-risk-file waiver. Violating any is a correctness defect.

1. **Never remove the `zoomGeneration` gesture-start bump.** `handlePdfjsZoomPhase` (`PDFViewer.jsx:1820–1822`) must keep `if (phase === 'gesture-start') setZoomGeneration((prev) => prev + 1)`. All mounted Canvas tools (FabricDrawingCanvas/Eraser/Edit) watch this to auto-commit in-progress work before the container resizes.
2. **Container-aware canvas sizing.** Canvas components must measure `containerEl.offsetWidth / pageSize.width` for `effectiveScale` — never `pageSize * reportedZoom`. The Electron/browser zoom factor creates a mismatch. Verify `PageAnnotationLayer` host measurement still works after any overlay reparenting.
3. **SVG viewBox owns all zoom scaling.** `SVGAnnotationLayer` scales via `viewBox="0 0 pageW pageH"` with zero JavaScript zoom coordination. Never reintroduce JS zoom math there; never add explicit width/height that conflicts with the wrapper transform.
4. **Do NOT structurally edit the per-page overlay portal render loop in `PDFViewer.jsx`.** This is why Strategy B (imperative transform on existing overlayDivs) was chosen over Strategy A (re-parent). Adding a `return true` short-circuit to the *filter* is a guard, not a structural edit; mounting `PdfjsTextLayer` next to the existing `PdfjsLinkLayer` follows the established pattern. Do not rewrite the loop's iteration/portal mechanics.
5. **`getPDFViewerEngine()` is the ONLY engine gate — NOT `useSyncfusionRenderer`.** `useSyncfusionRenderer` is hard-coded `true` (`PDFViewer.jsx:819`); code gated on it runs under BOTH engines. Gate every new pdf.js-only line on `getPDFViewerEngine() === PDF_VIEWER_ENGINE_PDFJS`. Never trust a "gated off under pdf.js" claim that cites `useSyncfusionRenderer`.
6. **High-risk files — minimum viable diff.** `src/PDFViewer.jsx` (~34k lines) and `src/components/PdfjsViewerContainer.jsx` are load-bearing. Keep edits small and scoped; do not refactor while inside. Run `npm test` after every touch and report baseline.

---

## Verification

The **demo is the reference** for every feature. For each, compare app behavior side-by-side against `?spike=features`.

### Per-feature live checks

- **Glued zoom:** Open a doc with annotations + forms + links. Ctrl/Cmd + wheel-zoom from a point on the page. **Pass:** markups, form inputs, link hotspots, and search highlights stay pinned to the same page content under the cursor through the entire gesture (no slip, no snap-back on settle). Compare to the demo — they should feel identical. **Fail:** overlay slips during the ~110ms gesture and jumps into place on settle.
- **Text select/copy:** Drag-select text over the canvas; Cmd+C; paste elsewhere. **Pass:** native selection highlights cover the glyphs and copied text matches. Confirm spans stay aligned after a zoom (rides the glued-zoom transform).
- **Links:** Open a **links-only PDF on a clean page (no app annotations)**. **Pass:** link hotspots render (portal-gate fix), clicking an internal link jumps to the page, external opens via `electronAPI.openExternal`. Zoom — no drift.
- **Forms:** Open a form PDF. Type into a text field, toggle a checkbox/radio. **Pass:** widgets render on a pure-form page in pan mode (portal-gate fix), values persist across reload (Yjs/Supabase), and inputs stay glued through a zoom gesture.
- **Bookmarks:** Open a PDF with an outline. **Pass:** outline appears in the sidebar, clicking a leaf jumps to the page, and (with the guard) only one extraction runs under pdf.js — confirm no second `extractPdfOutlineBookmarks` at ~3.2s.
- **Zoom feel/perf:** Wheel-zoom past `BASE_MAX_SCALE=2.5`. **Pass:** DetailTile sharpens the visible slice on settle; settle timing (~110ms) and cursor anchoring match the demo. Profile on the **36-page package document** for the per-frame overlay loop.

### Instrumentation

- **App log:** `Cmd+Shift+L` dumps the in-app diagnostic log. Use it to confirm `onZoomPhase('live'/'settle')` emissions and overlay re-pin timing, and to verify the form layer no longer vanishes/snaps during a gesture (the 2026-06-02 session-moments log captured the pre-fix vanish/snap).
- **In-browser coordinate check (do before trusting the math):** measure `overlayRoot.getBoundingClientRect().left` and the engine scroller's `getBoundingClientRect().left` independently — they should be equal. On Electron, confirm the zoom factor doesn't introduce an offset that would turn glue into parallax.

### Build + test gate

- `npm run build` must pass.
- `npm test` baseline is **840 passing / 0 failing / 6 skipped**. Report this baseline before and after every change to a high-risk file. Any new failure is a regression to fix before proceeding.
